"""Freeze and validate a modern MTA-only month independently of TLC availability."""

import errno
import hashlib
import json
import platform
import shutil
import tempfile
from pathlib import Path

import duckdb
from backfill import atomic_write
from export_subway_dashboard import export
from export_yellow_taxi_dashboard import month_calendar

from nyc_mobility.acquisition import (
    _count,
    _metadata,
    capture_mta,
    derive_roster,
    mta_dataset,
    mta_requests,
    store_bytes,
    verify_asset,
)
from nyc_mobility.core import canonical_bytes, file_hash, reject_symlinks, safe_directory
from nyc_mobility.pipeline import _output_hashes, code_hash
from nyc_mobility.subway import validate_subway

CAPTURE_INPUTS = {"subway", "count_before", "count_after", "metadata_before", "metadata_after"}


def _rejection(root: Path, snapshot: Path) -> Path:
    # A validator change can reconsider captures rejected by an earlier version.
    key = hashlib.sha256(canonical_bytes([snapshot.stem, code_hash(), file_hash(Path(__file__))]))
    return reject_symlinks(root, root / "refresh-subway-rejections" / f"{key.hexdigest()}.json")


def _reject_capture(root: Path, snapshot: Path, month: str, error: ValueError) -> None:
    marker = _rejection(root, snapshot)
    marker.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(
        marker,
        canonical_bytes(
            {
                "month": month,
                "snapshot": snapshot.stem,
                "reason": str(error),
            }
        ),
    )


def capture(root: Path, month: str) -> tuple[Path, dict]:
    month_calendar(month, allow_transition=True)
    if month < "2025-01":
        raise ValueError("Refresh subway capture requires a modern month from 2025 onward")
    folder = safe_directory(root, root / "raw" / "refresh-subway-snapshots")
    for path in sorted(folder.glob("*.json")):
        document = json.loads(reject_symlinks(root, path).read_bytes())
        if document.get("month") == month:
            if path.stem != file_hash(path):
                raise ValueError("Refresh subway capture checksum mismatch")
            if _rejection(root, path).exists():
                continue
            verify_capture(root, month, document)
            return path, document
    assets, mta = capture_mta(root, month)
    document = {"version": 1, "month": month, "assets": assets, "mta": mta}
    verify_capture(root, month, document)
    snapshot = store_bytes(
        canonical_bytes(document),
        root,
        folder.name,
        ".json",
        "derived:official-refresh-mta-capture",
    )
    return verify_asset(snapshot, root), document


def verify_capture(root: Path, month: str, document: dict) -> Path:
    assets, mta = document["assets"], document["mta"]
    dataset = mta_dataset(month)
    metadata_url, count_url, source_url, query = mta_requests(month)
    if (
        type(document.get("version")) is not int
        or document["version"] != 1
        or document.get("month") != month
        or set(assets) != CAPTURE_INPUTS
        or mta.get("export_query") != query
    ):
        raise ValueError("Invalid refresh subway capture metadata")
    for name, url in (
        ("subway", source_url),
        ("count_before", count_url),
        ("count_after", count_url),
        ("metadata_before", metadata_url),
        ("metadata_after", metadata_url),
    ):
        if assets[name].get("requested_url") != url or assets[name].get("final_url") != url:
            raise ValueError(f"Invalid refresh subway source URL for {name}")
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
        before.get("id") != dataset
        or after.get("id") != dataset
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


def run_subway(root: Path, month: str) -> Path:
    root = root.resolve()
    snapshot, document = capture(root, month)
    source = verify_capture(root, month, document)
    try:
        roster = derive_roster(source, root, month)
    except ValueError as exc:
        _reject_capture(root, snapshot, month, exc)
        raise
    roster_path = verify_asset(roster, root)
    inputs = document["assets"] | {"roster": roster}
    identity = {
        "contract_version": "refresh-subway-v1",
        "code_sha256": code_hash(),
        "runner_sha256": file_hash(Path(__file__)),
        "python": platform.python_version(),
        "duckdb": duckdb.__version__,
        "month": month,
        "snapshot_sha256": snapshot.stem,
        "input_sha256": {name: asset["sha256"] for name, asset in inputs.items()},
    }
    run_id = hashlib.sha256(canonical_bytes(identity)).hexdigest()
    runs = safe_directory(root, root / "refresh-subway-runs")
    destination = reject_symlinks(root, runs / run_id)
    if not destination.exists():
        stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=runs))
        try:
            subway = stage / "subway"
            subway.mkdir()
            try:
                quality = validate_subway(source, subway, month, roster_path)
                if quality["input_rows"] != document["mta"]["export_rows"]:
                    raise ValueError("Refresh subway rows do not reconcile to frozen capture")
            except ValueError as exc:
                _reject_capture(root, snapshot, month, exc)
                raise
            manifest = {
                "status": "completed",
                "source_kind": "live",
                "run_id": run_id,
                "identity": identity,
                "snapshot": "sha256:" + snapshot.stem,
                "inputs": inputs,
                "outputs": _output_hashes(stage),
                "mta_capture": document["mta"],
            }
            (stage / "manifest.json").write_bytes(canonical_bytes(manifest))
            try:
                export(stage, require_month_edges=True)
            except ValueError as exc:
                _reject_capture(root, snapshot, month, exc)
                raise
            if (
                code_hash() != identity["code_sha256"]
                or file_hash(Path(__file__)) != identity["runner_sha256"]
            ):
                raise ValueError("Refresh subway code changed during validation")
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
        or manifest.get("source_kind") != "live"
        or manifest.get("run_id") != run_id
        or manifest.get("identity") != identity
        or manifest.get("snapshot") != "sha256:" + snapshot.stem
        or manifest.get("inputs") != inputs
        or manifest.get("outputs") != _output_hashes(destination)
        or manifest.get("mta_capture") != document["mta"]
    ):
        raise ValueError("Refresh subway run differs from frozen inputs or outputs")
    export(destination, require_month_edges=True)
    return destination
