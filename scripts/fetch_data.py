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
RESOURCES = {
    "1999-2022": "91c849ed-ddc4-472b-bd09-0f5486cea35c",
    "2023": "2016d770-f094-4a2e-983e-797c26479720",
    "2024-now": "a30dcbea-a1d2-482c-ae29-8f781f5025fb",
}
PAGE = 30000
OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "funds.json"


def fetch_page(resource_id: str, offset: int) -> dict:
    query = urllib.parse.urlencode(
        {
            "resource_id": resource_id,
            "limit": PAGE,
            "offset": offset,
            "fields": "FUND_ID,FUND_NAME,FUND_CLASSIFICATION,MANAGING_CORPORATION,"
            "SPECIALIZATION,SUB_SPECIALIZATION,TARGET_POPULATION,REPORT_PERIOD,"
            "MONTHLY_YIELD,TOTAL_ASSETS,AVG_ANNUAL_MANAGEMENT_FEE",
        }
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


def build(rows: list[dict]) -> dict:
    """Group raw rows into one record per fund with a dense monthly-yield series."""
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
                "corp": row.get("MANAGING_CORPORATION"),
                "spec": row.get("SPECIALIZATION"),
                "sub": row.get("SUB_SPECIALIZATION"),
                "pop": row.get("TARGET_POPULATION"),
                "fee": row.get("AVG_ANNUAL_MANAGEMENT_FEE"),
                "assets": row.get("TOTAL_ASSETS"),
            }
    out = []
    latest = 0
    for fund_id, fund in sorted(funds.items()):
        idxs = sorted(fund["months"])
        first, last = idxs[0], idxs[-1]
        first_period = fund["months"][first][0]
        last_period = fund["months"][last][0]
        latest = max(latest, last_period)
        series = [
            fund["months"][i][1] if i in fund["months"] else None
            for i in range(first, last + 1)
        ]
        meta = fund["meta"]
        out.append(
            {
                "id": fund_id,
                "name": meta["name"],
                "cls": meta["cls"],
                "corp": meta["corp"],
                "spec": meta["spec"],
                "sub": meta["sub"],
                "pop": meta["pop"],
                "fee": meta["fee"],
                "assets": meta["assets"],
                "start": first_period,
                "end": last_period,
                "y": series,
            }
        )
    return {
        "source": "https://data.gov.il/dataset/gemelnet",
        "latest": latest,
        "funds": out,
    }


def main() -> int:
    rows: list[dict] = []
    for label, rid in RESOURCES.items():
        part = fetch_all(rid)
        print(f"{label}: {len(part)} rows", file=sys.stderr)
        rows.extend(part)
    data = build(rows)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({len(data['funds'])} funds, latest {data['latest']})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
