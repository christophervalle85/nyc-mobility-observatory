"""Export validated monthly subway comparison observations, preserving unknown hours."""

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

from export_yellow_taxi_dashboard import WEB, integer, month_calendar, object_value, verified_bytes

HEADER = [
    "transit_hour_local",
    "station_complex_id",
    "station_complex",
    "borough",
    "latitude",
    "longitude",
    "ridership",
    "observation",
    "model_eligible",
    "comparison_eligible",
    "exclusion_reason",
]


def export(run: Path) -> bytes:
    manifest = object_value(json.loads((run / "manifest.json").read_bytes()), "manifest")
    identity = object_value(manifest.get("identity"), "identity")
    if manifest.get("status") != "completed":
        raise ValueError("A completed run is required")
    month, start, hours = month_calendar(identity.get("month"))
    run_id = manifest.get("run_id")
    if not isinstance(run_id, str) or not re.fullmatch(r"[0-9a-f]{64}", run_id):
        raise ValueError("Invalid portable run ID")
    outputs = object_value(manifest.get("outputs"), "outputs")
    source = verified_bytes(run, outputs, "subway/station_hour.csv")
    quality = object_value(
        json.loads(verified_bytes(run, outputs, "subway/quality.json")), "subway quality"
    )
    if quality.get("month") != month or quality.get("timezone") != "America/New_York":
        raise ValueError("Invalid subway month or timezone")
    ids = quality.get("station_universe_ids")
    if not isinstance(ids, list) or not ids:
        raise ValueError("Missing station universe")
    ids = [integer(value, "station ID") for value in ids]
    if len(set(ids)) != len(ids) or 0 in ids:
        raise ValueError("Station IDs must be unique and positive")
    if len(ids) != integer(quality.get("station_universe_count"), "station_universe_count"):
        raise ValueError("Station universe count mismatch")
    stations = {
        value: {"id": value, "name": "", "borough": "", "counts": [None] * hours}
        for value in sorted(ids)
    }
    identities = {}
    seen = set()
    observed = comparable = 0
    reader = csv.reader(io.StringIO(source.decode("utf-8")), strict=True)
    if next(reader, None) != HEADER:
        raise ValueError("Unexpected subway CSV header")
    for row in reader:
        if len(row) != len(HEADER):
            raise ValueError("Unexpected subway row width")
        label, station_text, name, borough, lat, lon, value, obs, model, comparison, reason = row
        if not re.fullmatch(r"[1-9][0-9]*", station_text):
            raise ValueError("Invalid station ID")
        station_id = int(station_text)
        if station_id not in stations:
            raise ValueError("Unknown station ID")
        station_identity = (name, borough, lat, lon)
        if not name.strip() or not borough.strip():
            raise ValueError("Missing station identity")
        if station_id in identities and identities[station_id] != station_identity:
            raise ValueError("Station identity changed")
        if station_id not in identities:
            latitude, longitude = float(lat), float(lon)
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                raise ValueError("Invalid station coordinates")
            stations[station_id].update(latitude=latitude, longitude=longitude)
            identities[station_id] = station_identity
        stamp = datetime.strptime(label, "%Y-%m-%d %H:%M:%S")
        hour = int((stamp - start).total_seconds() // 3600)
        if label != stamp.strftime("%Y-%m-%d %H:00:00") or not 0 <= hour < hours:
            raise ValueError("Invalid hour for manifest month")
        key = (station_id, hour)
        if key in seen:
            raise ValueError("Duplicate station/hour")
        seen.add(key)
        if any(flag not in ("true", "false") for flag in (obs, model, comparison)):
            raise ValueError("Invalid eligibility flag")
        if comparison == "true" and (obs != "true" or model != "true" or reason):
            raise ValueError("Inconsistent comparison eligibility")
        if obs == "false" and (value or model != "false" or reason != "missing_observation"):
            raise ValueError("Inconsistent missing observation")
        count = None
        if obs == "true":
            observed += 1
            count = float(value)
            if not math.isfinite(count) or not 0 <= count <= 9007199254740991:
                raise ValueError("Ridership must be finite and nonnegative")
        if comparison == "true":
            comparable += 1
            stations[station_id]["counts"][hour] = count
        stations[station_id]["name"] = name
        stations[station_id]["borough"] = borough
    expected = {
        "station_hour_denominator": len(stations) * hours,
        "observed_station_hours": observed,
        "eligible_station_hours": comparable,
        "missing_station_hours": len(stations) * hours - observed,
    }
    if len(seen) != len(stations) * hours:
        raise ValueError("Archive must explicitly account for every station/hour")
    for field, actual in expected.items():
        if integer(quality.get(field), field) != actual:
            raise ValueError(f"Quality reconciliation failed: {field}")
    result = {
        "version": 1,
        "month": month,
        "timezone": "America/New_York",
        "runId": run_id,
        "sourceSha256": hashlib.sha256(source).hexdigest(),
        "stations": list(stations.values()),
    }
    return (json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n").encode()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    temporary = None
    try:
        data = export(args.run_dir)
        month = json.loads(data)["month"]
        output = args.output or WEB / f"public/data/subway-{month}.json"
        with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
        os.replace(temporary, output)
    except (OSError, ValueError, csv.Error) as exc:
        parser.exit(1, f"Export failed: {exc}\n")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(f"Exported {len(data)} bytes")


if __name__ == "__main__":
    main()
