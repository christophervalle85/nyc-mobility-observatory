"""Discover, validate and append historical mobility files to a local dashboard."""

import argparse
import csv
import fcntl
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import duckdb
from export_mobility_months import catalog
from export_subway_dashboard import export as export_subway
from export_yellow_taxi_dashboard import WEB, month_calendar
from export_yellow_taxi_dashboard import export as export_taxi

from nyc_mobility.acquisition import verify_asset
from nyc_mobility.core import canonical_bytes, file_hash, reject_symlinks, safe_directory
from nyc_mobility.discovery import discover
from nyc_mobility.pipeline import run

FILES = {"taxi": "yellow-taxi", "subway": "subway"}


def atomic_write(path: Path, payload: bytes) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        temporary.write_bytes(payload)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def registered_assets(root: Path) -> dict[str, Path]:
    index = reject_symlinks(root, root / "mobility-months.json")
    if not index.exists():
        return {}
    current = json.loads(index.read_bytes())
    if (
        not isinstance(current, dict)
        or type(current.get("version")) is not int
        or current["version"] != 1
        or not isinstance(current.get("months"), list)
        or not current["months"]
    ):
        raise ValueError("Invalid published catalog")
    sections = {}
    seen = set()
    for entry in current["months"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("month"), str):
            raise ValueError("Invalid published month")
        month = entry["month"]
        month_calendar(month)
        if month in seen or any(type(entry.get(mode)) is not bool for mode in FILES):
            raise ValueError("Invalid or duplicate published mode")
        if not any(entry[mode] for mode in FILES):
            raise ValueError("Published month needs an available mode")
        seen.add(month)
        for mode, stem in FILES.items():
            if entry[mode]:
                name = f"{stem}-{month}.json"
                asset = reject_symlinks(root, root / name)
                if not asset.is_file():
                    raise ValueError(f"Published asset is missing: {name}")
                sections[name] = asset
    return sections


def publish_month(destination: Path, month: str, assets: dict[str, bytes]) -> None:
    month_calendar(month)
    if not assets or not assets.keys() <= FILES.keys():
        raise ValueError("Expected one or both monthly mode exports")
    root = destination.absolute()
    if root.is_symlink():
        raise ValueError("Dashboard destination cannot be a symbolic link")
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    lock = reject_symlinks(root, root / ".backfill.lock")
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        index = reject_symlinks(root, root / "mobility-months.json")
        registered = registered_assets(root)
        candidates = {f"{FILES[mode]}-{month}.json": payload for mode, payload in assets.items()}
        with tempfile.TemporaryDirectory(prefix=".backfill-stage-", dir=root) as tmp:
            stage = Path(tmp)
            for name, source in registered.items():
                os.link(source, stage / name)
            for name, payload in candidates.items():
                target = reject_symlinks(root, root / name)
                if target.exists() and target.read_bytes() != payload:
                    raise ValueError(f"Refusing to overwrite a different monthly asset: {name}")
                if name not in registered:
                    (stage / name).write_bytes(payload)
            updated = catalog(stage)
            for name in candidates:
                target = root / name
                if not target.exists():
                    os.link(stage / name, target)
            if not index.exists() or index.read_bytes() != updated:
                atomic_write(index, updated)


def archive_matches(document: dict, candidate: dict, taxi_only: bool) -> bool:
    month = candidate["month"]
    if (
        document.get("source_kind") != "live"
        or document.get("month") != month
        or document.get("taxi_only") is not taxi_only
    ):
        return False
    assets = document.get("assets", {})
    taxi_url = assets.get("taxi", {}).get("requested_url")
    if (
        taxi_url
        != f"https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_{month}.parquet"
    ):
        return False
    if taxi_only:
        return "subway" not in assets
    mta_url = urlsplit(assets.get("subway", {}).get("requested_url", ""))
    return (
        mta_url.scheme == "https"
        and mta_url.netloc == "data.ny.gov"
        and mta_url.path == f"/resource/{candidate['subway_dataset']}.csv"
        and document.get("mta", {}).get("dataset_version", {}).get("id")
        == candidate["subway_dataset"]
    )


def verified_snapshot(path: Path, root: Path) -> dict:
    path = reject_symlinks(root, path)
    if path.stem != file_hash(path):
        raise ValueError(f"Snapshot digest mismatch: {path.name}")
    document = json.loads(path.read_bytes())
    for asset in document["assets"].values():
        verify_asset(asset, root)
    return document


def resolved_run(root: Path, candidate: dict) -> Path:
    """Reuse a matching official run, then a matching frozen capture, then fetch."""
    month = candidate["month"]
    taxi_only = not candidate["subway"]
    runs = safe_directory(root, root / "runs")
    snapshots = safe_directory(root, root / "snapshots")
    for path in sorted(runs.glob("*/manifest.json")):
        document = json.loads(reject_symlinks(root, path).read_bytes())
        identity = document.get("identity", {})
        if (
            document.get("status") != "completed"
            or document.get("source_kind") != "live"
            or identity.get("month") != month
            or identity.get("taxi_only") is not taxi_only
        ):
            continue
        digest = identity.get("snapshot_sha256", "")
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Invalid archived snapshot identity")
        snapshot = snapshots / f"{digest}.json"
        source = verified_snapshot(snapshot, root)
        if not archive_matches(source, candidate, taxi_only):
            continue
        expected_run = hashlib.sha256(canonical_bytes(identity)).hexdigest()
        if (
            document.get("run_id") != expected_run
            or path.parent.name != expected_run
            or document["inputs"] != source["assets"]
            or identity.get("input_sha256")
            != {key: data["sha256"] for key, data in source["assets"].items()}
        ):
            raise ValueError("Completed run does not match its frozen inputs")
        return path.parent
    for path in sorted(snapshots.glob("*.json")):
        document = json.loads(reject_symlinks(root, path).read_bytes())
        if archive_matches(document, candidate, taxi_only):
            verified_snapshot(path, root)
            return run(month, root, offline=True, snapshot=path, taxi_only=taxi_only).parent
    return run(month, root, taxi_only=taxi_only).parent


def run_batch(
    inventory: dict,
    archive: Path,
    destination: Path,
    *,
    limit: int | None,
    since: str | None,
    through: str | None,
) -> list[dict]:
    published = {name[-12:-5] for name in registered_assets(destination)}
    results = []
    attempted = 0
    for candidate in inventory["months"]:
        month = candidate["month"]
        if (since and month < since) or (through and month > through) or month in published:
            continue
        if limit is not None and attempted >= limit:
            break
        try:
            month_calendar(month)
        except ValueError as exc:
            results.append({"month": month, "status": "unsupported", "reason": str(exc)})
            continue
        if not candidate["taxi"]:
            results.append(
                {
                    "month": month,
                    "status": "unsupported",
                    "reason": "Subway-only capture is not supported",
                }
            )
            continue
        attempted += 1
        print(f"Backfilling {month}", file=sys.stderr, flush=True)
        try:
            validated = resolved_run(archive, candidate)
            assets = {"taxi": export_taxi(validated, WEB / "public/data/taxi-zones.geojson")}
            if candidate["subway"]:
                assets["subway"] = export_subway(
                    validated,
                    require_month_edges=candidate.get("subway_coverage") == "date-span-candidate",
                )
            publish_month(destination, month, assets)
            result = {"month": month, "status": "published", "run": validated.name}
        except (ValueError, OSError, csv.Error, duckdb.Error, KeyError, TypeError) as exc:
            result = {"month": month, "status": "failed", "reason": str(exc)}
        results.append(result)
        print(json.dumps(result), file=sys.stderr, flush=True)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path(".data"))
    parser.add_argument("--dashboard-dir", type=Path, default=WEB / "public/data")
    parser.add_argument("--discover-only", action="store_true")
    parser.add_argument("--limit", type=int, help="maximum number of new candidate captures")
    parser.add_argument("--since", help="earliest candidate month, inclusive")
    parser.add_argument("--through", help="latest candidate month, inclusive")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    for bound in (args.since, args.through):
        if bound is not None and not re.fullmatch(r"[0-9]{4}-(?:0[1-9]|1[0-2])", bound):
            parser.error("date bounds must be YYYY-MM")
    if args.since and args.through and args.since > args.through:
        parser.error("--since must not follow --through")
    archive = args.data_dir.resolve()
    inventory = discover(archive)
    if args.discover_only:
        print(json.dumps(inventory, indent=2))
        return int(any(source["status"] == "error" for source in inventory["sources"]))
    if any(source["status"] == "error" for source in inventory["sources"]):
        print(json.dumps(inventory, indent=2), file=sys.stderr)
        print("Discovery incomplete. Retry before backfilling.", file=sys.stderr)
        return 1
    if args.dashboard_dir.is_symlink():
        parser.error("Dashboard destination cannot be a symbolic link")
    lock = reject_symlinks(archive, archive / ".backfill.lock")
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        results = run_batch(
            inventory,
            archive,
            args.dashboard_dir.resolve(),
            limit=args.limit,
            since=args.since,
            through=args.through,
        )
    print(json.dumps(results, indent=2))
    return int(any(item["status"] == "failed" for item in results))


if __name__ == "__main__":
    raise SystemExit(main())
