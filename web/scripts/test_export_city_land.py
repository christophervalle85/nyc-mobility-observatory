import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

MODULE = Path(__file__).with_name("export_city_land.py")
spec = importlib.util.spec_from_file_location("export_city_land", MODULE)
land = importlib.util.module_from_spec(spec)
spec.loader.exec_module(land)

NAMES = ["Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"]


def fixture():
    features = []
    for index, name in enumerate(NAMES):
        x = -74.15 + index * 0.07
        outer = [[x, 40.6], [x + 0.03, 40.6], [x + 0.03, 40.63], [x, 40.63], [x, 40.6]]
        hole = [
            [x + 0.01, 40.61],
            [x + 0.02, 40.61],
            [x + 0.02, 40.62],
            [x + 0.01, 40.62],
            [x + 0.01, 40.61],
        ]
        island = [
            [x + 0.04, 40.6],
            [x + 0.041, 40.6],
            [x + 0.041, 40.601],
            [x + 0.04, 40.601],
            [x + 0.04, 40.6],
        ]
        features.append(
            {
                "properties": {"boroname": name},
                "geometry": {"type": "MultiPolygon", "coordinates": [[outer, hole], [island]]},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def metadata():
    return {
        "id": "gthc-hcne",
        "provenance": "official",
        "description": "Boundaries of boroughs (water areas excluded). Current version: 26c",
    }


class LandTests(unittest.TestCase):
    def test_preserves_every_part_and_hole_deterministically(self):
        first, stats = land.convert(fixture(), metadata())
        second, _ = land.convert(fixture(), metadata())
        self.assertEqual(first, second)
        self.assertEqual(len(first["polygons"]), 10)
        self.assertEqual(sum(len(p.get("holes", [])) for p in first["polygons"]), 5)
        self.assertEqual(stats["source_polygons"], 10)
        self.assertTrue(all(p["ring"][0] != p["ring"][-1] for p in first["polygons"]))

    def test_preserves_subcentimetre_island_without_coordinate_quantization(self):
        source = fixture()
        x, y = -74.10, 40.65
        tiny = [[x, y], [x + 1e-8, y], [x + 1e-8, y + 1e-8], [x, y + 1e-8], [x, y]]
        source["features"][0]["geometry"]["coordinates"].append([tiny])
        result, stats = land.convert(source, metadata())
        self.assertEqual(stats["output_polygons"], 11)
        self.assertEqual(stats["union_polygons"], 11)
        self.assertTrue(
            all(len({tuple(p) for p in item["ring"]}) >= 3 for item in result["polygons"])
        )

    def test_union_removes_shared_administrative_border_without_discarding_land(self):
        source = fixture()
        x = -74.15 + 0.03
        outer = [[x, 40.6], [x + 0.03, 40.6], [x + 0.03, 40.63], [x, 40.63], [x, 40.6]]
        hole = [
            [x + 0.01, 40.61],
            [x + 0.02, 40.61],
            [x + 0.02, 40.62],
            [x + 0.01, 40.62],
            [x + 0.01, 40.61],
        ]
        source["features"][1]["geometry"]["coordinates"][0] = [outer, hole]
        source["features"][0]["geometry"]["coordinates"][1] = [
            [
                [-74.14, 40.64],
                [-74.139, 40.64],
                [-74.139, 40.641],
                [-74.14, 40.641],
                [-74.14, 40.64],
            ]
        ]
        result, stats = land.convert(source, metadata())
        self.assertEqual(stats["source_polygons"], 10)
        self.assertEqual(stats["union_polygons"], 9)
        self.assertEqual(stats["output_polygons"], 9)
        self.assertEqual(stats["output_holes"], 5)

    def test_frozen_asset_checksum_and_topology_match_provenance(self):
        folder = Path(__file__).parents[1] / "public" / "data"
        raw = (folder / "city-land.json").read_bytes()
        result = json.loads(raw)
        provenance = json.loads((folder / "city-land.provenance.json").read_text())
        self.assertEqual(hashlib.sha256(raw).hexdigest(), provenance["output_sha256"])
        self.assertEqual(len(raw), provenance["output_bytes"])
        self.assertEqual(provenance["source_sha256"], land.SOURCE_SHA256)
        geometry = land.MultiPolygon(
            [land.Polygon(p["ring"], p.get("holes", [])) for p in result["polygons"]]
        )
        self.assertTrue(geometry.is_valid)
        self.assertEqual(len(result["polygons"]), 88)
        self.assertEqual(land.hole_count(geometry), 1)
        positions = sum(
            len(p["ring"]) + sum(len(h) for h in p.get("holes", [])) for p in result["polygons"]
        )
        self.assertEqual(positions, 5546)
        self.assertLessEqual(positions, 8192)
        stats = provenance["statistics"]
        self.assertEqual(stats["source_polygons"], 117)
        self.assertEqual(stats["source_holes"], 1)
        self.assertEqual(stats["union_holes"], 43)
        self.assertEqual(stats["removed_precision_holes"], 42)
        self.assertEqual(stats["cleaned_baseline_holes"], 1)
        self.assertEqual(
            stats["full_candidate_sha256"],
            "c4c77da29f004421dca35f63e48c8ab095a8a69cff1f3709a0e5d7ffb3631905",
        )
        self.assertEqual(
            hashlib.sha256(land.encoded([p["ring"] for p in result["polygons"]])).hexdigest(),
            "12306eb3249c7ddb824f3dfbfc14a9c088d2386dbeb3cd8ecaf3963a4703d701",
        )
        self.assertLessEqual(stats["removed_source_hole_area_metres_squared"], 42 * 0.01)
        self.assertLessEqual(
            provenance["statistics"]["post_serialization_densified_boundary_hausdorff_metres"], 50
        )

    def test_precision_cleanup_removes_only_microscopic_unprotected_holes(self):
        outer = [[0, 0], [100, 0], [100, 100], [0, 100]]
        sliver = [[10, 10], [10.001, 10], [10.001, 10.001], [10, 10.001]]
        real = [[20, 20], [30, 20], [30, 30], [20, 30]]
        protected = [[40, 40], [40.001, 40], [40.001, 40.001], [40, 40.001]]
        island = [[200, 200], [200.0001, 200], [200.0001, 200.0001], [200, 200.0001]]
        original = land.MultiPolygon(
            [land.Polygon(outer, [sliver, real, protected]), land.Polygon(island)]
        )
        cleaned, removed = land.clean_union_precision_holes(original, [land.Polygon(protected)])
        self.assertEqual(len(land.parts(cleaned)), 2)
        self.assertEqual(land.hole_count(cleaned), 2)
        self.assertEqual(len(removed), 1)
        self.assertLessEqual(removed[0], 0.01)
        self.assertEqual(
            list(land.parts(cleaned)[0].exterior.coords),
            list(land.parts(original)[0].exterior.coords),
        )

    def test_rejects_bad_metadata_missing_borough_and_nan(self):
        bad = metadata()
        bad["provenance"] = "community"
        with self.assertRaises(ValueError):
            land.convert(fixture(), bad)
        bad = fixture()
        bad["features"].pop()
        with self.assertRaises(ValueError):
            land.convert(bad, metadata())
        bad = fixture()
        bad["features"][0]["geometry"]["coordinates"][0][0][1][0] = float("nan")
        with self.assertRaises(ValueError):
            land.convert(bad, metadata())

    def test_rejects_self_crossing_and_hole_outside(self):
        bad = fixture()
        bad["features"][0]["geometry"]["coordinates"][0][0] = [
            [-74.15, 40.6],
            [-74.12, 40.63],
            [-74.15, 40.63],
            [-74.12, 40.6],
            [-74.15, 40.6],
        ]
        with self.assertRaises(ValueError):
            land.convert(bad, metadata())
        bad = fixture()
        bad["features"][0]["geometry"]["coordinates"][0][1] = [
            [-74.2, 40.6],
            [-74.19, 40.6],
            [-74.19, 40.61],
            [-74.2, 40.61],
            [-74.2, 40.6],
        ]
        with self.assertRaises(ValueError):
            land.convert(bad, metadata())

    def test_budget_fails_closed(self):
        with self.assertRaises(ValueError):
            land.convert(fixture(), metadata(), max_vertices=10)

    def test_distance_bound_and_tolerance_limit(self):
        with self.assertRaises(ValueError):
            land.convert(fixture(), metadata(), tolerance=51)
        result, stats = land.convert(fixture(), metadata())
        self.assertTrue(stats["topology_valid"])
        self.assertLessEqual(stats["post_serialization_densified_boundary_hausdorff_metres"], 50)


if __name__ == "__main__":
    unittest.main()
