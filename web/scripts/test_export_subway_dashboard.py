"""Isolated archive tests for missing and comparison-ineligible subway observations."""

import csv
import hashlib
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from export_subway_dashboard import HEADER, export, main


class SubwayExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.run = Path(self.temp.name)
        (self.run / "subway").mkdir()
        self.rows = []
        for hour in range(720):
            stamp = datetime(2026, 9, 1) + timedelta(hours=hour)
            self.rows.append(
                [
                    stamp.strftime("%Y-%m-%d %H:%M:%S"),
                    "1",
                    "Station",
                    "Queens",
                    "40.7",
                    "-73.9",
                    "0",
                    "true",
                    "true",
                    "true",
                    "",
                ]
            )
        self.rows[0][6] = "2.5"
        self.rows[1][6:] = ["", "false", "false", "false", "missing_observation"]
        self.rows[2][6:] = ["12.5", "true", "false", "false", "negative_transfer"]
        self.quality = {
            "month": "2026-09",
            "timezone": "America/New_York",
            "station_universe_ids": [1],
            "station_universe_count": 1,
            "station_hour_denominator": 720,
            "observed_station_hours": 719,
            "eligible_station_hours": 718,
            "missing_station_hours": 1,
        }
        self.write_archive()

    def write_archive(self) -> None:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(HEADER)
        writer.writerows(self.rows)
        files = {
            "subway/station_hour.csv": buffer.getvalue().encode(),
            "subway/quality.json": json.dumps(self.quality).encode(),
        }
        outputs = {}
        for name, data in files.items():
            (self.run / name).write_bytes(data)
            outputs[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        (self.run / "manifest.json").write_text(
            json.dumps(
                {
                    "status": "completed",
                    "identity": {"month": "2026-09"},
                    "run_id": "a" * 64,
                    "outputs": outputs,
                }
            )
        )

    def test_determinism_fractional_counts_and_nulls(self) -> None:
        result = export(self.run)
        self.assertEqual(result, export(self.run))
        self.assertNotIn(str(self.run).encode(), result)
        counts = json.loads(result)["stations"][0]["counts"]
        self.assertEqual(len(counts), 720)
        self.assertEqual(counts[:4], [2.5, None, None, 0])
        self.assertEqual(sum(value is not None for value in counts), 718)

    def test_optional_month_edge_check_rejects_an_unobserved_last_day(self) -> None:
        self.assertEqual(export(self.run, require_month_edges=True), export(self.run))
        for row in self.rows[-24:]:
            row[6:] = ["", "false", "false", "false", "missing_observation"]
        self.quality["observed_station_hours"] -= 24
        self.quality["eligible_station_hours"] -= 24
        self.quality["missing_station_hours"] += 24
        self.write_archive()
        self.assertEqual(json.loads(export(self.run))["stations"][0]["counts"][-24:], [None] * 24)
        with self.assertRaisesRegex(ValueError, "month edges"):
            export(self.run, require_month_edges=True)

    def test_completed_month_and_portable_run_identity(self) -> None:
        path = self.run / "manifest.json"
        original = json.loads(path.read_text())
        for field, value in (
            ("status", "running"),
            ("identity", {"month": "2026-10"}),
            ("run_id", "/private/run"),
        ):
            manifest = dict(original)
            manifest[field] = value
            path.write_text(json.dumps(manifest))
            with self.subTest(field=field), self.assertRaises(ValueError):
                export(self.run)

    def test_august_has_744_hours(self) -> None:
        for hour, row in enumerate(self.rows):
            row[0] = (datetime(2026, 8, 1) + timedelta(hours=hour)).strftime("%Y-%m-%d %H:%M:%S")
        for hour in range(720, 744):
            row = self.rows[3].copy()
            row[0] = (datetime(2026, 8, 1) + timedelta(hours=hour)).strftime("%Y-%m-%d %H:%M:%S")
            self.rows.append(row)
        self.quality.update(
            month="2026-08",
            station_hour_denominator=744,
            observed_station_hours=743,
            eligible_station_hours=742,
        )
        self.write_archive()
        path = self.run / "manifest.json"
        manifest = json.loads(path.read_text())
        manifest["identity"]["month"] = "2026-08"
        path.write_text(json.dumps(manifest))
        data = json.loads(export(self.run))
        self.assertEqual(data["month"], "2026-08")
        self.assertEqual(len(data["stations"][0]["counts"]), 744)
        self.assertEqual(data["stations"][0]["counts"][:4], [2.5, None, None, 0])

    def transition_archive(self, month: str, day: int, nonexistent: bool) -> None:
        from export_yellow_taxi_dashboard import month_calendar

        _, start, hours = month_calendar(month, allow_transition=True)
        self.rows = []
        for hour in range(hours):
            stamp = start + timedelta(hours=hour)
            if nonexistent and stamp.day == day and stamp.hour == 2:
                continue
            transition = stamp.day == day
            self.rows.append(
                [
                    stamp.strftime("%Y-%m-%d %H:%M:%S"),
                    "1",
                    "Station",
                    "Queens",
                    "40.7",
                    "-73.9",
                    "2.5",
                    "true",
                    "false" if transition else "true",
                    "false" if transition else "true",
                    "dst_transition_date" if transition else "",
                ]
            )
        valid = hours - int(nonexistent)
        self.quality.update(
            month=month,
            station_hour_denominator=valid,
            observed_station_hours=valid,
            eligible_station_hours=hours - 24,
            missing_station_hours=0,
        )
        self.write_archive()
        path = self.run / "manifest.json"
        manifest = json.loads(path.read_text())
        manifest["identity"]["month"] = month
        path.write_text(json.dumps(manifest))

    def test_transition_recorded_counts_and_eligible_mask(self) -> None:
        for month, day, spring in (("2024-03", 10, True), ("2024-11", 3, False)):
            self.transition_archive(month, day, spring)
            result = json.loads(export(self.run))
            self.assertEqual(result["version"], 2)
            station = result["stations"][0]
            self.assertEqual(station["counts"][(day - 1) * 24 : day * 24], [None] * 24)
            recorded = station["recordedCounts"]
            self.assertEqual(len(recorded), 24)
            self.assertEqual(recorded[2], None if spring else 2.5)
            self.assertEqual(sum(v or 0 for v in recorded), (23 if spring else 24) * 2.5)
            self.assertEqual(
                sum(v is not None for v in station["counts"]), len(station["counts"]) - 24
            )

    def test_transition_cannot_be_comparison_eligible(self) -> None:
        self.transition_archive("2024-11", 3, False)
        self.rows[48][8:11] = ["true", "true", ""]
        self.write_archive()
        path = self.run / "manifest.json"
        manifest = json.loads(path.read_text())
        manifest["identity"]["month"] = "2024-11"
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "comparison-ineligible"):
            export(self.run)

    def test_hash_and_byte_mismatch(self) -> None:
        for name in ("subway/station_hour.csv", "subway/quality.json"):
            path = self.run / name
            original = path.read_bytes()
            for data in (original + b" ", b"!" + original[1:]):
                path.write_bytes(data)
                with self.assertRaisesRegex(ValueError, "manifest"):
                    export(self.run)
            path.write_bytes(original)

    def test_invalid_rows(self) -> None:
        for column, value in (
            (6, "NaN"),
            (6, "Infinity"),
            (6, "-1"),
            (1, "999"),
            (2, "Changed"),
            (9, "yes"),
            (7, "false"),
            (0, "2026-10-01 00:00:00"),
            (0, "2026-09-01 00:01:00"),
        ):
            original = self.rows[3][column]
            self.rows[3][column] = value
            self.write_archive()
            with self.subTest(column=column, value=value), self.assertRaises(ValueError):
                export(self.run)
            self.rows[3][column] = original

    def test_duplicate_and_missing_rows(self) -> None:
        self.rows.append(self.rows[0])
        self.write_archive()
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            export(self.run)
        self.rows = self.rows[:-2]
        self.write_archive()
        with self.assertRaisesRegex(ValueError, "every station/hour"):
            export(self.run)

    def test_quality_reconciliation(self) -> None:
        for field in (
            "observed_station_hours",
            "eligible_station_hours",
            "missing_station_hours",
            "station_hour_denominator",
            "station_universe_count",
        ):
            self.quality[field] += 1
            self.write_archive()
            with self.subTest(field=field), self.assertRaises(ValueError):
                export(self.run)
            self.quality[field] -= 1

    def test_atomic_failure_preserves_asset(self) -> None:
        output = self.run / "output.json"
        output.write_bytes(b"old")
        before = set(self.run.iterdir())
        with (
            patch("sys.argv", ["export", "--run-dir", str(self.run), "--output", str(output)]),
            patch("export_subway_dashboard.os.replace", side_effect=OSError("test failure")),
            patch("sys.stderr"),
            self.assertRaises(SystemExit),
        ):
            main()
        self.assertEqual(output.read_bytes(), b"old")
        self.assertEqual(set(self.run.iterdir()), before)


if __name__ == "__main__":
    unittest.main()
