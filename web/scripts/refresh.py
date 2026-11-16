"""Stage one newly available calendar month without modifying the published dashboard."""

import argparse
import csv
import hashlib
import json
import shutil
import tempfile
from http.client import IncompleteRead
from pathlib import Path
from unicodedata import normalize

import duckdb
from backfill import FILES, atomic_write, registered_assets, resolved_run
from export_mobility_months import catalog, published_run_pairs
from export_subway_dashboard import export as export_subway
from export_yellow_taxi_dashboard import WEB, month_calendar
from export_yellow_taxi_dashboard import export as export_taxi
from refresh_subway import run_subway

from nyc_mobility.core import canonical_bytes
from nyc_mobility.discovery import discover

SOURCES = {"taxi": "tlc", "subway": "mta-5wq4-mkjj"}
FAILURES = (OSError, ValueError, csv.Error, duckdb.Error, KeyError, TypeError, IncompleteRead)


def _contains(root: Path, path: Path) -> bool:
    if path.is_relative_to(root):
        return True
    if root.exists():
        return any(
            root.samefile(ancestor) for ancestor in (path, *path.parents) if ancestor.exists()
        )
    # Future directories have no inode to compare on case-insensitive volumes.
    if not path.exists():
        folded = tuple(normalize("NFC", part.casefold()) for part in root.parts)
        return (
            tuple(normalize("NFC", part.casefold()) for part in path.parts[: len(folded)]) == folded
        )
    return False


def preflight(stage_dir: Path, data_dir: Path, published_dir: Path) -> tuple[Path, Path, Path]:
    """Check every boundary before creating a directory or contacting a source."""
    for path in (stage_dir, data_dir, published_dir):
        if path.is_symlink():
            raise ValueError("Refresh paths cannot be symbolic links")
    stage, archive, baseline = (path.resolve() for path in (stage_dir, data_dir, published_dir))
    for first, second in ((stage, archive), (stage, baseline), (archive, baseline)):
        if _contains(first, second) or _contains(second, first):
            raise ValueError(
                "Stage, archive and published baseline must be separate, non-overlapping paths"
            )
    protected = (WEB / "public").resolve()
    for path in (stage, archive):
        if _contains(protected, path) or _contains(path, protected):
            raise ValueError("Stage and archive must not overlap the published dashboard tree")
    if stage.exists():
        raise ValueError("Stage directory must be new and must not already exist")
    if not baseline.is_dir() or not (baseline / "mobility-months.json").is_file():
        raise ValueError("Published baseline requires an existing catalog")
    if archive.exists() and not archive.is_dir():
        raise ValueError("Archive must be a directory")
    return stage, archive, baseline


def _source(inventory: dict, mode: str) -> dict:
    return next(
        (item for item in inventory["sources"] if item["source"] == SOURCES[mode]),
        {"status": "error", "error": "Required source discovery result is missing"},
    )


def select_month(inventory: dict, watermarks: dict[str, str | None]) -> str | None:
    eligible = []
    seen = set()
    for candidate in inventory["months"]:
        month = candidate["month"]
        month_calendar(month, allow_transition=True)
        if month in seen:
            raise ValueError("Duplicate discovered month")
        seen.add(month)
        for mode in FILES:
            if type(candidate.get(mode)) is not bool:
                raise ValueError("Discovered mode availability must be boolean")
            if (
                candidate[mode]
                and month > (watermarks[mode] or "")
                and _source(inventory, mode)["status"] == "ok"
            ):
                if mode == "subway" and (
                    month < "2025-01" or candidate.get("subway_dataset") != "5wq4-mkjj"
                ):
                    continue
                eligible.append(month)
    return min(eligible) if eligible else None


def _unavailable(inventory: dict, mode: str, month: str | None, watermark: str | None) -> dict:
    source = _source(inventory, mode)
    if source["status"] == "error":
        return {
            "status": "discovery-failed",
            "reason": source.get("error") or "Source discovery failed",
        }
    rejected = [
        entry
        for entry in inventory.get("rejected", [])
        if entry["source"] == SOURCES[mode]
        and (entry["month"] == month if month else entry["month"] > (watermark or ""))
    ]
    if rejected:
        partial = next((entry for entry in rejected if "partial" in entry["reason"]), None)
        return {
            "status": "partial" if partial else "unavailable",
            "reason": (partial or rejected[0])["reason"],
        }
    if month is not None or source["status"] == "empty":
        return {
            "status": "unavailable",
            "reason": "No completed published source is available for this mode/month",
        }
    return {
        "status": "up-to-date",
        "reason": "No eligible published source is newer than this mode's watermark",
    }


def refresh(stage_dir: Path, data_dir: Path, published_dir: Path = WEB / "public/data") -> dict:
    stage, archive, baseline = preflight(stage_dir, data_dir, published_dir)
    registered = registered_assets(baseline)
    pairs = published_run_pairs(baseline)
    # Validate registered baseline payloads, never adopt orphan files.
    catalog(baseline, independent_runs=pairs, asset_paths=registered.values())
    watermarks = {
        mode: max(
            (name[-12:-5] for name in registered if name.startswith(stem + "-")), default=None
        )
        for mode, stem in FILES.items()
    }
    inventory = discover(archive, include_historical=False)
    month = select_month(inventory, watermarks)
    report = {
        "version": 1,
        "month": month,
        "watermarks": watermarks,
        "modes": {},
        "sources": inventory["sources"],
        "stageDir": None,
        "changesStaged": False,
    }
    if month is None:
        report["modes"] = {
            mode: _unavailable(inventory, mode, None, watermarks[mode]) for mode in FILES
        }
        return report
    candidate = next(item for item in inventory["months"] if item["month"] == month)
    stage.mkdir(parents=True, exist_ok=False)
    report["stageDir"] = str(stage)
    for name, path in registered.items():
        shutil.copyfile(path, stage / name)
    for mode in FILES:
        name = f"{FILES[mode]}-{month}.json"
        if name in registered:
            report["modes"][mode] = {
                "status": "already-published",
                "reason": "This mode/month already exists in the registered baseline",
            }
            continue
        if month <= (watermarks[mode] or ""):
            report["modes"][mode] = {
                "status": "outside-refresh-window",
                "reason": "This older catalog gap does not advance the mode's published watermark",
            }
            continue
        if not candidate[mode] or _source(inventory, mode)["status"] != "ok":
            report["modes"][mode] = _unavailable(inventory, mode, month, watermarks[mode])
            continue
        try:
            if mode == "taxi":
                run = resolved_run(archive, {"month": month, "subway": False})
                payload = export_taxi(run, WEB / "public/data/taxi-zones.geojson")
            else:
                run = run_subway(archive, month)
                payload = export_subway(run, require_month_edges=True)
            with tempfile.TemporaryDirectory(prefix=".candidate-", dir=stage) as temp:
                path = Path(temp) / name
                path.write_bytes(payload)
                # Validate each mode independently before allowing it into the prospective catalog.
                catalog(Path(temp), independent_runs={}, asset_paths=[path])
                document = json.loads(payload)
                if document["runId"] != run.name:
                    raise ValueError("Export does not match validated run identity")
                manifest_path = run / "manifest.json"
                snapshot = None
                if manifest_path.is_file():
                    manifest = json.loads(manifest_path.read_bytes())
                    snapshot = manifest.get("identity", {}).get("snapshot_sha256")
                shutil.copyfile(path, stage / name)
            report["modes"][mode] = {
                "status": "staged",
                "reason": "Verified export staged for review",
                "runId": run.name,
                "sourceSha256": document["sourceSha256"],
                "assetSha256": hashlib.sha256(payload).hexdigest(),
                "snapshotSha256": snapshot,
            }
        except FAILURES as exc:
            report["modes"][mode] = {
                "status": "failed",
                "reason": f"{type(exc).__name__}: {exc}",
            }
    modes = {}
    for mode, stem in FILES.items():
        path = stage / f"{stem}-{month}.json"
        if path.exists():
            modes[mode] = json.loads(path.read_bytes())["runId"]
    if set(modes) == {"taxi", "subway"} and modes["taxi"] != modes["subway"]:
        pairs[month] = (modes["taxi"], modes["subway"])
    report["changesStaged"] = any(value["status"] == "staged" for value in report["modes"].values())
    prospective = catalog(stage, independent_runs=pairs)
    atomic_write(stage / "refresh-result.json", canonical_bytes(report))
    # The prospective catalog is the final write. Nothing is promoted to the baseline.
    atomic_write(stage / "mobility-months.json", prospective)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage-dir", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--published-dir", type=Path, default=WEB / "public/data")
    args = parser.parse_args(argv)
    try:
        result = refresh(args.stage_dir, args.data_dir, args.published_dir)
    except FAILURES as exc:
        print(json.dumps({"status": "failed", "reason": f"{type(exc).__name__}: {exc}"}))
        return 1
    print(json.dumps(result, indent=2))
    return int(
        any(mode["status"] in {"failed", "discovery-failed"} for mode in result["modes"].values())
    )


if __name__ == "__main__":
    raise SystemExit(main())
