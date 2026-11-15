"""Bounded official-source discovery; candidates still require capture and export validation."""

import calendar
import csv
import io
import re
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from .acquisition import MTA_DATASETS, TLC_INDEX, download, utc_now, verify_asset
from .core import month_bounds

MAX_MONTHS = 1200


class YellowLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.months: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        for key, value in attrs:
            if key != "href" or value is None:
                continue
            match = re.fullmatch(
                r"https://d37ci6vzurychx\.cloudfront\.net/trip-data/"
                r"yellow_tripdata_([0-9]{4}-(?:0[1-9]|1[0-2]))\.parquet",
                value,
            )
            if match:
                month_bounds(match[1])
                self.months.add(match[1])
                if len(self.months) > MAX_MONTHS:
                    raise ValueError("TLC index exceeds bounded month limit")


def parse_tlc(data: bytes) -> list[str]:
    parser = YellowLinks()
    parser.feed(data.decode("utf-8"))
    return sorted(parser.months, reverse=True)


def coverage_url(dataset: str) -> str:
    if dataset not in MTA_DATASETS:
        raise ValueError("Unsupported MTA dataset")
    period = "date_trunc_ym(transit_timestamp)"
    return f"https://data.ny.gov/resource/{dataset}.csv?" + urlencode(
        {
            "$select": f"{period} as month,min(transit_timestamp) as first,"
            "max(transit_timestamp) as last,count(*) as count",
            "$group": period,
            "$order": "month",
            "$limit": MAX_MONTHS + 1,
            "$where": "transit_mode = 'subway'",
        }
    )


def parse_coverage(data: bytes, dataset: str) -> list[dict]:
    if dataset not in MTA_DATASETS:
        raise ValueError("Unsupported MTA dataset")
    reader = csv.DictReader(io.StringIO(data.decode("utf-8")), strict=True)
    if reader.fieldnames != ["month", "first", "last", "count"]:
        raise ValueError("Unexpected MTA coverage schema")
    rows, seen = [], set()
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            raise ValueError("Malformed MTA coverage row")
        if len(rows) >= MAX_MONTHS:
            raise ValueError("MTA coverage exceeds bounded month limit")
        label = datetime.fromisoformat(row["month"])
        month = label.strftime("%Y-%m")
        month_bounds(month)
        if label.tzinfo is not None or label != datetime(label.year, label.month, 1):
            raise ValueError("Invalid MTA grouped month")
        if month in seen or not row["count"].isdigit() or int(row["count"]) <= 0:
            raise ValueError("Duplicate month or invalid MTA coverage count")
        if not (
            "2020-01" <= month < "2025-01" if dataset == MTA_DATASETS[0] else month >= "2025-01"
        ):
            raise ValueError("MTA month outside dataset period")
        first, last = (datetime.fromisoformat(row[key]) for key in ("first", "last"))
        if (
            any(
                value.tzinfo is not None or value.strftime("%Y-%m") != month
                for value in (first, last)
            )
            or first > last
        ):
            raise ValueError("Invalid MTA coverage boundaries")
        seen.add(month)
        rows.append(
            {
                "month": month,
                "complete_edges": first.day == 1
                and last.day == calendar.monthrange(label.year, label.month)[1],
            }
        )
    return rows


def span_candidates(root: Path, dataset: str) -> tuple[list[dict], list[dict]]:
    """Provider-timeout fallback: a span supplies candidates, never observed-month proof."""
    if dataset not in MTA_DATASETS:
        raise ValueError("Unsupported MTA dataset")
    stamps, assets = [], []
    for direction in ("ASC", "DESC"):
        url = f"https://data.ny.gov/resource/{dataset}.csv?" + urlencode(
            {
                "$select": "transit_timestamp",
                "$where": "transit_mode = 'subway'",
                "$order": f"transit_timestamp {direction}",
                "$limit": 1,
            }
        )
        asset = download(
            url,
            root,
            f"discovery-mta-{dataset}-{direction.lower()}",
            ".csv",
            max_bytes=4096,
            timeout=60,
            retries=0,
        )
        assets.append(asset)
        reader = csv.DictReader(
            io.StringIO(verify_asset(asset, root).read_bytes().decode()), strict=True
        )
        rows = list(reader)
        if reader.fieldnames != ["transit_timestamp"] or len(rows) > 1:
            raise ValueError("Invalid MTA span probe")
        if not rows:
            stamps.append(None)
            continue
        if set(rows[0]) != {"transit_timestamp"} or not rows[0]["transit_timestamp"]:
            raise ValueError("Invalid MTA span timestamp")
        stamp = datetime.fromisoformat(rows[0]["transit_timestamp"])
        if stamp.tzinfo is not None:
            raise ValueError("MTA span must use local clock timestamps")
        stamps.append(stamp)
    first, last = stamps
    if first is None and last is None:
        return [], assets
    if first is None or last is None or first > last:
        raise ValueError("Inconsistent MTA span probes")
    first_month, last_month = first.strftime("%Y-%m"), last.strftime("%Y-%m")
    if not (
        "2020-01" <= first_month <= last_month < "2025-01"
        if dataset == MTA_DATASETS[0]
        else first_month >= "2025-01"
    ):
        raise ValueError("MTA span outside dataset period")
    entries = []
    month = first_month
    while month <= last_month:
        if len(entries) >= MAX_MONTHS:
            raise ValueError("MTA span exceeds bounded month limit")
        _, end = month_bounds(month)
        days = calendar.monthrange(int(month[:4]), int(month[5:]))[1]
        complete = (month != first_month or first.day == 1) and (
            month != last_month or last.day == days
        )
        entries.append({"month": month, "complete_edges": complete})
        month = end[:7]
    return entries, assets


def provider_timeout(exc: BaseException) -> bool:
    return (
        isinstance(exc, TimeoutError)
        or isinstance(exc, HTTPError)
        and (exc.code == 429 or exc.code >= 500)
        or isinstance(exc, URLError)
        and isinstance(exc.reason, TimeoutError)
    )


def discover(root: Path) -> dict:
    current = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m")
    months: dict[str, dict] = {}
    sources, rejected = [], []
    requests = [("tlc", TLC_INDEX, ".html", 5 * 1024**2)] + [
        (f"mta-{dataset}", coverage_url(dataset), ".csv", 1024**2) for dataset in MTA_DATASETS
    ]
    for source, url, suffix, limit in requests:
        asset = None
        try:
            span_assets = []
            fallback_reason = None
            try:
                asset = download(
                    url, root, "discovery-" + source, suffix, max_bytes=limit, timeout=60, retries=0
                )
                data = verify_asset(asset, root).read_bytes()
                entries = (
                    [{"month": month, "complete_edges": True} for month in parse_tlc(data)]
                    if source == "tlc"
                    else parse_coverage(data, source[4:])
                )
            except (OSError, URLError) as exc:
                if source == "tlc" or not provider_timeout(exc):
                    raise
                entries, span_assets = span_candidates(root, source[4:])
                fallback_reason = f"{type(exc).__name__}: {exc}"
            coverage = (
                "published-file"
                if source == "tlc"
                else "date-span-candidate"
                if span_assets
                else "monthly-observed-edges"
            )
            sources.append(
                {
                    "source": source,
                    "status": "ok" if entries else "empty",
                    "asset": asset,
                    "error": None,
                    "coverage": coverage,
                    "span_assets": span_assets,
                    "fallback_reason": fallback_reason,
                }
            )
            for entry in entries:
                month = entry["month"]
                reason = None
                if month >= current:
                    reason = "current or future calendar month"
                elif source == "tlc" and month < "2011-01":
                    reason = "legacy taxi coordinates require a verified zone-ID adapter"
                elif not entry["complete_edges"]:
                    reason = "partial observed month edges"
                if reason:
                    rejected.append({"month": month, "source": source, "reason": reason})
                    continue
                candidate = months.setdefault(
                    month, {"month": month, "taxi": False, "subway": False, "subway_dataset": None}
                )
                if source == "tlc":
                    candidate["taxi"] = True
                else:
                    candidate.update(
                        subway=True, subway_dataset=source[4:], subway_coverage=coverage
                    )
        except (OSError, URLError, ValueError, csv.Error) as exc:
            sources.append(
                {
                    "source": source,
                    "status": "error",
                    "asset": asset,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
    return {
        "version": 1,
        "discovered_at": utc_now(),
        "months": [months[month] for month in sorted(months, reverse=True)],
        "sources": sources,
        "rejected": rejected,
    }
