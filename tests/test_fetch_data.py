import sys
import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_data  # noqa: E402


def row(fund_id, period, y, name="קרן"):
    return {"FUND_ID": fund_id, "REPORT_PERIOD": period, "MONTHLY_YIELD": y, "FUND_NAME": name + " "}


class BuildTests(unittest.TestCase):
    def test_catalog_shards_round_trip_every_bundled_field_and_series(self):
        root = Path(__file__).resolve().parent.parent / "docs" / "data"
        base = json.loads((root / "funds.json").read_text())
        pension = json.loads((root / "pension.json").read_text())
        expected = {**base, "funds": base["funds"] + pension}
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "funds.json"
            fetch_data.write_catalog(expected, out)
            actual = json.loads(out.read_text())
            actual["funds"] += json.loads(out.with_name("pension.json").read_text())
            self.assertEqual(actual, expected)
            for name in ["funds.json", "pension.json", "catalog.json"]:
                self.assertEqual((Path(tmp) / name).read_bytes(), (root / name).read_bytes())
                self.assertLessEqual((Path(tmp) / name).stat().st_size, 2_097_152)

    def test_refresh_main_writes_both_shards(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "funds.json"
            def fake_build(rows, source):
                return [{"src": source, "end": 202601, "y": [None, 0.123456789]}]
            with mock.patch.object(fetch_data, "OUT", out), mock.patch.object(fetch_data, "fetch_all", return_value=[]), mock.patch.object(fetch_data, "build", side_effect=fake_build):
                self.assertEqual(fetch_data.main(), 0)
            self.assertEqual([f["src"] for f in json.loads(out.read_text())["funds"]], ["gemel", "insurance"])
            self.assertEqual(json.loads(out.with_name("pension.json").read_text()), [{"src": "pension", "end": 202601, "y": [None, 0.123456789]}])

    def test_oversized_shard_fails_before_writing_either_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "funds.json"
            with self.assertRaisesRegex(ValueError, "existing file cap"):
                fetch_data.write_catalog({"funds": [{"src": "pension", "name": "x" * 2_097_152}]}, out)
            self.assertFalse(out.exists())
            self.assertFalse(out.with_name("pension.json").exists())

    def test_month_index_is_consecutive_across_years(self):
        self.assertEqual(fetch_data.month_index(200201) - fetch_data.month_index(200112), 1)

    def test_dense_series_with_gap(self):
        out = fetch_data.build([row(1, 200201, 1.0), row(1, 200203, 3.0)])
        fund = out[0]
        self.assertEqual(fund["y"], [1.0, None, 3.0])
        self.assertEqual((fund["start"], fund["end"]), (200201, 200203))
        self.assertEqual(fund["key"], "g:1")

    def test_skips_rows_without_yield_and_trims_names(self):
        out = fetch_data.build([row(2, 200201, None), row(2, 200202, 0.5, "שם")])
        self.assertEqual(out[0]["name"], "שם")
        self.assertEqual(out[0]["y"], [0.5])

    def test_pension_source_keeps_namespace_and_missing_months(self):
        rows = [row(7, 202001, 1.0), row(7, 202003, 2.0)]
        rows[0]["PARENT_COMPANY_NAME"] = "Synthetic pension"
        rows[1]["PARENT_COMPANY_NAME"] = "Synthetic pension"
        fund = fetch_data.build(rows, "pension")[0]
        self.assertEqual((fund["key"], fund["src"]), ("p:7", "pension"))
        self.assertEqual(fund["corp"], "Synthetic pension")
        self.assertEqual(fund["y"], [1.0, None, 2.0])

    def test_insurance_source_uses_its_own_key_and_corp_column(self):
        r = row(7, 200201, 1.0)
        r["PARENT_COMPANY_NAME"] = "חברה"
        out = fetch_data.build([r], "insurance")
        self.assertEqual((out[0]["key"], out[0]["src"], out[0]["corp"]), ("i:7", "insurance", "חברה"))


if __name__ == "__main__":
    unittest.main()
