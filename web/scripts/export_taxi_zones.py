# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["pyshp==2.3.1", "pyproj==3.7.2"]
# ///
"""Convert frozen official TLC geometry offline. Never reads environment/token files."""

import argparse
import csv
import hashlib
import io
import json
import math
import os
import stat
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

import pyproj
import shapefile

OFFICIAL_ZIP_SHA256 = "f6d711917bb4340f8f644d5366c51665489eb2d426dd1a4a55677721ae5adf17"
ZIP_URL = "https://d37ci6vzurychx.cloudfront.net/misc/taxi_zones.zip"
LOOKUP_URL = "https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv"
MAX_ZIP_BYTES = 10 * 1024 * 1024
MAX_MEMBER_BYTES = 4 * 1024 * 1024
MAX_EXPANDED_BYTES = 8 * 1024 * 1024
MAX_VERTICES = 200_000
MAX_RING_VERTICES = 100_000
MAX_FEATURES = 1000
NYC_BOUNDS = (-74.30, 40.45, -73.65, 40.95)  # Includes TLC's Newark Airport zone.
MEMBERS = {f"taxi_zones/taxi_zones.{suffix}" for suffix in ("shp", "shx", "dbf", "prj", "cpg")}


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(path: Path, expected: str, ceiling: int) -> None:
    if not path.is_file() or path.stat().st_size > ceiling:
        raise ValueError("input missing or exceeds size ceiling")
    if checksum(path) != expected:
        raise ValueError("input checksum mismatch")


def read_zip(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if len(infos) > len(MEMBERS) + 1 or len({info.filename for info in infos}) != len(infos):
            raise ValueError("ZIP has duplicate or excessive members")
        total = 0
        for info in infos:
            name = PurePosixPath(info.filename)
            if (
                name.is_absolute()
                or ".." in name.parts
                or "\\" in info.filename
                or stat.S_ISLNK(info.external_attr >> 16)
                or info.flag_bits & 1
                or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
            ):
                raise ValueError("unsafe ZIP member")
            if info.filename == "taxi_zones/" and info.is_dir() and info.file_size == 0:
                continue
            if info.filename not in MEMBERS or info.is_dir():
                raise ValueError("unexpected ZIP member")
            total += info.file_size
            if not 0 < info.file_size <= MAX_MEMBER_BYTES or total > MAX_EXPANDED_BYTES:
                raise ValueError("ZIP member size exceeds ceiling")
        if not MEMBERS.issubset({info.filename for info in infos}):
            raise ValueError("ZIP is missing expected geometry members")
        # read() validates CRC; only these named, size-bounded bytes enter parsers.
        return {Path(name).suffix[1:]: archive.read(name) for name in sorted(MEMBERS)}


def make_transformer(wkt: str) -> pyproj.Transformer:
    pyproj.network.set_network_enabled(False)
    try:
        source = pyproj.CRS.from_wkt(wkt)
        if source.to_epsg() != 2263 or not source.is_projected:
            raise ValueError("source CRS must be EPSG:2263 US survey feet")
        return pyproj.Transformer.from_crs(
            source, "EPSG:4326", always_xy=True, allow_ballpark=False
        )
    except pyproj.exceptions.CRSError as exc:
        raise ValueError("invalid source CRS; expected EPSG:2263") from exc


def lookup_rows(path: Path) -> dict[int, dict[str, str]]:
    rows = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle, strict=True)
        if reader.fieldnames != ["LocationID", "Borough", "Zone", "service_zone"]:
            raise ValueError("unexpected lookup schema")
        for row in reader:
            if None in row or any(not value or not value.strip() for value in row.values()):
                raise ValueError("invalid lookup row or missing label")
            if not row["LocationID"].isdigit():
                raise ValueError("lookup ID must be an integer")
            identifier = int(row["LocationID"])
            if identifier <= 0 or identifier in rows or len(rows) >= MAX_FEATURES + 2:
                raise ValueError("duplicate/invalid lookup ID or excessive lookup rows")
            rows[identifier] = row
    return rows


def normalized(value: str) -> str:
    return " ".join(value.split()).casefold()


def project_geometry(
    shape: shapefile.Shape, transformer: pyproj.Transformer
) -> tuple[dict, int, int]:
    if shape.shapeType != shapefile.POLYGON or not shape.parts:
        raise ValueError("source geometry must be a nonempty 2D Polygon")
    parts = list(shape.parts) + [len(shape.points)]
    rings = [list(shape.points[start:end]) for start, end in zip(parts, parts[1:], strict=False)]
    for ring in rings:
        if (
            not 4 <= len(ring) <= MAX_RING_VERTICES
            or ring[0] != ring[-1]
            or len(set(ring[:-1])) < 3
            or any(
                len(point) != 2 or not all(math.isfinite(value) for value in point)
                for point in ring
            )
            or shapefile.signed_area(ring) == 0
        ):
            raise ValueError("invalid polygon ring or ring vertex limit")
    errors = {}
    polygons = shapefile.organize_polygon_rings(rings, return_errors=errors)
    if errors:
        raise ValueError("invalid ring orientation or orphan hole")
    projected = []
    holes = 0
    for polygon in polygons:
        shell = polygon[0]
        for hole in polygon[1:]:
            if not all(shapefile.ring_contains_point(shell, point) for point in hole[:-1]):
                raise ValueError("polygon hole is outside its exterior ring")
        holes += len(polygon) - 1
        converted = []
        for ring in polygon:
            xs, ys = zip(*ring, strict=True)
            longitudes, latitudes = transformer.transform(xs, ys, errcheck=True)
            coordinates = [
                [longitude, latitude]
                for longitude, latitude in zip(longitudes, latitudes, strict=True)
            ]
            west, south, east, north = NYC_BOUNDS
            if any(
                not math.isfinite(lon)
                or not math.isfinite(lat)
                or not west <= lon <= east
                or not south <= lat <= north
                for lon, lat in coordinates
            ):
                raise ValueError("projected coordinate outside NYC/TLC bounds")
            # Shapefile winding is opposite GeoJSON's right-hand convention. Only reverse;
            # retain every vertex and full projection precision without simplification.
            converted.append(list(reversed(coordinates)))
        projected.append(converted)
    geometry = (
        {"type": "Polygon", "coordinates": projected[0]}
        if len(projected) == 1
        else {"type": "MultiPolygon", "coordinates": projected}
    )
    return geometry, holes, len(shape.points)


def convert_assets(
    zip_path: Path, lookup_path: Path, zip_sha256: str, lookup_sha256: str
) -> tuple[dict, dict]:
    verify(zip_path, zip_sha256, MAX_ZIP_BYTES)
    verify(lookup_path, lookup_sha256, 1024 * 1024)
    members = read_zip(zip_path)
    if members["cpg"].decode("ascii").strip().lower() not in ("utf-8", "utf8"):
        raise ValueError("unexpected DBF text encoding")
    transformer = make_transformer(members["prj"].decode("utf-8"))
    lookup = lookup_rows(lookup_path)
    features, identifiers, vertices, holes = [], set(), 0, 0
    with shapefile.Reader(
        shp=io.BytesIO(members["shp"]),
        shx=io.BytesIO(members["shx"]),
        dbf=io.BytesIO(members["dbf"]),
        encoding="utf-8",
    ) as reader:
        if not 0 < len(reader) <= MAX_FEATURES:
            raise ValueError("geometry feature count outside ceiling")
        fields = {field[0] for field in reader.fields[1:]}
        if not {"LocationID", "zone", "borough"}.issubset(fields):
            raise ValueError("missing source geometry identity fields")
        for item in reader.iterShapeRecords():
            record = item.record.as_dict()
            identifier = record["LocationID"]
            if type(identifier) is not int or identifier <= 0 or identifier in (264, 265):
                raise ValueError("source LocationID must be an ordinary positive integer")
            if identifier in identifiers:
                raise ValueError("duplicate source LocationID; no deduplication permitted")
            reference = lookup.get(identifier)
            if (
                reference is None
                or not isinstance(record["zone"], str)
                or not isinstance(record["borough"], str)
                or normalized(record["zone"]) != normalized(reference["Zone"])
                or normalized(record["borough"]) != normalized(reference["Borough"])
            ):
                raise ValueError(f"geometry identity does not join official lookup: {identifier}")
            vertices += len(item.shape.points)
            if vertices > MAX_VERTICES:
                raise ValueError("geometry vertex ceiling exceeded")
            geometry, hole_count, _ = project_geometry(item.shape, transformer)
            holes += hole_count
            identifiers.add(identifier)
            features.append(
                {
                    "type": "Feature",
                    "id": identifier,
                    "properties": {
                        "location_id": identifier,
                        "zone": reference["Zone"],
                        "borough": reference["Borough"],
                    },
                    "geometry": geometry,
                }
            )
    if identifiers != set(lookup) - {264, 265}:
        raise ValueError("geometry/lookup ID coverage mismatch")
    features.sort(key=lambda feature: feature["id"])
    operation = transformer.get_last_used_operation()
    report = {
        "features": len(features),
        "vertices": vertices,
        "holes": holes,
        "geometry_types": {
            kind: sum(feature["geometry"]["type"] == kind for feature in features)
            for kind in ("Polygon", "MultiPolygon")
        },
        "operation": operation.description,
        "accuracy_metres": operation.accuracy,
    }
    return {"type": "FeatureCollection", "features": features}, report


def asset_path(root: Path, asset: dict, key: str, suffix: str) -> Path:
    relative = Path(asset["path"])
    expected = Path("raw") / key / (asset["sha256"] + suffix)
    if relative != expected or relative.is_absolute() or ".." in relative.parts:
        raise ValueError("unexpected archived asset path")
    path = root
    for part in relative.parts:
        path /= part
        if path.is_symlink():
            raise ValueError("archived asset path must not contain symbolic links")
    if not path.is_file() or path.stat().st_size != asset["bytes"]:
        raise ValueError("archived asset length mismatch")
    return path


def encoded(value: dict) -> bytes:
    return (
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        )
        + "\n"
    ).encode("utf-8")


def atomic_write(path: Path, data: bytes) -> None:
    if path.is_symlink():
        raise ValueError("output must not be a symbolic link")
    descriptor, temporary = tempfile.mkstemp(prefix=".taxi-zones-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def export_snapshot(snapshot: Path, data_dir: Path, output_dir: Path) -> dict:
    if not snapshot.is_file() or snapshot.stat().st_size > 256 * 1024:
        raise ValueError("snapshot missing or exceeds metadata ceiling")
    snapshot_sha = checksum(snapshot)
    if snapshot.name != snapshot_sha + ".json":
        raise ValueError("snapshot checksum mismatch")
    document = json.loads(snapshot.read_bytes())
    if document.get("snapshot_version") != 1:
        raise ValueError("unsupported M1 snapshot version")
    assets = document["assets"]
    if assets["polygons"]["sha256"] != OFFICIAL_ZIP_SHA256:
        raise ValueError("snapshot does not reference the approved official TLC ZIP")
    root = data_dir.resolve()
    zipped = asset_path(root, assets["polygons"], "polygons", ".zip")
    lookup = asset_path(root, assets["lookup"], "lookup", ".csv")
    collection, validation = convert_assets(
        zipped, lookup, assets["polygons"]["sha256"], assets["lookup"]["sha256"]
    )
    content = encoded(collection)
    command = (
        "uv run --locked --script web/scripts/export_taxi_zones.py --data-dir .data "
        f"--snapshot .data/snapshots/{snapshot_sha}.json --output-dir web/public/data"
    )
    provenance = {
        "contract_version": "m2-tlc-geometry-v1",
        "credit": "NYC Taxi & Limousine Commission (TLC). Independent official taxi-zone overlay.",
        "source_page": "https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page",
        "terms_url": "https://www.nyc.gov/home/terms-of-use.page",
        "policy_reference": "https://cityofnewyork.github.io/opendatatsm/publicpolicies.html",
        "terms_note": "NYC source/policy references; no additional license grant is asserted.",
        "snapshot": "sha256:" + snapshot_sha,
        "inputs": {
            "zip": {
                "url": ZIP_URL,
                "sha256": assets["polygons"]["sha256"],
                "bytes": assets["polygons"]["bytes"],
            },
            "lookup": {
                "url": LOOKUP_URL,
                "sha256": assets["lookup"]["sha256"],
                "bytes": assets["lookup"]["bytes"],
            },
        },
        "output": {
            "file": "taxi-zones.geojson",
            "sha256": hashlib.sha256(content).hexdigest(),
            "bytes": len(content),
        },
        "projection": {
            "source": "EPSG:2263 NAD83 / New York Long Island (US survey feet)",
            "destination": "EPSG:4326 WGS84",
            "axis_order": "longitude, latitude",
            "always_xy": True,
            "network_enabled": False,
            "pyproj": pyproj.__version__,
            "PROJ": pyproj.proj_version_str,
            "EPSG_database": pyproj.database.get_database_metadata("EPSG.VERSION"),
            "operation": validation["operation"],
            "operation_accuracy_metres": validation["accuracy_metres"],
        },
        "converter": {
            "file": "web/scripts/export_taxi_zones.py",
            "sha256": checksum(Path(__file__)),
            "pyshp": shapefile.__version__,
        },
        "validation": validation,
        "coordinate_policy": (
            "All source vertices retained at full projection precision; no simplification."
        ),
        "conversion_command": command,
        "limits": [
            "Structural rings, hole containment, IDs, lookup joins and extent checked; "
            "not a complete independent topology or survey audit.",
            "No Google geometry, imagery, heights or derived content is used.",
        ],
    }
    output_dir = output_dir.absolute()
    if any(parent.is_symlink() for parent in (output_dir, *output_dir.parents)):
        raise ValueError("output directory must not contain symbolic links")
    output_dir.mkdir(parents=True, exist_ok=True)
    # All input validation completes first; each generated file is replaced atomically.
    atomic_write(output_dir / "taxi-zones.geojson", content)
    atomic_write(output_dir / "taxi-zones.provenance.json", encoded(provenance))
    return provenance


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, default=Path(".data"))
    parser.add_argument("--output-dir", type=Path, default=Path("web/public/data"))
    args = parser.parse_args()
    try:
        report = export_snapshot(args.snapshot, args.data_dir, args.output_dir)
        print(
            json.dumps(
                {"features": report["validation"]["features"], "output": report["output"]},
                sort_keys=True,
            )
        )
        return 0
    except (
        ValueError,
        KeyError,
        OSError,
        csv.Error,
        zipfile.BadZipFile,
        shapefile.ShapefileException,
        pyproj.exceptions.ProjError,
    ) as exc:
        print(f"geometry export failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
