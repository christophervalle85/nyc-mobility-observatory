"""Month calendars and catalogs reflect only validated available mode assets."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from export_mobility_months import catalog, main
from export_yellow_taxi_dashboard import month_calendar


class CatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def asset(self, month: str, mode: str) -> Path:
        _, _, hours = month_calendar(month)
        data = {
            "version": 1,
            "month": month,
            "timezone": "America/New_York",
            "runId": "a" * 64,
            "sourceSha256": "b" * 64,
        }
        if mode == "yellow-taxi":
            data.update(zones={str(i): [0] * hours for i in range(1, 264)}, totalDropoffs=0)
        else:
            data["stations"] = [
                {
                    "id": 1,
                    "name": "Station",
                    "borough": "Queens",
                    "latitude": 40.7,
                    "longitude": -73.9,
                    "counts": [None, 2.5] + [0] * (hours - 2),
                }
            ]
        path = self.directory / f"{mode}-{month}.json"
        path.write_text(json.dumps(data))
        return path

    def test_calendar_lengths_and_dst_rejection(self) -> None:
        for month, hours in (("2026-08", 744), ("2026-09", 720), ("2024-02", 696)):
            self.assertEqual(month_calendar(month)[2], hours)
        for month in ("2026-03", "2026-11"):
            with self.assertRaisesRegex(ValueError, "DST"):
                month_calendar(month)
        for month in ("2026-13", "2026-1", "../2026-09", None):
            with self.assertRaises(ValueError):
                month_calendar(month)

    def test_independent_modes_order_and_determinism(self) -> None:
        self.asset("2026-08", "yellow-taxi")
        self.asset("2026-09", "subway")
        first = catalog(self.directory)
        self.assertEqual(first, catalog(self.directory))
        self.assertEqual(
            json.loads(first),
            {
                "version": 1,
                "months": [
                    {"month": "2026-09", "taxi": False, "subway": True},
                    {"month": "2026-08", "taxi": True, "subway": False},
                ],
            },
        )
        self.asset("2026-09", "yellow-taxi")
        self.assertTrue(json.loads(catalog(self.directory))["months"][0]["taxi"])

    def test_empty_directory_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "No validated"):
            catalog(self.directory)

    def test_coordinates_and_same_month_run_identity(self) -> None:
        path = self.asset("2026-08", "subway")
        data = json.loads(path.read_text())
        data["stations"][0]["latitude"] = 91
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "latitude"):
            catalog(self.directory)
        data["stations"][0]["latitude"] = 40.7
        data["runId"] = "c" * 64
        path.write_text(json.dumps(data))
        self.asset("2026-08", "yellow-taxi")
        with self.assertRaisesRegex(ValueError, "share a completed run"):
            catalog(self.directory)

    def test_bad_assets_do_not_replace_catalog(self) -> None:
        path = self.asset("2026-08", "subway")
        asset = json.loads(path.read_text())
        asset["stations"][0]["counts"].pop()
        path.write_text(json.dumps(asset))
        target = self.directory / "mobility-months.json"
        target.write_bytes(b"old catalog")
        with (
            patch("sys.argv", ["catalog", "--data-dir", str(self.directory)]),
            patch("sys.stderr"),
            self.assertRaises(SystemExit),
        ):
            main()
        self.assertEqual(target.read_bytes(), b"old catalog")

    def test_month_mismatch_and_invalid_values(self) -> None:
        path = self.asset("2026-08", "subway")
        original = json.loads(path.read_text())
        for value in (-1, float("nan"), True):
            data = json.loads(json.dumps(original))
            data["stations"][0]["counts"][0] = value
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                catalog(self.directory)
        original["month"] = "2026-09"
        path.write_text(json.dumps(original))
        with self.assertRaises(ValueError):
            catalog(self.directory)


if __name__ == "__main__":
    unittest.main()
