"""Bounded approved-origin downloads and immutable, verified source snapshots."""

import csv
import hashlib
import io
import json
import os
import re
import tempfile
import time
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse

from .core import canonical_bytes, file_hash, month_bounds, reject_symlinks, safe_directory

ORIGINS = {"d37ci6vzurychx.cloudfront.net", "data.ny.gov"}
MTA = "https://data.ny.gov/resource/5wq4-mkjj.csv"
METADATA = "https://data.ny.gov/api/views/5wq4-mkjj.json"
MAX_MTA_ROWS = 5_000_000
MTA_FIELDS = (
    "transit_timestamp,transit_mode,station_complex_id,station_complex,borough,"
    "payment_method,fare_class_category,ridership,transfers,latitude,longitude"
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def validate_url(url: str) -> None:
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in ORIGINS
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or parsed.fragment
    ):
        raise ValueError("source URL must use an approved HTTPS origin without credentials")


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)  # Check before urllib performs the redirected request.
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _publish_temp(temp: Path, root: Path, name: str, suffix: str, digest: str) -> Path:
    if not re.fullmatch(r"[a-z][a-z0-9_-]*", name) or suffix not in (
        ".csv",
        ".json",
        ".parquet",
        ".zip",
    ):
        raise ValueError("invalid raw asset name or suffix")
    destination = root / "raw" / name / (digest + suffix)
    safe_directory(root, destination.parent)
    reject_symlinks(root, destination)
    try:
        os.link(temp, destination)  # Exclusive atomic publication, never replace prior bytes.
    except FileExistsError:
        if destination.stat().st_size != temp.stat().st_size or file_hash(destination) != digest:
            raise ValueError(
                f"existing immutable asset has checksum corruption: {destination}"
            ) from None
    return destination


def download(
    url: str,
    root: Path,
    name: str,
    suffix: str,
    *,
    max_bytes: int,
    opener=None,
    timeout: int = 180,
    retries: int = 2,
) -> dict:
    validate_url(url)
    if max_bytes <= 0:
        raise ValueError("max_bytes must be positive")
    root = root.resolve()
    temporary = safe_directory(root, root / "tmp")
    opener = opener or urllib.request.build_opener(SafeRedirectHandler())
    started, deadline = utc_now(), time.monotonic() + 600
    for attempt in range(retries + 1):
        fd, raw_name = tempfile.mkstemp(prefix="download-", dir=temporary)
        temp = Path(raw_name)
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "nyc-mobility-observatory/0.1",
                    "Accept-Encoding": "identity",
                },
            )
            with os.fdopen(fd, "wb") as target, opener.open(request, timeout=timeout) as response:
                final_url = response.geturl()
                validate_url(final_url)
                length_header = response.headers.get("Content-Length")
                length = int(length_header) if length_header is not None else None
                if length is not None and (length < 0 or length > max_bytes):
                    raise ValueError("Content-Length exceeds download size limit")
                digest, size = hashlib.sha256(), 0
                while True:
                    if time.monotonic() > deadline:
                        raise ValueError("download exceeded total time limit")
                    # read1 performs at most one buffered/raw read; a drip-feed cannot keep
                    # filling a 1 MiB read indefinitely between deadline checks.
                    chunk = response.read1(64 * 1024)
                    if time.monotonic() > deadline:
                        raise ValueError("download exceeded total time limit")
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError("download exceeded byte size limit")
                    target.write(chunk)
                    digest.update(chunk)
                if size == 0 or (length is not None and size != length):
                    raise ValueError("empty or truncated download: Content-Length mismatch")
                target.flush()
                os.fsync(target.fileno())
                headers = {
                    key: response.headers.get(key)
                    for key in ("Content-Type", "Content-Length", "ETag", "Last-Modified", "Date")
                }
            sha = digest.hexdigest()
            destination = _publish_temp(temp, root, name, suffix, sha)
            return {
                "path": str(destination.relative_to(root)),
                "sha256": sha,
                "bytes": size,
                "requested_url": url,
                "final_url": final_url,
                "query": urlparse(url).query,
                "pagination": "single bounded response",
                "fetch_started_at": started,
                "fetch_finished_at": utc_now(),
                "response_headers": headers,
                "publication_date": None,
                "publication_date_note": (
                    "Not provided; HTTP Last-Modified is not a publication date."
                ),
            }
        except (URLError, TimeoutError, ConnectionError) as exc:
            retryable = not isinstance(exc, HTTPError) or exc.code == 429 or exc.code >= 500
            if not retryable or attempt == retries or time.monotonic() >= deadline:
                raise
            time.sleep(min(2**attempt, 4))
        finally:
            temp.unlink(missing_ok=True)
    raise RuntimeError("download retry loop exhausted")


def store_bytes(data: bytes, root: Path, name: str, suffix: str, source: str) -> dict:
    """Archive deterministic local derivatives (or tiny synthetic fixture assets)."""
    root = root.resolve()
    safe_directory(root, root / "tmp")
    fd, raw_name = tempfile.mkstemp(prefix="archive-", dir=root / "tmp")
    temp = Path(raw_name)
    try:
        with os.fdopen(fd, "wb") as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        sha = hashlib.sha256(data).hexdigest()
        destination = _publish_temp(temp, root, name, suffix, sha)
        return {
            "path": str(destination.relative_to(root)),
            "sha256": sha,
            "bytes": len(data),
            "requested_url": source,
            "final_url": source,
            "query": None,
            "pagination": None,
            "fetch_started_at": None,
            "fetch_finished_at": None,
            "response_headers": {},
            "publication_date": None,
            "publication_date_note": "Locally derived or synthetic asset; see snapshot lineage.",
        }
    finally:
        temp.unlink(missing_ok=True)


def verify_asset(asset: dict, root: Path) -> Path:
    relative = Path(asset["path"])
    reject_symlinks(root, root / relative)
    path = (root / relative).resolve()
    if relative.is_absolute() or not path.is_relative_to(root.resolve() / "raw"):
        raise ValueError("asset path is outside raw data directory")
    if not path.is_file() or path.stat().st_size != asset["bytes"]:
        raise ValueError(f"asset length mismatch or missing asset: {relative}")
    if file_hash(path) != asset["sha256"]:
        raise ValueError(f"asset checksum mismatch: {relative}")
    return path


def _metadata(asset: dict, root: Path) -> dict:
    document = json.loads(verify_asset(asset, root).read_bytes())
    if not isinstance(document, dict) or not isinstance(document.get("rowsUpdatedAt"), int):
        raise ValueError("MTA metadata missing integer rowsUpdatedAt")
    return document


def _count(asset: dict, root: Path) -> int:
    with verify_asset(asset, root).open(newline="") as handle:
        rows = list(csv.DictReader(handle, strict=True))
    if len(rows) != 1 or set(rows[0]) != {"count"} or not rows[0]["count"].isdigit():
        raise ValueError("invalid MTA count response")
    count = int(rows[0]["count"])
    if not 0 < count <= MAX_MTA_ROWS:
        raise ValueError("MTA count outside bounded capture row limit")
    return count


def capture_mta(root: Path, month: str) -> tuple[dict, dict]:
    start, end = (value.replace(" ", "T") for value in month_bounds(month))
    where = f"transit_timestamp >= '{start}' AND transit_timestamp < '{end}'"
    count_url = MTA + "?" + urlencode({"$select": "count(*) as count", "$where": where})
    query = {"$select": MTA_FIELDS, "$where": where, "$order": ":id", "$limit": MAX_MTA_ROWS + 1}
    assets = {}
    assets["metadata_before"] = download(
        METADATA, root, "metadata_before", ".json", max_bytes=5 * 1024 * 1024
    )
    before = _metadata(assets["metadata_before"], root)
    assets["count_before"] = download(count_url, root, "count_before", ".csv", max_bytes=4096)
    count = _count(assets["count_before"], root)
    assets["subway"] = download(
        MTA + "?" + urlencode(query), root, "subway", ".csv", max_bytes=1024**3
    )
    assets["count_after"] = download(count_url, root, "count_after", ".csv", max_bytes=4096)
    after_count = _count(assets["count_after"], root)
    assets["metadata_after"] = download(
        METADATA, root, "metadata_after", ".json", max_bytes=5 * 1024 * 1024
    )
    after = _metadata(assets["metadata_after"], root)
    if before["rowsUpdatedAt"] != after["rowsUpdatedAt"] or count != after_count:
        raise ValueError("MTA source changed during capture: count or rowsUpdatedAt mismatch")
    with verify_asset(assets["subway"], root).open(newline="") as handle:
        reader = csv.DictReader(handle, strict=True)
        if reader.fieldnames != MTA_FIELDS.split(","):
            raise ValueError("unexpected MTA export schema/header")
        actual = 0
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("malformed MTA export row")
            actual += 1
            if actual > MAX_MTA_ROWS:
                raise ValueError("MTA export exceeds bounded row limit")
    if actual != count:
        raise ValueError(f"MTA export row count mismatch: expected {count}, got {actual}")
    version = {
        key: before.get(key)
        for key in (
            "id",
            "name",
            "rowsUpdatedAt",
            "viewLastModified",
            "publicationDate",
            "provenance",
        )
    }
    return assets, {
        "capture_assurance": "best-effort mutable-source capture; no transaction guarantee",
        "rows_before": count,
        "rows_after": after_count,
        "export_rows": actual,
        "dataset_version": version,
        "export_query": query,
        "caveat": "Equal counts and metadata cannot prove unchanged content.",
    }


def derive_roster(input_path: Path, root: Path, month: str) -> dict:
    """Monthly observed-source reference; preserve conflicts for validator rejection."""
    fields = ["station_complex_id", "station_complex", "borough", "latitude", "longitude"]
    seen: dict[str, tuple[str, ...]] = {}
    with input_path.open(newline="") as handle:
        for row in csv.DictReader(handle, strict=True):
            if row["transit_mode"] != "subway" or row["station_complex_id"] == "501":
                continue
            values = tuple(row[field] for field in fields)
            key = row["station_complex_id"]
            if key in seen and seen[key] != values:
                raise ValueError(
                    f"conflicting station identity/coordinates in observed month: {key}"
                )
            seen[key] = values
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(fields)
    writer.writerows(sorted(seen.values(), key=lambda row: int(row[0])))
    asset = store_bytes(
        output.getvalue().encode(), root, "roster", ".csv", "derived:monthly-subway-csv"
    )
    asset["derivation"] = {
        "input_sha256": file_hash(input_path),
        "month": month,
        "operation": "Check station identity/coordinate conflicts, then DISTINCT",
        "query": "SELECT DISTINCT station_complex_id, station_complex, borough, "
        "latitude, longitude FROM archived_month WHERE transit_mode = "
        "'subway' AND station_complex_id <> '501' ORDER BY station_complex_id",
        "reference_scope": "observed_month",
        "independent_reference_validated": False,
        "absent_entire_month_stations_detectable": False,
    }
    return asset


def validate_polygon_zip(path: Path) -> None:
    # Inspect the archive directory only. Never extract untrusted names or process geometry.
    if not zipfile.is_zipfile(path):
        raise ValueError("retained polygon asset is not a valid ZIP archive")


def save_snapshot(document: dict, root: Path) -> Path:
    data = canonical_bytes(document)
    digest = hashlib.sha256(data).hexdigest()
    root = root.resolve()
    folder = safe_directory(root, root / "snapshots")
    path = reject_symlinks(root, folder / (digest + ".json"))
    fd, raw_name = tempfile.mkstemp(prefix=".snapshot-", dir=folder)
    temporary = Path(raw_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != data:
                raise ValueError("snapshot checksum collision/corruption") from None
    finally:
        temporary.unlink(missing_ok=True)
    return path


def acquire(root: Path, month: str, taxi_only: bool = False) -> Path:
    month_bounds(month)
    prefix = "https://d37ci6vzurychx.cloudfront.net/"
    assets = {
        "taxi": download(
            prefix + f"trip-data/yellow_tripdata_{month}.parquet",
            root,
            "taxi",
            ".parquet",
            max_bytes=2 * 1024**3,
        ),
        "lookup": download(
            prefix + "misc/taxi_zone_lookup.csv", root, "lookup", ".csv", max_bytes=1024 * 1024
        ),
        "polygons": download(
            prefix + "misc/taxi_zones.zip", root, "polygons", ".zip", max_bytes=100 * 1024 * 1024
        ),
    }
    validate_polygon_zip(verify_asset(assets["polygons"], root))
    mta = None
    if not taxi_only:
        mta_assets, mta = capture_mta(root, month)
        assets.update(mta_assets)
        assets["roster"] = derive_roster(verify_asset(assets["subway"], root), root, month)
    document = {
        "snapshot_version": 1,
        "month": month,
        "taxi_only": taxi_only,
        "created_at": utc_now(),
        "assets": assets,
        "mta": mta,
        "source_kind": "live",
    }
    return save_snapshot(document, root)
