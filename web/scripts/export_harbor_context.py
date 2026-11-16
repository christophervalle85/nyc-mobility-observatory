# /// script
# requires-python = ">=3.11"
# dependencies = ["pyproj==3.7.2", "pyshp==2.3.1", "shapely==2.2.0"]
# ///
"""Build the optional New Jersey land layer from official 2025 TIGER/Line archives."""

import argparse
import hashlib
import io
import json
import math
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

import pyproj
import shapefile
import shapely
from shapely.geometry import box, shape

BOUNDS = (-74.42, 40.43, -73.57, 41.0)
COUNTIES = ("34003", "34013", "34017", "34023", "34025", "34027", "34031", "34035", "34039")
SOURCE = "https://www2.census.gov/geo/tiger/TIGER2025/"
ARCHIVES = ["STATE/tl_2025_us_state.zip"] + [
    f"AREAWATER/tl_2025_{county}_areawater.zip" for county in COUNTIES
]
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "data"


def polygons(geometry):
    if geometry.geom_type == "Polygon" and not geometry.is_empty:
        yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygons(part)


def read_archive(path):
    with path.open("rb") as stream:
        data = stream.read(20_000_001)
    if len(data) > 20_000_000:
        raise ValueError(f"Archive too large: {path.name}")
    with ZipFile(io.BytesIO(data)) as archive:
        members = [
            archive.getinfo(f"{path.stem}.{extension}") for extension in ("shp", "shx", "dbf")
        ]
        if sum(member.file_size for member in members) > 80_000_000:
            raise ValueError(f"Uncompressed source too large: {path.name}")
        shp, shx, dbf = (io.BytesIO(archive.read(member)) for member in members)
    return shapefile.Reader(shp=shp, shx=shx, dbf=dbf), hashlib.sha256(data).hexdigest()


def export(source_dir, output):
    pyproj.network.set_network_enabled(False)
    forward = pyproj.Transformer.from_crs(4269, 32118, always_xy=True)
    backward = pyproj.Transformer.from_crs(32118, 4326, always_xy=True)
    crop = box(*BOUNDS)
    sources = []
    water = []
    state = None

    def clip(geometry):
        if not geometry.is_valid:
            geometry = shapely.make_valid(geometry)
        return shapely.transform(geometry.intersection(crop), forward.transform, interleaved=False)

    for remote in ARCHIVES:
        reader, checksum = read_archive(source_dir / Path(remote).name)
        sources.append({"url": SOURCE + remote, "sha256": checksum})
        if remote.startswith("STATE/"):
            state = next(
                clip(shape(record.shape.__geo_interface__))
                for record in reader.iterShapeRecords(fields=["STATEFP"])
                if record.record["STATEFP"] == "34"
            )
            continue
        for feature in reader.iterShapes():
            if crop.intersects(box(*feature.bbox)):
                water.extend(
                    part
                    for part in polygons(clip(shape(feature.__geo_interface__)))
                    if part.area >= 2500
                )

    if state is None or not water:
        raise ValueError("Missing source land or water")
    land = state.difference(shapely.union_all(water)).simplify(10, preserve_topology=True)
    land = shapely.transform(land, backward.transform, interleaved=False).intersection(crop)
    land = shapely.set_precision(land, 0.000001)

    def ring(coordinates):
        return [[round(x, 6), round(y, 6)] for x, y in coordinates]

    output_polygons = [
        [ring(part.exterior.coords), *(ring(hole.coords) for hole in part.interiors)]
        for part in polygons(land)
    ]
    streets, major_streets, park_polygons = [], [], []
    road_coverage = {}
    landmark_names = []
    projected_land = shapely.transform(land, forward.transform, interleaved=False)

    def lines(geometry):
        if geometry.geom_type == "LineString" and not geometry.is_empty:
            yield geometry
        elif hasattr(geometry, "geoms"):
            for child in geometry.geoms:
                yield from lines(child)

    for county in COUNTIES:
        remote = f"ROADS/tl_2025_{county}_roads.zip"
        reader, checksum = read_archive(source_dir / Path(remote).name)
        sources.append({"url": SOURCE + remote, "sha256": checksum})
        counts = Counter()
        for feature in reader.iterShapeRecords(fields=["MTFCC"]):
            code = feature.record["MTFCC"]
            if code not in ("S1100", "S1200", "S1400") or not crop.intersects(
                box(*feature.shape.bbox)
            ):
                continue
            geometry = clip(shape(feature.shape.__geo_interface__)).simplify(8)
            geometry = shapely.transform(
                geometry, backward.transform, interleaved=False
            ).intersection(crop)
            for line in lines(geometry):
                points = ring(line.coords)
                if len(set(map(tuple, points))) >= 2:
                    (major_streets if code in ("S1100", "S1200") else streets).append(points)
                    counts[code] += 1
        road_coverage[county] = dict(counts)
    remote = "AREALM/tl_2025_34_arealm.zip"
    reader, checksum = read_archive(source_dir / Path(remote).name)
    sources.append({"url": SOURCE + remote, "sha256": checksum})
    for feature in reader.iterShapeRecords(fields=["MTFCC", "FULLNAME"]):
        code = feature.record["MTFCC"]
        if code not in {
            "K2180",
            "K2181",
            "K2182",
            "K2183",
            "K2184",
            "K2185",
            "K2186",
            "K2187",
            "K2188",
            "K2190",
        }:
            continue
        if not crop.intersects(box(*feature.shape.bbox)):
            continue
        geometry = (
            clip(shape(feature.shape.__geo_interface__))
            .intersection(projected_land)
            .simplify(8, preserve_topology=True)
            .intersection(projected_land)
        )
        geometry = shapely.transform(geometry, backward.transform, interleaved=False).intersection(
            crop
        )
        geometry = shapely.set_precision(geometry, 0.000001)
        for part in polygons(geometry):
            rings = [ring(part.exterior.coords), *(ring(hole.coords) for hole in part.interiors)]
            if any(len(r) < 4 or r[0] != r[-1] for r in rings):
                raise ValueError("Invalid park ring")
            park_polygons.append(rings)
            landmark_names.append(feature.record["FULLNAME"])
    streets.sort()
    major_streets.sort()
    park_polygons.sort()
    road_vertices = sum(map(len, streets + major_streets))
    park_vertices = sum(len(r) for p in park_polygons for r in p)
    if not 0 < road_vertices <= 250_000 or park_vertices > 40_000:
        raise ValueError("Excessive context vertices")
    all_points = [p for line in streets + major_streets for p in line]
    all_points += [p for polygon in park_polygons for line in polygon for p in line]
    if not all(
        math.isfinite(x)
        and math.isfinite(y)
        and BOUNDS[0] <= x <= BOUNDS[2]
        and BOUNDS[1] <= y <= BOUNDS[3]
        for x, y in all_points
    ):
        raise ValueError("Invalid context coordinates")
    total_vertices = sum(len(line) for polygon in output_polygons for line in polygon)
    if not land.is_valid or not 0 < total_vertices <= 25_000:
        raise ValueError("Invalid harbor layer or excessive vertex count")
    output_polygons.sort()
    encoded = (
        json.dumps(
            {
                "version": 1,
                "polygons": output_polygons,
                "streets": streets,
                "majorStreets": major_streets,
                "parks": park_polygons,
            },
            separators=(",", ":"),
        )
        + "\n"
    ).encode()
    if len(encoded) > 8000000:
        raise ValueError("Excessive output bytes")
    provenance = {
        "version": 1,
        "source": (
            "U.S. Census Bureau, 2025 TIGER/Line Shapefiles, "
            "State, Area Hydrography, Roads and Area Landmarks"
        ),
        "release": "2025",
        "sourcePage": "https://www.census.gov/geographies/mapping-files/2025/geo/tiger-line-file.html",
        "usage": (
            "U.S. Government work (17 U.S.C. § 105). Credit the U.S. Census Bureau. "
            "Approximate positions are supplied without warranty "
            "and must not be used as legal boundaries."
        ),
        "usageDocumentation": (
            "https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc_Ch1.pdf"
        ),
        "processing": (
            "Clip New Jersey and water polygons to map extent, subtract water polygons of at least "
            "2,500 square meters, simplify at 10 meters, and round WGS84 coordinates "
            "to six decimal places."
        ),
        "bounds": BOUNDS,
        "sources": sources,
        "totalVertices": total_vertices + road_vertices + park_vertices,
        "roadVertices": road_vertices,
        "parkVertices": park_vertices,
        "roadCoverage": road_coverage,
        "parkNames": sorted(set(landmark_names)),
        "detailProcessing": (
            "Roads S1100/S1200 major, S1400 local; simplify 8m. "
            "Parks K2180-K2190 excluding K2189; intersect generated land, "
            "simplify 8m. Round six decimals."
        ),
        "classificationDocumentation": "https://www2.census.gov/geo/pdfs/reference/mtfccs2025.pdf",
        "outputSha256": hashlib.sha256(encoded).hexdigest(),
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "harbor-context.json").write_bytes(encoded)
    (output / "harbor-context.provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source_dir", type=Path, help="Folder holding the original TIGER/Line zip archives"
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    export(args.source_dir, args.output)
