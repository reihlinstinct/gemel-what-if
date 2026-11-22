"""Download monthly Gemel-Net yields from data.gov.il and build docs/data/funds.json.

Source: https://data.gov.il/dataset/gemelnet (Capital Market Authority, open data).
Only public, aggregated fund data is read. Standard library only.
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://data.gov.il/api/3/action/datastore_search"
# source -> (key prefix, dataset page, resources, corporation column)
SOURCES = {
    "gemel": {
        "prefix": "g",
        "dataset": "https://data.gov.il/dataset/gemelnet",
        "corp_field": "MANAGING_CORPORATION",
        "resources": {
            "1999-2022": "91c849ed-ddc4-472b-bd09-0f5486cea35c",
            "2023": "2016d770-f094-4a2e-983e-797c26479720",
            "2024-now": "a30dcbea-a1d2-482c-ae29-8f781f5025fb",
        },
    },
    "pension": {
        "prefix": "p",
        "dataset": "https://data.gov.il/he/datasets/cma/pensia-net/6d47d6b5-cb08-488b-b333-f1e717b1e1bd",
        "corp_field": "PARENT_COMPANY_NAME",
        "resources": {
            "1999-2022": "a66926f3-e396-4984-a4db-75486751c2f7",
            "2023": "4694d5a7-5284-4f3d-a2cb-5887f43fb55e",
            "2024-now": "6d47d6b5-cb08-488b-b333-f1e717b1e1bd",
        },
    },
    "insurance": {
        "prefix": "i",
        "dataset": "https://data.gov.il/dataset/insurance",
        "corp_field": "PARENT_COMPANY_NAME",
        "resources": {
            "1999-2022": "584e6b69-174f-46c9-b8db-03925b4c68c6",
            "2023": "672090ba-7893-4496-a07c-dc7e822cbf18",
            "2024-now": "c6c62cc7-fe02-4b18-8f3e-813abfbb4647",
        },
    },
}
PAGE = 30000
OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "funds.json"


def fetch_page(resource_id: str, offset: int) -> dict:
    # No field filter: the two datasets name some columns differently.
    query = urllib.parse.urlencode(
        {"resource_id": resource_id, "limit": PAGE, "offset": offset}
    )
    req = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": "gemel-what-if"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.load(resp)["result"]


def fetch_all(resource_id: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        result = fetch_page(resource_id, offset)
        rows.extend(result["records"])
        offset += PAGE
        if offset >= result["total"]:
            return rows


def month_index(period: int) -> int:
    """YYYYMM -> months since year 0, so consecutive months differ by 1."""
    return (period // 100) * 12 + (period % 100 - 1)


def build(rows: list[dict], source: str = "gemel") -> list[dict]:
    """Group raw rows into one record per fund with a dense monthly-yield series."""
    cfg = SOURCES[source]
    funds: dict[int, dict] = {}
    for row in rows:
        period = row.get("REPORT_PERIOD")
        if not period or row.get("MONTHLY_YIELD") is None:
            continue
        fund = funds.setdefault(
            row["FUND_ID"], {"months": {}, "meta": {}, "assets": {}}
        )
        fund["months"][month_index(period)] = (period, row["MONTHLY_YIELD"])
        # Keep the latest metadata seen (names and fees change over time).
        if period >= fund["meta"].get("period", 0):
            fund["meta"] = {
                "period": period,
                "name": (row.get("FUND_NAME") or "").strip(),
                "cls": row.get("FUND_CLASSIFICATION"),
                "corp": row.get(cfg["corp_field"]),
                "spec": row.get("SPECIALIZATION"),
                "sub": row.get("SUB_SPECIALIZATION"),
                "pop": row.get("TARGET_POPULATION"),
                "fee": row.get("AVG_ANNUAL_MANAGEMENT_FEE"),
                "dfee": row.get("AVG_DEPOSIT_FEE"),
                "assets": row.get("TOTAL_ASSETS"),
            }
    out = []
    for fund_id, fund in sorted(funds.items()):
        idxs = sorted(fund["months"])
        first, last = idxs[0], idxs[-1]
        first_period = fund["months"][first][0]
        last_period = fund["months"][last][0]
        series = [
            fund["months"][i][1] if i in fund["months"] else None
            for i in range(first, last + 1)
        ]
        meta = fund["meta"]
        out.append(
            {
                "key": f"{cfg['prefix']}:{fund_id}",
                "src": source,
                "id": fund_id,
                "name": meta["name"],
                "cls": meta["cls"],
                "corp": meta["corp"],
                "spec": meta["spec"],
                "sub": meta["sub"],
                "pop": meta["pop"],
                "fee": meta["fee"],
                "dfee": meta["dfee"],
                "assets": meta["assets"],
                "start": first_period,
                "end": last_period,
                "y": series,
            }
        )
    return out


def write_catalog(data: dict, out: Path | None = None) -> None:
    """Losslessly shard public data below the per-file cap; consumers concatenate.

    Keep the existing Gemel/insurance catalog shape. Pension records live in a
    separate array, preserving every field and monthly value without compression
    dependencies, rounding, deduplication or guard exceptions.
    """
    out = out or OUT
    pension = [f for f in data["funds"] if f["src"] == "pension"]
    base = {**data, "funds": [f for f in data["funds"] if f["src"] != "pension"]}
    encoded_shards = []
    for path, value in [(out, base), (out.with_name("pension.json"), pension)]:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 2_097_152:
            raise ValueError(f"catalog shard exceeds the existing file cap: {path.name}")
        encoded_shards.append((path, encoded))
    out.parent.mkdir(parents=True, exist_ok=True)
    for path, encoded in encoded_shards:
        path.write_text(encoded, encoding="utf-8")


def main() -> int:
    funds: list[dict] = []
    for source, cfg in SOURCES.items():
        rows: list[dict] = []
        for label, rid in cfg["resources"].items():
            part = fetch_all(rid)
            print(f"{source} {label}: {len(part)} rows", file=sys.stderr)
            rows.extend(part)
        funds.extend(build(rows, source))
    data = {
        "sources": {name: cfg["dataset"] for name, cfg in SOURCES.items()},
        "latest": max(f["end"] for f in funds),
        "funds": funds,
    }
    write_catalog(data)
    print(f"wrote {OUT} ({len(data['funds'])} funds, latest {data['latest']})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
