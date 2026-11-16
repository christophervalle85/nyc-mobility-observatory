# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely==2.2.0", "pyproj==3.7.2"]
# ///
"""Export bounded NYC context offline from frozen official Socrata JSON captures.

Run with --source-dir containing {streets,parks}-{data,metadata,request}.json.
The provenance records exact bounded request URLs; save their JSON responses to
these filenames to reproduce acquisition. No network is used by this exporter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlencode

import pyproj
import shapely
from shapely.geometry import LineString, Polygon, box, shape

BOUNDS = (-74.26, 40.49, -73.69, 40.93)
SOURCE_CONFIG = {
    "streets": (
        "inkn-q76z",
        "the_geom,physicalid,full_street_name,rw_type,streetwidth,boroughcode",
        "within_box(the_geom,40.93,-74.26,40.49,-73.69) AND rw_type in (1,2,3)",
        "physicalid",
        150001,
        60000000,
    ),
    "parks": (
        "enfh-gkve",
        "multipolygon,objectid,signname,borough,acres,typecategory",
        "within_box(multipolygon,40.93,-74.26,40.49,-73.69) AND retired = false",
        "objectid",
        10001,
        30000000,
    ),
}


def bounded_read(path: Path, limit: int) -> bytes:
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Source exceeds fixed byte limit")
    return data


ROOT = Path(__file__).resolve().parents[1] / "public" / "data"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parts(geometry, kind):
    if geometry.geom_type == kind:
        yield geometry
    elif hasattr(geometry, "geoms"):
        for child in geometry.geoms:
            yield from parts(child, kind)


def export(source: Path, output: Path, provenance: Path) -> None:
    pyproj.network.set_network_enabled(False)
    forward = pyproj.Transformer.from_crs(4326, 32118, always_xy=True)
    backward = pyproj.Transformer.from_crs(32118, 4326, always_xy=True)
    boundary = box(*BOUNDS)
    sources = {}
    rows = {}
    for name, (dataset, fields, where, order, row_limit, byte_limit) in SOURCE_CONFIG.items():
        raw = bounded_read(source / f"{name}-data.json", byte_limit)
        meta = bounded_read(source / f"{name}-metadata.json", 2000000)
        request = json.loads(bounded_read(source / f"{name}-request.json", 4096))
        expected_url = (
            "https://data.cityofnewyork.us/resource/"
            + dataset
            + ".json?"
            + urlencode(
                {"$select": fields, "$where": where, "$order": order, "$limit": str(row_limit)}
            )
        )
        if request.get("dataset") != dataset or request.get("url") != expected_url:
            raise ValueError("Source endpoint or bounded query mismatch")
        records = json.loads(raw)
        if not isinstance(records, list) or not 0 < len(records) < row_limit:
            raise ValueError("Invalid or truncated source capture")
        metadata = json.loads(meta)
        if metadata["id"] != dataset or type(metadata.get("rowsUpdatedAt")) is not int:
            raise ValueError("Metadata dataset/version mismatch")
        sources[name] = {
            "dataset": dataset,
            "url": expected_url,
            "metadataUrl": "https://data.cityofnewyork.us/api/views/" + dataset + ".json",
            "rowLimit": row_limit,
            "byteLimit": byte_limit,
            "rows": len(records),
            "bytes": len(raw),
            "sha256": digest(raw),
            "metadataSha256": digest(meta),
            "rowsUpdatedAt": metadata["rowsUpdatedAt"],
        }
        borough_field = "boroughcode" if name == "streets" else "borough"
        borough_counts = dict(sorted(Counter(row.get(borough_field) for row in records).items()))
        expected_boroughs = (
            {"1", "2", "3", "4", "5"} if name == "streets" else {"B", "M", "Q", "R", "X"}
        )
        if set(borough_counts) != expected_boroughs:
            raise ValueError("Source does not cover all five boroughs")
        sources[name]["boroughRows"] = borough_counts
        rows[name] = records

    def project(geometry):
        return shapely.transform(geometry, forward.transform, interleaved=False)

    def coords(sequence):
        return [[round(x, 6), round(y, 6)] for x, y in sequence]

    groups = defaultdict(list)
    for row in rows["streets"]:
        if row["rw_type"] not in ("1", "2", "3"):
            raise ValueError("Unexpected street source class")
        name = row.get("full_street_name", "")
        major = (
            float(row.get("streetwidth") or 0) >= 80
            or any(word in name for word in ("BROADWAY", "FDR", "HENRY HUDSON", "WEST ST"))
            or name in ("PARK AVE", "MADISON AVE", "LEXINGTON AVE", "AMSTERDAM AVE", "COLUMBUS AVE")
        )
        geometry = shape(row["the_geom"])
        if not geometry.is_valid:
            raise ValueError("Invalid source street")
        groups[(major, name)].extend(parts(project(geometry.intersection(boundary)), "LineString"))
    result = {"streets": [], "majorStreets": [], "parks": []}
    for (major, _name), lines in sorted(groups.items()):
        merged = shapely.line_merge(shapely.union_all(lines))
        for line in parts(merged, "LineString"):
            simplified = shapely.transform(line.simplify(5), backward.transform, interleaved=False)
            points = coords(simplified.coords)
            if len(set(map(tuple, points))) >= 2:
                result["majorStreets" if major else "streets"].append(points)
    central_park = False
    for row in rows["parks"]:
        geometry = shape(row["multipolygon"])
        if not geometry.is_valid:
            geometry = shapely.make_valid(geometry)
        simplified = project(geometry.intersection(boundary)).simplify(8, preserve_topology=True)
        simplified = shapely.transform(simplified, backward.transform, interleaved=False)
        simplified = shapely.set_precision(simplified, 0.000001)
        for polygon in parts(simplified, "Polygon"):
            if polygon.is_empty:
                continue
            rings = [
                coords(polygon.exterior.coords),
                *[coords(ring.coords) for ring in polygon.interiors],
            ]
            if any(len(ring) < 4 or ring[0] != ring[-1] for ring in rings):
                raise ValueError("Invalid output park ring")
            if not Polygon(rings[0], rings[1:]).is_valid:
                raise ValueError("Rounding invalidated park polygon")
            result["parks"].append(rings)
            if row.get("signname") == "Central Park":
                central_park = True
    if not central_park or not all(result.values()):
        raise ValueError("Required context is missing")
    for key in result:
        result[key].sort(key=lambda value: json.dumps(value, separators=(",", ":")))
    for line in result["streets"] + result["majorStreets"]:
        if not LineString(line).is_valid:
            raise ValueError("Invalid output street")
    points = [p for line in result["streets"] + result["majorStreets"] for p in line]
    points += [p for polygon in result["parks"] for ring in polygon for p in ring]
    if not all(
        math.isfinite(x)
        and math.isfinite(y)
        and BOUNDS[0] <= x <= BOUNDS[2]
        and BOUNDS[1] <= y <= BOUNDS[3]
        for x, y in points
    ):
        raise ValueError("Output escaped geographic bounds")
    features = {key: len(value) for key, value in result.items()}
    actual_bounds = [
        min(p[0] for p in points),
        min(p[1] for p in points),
        max(p[0] for p in points),
        max(p[1] for p in points),
    ]
    result.update(version=1, totalVertices=len(points), bounds=actual_bounds)
    encoded = (json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n").encode()
    details = {
        "version": 1,
        "sources": sources,
        "bounds": list(BOUNDS),
        "projection": "EPSG:32118",
        "streetToleranceMeters": 5,
        "parkToleranceMeters": 8,
        "coordinateDecimals": 6,
        "processing": (
            "Clip; merge streets by name/class; simplify; repair invalid source parks; "
            "snap polygons to 0.000001 degree grid preserving topology; retain polygon holes."
        ),
        "majorStreetRule": (
            "Source streetwidth >= 80 or named Broadway/FDR/Henry Hudson/West St/"
            "Park/Madison/Lexington/Amsterdam/Columbus."
        ),
        "dependencies": {"shapely": shapely.__version__, "pyproj": pyproj.__version__},
        "centralParkIncluded": central_park,
        "legalPolicy": "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-130572",
        "features": features,
        "totalVertices": len(points),
        "actualBounds": actual_bounds,
        "publicUseReferences": [
            "https://www.nyc.gov/opendata/get-started/FAQs",
            "https://cityofnewyork.github.io/opendatatsm/publicpolicies.html",
        ],
        "output": {"filename": output.name, "bytes": len(encoded), "sha256": digest(encoded)},
    }
    output.write_bytes(encoded)
    provenance.write_text(json.dumps(details, indent=2) + "\n")
    print(json.dumps(details["output"]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "manhattan-streets-parks.json")
    parser.add_argument(
        "--provenance", type=Path, default=ROOT / "manhattan-streets-parks.provenance.json"
    )
    args = parser.parse_args()
    export(args.source_dir, args.output, args.provenance)
