"""Small isolated archives exercise exporter validation without raw trip data."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from export_yellow_taxi_dashboard import export, main

HEADER = "dropoff_hour_local,DOLocationID,trip_count\n"


class ExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.run = Path(self.temp.name)
        (self.run / "taxi").mkdir()
        self.geo = self.run / "geography.json"
        self.geo.write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [{"properties": {"location_id": i}} for i in range(1, 264)],
                }
            )
        )
        self.manifest = {
            "status": "completed",
            "identity": {"month": "2026-09"},
            "run_id": "a" * 64,
            "outputs": {},
        }
        self.archive("2026-09-01 00:00:00,1,2\n2026-09-30 23:00:00,263,3\n")

    def file(self, name: str, data: bytes) -> None:
        (self.run / name).write_bytes(data)
        self.manifest["outputs"][name] = {
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        self.save_manifest()

    def save_manifest(self) -> None:
        (self.run / "manifest.json").write_text(json.dumps(self.manifest))

    def archive(self, rows: str, total: int = 5, row_count: int = 2) -> None:
        self.file("taxi/zone_hour.csv", (HEADER + rows).encode())
        self.file(
            "taxi/quality.json",
            json.dumps(
                {
                    "eligible_rows": total,
                    "aggregate_rows": row_count,
                    "timezone": "America/New_York",
                    "adjacent_pickup_month_files_included": False,
                }
            ).encode(),
        )

    def test_dense_deterministic_portable_output(self) -> None:
        first = export(self.run, self.geo)
        self.assertEqual(first, export(self.run, self.geo))
        self.assertNotIn(str(self.run).encode(), first)
        data = json.loads(first)
        self.assertEqual(data["totalDropoffs"], 5)
        self.assertEqual(len(data["zones"]), 263)
        self.assertTrue(all(len(values) == 720 for values in data["zones"].values()))
        self.assertEqual(data["zones"]["1"][0], 2)
        self.assertEqual(data["zones"]["263"][-1], 3)
        self.assertEqual(sum(data["zones"]["2"]), 0)
        self.assertEqual(sum(map(sum, data["zones"].values())), 5)

    def test_failed_replacement_preserves_existing_asset(self) -> None:
        output = self.run / "dashboard.json"
        output.write_bytes(b"existing")
        before = set(self.run.iterdir())
        argv = [
            "export",
            "--run-dir",
            str(self.run),
            "--geography",
            str(self.geo),
            "--output",
            str(output),
        ]
        with (
            patch("sys.argv", argv),
            patch("export_yellow_taxi_dashboard.os.replace", side_effect=OSError("test failure")),
            patch("sys.stderr"),
        ):
            with self.assertRaises(SystemExit) as raised:
                main()
        self.assertEqual(raised.exception.code, 1)
        self.assertEqual(output.read_bytes(), b"existing")
        self.assertEqual(set(self.run.iterdir()), before)

    def test_corruption_and_size_mismatches(self) -> None:
        for name in ("taxi/zone_hour.csv", "taxi/quality.json"):
            with self.subTest(name=name):
                path = self.run / name
                original = path.read_bytes()
                for broken in (original + b" ", b"!" + original[1:]):
                    path.write_bytes(broken)
                    with self.assertRaisesRegex(ValueError, "manifest"):
                        export(self.run, self.geo)
                path.write_bytes(original)

    def test_invalid_rows(self) -> None:
        for row in (
            "2026-09-01 00:00:00,264,5\n",
            "2026-09-01 00:00:00,1,-1\n",
            "2026-09-01 00:00:00,1,1.5\n",
            "2026-10-01 00:00:00,1,5\n",
            "2026-09-01 00:01:00,1,5\n",
            "2026-09-01 00:00:00,1,5,extra\n",
            "2026-09-01 00:00:00,1,2\n2026-09-01 00:00:00,1,3\n",
            "2026-09-01 00:00:00,1,9007199254740992\n",
        ):
            with self.subTest(row=row):
                self.archive(row)
                with self.assertRaises(ValueError):
                    export(self.run, self.geo)

    def test_reconciliation(self) -> None:
        for total, rows in ((6, 1), (5, 2)):
            self.archive("2026-09-01 00:00:00,1,5\n", total, rows)
            with self.assertRaisesRegex(ValueError, "reconcile"):
                export(self.run, self.geo)

    def test_run_contract(self) -> None:
        for key, value in (
            ("status", "running"),
            ("identity", {"month": "2026-10"}),
            ("run_id", "/private/path"),
        ):
            original = self.manifest[key]
            self.manifest[key] = value
            self.save_manifest()
            with self.assertRaises(ValueError):
                export(self.run, self.geo)
            self.manifest[key] = original

    def test_missing_file_and_unknown_geography(self) -> None:
        self.geo.write_text('{"type":"FeatureCollection","features":[]}')
        with self.assertRaisesRegex(ValueError, "Geography"):
            export(self.run, self.geo)
        (self.run / "taxi/zone_hour.csv").unlink()
        with self.assertRaises(FileNotFoundError):
            export(self.run, self.geo)


if __name__ == "__main__":
    unittest.main()
