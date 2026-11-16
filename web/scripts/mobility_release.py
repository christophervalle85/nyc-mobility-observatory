"""Prepare and apply a verified one-month data release; Git publication is external."""

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from backfill import FILES, registered_assets
from export_mobility_months import catalog, published_run_pairs
from export_yellow_taxi_dashboard import month_calendar
from refresh import _contains

from nyc_mobility.core import canonical_bytes

INDEX = "mobility-months.json"
MANIFEST = "manifest.json"
REPORT = "refresh-result.json"
MAX_FILE_BYTES = 32 * 1024 * 1024
MANIFEST_FIELDS = {"version", "baseSha", "month", "baseline", "files", "modes", "sources"}
STATUSES = {
    "staged",
    "failed",
    "discovery-failed",
    "partial",
    "unavailable",
    "already-published",
    "outside-refresh-window",
    "up-to-date",
}


def _read(path: Path, *, limit: int = MAX_FILE_BYTES) -> bytes:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise ValueError(f"Expected a bounded regular file: {path.name}")
    return path.read_bytes()


def _json(data: bytes) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    value = json.loads(data, object_pairs_hook=unique)
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    return value


def _digest(data: bytes) -> dict:
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def _base_sha(value: str) -> None:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Expected an exact lowercase 40-hex baseline commit")


def _require_completed_month(month: str) -> None:
    month_calendar(month, allow_transition=True)
    current = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m")
    if month >= current:
        raise ValueError("Release requires a completed New York calendar month")


def _directories(*paths: Path) -> list[Path]:
    for path in paths:
        if path.is_symlink():
            raise ValueError("Release directories cannot be symbolic links")
    resolved = [path.resolve() for path in paths]
    for index, first in enumerate(resolved):
        for second in resolved[index + 1 :]:
            if _contains(first, second) or _contains(second, first):
                raise ValueError("Release directories must not overlap or alias")
    return resolved


def _validated(directory: Path, *, exact: bool = False) -> tuple[dict[str, Path], bytes]:
    raw = _read(directory / INDEX)
    document = _json(raw)
    assets = registered_assets(directory)
    for path in assets.values():
        _json(_read(path))
    expected = catalog(
        directory, independent_runs=published_run_pairs(directory), asset_paths=assets.values()
    )
    if raw != expected if exact else document != _json(expected):
        raise ValueError("Catalog does not exactly describe its registered assets and run bindings")
    return assets, raw


def _fingerprints(directory: Path, assets: dict[str, Path]) -> dict:
    return {
        name: _digest(_read(path))
        for name, path in sorted(assets.items() | {INDEX: directory / INDEX}.items())
    }


def _mode_report(modes: object, sources: object, month: str, additions: dict[str, bytes]) -> None:
    if not isinstance(modes, dict) or set(modes) != set(FILES) or not isinstance(sources, list):
        raise ValueError("Invalid refresh mode/source report")
    for mode, prefix in FILES.items():
        entry = modes[mode]
        if (
            not isinstance(entry, dict)
            or entry.get("status") not in STATUSES
            or not isinstance(entry.get("reason"), str)
        ):
            raise ValueError("Invalid refresh mode status")
        name = f"{prefix}-{month}.json"
        if (entry["status"] == "staged") != (name in additions):
            raise ValueError("Staged modes must exactly match release additions")
        if name in additions:
            asset = _json(additions[name])
            if (
                entry.get("runId") != asset.get("runId")
                or entry.get("sourceSha256") != asset.get("sourceSha256")
                or entry.get("assetSha256") != _digest(additions[name])["sha256"]
            ):
                raise ValueError("Staged mode provenance differs from release asset")


def _forward_month(month: str, additions: dict[str, bytes], prior: dict[str, Path]) -> None:
    for prefix in FILES.values():
        if f"{prefix}-{month}.json" in additions:
            watermark = max(
                (name[-12:-5] for name in prior if name.startswith(prefix + "-")), default=""
            )
            if month <= watermark:
                raise ValueError("Release must advance each added mode's published watermark")


def _result(manifest: dict, status: str) -> dict:
    return {
        "status": status,
        "month": manifest["month"],
        "baseSha": manifest["baseSha"],
        "paths": sorted(manifest["files"]),
        "files": manifest["files"],
        "modes": manifest["modes"],
        "sources": manifest["sources"],
        "changes": True,
    }


def prepare(stage_dir: Path, bundle_dir: Path, published_dir: Path, base_sha: str) -> dict:
    _base_sha(base_sha)
    stage, bundle, baseline = _directories(stage_dir, bundle_dir, published_dir)
    if bundle.exists():
        raise ValueError("Bundle directory must be new")
    prior, _ = _validated(baseline)
    staged, prospective = _validated(stage, exact=True)
    report = _json(_read(stage / REPORT, limit=1024 * 1024))
    if (
        report.get("changesStaged") is not True
        or type(report.get("version")) is not int
        or report["version"] != 1
    ):
        raise ValueError("Refresh stage has no verified changes")
    month = report.get("month")
    _require_completed_month(month)
    if set(path.name for path in stage.iterdir()) != set(staged) | {INDEX, REPORT}:
        raise ValueError("Unexpected stage files")
    if not prior.keys() <= staged.keys():
        raise ValueError("Release would remove a published asset")
    for name, path in prior.items():
        if _read(path) != _read(staged[name]):
            raise ValueError(f"Existing published asset changed: {name}")
    names = set(staged) - set(prior)
    allowed = {f"{prefix}-{month}.json" for prefix in FILES.values()}
    if not names or not names <= allowed:
        raise ValueError("Release must add only the selected month's new mode assets")
    for name in names:
        if (baseline / name).exists() or (baseline / name).is_symlink():
            raise ValueError(f"Conflicting unregistered baseline file: {name}")
    additions = {name: _read(staged[name]) for name in sorted(names)}
    _forward_month(month, additions, prior)
    _mode_report(report.get("modes"), report.get("sources"), month, additions)
    payloads = additions | {INDEX: prospective}
    manifest = {
        "version": 1,
        "baseSha": base_sha,
        "month": month,
        "baseline": _fingerprints(baseline, prior),
        "files": {name: _digest(data) for name, data in payloads.items()},
        "modes": report["modes"],
        "sources": report["sources"],
    }
    # No bundle writes occur until all candidate and baseline validation has completed.
    bundle.mkdir(parents=True, exist_ok=False)
    try:
        for name, data in payloads.items():
            (bundle / name).write_bytes(data)
        (bundle / MANIFEST).write_bytes(canonical_bytes(manifest))
    except OSError:
        shutil.rmtree(bundle)
        raise
    return _result(manifest, "prepared")


def apply(bundle_dir: Path, published_dir: Path, base_sha: str) -> dict:
    _base_sha(base_sha)
    bundle, baseline = _directories(bundle_dir, published_dir)
    manifest = _json(_read(bundle / MANIFEST, limit=1024 * 1024))
    if (
        set(manifest) != MANIFEST_FIELDS
        or type(manifest.get("version")) is not int
        or manifest["version"] != 1
        or manifest.get("baseSha") != base_sha
    ):
        raise ValueError("Invalid release manifest or stale baseline commit")
    month = manifest["month"]
    _require_completed_month(month)
    files = manifest["files"]
    allowed = {INDEX} | {f"{prefix}-{month}.json" for prefix in FILES.values()}
    if (
        not isinstance(files, dict)
        or INDEX not in files
        or len(files) < 2
        or not files.keys() <= allowed
    ):
        raise ValueError("Unexpected release paths")
    if set(path.name for path in bundle.iterdir()) != set(files) | {MANIFEST}:
        raise ValueError("Bundle contains unexpected files")
    payloads = {}
    for name, expected in files.items():
        data = _read(bundle / name)
        if expected != _digest(data) or type(expected.get("bytes")) is not int:
            raise ValueError(f"Release hash or byte count mismatch: {name}")
        payloads[name] = data
    prior, _ = _validated(baseline)
    if manifest["baseline"] != _fingerprints(baseline, prior):
        raise ValueError("Stale or modified baseline; prepare a fresh release")
    additions = {name: data for name, data in payloads.items() if name != INDEX}
    for name in additions:
        if (baseline / name).exists() or (baseline / name).is_symlink():
            raise ValueError(f"Refusing to replace an existing asset: {name}")
    _forward_month(month, additions, prior)
    _mode_report(manifest["modes"], manifest["sources"], month, additions)
    # Build a read-only projection using existing files plus bundled files, without checkout writes.
    projected = _json(payloads[INDEX])
    with tempfile.TemporaryDirectory(prefix="mobility-release-check-") as temp:
        directory = Path(temp)
        (directory / INDEX).write_bytes(payloads[INDEX])
        pairs = published_run_pairs(directory)
        paths = list(prior.values()) + [bundle / name for name in additions]
        expected = catalog(directory, independent_runs=pairs, asset_paths=paths)
        if payloads[INDEX] != expected or projected != _json(expected):
            raise ValueError("Prospective catalog differs from exact validated release")
    created = []
    temporary = None
    try:
        for name, data in additions.items():
            path = baseline / name
            with path.open("xb") as handle:
                created.append(path)
                handle.write(data)
        with tempfile.NamedTemporaryFile(dir=baseline, prefix=".catalog-", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(payloads[INDEX])
        os.replace(temporary, baseline / INDEX)
        temporary = None
    except OSError:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return _result(manifest, "applied")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "apply"):
        sub = commands.add_parser(command)
        sub.add_argument("--bundle-dir", type=Path, required=True)
        sub.add_argument("--published-dir", type=Path, required=True)
        sub.add_argument("--base-sha", required=True)
        if command == "prepare":
            sub.add_argument("--stage-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = (
            prepare(args.stage_dir, args.bundle_dir, args.published_dir, args.base_sha)
            if args.command == "prepare"
            else apply(args.bundle_dir, args.published_dir, args.base_sha)
        )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "failed", "reason": str(exc), "paths": [], "changes": False}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
