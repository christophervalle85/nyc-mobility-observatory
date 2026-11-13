"""Validate a completed M1 archive and publish monthly aggregate dashboard asset."""

import argparse
import calendar
import csv
import hashlib
import io
import json
import os
import re
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

WEB = Path(__file__).resolve().parents[1]


def object_value(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def integer(value: object, label: str) -> int:
    if type(value) is not int or value < 0 or value > 9007199254740991:
        raise ValueError(f"{label} must be a nonnegative safe integer")
    return value


def verified_bytes(run: Path, outputs: dict, name: str) -> bytes:
    record = object_value(outputs.get(name), f"manifest output {name}")
    data = (run / name).read_bytes()
    if integer(record.get("bytes"), "output bytes") != len(data):
        raise ValueError(f"{name}: manifest byte count mismatch")
    if record.get("sha256") != hashlib.sha256(data).hexdigest():
        raise ValueError(f"{name}: manifest SHA-256 mismatch")
    return data


def month_calendar(value: object) -> tuple[str, datetime, int]:
    """The dense local-clock format cannot represent DST gaps or repeated hours."""
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        raise ValueError("Month must use YYYY-MM")
    start = datetime.strptime(value, "%Y-%m")
    hours = calendar.monthrange(start.year, start.month)[1] * 24
    timezone = ZoneInfo("America/New_York")
    for hour in range(hours):
        stamp = start + timedelta(hours=hour)
        if (
            stamp.replace(tzinfo=timezone, fold=0).utcoffset()
            != stamp.replace(tzinfo=timezone, fold=1).utcoffset()
        ):
            raise ValueError(
                "DST-transition months are unsupported by the local-clock asset format"
            )
    return value, start, hours


def export(run: Path, geography: Path) -> bytes:
    manifest = object_value(json.loads((run / "manifest.json").read_bytes()), "manifest")
    identity = object_value(manifest.get("identity"), "identity")
    if manifest.get("status") != "completed":
        raise ValueError("A completed run is required")
    month, start, hours = month_calendar(identity.get("month"))
    run_id = manifest.get("run_id")
    if not isinstance(run_id, str) or not re.fullmatch(r"[0-9a-f]{64}", run_id):
        raise ValueError("Invalid portable run ID")
    outputs = object_value(manifest.get("outputs"), "outputs")
    source = verified_bytes(run, outputs, "taxi/zone_hour.csv")
    quality = object_value(
        json.loads(verified_bytes(run, outputs, "taxi/quality.json")), "taxi quality"
    )
    if quality.get("timezone") != "America/New_York":
        raise ValueError("Unsupported taxi timezone")
    if quality.get("adjacent_pickup_month_files_included") is not False:
        raise ValueError("Expected single pickup-month source coverage")
    geo = object_value(json.loads(geography.read_bytes()), "geography")
    features = geo.get("features")
    if geo.get("type") != "FeatureCollection" or not isinstance(features, list):
        raise ValueError("Expected a geography FeatureCollection")
    ids = []
    for feature in features:
        props = object_value(object_value(feature, "feature").get("properties"), "properties")
        ids.append(integer(props.get("location_id"), "location_id"))
    if sorted(ids) != list(range(1, 264)):
        raise ValueError("Geography must contain each known TLC zone 1–263 exactly once")
    zones = {str(zone): [0] * hours for zone in sorted(ids)}
    reader = csv.reader(io.StringIO(source.decode("utf-8")), strict=True)
    if next(reader, None) != ["dropoff_hour_local", "DOLocationID", "trip_count"]:
        raise ValueError("Unexpected aggregate CSV header")
    seen = set()
    total = 0
    for row in reader:
        if len(row) != 3:
            raise ValueError("Aggregate row must have exactly three columns")
        label, zone, count_text = row
        if zone not in zones or not re.fullmatch(r"0|[1-9][0-9]*", count_text):
            raise ValueError("Invalid zone or nonnegative integer count")
        stamp = datetime.strptime(label, "%Y-%m-%d %H:%M:%S")
        hour = int((stamp - start).total_seconds() // 3600)
        if label != stamp.strftime("%Y-%m-%d %H:00:00") or not 0 <= hour < hours:
            raise ValueError("Hour must be an exact local-clock hour in the manifest month")
        key = (zone, hour)
        if key in seen:
            raise ValueError("Duplicate zone/hour row")
        seen.add(key)
        count = integer(int(count_text), "trip_count")
        zones[zone][hour] = count
        total += count
    integer(total, "totalDropoffs")
    if total != integer(quality.get("eligible_rows"), "eligible_rows"):
        raise ValueError("Aggregate total does not reconcile to eligible_rows")
    if len(seen) != integer(quality.get("aggregate_rows"), "aggregate_rows"):
        raise ValueError("Aggregate row count does not reconcile to quality report")
    result = {
        "version": 1,
        "month": month,
        "timezone": "America/New_York",
        "runId": run_id,
        "sourceSha256": hashlib.sha256(source).hexdigest(),
        "totalDropoffs": total,
        "zones": zones,
    }
    return (json.dumps(result, separators=(",", ":")) + "\n").encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--geography", type=Path, default=WEB / "public/data/taxi-zones.geojson")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        data = export(args.run_dir, args.geography)
        month = json.loads(data)["month"]
        output = args.output or WEB / f"public/data/yellow-taxi-{month}.json"
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(data)
            os.replace(temporary, output)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    except (OSError, ValueError, csv.Error) as exc:
        parser.exit(1, f"Export failed: {exc}\n")
    print(f"Exported {len(data)} bytes")


if __name__ == "__main__":
    main()
