"""Exercise append-only month publication against the real catalog validator."""

import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backfill import publish_month, publish_months, run_batch
from export_mobility_months import catalog


def month_assets(month: str, hours: int, *, run_id: str) -> dict[str, bytes]:
    identity = {
        "version": 1,
        "month": month,
        "timezone": "America/New_York",
        "runId": run_id * 64,
    }
    zones = {str(zone): [0] * hours for zone in range(1, 264)}
    zones["1"][0] = 5
    taxi = {
        **identity,
        "sourceSha256": "a" * 64,
        "totalDropoffs": 5,
        "zones": zones,
    }
    subway = {
        **identity,
        "sourceSha256": "b" * 64,
        "stations": [
            {
                "id": 1,
                "name": "Test Station",
                "borough": "Queens",
                "latitude": 40.7,
                "longitude": -73.9,
                "counts": [None, 2.5] + [0] * (hours - 2),
            }
        ],
    }
    return {"taxi": json.dumps(taxi).encode(), "subway": json.dumps(subway).encode()}


class PublishMonthTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.destination = Path(temporary.name).resolve()
        self.catalog_path = self.destination / "mobility-months.json"
        self.august = month_assets("2026-08", 744, run_id="c")
        self.september = month_assets("2026-09", 720, run_id="d")
        (self.destination / "yellow-taxi-2026-08.json").write_bytes(self.august["taxi"])
        self.catalog_path.write_bytes(catalog(self.destination))

    def published_files(self) -> dict[str, bytes]:
        return {path.name: path.read_bytes() for path in self.destination.glob("*.json")}

    def test_historical_subway_complements_published_taxi_and_survives_later_append(self) -> None:
        month = "2024-12"
        taxi = month_assets(month, 744, run_id="a")["taxi"]
        subway = month_assets(month, 744, run_id="b")["subway"]
        publish_month(self.destination, month, {"taxi": taxi})
        updates = {month: {"subway": subway}}
        before = self.published_files()
        with self.assertRaisesRegex(ValueError, "binding"):
            publish_months(
                self.destination, updates, independent_runs={month: ("c" * 64, "b" * 64)}
            )
        self.assertEqual(self.published_files(), before)

        pairs = {month: ("a" * 64, "b" * 64)}
        publish_months(self.destination, updates, independent_runs=pairs)
        after = self.published_files()
        publish_months(self.destination, updates, independent_runs=pairs)
        self.assertEqual(self.published_files(), after)
        publish_month(self.destination, "2026-09", self.september)
        self.assertEqual((self.destination / f"yellow-taxi-{month}.json").read_bytes(), taxi)
        self.assertEqual(self.catalog_path.read_bytes(), catalog(self.destination))

    def test_incompatible_new_assets_leave_existing_publication_intact(self) -> None:
        subway = json.loads(self.september["subway"])
        subway["runId"] = "e" * 64
        before = self.published_files()

        with self.assertRaisesRegex(ValueError, "share a completed run"):
            publish_month(
                self.destination,
                "2026-09",
                {**self.september, "subway": json.dumps(subway).encode()},
            )

        self.assertEqual(self.published_files(), before)

    def test_invalid_registered_asset_blocks_a_new_month_before_writes(self) -> None:
        target = self.destination / "subway-2026-08.json"
        target.write_bytes(self.august["subway"])
        self.catalog_path.write_bytes(catalog(self.destination))
        subway = json.loads(self.august["subway"])
        subway["stations"][0]["counts"].pop()
        target.write_bytes(json.dumps(subway).encode())
        before = self.published_files()

        with self.assertRaisesRegex(ValueError, "Invalid hour count"):
            publish_month(self.destination, "2026-09", self.september)

        self.assertEqual(self.published_files(), before)

    def test_conflicting_fixed_filename_is_never_replaced(self) -> None:
        conflicting = json.loads(self.september["subway"])
        conflicting["stations"][0]["counts"][0] = 7
        (self.destination / "subway-2026-09.json").write_bytes(json.dumps(conflicting).encode())
        before = self.published_files()

        with self.assertRaisesRegex(ValueError, "different monthly asset"):
            publish_month(self.destination, "2026-09", self.september)

        self.assertEqual(self.published_files(), before)

    def test_retry_finishes_publication_after_assets_landed_before_catalog(self) -> None:
        taxi = self.destination / "yellow-taxi-2026-09.json"
        subway = self.destination / "subway-2026-09.json"
        last_catalog = self.catalog_path.read_bytes()

        with (
            patch("backfill.atomic_write", side_effect=OSError("simulated catalog write failure")),
            self.assertRaisesRegex(OSError, "simulated catalog write failure"),
        ):
            publish_month(self.destination, "2026-09", self.september)

        self.assertEqual(self.catalog_path.read_bytes(), last_catalog)
        self.assertEqual(taxi.read_bytes(), self.september["taxi"])
        self.assertEqual(subway.read_bytes(), self.september["subway"])
        asset_inodes = (taxi.stat().st_ino, subway.stat().st_ino)

        publish_month(self.destination, "2026-09", self.september)

        self.assertEqual(
            json.loads(self.catalog_path.read_bytes()),
            {
                "version": 1,
                "months": [
                    {"month": "2026-09", "taxi": True, "subway": True},
                    {"month": "2026-08", "taxi": True, "subway": False},
                ],
            },
        )
        self.assertEqual(taxi.read_bytes(), self.september["taxi"])
        self.assertEqual(subway.read_bytes(), self.september["subway"])
        self.assertEqual((taxi.stat().st_ino, subway.stat().st_ino), asset_inodes)
        after_retry = self.published_files()
        publish_month(self.destination, "2026-09", self.september)
        self.assertEqual(self.published_files(), after_retry)
        self.assertEqual((taxi.stat().st_ino, subway.stat().st_ino), asset_inodes)

    def test_unregistered_assets_stay_unlisted_when_publishing_another_month(self) -> None:
        orphan = self.destination / "subway-2026-08.json"
        orphan.write_bytes(self.august["subway"])

        publish_month(self.destination, "2026-09", self.september)

        months = json.loads(self.catalog_path.read_bytes())["months"]
        self.assertEqual(
            months,
            [
                {"month": "2026-09", "taxi": True, "subway": True},
                {"month": "2026-08", "taxi": True, "subway": False},
            ],
        )
        self.assertEqual(orphan.read_bytes(), self.august["subway"])

    def test_batch_continues_after_a_csv_error(self) -> None:
        inventory = {
            "months": [
                {"month": "2026-10", "taxi": True, "subway": False},
                {"month": "2026-09", "taxi": True, "subway": True},
            ]
        }
        archive = self.destination / "archive"
        september_run = archive / ("d" * 64)
        with (
            patch("backfill.resolved_run", side_effect=[csv.Error("malformed CSV"), september_run]),
            patch("backfill.export_taxi", return_value=self.september["taxi"]),
            patch("backfill.export_subway", return_value=self.september["subway"]),
            patch("sys.stderr", new_callable=io.StringIO),
        ):
            results = run_batch(
                inventory, archive, self.destination, limit=2, since=None, through=None
            )

        self.assertEqual(
            results,
            [
                {"month": "2026-10", "status": "failed", "reason": "malformed CSV"},
                {"month": "2026-09", "status": "published", "run": "d" * 64},
            ],
        )
        self.assertFalse((self.destination / "yellow-taxi-2026-10.json").exists())
        self.assertEqual(
            (self.destination / "yellow-taxi-2026-09.json").read_bytes(), self.september["taxi"]
        )
        self.assertEqual(
            (self.destination / "subway-2026-09.json").read_bytes(), self.september["subway"]
        )
        self.assertEqual(
            json.loads(self.catalog_path.read_bytes())["months"],
            [
                {"month": "2026-09", "taxi": True, "subway": True},
                {"month": "2026-08", "taxi": True, "subway": False},
            ],
        )

    def test_batch_skips_capture_for_an_already_published_month(self) -> None:
        inventory = {"months": [{"month": "2026-08", "taxi": True, "subway": False}]}
        before = self.published_files()

        with patch("backfill.resolved_run", side_effect=AssertionError("unexpected capture")):
            results = run_batch(
                inventory, self.destination, self.destination, limit=1, since=None, through=None
            )

        self.assertEqual(results, [])
        self.assertEqual(self.published_files(), before)


if __name__ == "__main__":
    unittest.main()
