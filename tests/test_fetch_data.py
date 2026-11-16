import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_data  # noqa: E402


def row(fund_id, period, y, name="קרן"):
    return {"FUND_ID": fund_id, "REPORT_PERIOD": period, "MONTHLY_YIELD": y, "FUND_NAME": name + " "}


class BuildTests(unittest.TestCase):
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

    def test_insurance_source_uses_its_own_key_and_corp_column(self):
        r = row(7, 200201, 1.0)
        r["PARENT_COMPANY_NAME"] = "חברה"
        out = fetch_data.build([r], "insurance")
        self.assertEqual((out[0]["key"], out[0]["src"], out[0]["corp"]), ("i:7", "insurance", "חברה"))


if __name__ == "__main__":
    unittest.main()
