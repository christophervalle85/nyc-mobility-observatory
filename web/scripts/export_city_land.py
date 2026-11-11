# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["pyproj==3.7.2", "shapely==2.2.0"]
# ///
"""Derive a bounded land-only clipping mask from frozen official NYC geometry.

Offline tool only. Does not read credentials or perform network requests.
"""

import argparse
import hashlib
import json
import math
from datetime import UTC, datetime
from pathlib import Path

import pyproj
import shapely
from shapely.geometry import MultiPolygon, Polygon, shape

SOURCE_URL = (
    "https://data.cityofnewyork.us/api/v3/views/gthc-hcne/query.geojson?accessType=DOWNLOAD"
)
METADATA_URL = "https://data.cityofnewyork.us/api/views/gthc-hcne.json"
SOURCE_SHA256 = "9677a5c0e497105e4375e7253d157a9027134514ac92bcfca207e4c55631519b"
BOROUGHS = ("Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island")
MAX_SOURCE_VERTICES = 100000
pyproj.network.set_network_enabled(False)
TO_METRES = pyproj.Transformer.from_crs(
    "EPSG:4326", "EPSG:32118", always_xy=True, allow_ballpark=False
)
TO_DEGREES = pyproj.Transformer.from_crs(
    "EPSG:32118", "EPSG:4326", always_xy=True, allow_ballpark=False
)


def project(geometry, transformer):
    return shapely.transform(geometry, transformer.transform, interleaved=False)


def parts(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    raise ValueError("expected polygonal land geometry")


def hole_count(geometry):
    return sum(len(p.interiors) for p in parts(geometry))


def precision_hole(hole, protected_holes):
    return hole.area <= 0.01 and not any(
        hole.intersects(protected) for protected in protected_holes
    )


def clean_union_precision_holes(geometry, protected_holes):
    """Fill only microscopic union-overlay slivers, retaining all source holes."""
    output = []
    removed = []
    for polygon in parts(geometry):
        kept = []
        for ring in polygon.interiors:
            hole = Polygon(ring)
            if precision_hole(hole, protected_holes):
                removed.append(float(hole.area))
            else:
                kept.append(ring)
        output.append(Polygon(polygon.exterior, kept))
    cleaned = MultiPolygon(output)
    if not cleaned.is_valid or len(parts(cleaned)) != len(parts(geometry)):
        raise ValueError("precision cleanup changed land component topology")
    return cleaned, removed


def validate_source(geometry):
    if (
        not isinstance(geometry, dict)
        or geometry.get("type") != "MultiPolygon"
        or not isinstance(geometry.get("coordinates"), list)
        or not geometry["coordinates"]
    ):
        raise ValueError("expected borough MultiPolygon")
    count = 0
    for polygon in geometry["coordinates"]:
        if not isinstance(polygon, list) or not polygon:
            raise ValueError("missing polygon")
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("ring must be closed")
            for point in ring:
                if (
                    not isinstance(point, list)
                    or len(point) != 2
                    or not all(
                        isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n)
                        for n in point
                    )
                ):
                    raise ValueError("invalid coordinate")
                if not (-74.3 <= point[0] <= -73.6 and 40.45 <= point[1] <= 40.95):
                    raise ValueError("coordinate outside NYC")
            count += len(ring) - 1
    value = shape(geometry)
    if value.is_empty or not value.is_valid:
        raise ValueError("invalid source topology: " + shapely.is_valid_reason(value))
    return value, count


def convert(data, metadata, tolerance=20, max_polygons=128, max_vertices=8192):
    if (
        not isinstance(tolerance, (int, float))
        or not math.isfinite(tolerance)
        or not 0 < tolerance <= 50
    ):
        raise ValueError("tolerance must be in (0,50] metres")
    if (
        not isinstance(metadata, dict)
        or metadata.get("id") != "gthc-hcne"
        or metadata.get("provenance") != "official"
        or "water areas excluded" not in metadata.get("description", "").lower()
        or "26c" not in metadata.get("description", "")
    ):
        raise ValueError("unexpected official metadata/version")
    if (
        not isinstance(data, dict)
        or data.get("type") != "FeatureCollection"
        or not isinstance(data.get("features"), list)
        or len(data["features"]) != 5
    ):
        raise ValueError("expected five boroughs")
    by_name = {f.get("properties", {}).get("boroname"): f for f in data["features"]}
    if set(by_name) != set(BOROUGHS):
        raise ValueError("missing or duplicated borough")
    values = []
    source_vertices = 0
    source_polygons = 0
    source_holes = 0
    for name in BOROUGHS:
        value, count = validate_source(by_name[name].get("geometry"))
        source_vertices += count
        source_polygons += len(parts(value))
        source_holes += hole_count(value)
        if source_vertices > MAX_SOURCE_VERTICES:
            raise ValueError("source vertex budget exceeded")
        values.append(project(value, TO_METRES))
    # Internal administrative borders are not coastlines. Union preserves all land,
    # merges touching components and exposes enclosed source-water holes explicitly.
    original = shapely.union_all(values)
    if original.is_empty or not original.is_valid:
        raise ValueError("invalid union topology")
    protected_holes = [
        Polygon(h) for value in values for polygon in parts(value) for h in polygon.interiors
    ]
    cleaned_baseline, removed_source_holes = clean_union_precision_holes(original, protected_holes)
    simplified = shapely.simplify(original, tolerance, preserve_topology=True)
    if (
        not simplified.is_valid
        or len(parts(simplified)) != len(parts(original))
        or hole_count(simplified) != hole_count(original)
    ):
        raise ValueError("simplification changed land component/hole topology")
    geographic = project(simplified, TO_DEGREES)
    polygons = []
    source_hole_flags = {}
    triples = list(zip(parts(original), parts(simplified), parts(geographic), strict=True))
    if any(len(a.interiors) != len(b.interiors) for a, b, _ in triples):
        raise ValueError("simplifier reordered or removed component hole structure")
    for index, (source_part, _, p) in enumerate(sorted(triples, key=lambda item: item[2].bounds)):

        def ring(coords):
            return [[x, y] for x, y in list(coords)[:-1]]

        item = {"name": f"NYC land component {index + 1}", "ring": ring(p.exterior.coords)}
        if p.interiors:
            item["holes"] = [ring(h.coords) for h in p.interiors]
        source_hole_flags[item["name"]] = [
            (precision_hole(Polygon(h), protected_holes), float(Polygon(h).area))
            for h in source_part.interiors
        ]
        polygons.append(item)
    # Simplify FIRST: filtering holes must not change any emitted outer or real-hole array.
    polygons = json.loads(json.dumps(polygons, allow_nan=False))
    full_candidate_sha256 = hashlib.sha256(
        encoded(
            {
                "version": 1,
                "source": "NYC DCP water-excluded borough boundaries 26c",
                "polygons": polygons,
            }
        )
    ).hexdigest()
    outer_arrays_sha256 = hashlib.sha256(encoded([p["ring"] for p in polygons])).hexdigest()
    removed_candidate_holes = []
    for polygon in polygons:
        kept = []
        for index, hole in enumerate(polygon.get("holes", [])):
            metric = project(Polygon(hole), TO_METRES)
            remove, source_area = source_hole_flags[polygon["name"]][index]
            if remove:
                removed_candidate_holes.append(
                    {
                        "component": polygon["name"],
                        "source_union_hole_index": index,
                        "source_union_area_metres_squared": source_area,
                        "candidate_area_metres_squared": float(metric.area),
                        "ring_sha256": hashlib.sha256(encoded(hole)).hexdigest(),
                    }
                )
            else:
                kept.append(hole)
        if kept:
            polygon["holes"] = kept
        else:
            polygon.pop("holes", None)
    if len(removed_candidate_holes) != len(removed_source_holes):
        raise ValueError("cleanup did not remove precisely the source-union precision slivers")
    if hashlib.sha256(encoded([p["ring"] for p in polygons])).hexdigest() != outer_arrays_sha256:
        raise ValueError("cleanup changed outer coast coordinates")
    emitted = MultiPolygon([Polygon(p["ring"], p.get("holes", [])) for p in polygons])
    if (
        not emitted.is_valid
        or len(parts(emitted)) != len(parts(original))
        or hole_count(emitted) != hole_count(cleaned_baseline)
    ):
        raise ValueError("emitted geometry failed post-serialization topology validation")
    emitted_metric = project(emitted, TO_METRES)
    deviation = float(
        shapely.hausdorff_distance(cleaned_baseline.boundary, emitted_metric.boundary, densify=0.25)
    )
    if not math.isfinite(deviation) or deviation > 50:
        raise ValueError(f"verified boundary deviation exceeds 50 metres: {deviation}")
    vertices = sum(len(p["ring"]) + sum(len(h) for h in p.get("holes", [])) for p in polygons)
    if len(polygons) > max_polygons or vertices > max_vertices:
        raise ValueError(f"display budget exceeded: {len(polygons)} polygons, {vertices} vertices")
    asset = {
        "version": 1,
        "source": "NYC DCP water-excluded borough boundaries 26c",
        "polygons": polygons,
    }
    stats = {
        "source_polygons": source_polygons,
        "source_holes": source_holes,
        "source_vertices_without_closures": source_vertices,
        "union_polygons": len(parts(original)),
        "union_holes": hole_count(original),
        "cleaned_baseline_polygons": len(parts(cleaned_baseline)),
        "cleaned_baseline_holes": hole_count(cleaned_baseline),
        "removed_precision_holes": len(removed_source_holes),
        "removed_source_hole_area_metres_squared": sum(removed_source_holes),
        "removed_candidate_holes": removed_candidate_holes,
        "precision_hole_area_ceiling_metres_squared": 0.01,
        "full_candidate_sha256": full_candidate_sha256,
        "outer_arrays_sha256": outer_arrays_sha256,
        "deviation_reference": (
            "union after removing only unprotected union holes <=0.01 square metres"
        ),
        "output_polygons": len(polygons),
        "output_holes": hole_count(emitted),
        "output_vertices_without_closures": vertices,
        "simplification_tolerance_metres": tolerance,
        "post_serialization_densified_boundary_hausdorff_metres": deviation,
        "hausdorff_densify_fraction": 0.25,
        "maximum_verified_deviation_metres": 50,
        "max_polygons": max_polygons,
        "max_vertices": max_vertices,
        "coordinate_precision": "full IEEE-754 double JSON round trip",
        "rings": "unclosed; closure is implicit",
        "topology_valid": True,
    }
    return asset, stats


def encoded(value):
    return (
        json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n"
    ).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument(
        "--acquired-at", required=True, help="Frozen source acquisition UTC ISO timestamp"
    )
    args = parser.parse_args()
    if args.source.stat().st_size > 5_000_000 or args.metadata.stat().st_size > 262144:
        raise ValueError("input byte budget exceeded")
    raw = args.source.read_bytes()
    meta = args.metadata.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError("frozen source checksum mismatch")
    acquired = datetime.fromisoformat(args.acquired_at.replace("Z", "+00:00"))
    if acquired.utcoffset() != UTC.utcoffset(acquired):
        raise ValueError("acquisition timestamp must be UTC")
    metadata = json.loads(meta)
    asset, stats = convert(json.loads(raw), metadata)
    payload = encoded(asset)
    provenance = {
        "source_url": SOURCE_URL,
        "metadata_url": METADATA_URL,
        "source_version": "26c",
        "source_sha256": SOURCE_SHA256,
        "source_bytes": len(raw),
        "metadata_sha256": hashlib.sha256(meta).hexdigest(),
        "source_rows_updated_at": metadata.get("rowsUpdatedAt"),
        "acquired_at_utc": args.acquired_at,
        "output_sha256": hashlib.sha256(payload).hexdigest(),
        "output_bytes": len(payload),
        "method": (
            "Union all official borough land in EPSG:32118; GEOS topology-preserving "
            "simplification at 20m FIRST; inverse project with full double precision; "
            "remove precisely the corresponding hole arrays classified from raw-union "
            "area <=0.01 square metres before simplification, protecting explicit source "
            "holes. GEOS topology-preserving simplification can expand numerical slivers,"
            " so candidate area is not the classification criterion. All outer-coast and "
            "retained real-hole arrays remain bit-identical to full candidate. Validate "
            "serialized topology and densified symmetric boundary Hausdorff distance "
            "against the precision-cleaned union baseline. Shared internal borough "
            "borders are removed, not interpreted as shoreline."
        ),
        "simplification_crs": "EPSG:32118 (NAD83 / New York Long Island; metres)",
        "pyproj_version": pyproj.__version__,
        "proj_version": pyproj.proj_version_str,
        "shapely_version": shapely.__version__,
        "geos_version": shapely.geos_version_string,
        "statistics": stats,
        "trial_only": True,
        "budget_decision": (
            "Original 4096-position cap failed: 30m GEOS candidate had 4328 positions and"
            " 51.7536875m verified boundary deviation. Root explicitly authorized one 20m"
            " candidate under an 8192-position trial cap, while retaining the 50m actual-"
            "deviation limit and all union components/holes. Runtime flag remains off "
            "pending A/B."
        ),
        "cleanup_decision": (
            "The full-mask live trial regressed. Root authorized one variable only: "
            "remove 42 microscopic union-overlay sliver holes, preserving every land "
            "component and the explicit DCP water hole. The boundary deviation reference "
            "excludes those exact sliver-hole borders; this is not the same boundary "
            "guarantee against the uncleaned union. Runtime A/B remains required."
        ),
        "limitations": (
            "Simplified administrative land footprint for display clipping only, not an "
            "exact shoreline, extracted imagery mesh, or assurance of alignment with "
            "Google imagery dates. Hausdorff check is GEOS discrete boundary distance "
            "with segment densification, not an exact continuous-distance proof."
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.provenance.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    args.provenance.write_bytes(encoded(provenance))
    print(json.dumps({"output_bytes": len(payload), **stats}))


if __name__ == "__main__":
    main()
