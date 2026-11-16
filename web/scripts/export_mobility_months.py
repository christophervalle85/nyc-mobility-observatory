"""Publish the availability catalog after exporting mode assets into the data directory."""

import argparse
import json
import math
import os
import re
import tempfile
from collections.abc import Iterable
from pathlib import Path

from export_yellow_taxi_dashboard import WEB, clock_change, integer, month_calendar, object_value


def published_run_pairs(data_dir: Path) -> dict[str, tuple[str, str]]:
    index = data_dir / "mobility-months.json"
    if not index.exists():
        return {}
    if index.is_symlink():
        raise ValueError("Catalog cannot be a symbolic link")
    document = object_value(json.loads(index.read_bytes()), "catalog")
    entries = document.get("months")
    if (
        type(document.get("version")) is not int
        or document["version"] != 1
        or not isinstance(entries, list)
    ):
        raise ValueError("Invalid published catalog")
    pairs = {}
    for entry in entries:
        entry = object_value(entry, "month entry")
        if not {"taxiRunId", "subwayRunId"} & entry.keys():
            continue
        month, _, _ = month_calendar(entry.get("month"), allow_transition=True)
        if month in pairs or entry.get("taxi") is not True or entry.get("subway") is not True:
            raise ValueError("Invalid independent run binding")
        pairs[month] = (entry.get("taxiRunId"), entry.get("subwayRunId"))
    return pairs


def catalog(
    data_dir: Path,
    *,
    independent_runs: dict[str, tuple[str, str]] | None = None,
    asset_paths: Iterable[Path] | None = None,
) -> bytes:
    months = {}
    run_ids = {}
    pairs = published_run_pairs(data_dir) if independent_runs is None else independent_runs
    for path in sorted(data_dir.iterdir() if asset_paths is None else asset_paths):
        match = re.fullmatch(r"(yellow-taxi|subway)-([0-9]{4}-[0-9]{2})\.json", path.name)
        if match is None:
            continue
        mode = "taxi" if match[1] == "yellow-taxi" else "subway"
        month, start, hours = month_calendar(match[2], allow_transition=True)
        change = clock_change(month, start, hours)
        asset = object_value(json.loads(path.read_bytes()), path.name)
        if (
            type(asset.get("version")) is not int
            or asset["version"] != (2 if change else 1)
            or asset.get("month") != month
            or asset.get("timezone") != "America/New_York"
        ):
            raise ValueError(f"Invalid asset contract: {path.name}")
        if change:
            if (
                asset.get("clockChange") != change
                or type(asset["clockChange"].get("hour")) is not int
            ):
                raise ValueError("Invalid clockChange metadata")
        elif "clockChange" in asset:
            raise ValueError("Ordinary month cannot have clockChange metadata")
        for field in ("runId", "sourceSha256"):
            if not isinstance(asset.get(field), str) or not re.fullmatch(
                r"[0-9a-f]{64}", asset[field]
            ):
                raise ValueError(f"Invalid {field}: {path.name}")
        run_ids.setdefault(month, {})[mode] = asset["runId"]
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
                values = station.get("counts")
                if change:
                    recorded = station.get("recordedCounts")
                    offset = (int(change["date"][-2:]) - 1) * 24
                    if (
                        not isinstance(values, list)
                        or len(values) != hours
                        or any(value is not None for value in values[offset : offset + 24])
                    ):
                        raise ValueError("Transition subway comparison counts must be null")
                    if not isinstance(recorded, list) or len(recorded) != 24:
                        raise ValueError("Invalid transition recordedCounts length")
                    for value in recorded:
                        if value is not None and (
                            type(value) not in (int, float)
                            or not math.isfinite(value)
                            or not 0 <= value <= 9007199254740991
                        ):
                            raise ValueError("Invalid recorded subway count")
                    if change["kind"] == "nonexistent" and recorded[2] is not None:
                        raise ValueError("Nonexistent subway hour must be null")
                elif "recordedCounts" in station:
                    raise ValueError("Ordinary stations cannot have transition recordedCounts")
                counts.append(values)
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
    for month, pair in pairs.items():
        observed = run_ids.get(month, {})
        if (
            set(observed) != {"taxi", "subway"}
            or pair != (observed["taxi"], observed["subway"])
            or pair[0] == pair[1]
        ):
            raise ValueError(f"Invalid independent run binding for {month}")
        months[month].update(taxiRunId=pair[0], subwayRunId=pair[1])
    for month, modes in run_ids.items():
        if len(set(modes.values())) > 1 and month not in pairs:
            raise ValueError(f"Modes must share a completed run for {month}")
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
