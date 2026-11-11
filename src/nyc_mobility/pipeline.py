"""Recompute frozen inputs in isolation and publish complete runs atomically."""

import hashlib
import json
import os
import platform
import shutil
import tempfile
import uuid
from pathlib import Path

import duckdb

from .acquisition import acquire, utc_now, validate_polygon_zip, verify_asset
from .core import (
    CONTRACT_VERSION,
    canonical_bytes,
    file_hash,
    month_bounds,
    reject_symlinks,
    safe_directory,
    write_json,
)
from .taxi import validate_taxi

DICTIONARY = """# M1 data dictionary

All derived timestamps are America/New_York local clock labels, not UTC instants.
No DST fold or nonexistent instant is invented. Sources and hashes are in manifest.json.

- taxi/zone_hour.csv: one row per (dropoff_hour_local, DOLocationID). trip_count is an
  integer source-file trip-row count, including apparent duplicates. Only recognized
  ordinary destination zones and in-month non-null dropoffs count. Adjacent pickup-month
  files are not included, so this is not exhaustive calendar-month dropoff coverage.
- taxi/row_ledger.csv: source_row is the 1-based physical Parquet row; excluded is the
  unique destination/dropoff exclusion decision; reasons is a semicolon-separated set.
  Flags overlap. Unknown origin, null pickup, nonpositive duration, and distance/fare
  anomalies do not remove an otherwise valid dropoff. Distance/fare anomalies mean
  null, nonfinite or nonpositive trip_distance (miles) / total_amount (USD).
- subway/station_hour.csv: observed station-hour ridership summed across payment/fare
  categories; transfers are never added. Missing hours are unknown, not generated zeroes.
  Consult subway/quality.json and exclusions for DST and suspect-window eligibility.
- quality.json: row reconciliations, overlapping flags, coverage limitations and audit state.
  The monthly observed-source station reference is not independent station authority
  or a service calendar and cannot detect stations absent for the entire month.
- manifest.json: frozen input hashes/provenance, code/runtime contract, output hashes.
  snapshot is a portable sha256:<digest> reference to the archived snapshot bytes.
  Locate it as snapshots/<digest>.json under the selected data root. The historical
  absolute path is operational.snapshot_path and may be stale after relocation.
  HTTP Last-Modified is response metadata, never asserted to be source publication date.

Full 21-month M0 audit, independent station/coordinate audit and service-calendar
validation remain pending. This bounded M1 pilot does not certify them.
"""


def code_hash() -> str:
    digest = hashlib.sha256()
    for path in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def select_snapshot(root: Path, month: str, snapshot: Path | None, taxi_only: bool) -> Path:
    if snapshot is not None:
        return snapshot.resolve()
    candidates = []
    for path in sorted((root / "snapshots").glob("*.json")):
        document = json.loads(path.read_bytes())
        if document.get("month") == month and document.get("taxi_only") == taxi_only:
            candidates.append(path)
    if len(candidates) != 1:
        raise ValueError("offline mode requires --snapshot when no unique matching snapshot exists")
    return candidates[0]


def _output_hashes(folder: Path) -> dict:
    return {
        str(path.relative_to(folder)): {"sha256": file_hash(path), "bytes": path.stat().st_size}
        for path in sorted(folder.rglob("*"))
        if path.is_file() and path.name != "manifest.json"
    }


def run(
    month: str,
    data_dir: Path,
    *,
    offline: bool = False,
    snapshot: Path | None = None,
    taxi_only: bool = False,
    output_dir: Path | None = None,
) -> Path:
    month_bounds(month)
    initial_code_hash = code_hash()
    root = data_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    requested_outputs = (output_dir or root / "runs").absolute()
    if requested_outputs.is_relative_to(root):
        outputs = safe_directory(root, requested_outputs)
    else:
        # An explicit external output root is a separate user-selected destination.
        if requested_outputs.is_symlink():
            raise ValueError("symbolic link output directory is not allowed")
        outputs = requested_outputs.resolve()
        outputs.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=outputs))
    started = utc_now()
    try:
        if snapshot is not None and not offline:
            raise ValueError(
                "--snapshot requires --offline; online captures a new immutable snapshot"
            )
        source = (
            select_snapshot(root, month, snapshot, taxi_only)
            if offline
            else acquire(root, month, taxi_only)
        )
        snapshot_sha = file_hash(source)
        if source.name != snapshot_sha + ".json":
            raise ValueError("snapshot checksum mismatch (filename must match SHA-256)")
        document = json.loads(source.read_bytes())
        if document.get("snapshot_version") != 1 or document.get("month") != month:
            raise ValueError("snapshot version/month mismatch")
        if document.get("taxi_only") != taxi_only:
            raise ValueError("snapshot mode differs from --taxi-only selection")
        assets = document["assets"]
        required = {"taxi", "lookup"} | (set() if taxi_only else {"subway", "roster"})
        if not required.issubset(assets):
            raise ValueError("snapshot missing required inputs")
        paths = {name: verify_asset(asset, root) for name, asset in assets.items()}
        if "polygons" in paths:
            validate_polygon_zip(paths["polygons"])
        identity = {
            "contract_version": CONTRACT_VERSION,
            "code_sha256": initial_code_hash,
            "python": platform.python_version(),
            "duckdb": duckdb.__version__,
            "month": month,
            "taxi_only": taxi_only,
            "snapshot_sha256": snapshot_sha,
            "input_sha256": {name: asset["sha256"] for name, asset in assets.items()},
        }
        run_id = hashlib.sha256(canonical_bytes(identity)).hexdigest()
        taxi_dir = stage / "taxi"
        taxi_dir.mkdir()
        taxi = validate_taxi(paths["taxi"], paths["lookup"], taxi_dir, month)
        subway = None
        if not taxi_only:
            from .subway import validate_subway

            subway_dir = stage / "subway"
            subway_dir.mkdir()
            subway = validate_subway(paths["subway"], subway_dir, month, paths["roster"])
        quality = {
            "month": month,
            "taxi": taxi,
            "subway": subway,
            "mta_capture": document.get("mta"),
            "reference_scope": "observed_month" if not taxi_only else None,
            "independent_reference_validated": False,
            "absent_entire_month_stations_detectable": False,
            "full_21_month_m0_audit": "pending",
            "service_calendar_validation": "pending",
            "independent_station_coordinate_audit": "pending",
            "pilot_scope": "bounded local ingestion; not full station-universe certification",
        }
        write_json(stage / "quality.json", quality)
        (stage / "data-dictionary.md").write_text(DICTIONARY)
        hashes = _output_hashes(stage)
        manifest = {
            "status": "completed",
            "run_id": run_id,
            "identity": identity,
            "snapshot": "sha256:" + snapshot_sha,
            "source_kind": document.get("source_kind"),
            "inputs": assets,
            "outputs": hashes,
            "operational": {
                "started_at": started,
                "finished_at": utc_now(),
                "offline": offline,
                "snapshot_path": str(source),
            },
        }
        if code_hash() != initial_code_hash:
            raise ValueError("package source changed during run; rerun with stable code")
        # Last file in staging. The directory only becomes visible as a completed run afterwards.
        write_json(stage / "manifest.json", manifest)
        destination = reject_symlinks(outputs, outputs / run_id)
        if destination.exists():
            existing = json.loads((destination / "manifest.json").read_bytes())
            if {key: value for key, value in existing.items() if key != "operational"} != {
                key: value for key, value in manifest.items() if key != "operational"
            } or _output_hashes(destination) != hashes:
                raise ValueError(
                    "existing immutable run differs from recomputed outputs or is corrupt"
                )
            return destination / "manifest.json"
        try:
            os.rename(stage, destination)
        except FileExistsError:
            raise ValueError(
                "concurrent run publication; rerun to verify the completed output"
            ) from None
        return destination / "manifest.json"
    except Exception as exc:
        failure_dir = safe_directory(root, root / "failures")
        write_json(
            failure_dir / (uuid.uuid4().hex + ".json"),
            {
                "status": "failed",
                "month": month,
                "started_at": started,
                "failed_at": utc_now(),
                "error_type": type(exc).__name__,
                "error": str(exc),
                "offline": offline,
            },
        )
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)
