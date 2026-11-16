"""Validate and add archived 2020–2024 subway estimates alongside existing taxi data."""

import argparse
import csv
import errno
import hashlib
import json
import platform
import shutil
import tempfile
from concurrent.futures import ProcessPoolExecutor
from http.client import IncompleteRead
from pathlib import Path
from urllib.parse import urlencode

import duckdb
from backfill import atomic_write, publish_months, registered_assets, resolved_run
from export_mobility_months import catalog, published_run_pairs
from export_subway_dashboard import export
from export_yellow_taxi_dashboard import WEB, month_calendar
from export_yellow_taxi_dashboard import export as export_taxi

from nyc_mobility.acquisition import (
    _count,
    _metadata,
    capture_mta,
    download,
    mta_requests,
    store_bytes,
    verify_asset,
)
from nyc_mobility.core import canonical_bytes, file_hash, reject_symlinks, safe_directory
from nyc_mobility.historical_subway import validate_historical_subway
from nyc_mobility.pipeline import _output_hashes, code_hash

DATASET = "wujg-7c2s"
REFERENCE_URL = "https://data.ny.gov/resource/5f5g-n3cz.csv?" + urlencode(
    {
        "$select": "complex_id,display_name,borough,latitude,longitude",
        "$order": "complex_id",
        "$limit": 1000,
    }
)
CAPTURE_INPUTS = {"subway", "count_before", "count_after", "metadata_before", "metadata_after"}
MONTHS = tuple(
    f"{year}-{month:02d}"
    for year in range(2020, 2025)
    for month in range(1, 13)
    if month not in {3, 11}
)
CLOCK_CHANGE_MONTHS = tuple(
    f"{year}-{month:02d}" for year in range(2020, 2025) for month in (3, 11)
)


def capture(root: Path, month: str) -> tuple[Path, dict]:
    folder = safe_directory(root, root / "raw" / "historical-subway-snapshots")
    for path in sorted(folder.glob("*.json")):
        document = json.loads(reject_symlinks(root, path).read_bytes())
        if document.get("month") == month:
            if path.stem != file_hash(path):
                raise ValueError("Historical subway capture checksum mismatch")
            return path, document
    assets, mta = capture_mta(root, month)
    document = {"version": 1, "month": month, "assets": assets, "mta": mta}
    snapshot = store_bytes(
        canonical_bytes(document),
        root,
        folder.name,
        ".json",
        "derived:official-historical-mta-capture",
    )
    return verify_asset(snapshot, root), document


def verify_capture(root: Path, month: str, document: dict) -> Path:
    assets, mta = document["assets"], document["mta"]
    metadata_url, count_url, source_url, query = mta_requests(month)
    if (
        type(document.get("version")) is not int
        or document["version"] != 1
        or document.get("month") != month
        or set(assets) != CAPTURE_INPUTS
        or mta.get("export_query") != query
    ):
        raise ValueError("Invalid historical subway capture metadata")
    for name, url in (
        ("subway", source_url),
        ("count_before", count_url),
        ("count_after", count_url),
        ("metadata_before", metadata_url),
        ("metadata_after", metadata_url),
    ):
        if assets[name].get("requested_url") != url or assets[name].get("final_url") != url:
            raise ValueError(f"Invalid historical subway source URL for {name}")
    before = _metadata(assets["metadata_before"], root)
    after = _metadata(assets["metadata_after"], root)
    before_count = _count(assets["count_before"], root)
    after_count = _count(assets["count_after"], root)
    version = {
        name: before.get(name)
        for name in (
            "id",
            "name",
            "rowsUpdatedAt",
            "viewLastModified",
            "publicationDate",
            "provenance",
        )
    }
    if (
        before.get("id") != DATASET
        or after.get("id") != DATASET
        or type(before["rowsUpdatedAt"]) is not int
        or type(after["rowsUpdatedAt"]) is not int
        or before["rowsUpdatedAt"] != after["rowsUpdatedAt"]
        or version != mta.get("dataset_version")
        or before_count != after_count
        or any(
            type(mta.get(field)) is not int or mta[field] != before_count
            for field in ("rows_before", "rows_after", "export_rows")
        )
    ):
        raise ValueError("Archived MTA versions or row counts do not reconcile")
    return verify_asset(assets["subway"], root)


def run_month(root: Path, month: str, reference: dict) -> Path:
    if month not in MONTHS + CLOCK_CHANGE_MONTHS:
        raise ValueError("Expected a historical subway month from 2020–2024")
    if (
        reference.get("requested_url") != REFERENCE_URL
        or reference.get("final_url") != REFERENCE_URL
    ):
        raise ValueError("Expected the pinned official MTA station reference")
    reference_path = verify_asset(reference, root)
    snapshot, document = capture(root, month)
    source_path = verify_capture(root, month, document)
    assets, mta = document["assets"], document["mta"]
    inputs = assets | {"station_reference": reference}
    identity = {
        "contract_version": "historical-subway-v1",
        "code_sha256": code_hash(),
        "runner_sha256": file_hash(Path(__file__)),
        "python": platform.python_version(),
        "duckdb": duckdb.__version__,
        "month": month,
        "snapshot_sha256": snapshot.stem,
        "input_sha256": {name: asset["sha256"] for name, asset in inputs.items()},
    }
    run_id = hashlib.sha256(canonical_bytes(identity)).hexdigest()
    runs = safe_directory(root, root / "historical-subway-runs")
    destination = reject_symlinks(root, runs / run_id)
    if not destination.exists():
        stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=runs))
        try:
            subway = stage / "subway"
            subway.mkdir()
            quality = validate_historical_subway(source_path, subway, month, reference_path)
            if quality["input_rows"] != mta["export_rows"]:
                raise ValueError("Historical subway rows do not reconcile to source capture")
            manifest = {
                "status": "completed",
                "run_id": run_id,
                "identity": identity,
                "inputs": inputs,
                "outputs": _output_hashes(stage),
                "mta_capture": mta,
            }
            export_candidate = stage / "manifest.json"
            export_candidate.write_bytes(canonical_bytes(manifest))
            export(stage, require_month_edges=True)
            if (
                code_hash() != identity["code_sha256"]
                or file_hash(Path(__file__)) != identity["runner_sha256"]
            ):
                raise ValueError("Historical subway code changed during validation")
            try:
                stage.rename(destination)
            except OSError as exc:
                if exc.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                    raise
        finally:
            shutil.rmtree(stage, ignore_errors=True)
    manifest = json.loads(reject_symlinks(root, destination / "manifest.json").read_bytes())
    if (
        manifest.get("status") != "completed"
        or manifest.get("run_id") != run_id
        or manifest.get("identity") != identity
        or manifest.get("inputs") != inputs
        or manifest.get("outputs") != _output_hashes(destination)
        or manifest.get("mta_capture") != mta
    ):
        raise ValueError("Historical subway run does not match the frozen inputs and outputs")
    return destination


def validate_job(job: tuple[Path, str, dict]) -> dict:
    root, month, reference = job
    try:
        run = run_month(root, month, reference)
        result = {"month": month, "run": run.name, "status": "validated"}
        if month in CLOCK_CHANGE_MONTHS:
            taxi = resolved_run(root, {"month": month, "subway": False})
            export_taxi(taxi, WEB / "public/data/taxi-zones.geojson")
            result["taxi_run"] = taxi.name
        print(f"{month} validated {run.name}", flush=True)
        return result
    except (
        OSError,
        ValueError,
        csv.Error,
        duckdb.Error,
        KeyError,
        TypeError,
        IncompleteRead,
    ) as exc:
        print(f"{month} failed: {exc}", flush=True)
        return {"month": month, "status": "failed", "reason": str(exc)}


def publish_results(dashboard: Path, root: Path, results: list[dict]) -> None:
    prior = registered_assets(dashboard)
    updates, pairs = {}, {}
    for result in results:
        if result["status"] != "validated":
            continue
        month, run_id = result["month"], result["run"]
        taxi = prior.get(f"yellow-taxi-{month}.json")
        payload = export(root / "historical-subway-runs" / run_id, require_month_edges=True)
        updates[month] = {"subway": payload}
        if taxi is None:
            taxi_id = result.get("taxi_run")
            if month not in CLOCK_CHANGE_MONTHS or not taxi_id:
                raise ValueError(f"Expected a validated taxi export for {month}")
            updates[month]["taxi"] = export_taxi(
                root / "runs" / taxi_id, WEB / "public/data/taxi-zones.geojson"
            )
        else:
            taxi_id = json.loads(taxi.read_bytes())["runId"]
        pairs[month] = (taxi_id, run_id)
    publish_months(dashboard, updates, independent_runs=pairs)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("months", nargs="*")
    parser.add_argument("--data-dir", type=Path, default=Path(".data"))
    parser.add_argument("--dashboard-dir", type=Path, default=WEB / "public/data")
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=3)
    parser.add_argument(
        "--pin-reference",
        action="store_true",
        help="Archive the official station reference if no pin exists",
    )
    parser.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--clock-change-months",
        action="store_true",
        help="Default to all ten March and November months when no months are listed",
    )
    args = parser.parse_args()
    months = args.months or list(CLOCK_CHANGE_MONTHS if args.clock_change_months else MONTHS)
    if len(set(months)) != len(months) or not set(months) <= set(MONTHS + CLOCK_CHANGE_MONTHS):
        parser.error("Use distinct YYYY-MM months from 2020–2024")
    for month in months:
        month_calendar(month, allow_transition=True)
    root = args.data_dir.resolve()
    pin = reject_symlinks(root, root / "historical-subway-reference.json")
    if args.pin_reference:
        if not pin.exists():
            asset = download(
                REFERENCE_URL, root, "historical-station-reference", ".csv", max_bytes=1024 * 1024
            )
            atomic_write(pin, canonical_bytes(asset))
        print(pin)
        return 0
    if not pin.is_file():
        parser.error(f"Pin the official MTA station reference in {pin}")
    reference = json.loads(pin.read_bytes())
    published = published_run_pairs(args.dashboard_dir) if args.publish else {}
    if published:
        catalog(
            args.dashboard_dir,
            independent_runs=published,
            asset_paths=registered_assets(args.dashboard_dir).values(),
        )
    pending = [month for month in months if month not in published]
    results = [
        {"month": month, "run": published[month][1], "status": "already-published"}
        for month in months
        if month in published
    ]
    if pending:
        with ProcessPoolExecutor(max_workers=args.jobs) as workers:
            results.extend(
                workers.map(validate_job, [(root, month, reference) for month in pending])
            )
    results.sort(key=lambda entry: entry["month"])
    report = root / f"historical-subway-results-{min(months)}-{max(months)}.json"
    atomic_write(report, canonical_bytes(results))
    if args.publish:
        publish_results(args.dashboard_dir, root, results)
    return int(any(result["status"] == "failed" for result in results))


if __name__ == "__main__":
    raise SystemExit(main())
