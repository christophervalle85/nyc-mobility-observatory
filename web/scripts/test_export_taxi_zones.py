# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["pyshp==2.3.1", "pyproj==3.7.2"]
# ///
"""Offline converter contracts. Run with uv run --script this_file.py."""

import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import pyproj
import shapefile

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = (
    ROOT / ".data/snapshots/99fe7db5f3a0e717bee4ef2d2042a1021464f298a77adee25b5a917d2358a101.json"
)
OUTER = [
    (1000000, 200000),
    (1000000, 201000),
    (1001000, 201000),
    (1001000, 200000),
    (1000000, 200000),
]
HOLE = [
    (1000200, 200200),
    (1000800, 200200),
    (1000800, 200800),
    (1000200, 200800),
    (1000200, 200200),
]
SECOND = [(x + 3000, y) for x, y in OUTER]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def exporter():
    path = Path(__file__).with_name("export_taxi_zones.py")
    assert path.is_file(), "offline geometry exporter is not implemented"
    spec = importlib.util.spec_from_file_location("export_taxi_zones", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class GeometryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def inputs(self, records=None, *, crs=2263, extra=None, lookup=None):
        records = records or [
            (1, "Example A", "Manhattan", [OUTER, HOLE]),
            (2, "Example B", "Queens", [OUTER, SECOND]),
        ]
        shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
        with shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON) as writer:
            writer.field("OBJECTID", "N", 9)
            writer.field("LocationID", "N", 9)
            writer.field("zone", "C", 80)
            writer.field("borough", "C", 80)
            for identifier, zone, borough, rings in records:
                writer.poly(rings)
                writer.record(900 + identifier, identifier, zone, borough)
        zipped = self.root / "zones.zip"
        with zipfile.ZipFile(zipped, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for suffix, content in [
                ("shp", shp.getvalue()),
                ("shx", shx.getvalue()),
                ("dbf", dbf.getvalue()),
                ("prj", pyproj.CRS.from_epsg(crs).to_wkt().encode()),
                ("cpg", b"UTF-8"),
            ]:
                archive.writestr("taxi_zones/taxi_zones." + suffix, content)
            if extra:
                archive.writestr(*extra)
        reference = self.root / "lookup.csv"
        reference.write_text(
            lookup
            or "LocationID,Borough,Zone,service_zone\n"
            "1,Manhattan,Example A,Yellow Zone\n2,Queens,Example B,Boro Zone\n"
            "264,Unknown,NV,N/A\n265,N/A,Outside of NYC,N/A\n"
        )
        return zipped, reference

    def convert(self, **kwargs):
        module = exporter()
        zipped, lookup = self.inputs(**kwargs)
        return module.convert_assets(zipped, lookup, digest(zipped), digest(lookup))

    def test_holes_and_multipart_preserve_source_location_ids(self):
        collection, report = self.convert()
        self.assertEqual(collection["type"], "FeatureCollection")
        self.assertEqual([feature["id"] for feature in collection["features"]], [1, 2])
        one, two = collection["features"]
        self.assertEqual(
            one["properties"], {"location_id": 1, "zone": "Example A", "borough": "Manhattan"}
        )
        self.assertEqual(one["geometry"]["type"], "Polygon")
        self.assertEqual(len(one["geometry"]["coordinates"]), 2)
        self.assertEqual(two["geometry"]["type"], "MultiPolygon")
        self.assertEqual(len(two["geometry"]["coordinates"]), 2)
        self.assertEqual(report["vertices"], 20)
        self.assertEqual(report["holes"], 1)
        self.assertEqual(report["features"], 2)
        point = one["geometry"]["coordinates"][0][0]
        self.assertTrue(-74.3 < point[0] < -73.65)
        self.assertTrue(40.45 < point[1] < 40.95)
        self.assertEqual(
            one["geometry"]["coordinates"][0][0], one["geometry"]["coordinates"][0][-1]
        )

    def test_expected_crs_and_axis_order(self):
        module = exporter()
        transform = module.make_transformer(pyproj.CRS.from_epsg(2263).to_wkt())
        # State-plane central meridian x=984250 US survey feet is longitude -74.
        longitude, latitude = transform.transform(984250, 200000, errcheck=True)
        self.assertAlmostEqual(longitude, -74.0, places=8)
        self.assertTrue(40.6 < latitude < 40.8)
        with self.assertRaisesRegex(ValueError, "CRS|2263"):
            self.convert(crs=4326)

    def test_unexpected_bounds_rejected(self):
        with self.assertRaisesRegex(ValueError, "bounds"):
            self.convert(
                records=[(1, "Example A", "Manhattan", [[(0, 0), (0, 1), (1, 1), (1, 0), (0, 0)]])]
            )

    def test_duplicate_ids_are_not_deduplicated(self):
        with self.assertRaisesRegex(ValueError, "duplicate|unique"):
            self.convert(
                records=[
                    (1, "Example A", "Manhattan", [OUTER]),
                    (1, "Example A", "Manhattan", [SECOND]),
                ]
            )

    def test_lookup_identity_and_coverage_are_validated(self):
        for reference in (
            "LocationID,Borough,Zone,service_zone\n1,Queens,Example A,Boro Zone\n",
            "LocationID,Borough,Zone,service_zone\n1,Manhattan,Example A,Yellow Zone\n",
        ):
            with (
                self.subTest(reference=reference),
                self.assertRaisesRegex(ValueError, "lookup|join"),
            ):
                self.convert(lookup=reference)

    def test_lookup_duplicate_ids_fail(self):
        with self.assertRaisesRegex(ValueError, "lookup|duplicate"):
            self.convert(
                lookup="LocationID,Borough,Zone,service_zone\n"
                "1,Manhattan,Example A,Yellow Zone\n1,Manhattan,Example A,Yellow Zone\n"
            )

    def test_orphan_holes_are_rejected_instead_of_invented_polygons(self):
        outside = [(x + 8000, y) for x, y in HOLE]
        with self.assertRaisesRegex(ValueError, "hole|ring"):
            self.convert(records=[(1, "Example A", "Manhattan", [OUTER, outside])])

    def test_vertex_budget_is_enforced(self):
        module = exporter()
        zipped, lookup = self.inputs()
        with patch.object(module, "MAX_VERTICES", 9), self.assertRaisesRegex(ValueError, "vertex"):
            module.convert_assets(zipped, lookup, digest(zipped), digest(lookup))

    def test_tampered_input_fails_before_conversion(self):
        module = exporter()
        zipped, lookup = self.inputs()
        original = digest(zipped)
        zipped.write_bytes(zipped.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "checksum"):
            module.convert_assets(zipped, lookup, original, digest(lookup))

    def test_unsafe_or_unexpected_zip_members_fail_without_extraction(self):
        for filename in (
            "../escape",
            "/absolute",
            "taxi_zones/../escape",
            "taxi_zones\\escape",
            "unexpected.txt",
        ):
            with self.subTest(filename=filename), self.assertRaisesRegex(ValueError, "ZIP|member"):
                self.convert(extra=(filename, b"bad"))
        self.assertFalse((self.root.parent / "escape").exists())

    def test_zip_member_ceiling_is_enforced(self):
        module = exporter()
        zipped, lookup = self.inputs()
        with (
            patch.object(module, "MAX_MEMBER_BYTES", 100),
            self.assertRaisesRegex(ValueError, "ZIP|size"),
        ):
            module.convert_assets(zipped, lookup, digest(zipped), digest(lookup))

    @unittest.skipUnless(SNAPSHOT.exists(), "requires the frozen M1 source snapshot")
    def test_actual_frozen_export_is_deterministic_and_portable(self):
        module = exporter()
        first, second = self.root / "first", self.root / "second"
        module.export_snapshot(SNAPSHOT, ROOT / ".data", first)
        module.export_snapshot(SNAPSHOT, ROOT / ".data", second)
        for filename in ("taxi-zones.geojson", "taxi-zones.provenance.json"):
            self.assertEqual((first / filename).read_bytes(), (second / filename).read_bytes())
        data = json.loads((first / "taxi-zones.geojson").read_text())
        self.assertEqual(len(data["features"]), 263)
        self.assertEqual(len({feature["id"] for feature in data["features"]}), 263)
        provenance = json.loads((first / "taxi-zones.provenance.json").read_text())
        self.assertEqual(provenance["output"]["sha256"], digest(first / "taxi-zones.geojson"))
        self.assertNotIn("/Users/", json.dumps(provenance))
        self.assertEqual(provenance["projection"]["axis_order"], "longitude, latitude")


if __name__ == "__main__":
    unittest.main(verbosity=2)
