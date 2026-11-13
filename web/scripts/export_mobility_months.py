"""Publish the availability catalog after exporting mode assets into the data directory."""

import argparse
import json
import math
import os
import re
import tempfile
from pathlib import Path

from export_yellow_taxi_dashboard import WEB, integer, month_calendar, object_value


def catalog(data_dir: Path) -> bytes:
    months = {}
    run_ids = {}
    for path in sorted(data_dir.iterdir()):
        match = re.fullmatch(r"(yellow-taxi|subway)-([0-9]{4}-[0-9]{2})\.json", path.name)
        if match is None:
            continue
        mode = "taxi" if match[1] == "yellow-taxi" else "subway"
        month, _, hours = month_calendar(match[2])
        asset = object_value(json.loads(path.read_bytes()), path.name)
        if (
            type(asset.get("version")) is not int
            or asset["version"] != 1
            or asset.get("month") != month
            or asset.get("timezone") != "America/New_York"
        ):
            raise ValueError(f"Invalid asset contract: {path.name}")
        for field in ("runId", "sourceSha256"):
            if not isinstance(asset.get(field), str) or not re.fullmatch(
                r"[0-9a-f]{64}", asset[field]
            ):
                raise ValueError(f"Invalid {field}: {path.name}")
        if month in run_ids and run_ids[month] != asset["runId"]:
            raise ValueError(f"Modes must share a completed run for {month}")
        run_ids[month] = asset["runId"]
        if mode == "taxi":
            zones = object_value(asset.get("zones"), "zones")
            if set(zones) != {str(i) for i in range(1, 264)}:
                raise ValueError("Taxi asset must contain zones 1–263")
            counts = list(zones.values())
        else:
            stations = asset.get("stations")
            if not isinstance(stations, list) or not stations:
                raise ValueError("Subway asset must contain stations")
            ids = set()
            counts = []
            for raw_station in stations:
                station = object_value(raw_station, "station")
                station_id = integer(station.get("id"), "station ID")
                if station_id == 0 or station_id in ids:
                    raise ValueError("Station IDs must be positive and unique")
                ids.add(station_id)
                for field in ("name", "borough"):
                    if not isinstance(station.get(field), str) or not station[field].strip():
                        raise ValueError(f"Invalid station {field}")
                for field, limit in (("latitude", 90), ("longitude", 180)):
                    coordinate = station.get(field)
                    if (
                        type(coordinate) not in (int, float)
                        or not math.isfinite(coordinate)
                        or not -limit <= coordinate <= limit
                    ):
                        raise ValueError(f"Invalid station {field}")
                counts.append(station.get("counts"))
        total = 0
        for values in counts:
            if not isinstance(values, list) or len(values) != hours:
                raise ValueError(f"Invalid hour count: {path.name}")
            for value in values:
                if mode == "subway" and value is None:
                    continue
                if mode == "taxi":
                    total += integer(value, "taxi count")
                elif (
                    type(value) not in (int, float)
                    or not math.isfinite(value)
                    or not 0 <= value <= 9007199254740991
                ):
                    raise ValueError("Invalid subway count")
        if mode == "taxi" and integer(asset.get("totalDropoffs"), "totalDropoffs") != total:
            raise ValueError("Taxi total does not reconcile")
        months.setdefault(month, {"month": month, "taxi": False, "subway": False})[mode] = True
    if not months:
        raise ValueError("No validated mobility assets; preserving the existing catalog")
    result = {"version": 1, "months": [months[month] for month in sorted(months, reverse=True)]}
    return (json.dumps(result, separators=(",", ":")) + "\n").encode()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=WEB / "public/data")
    args = parser.parse_args()
    temporary = None
    try:
        data = catalog(args.data_dir)
        with tempfile.NamedTemporaryFile(dir=args.data_dir, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
        os.replace(temporary, args.data_dir / "mobility-months.json")
    except (OSError, ValueError) as exc:
        parser.exit(1, f"Catalog export failed: {exc}\n")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(f"Exported catalog ({len(data)} bytes)")


if __name__ == "__main__":
    main()
