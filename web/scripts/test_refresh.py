"""Exercise staging-only refresh with synthetic sources and the real catalog."""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from hashlib import sha256
from pathlib import Path
from unittest.mock import MagicMock, patch

import refresh
from export_subway_dashboard import export as export_subway
from refresh_subway import run_subway
from test_backfill import month_assets

from nyc_mobility.acquisition import store_bytes

CATALOG = "mobility-months.json"
REPORT = "refresh-result.json"
TAXI = "yellow-taxi-2026-09.json"
SUBWAY = "subway-2026-09.json"
SUBWAY_SOURCE = "mta-5wq4-mkjj"


def candidate(month: str, *, taxi: bool, subway: bool) -> dict:
    entry = {
        "month": month,
        "taxi": taxi,
        "subway": subway,
        "subway_dataset": "5wq4-mkjj" if subway else None,
    }
    if subway:
        entry["subway_coverage"] = "monthly-observed-edges"
    return entry


def inventory(*months: dict, rejected: list[dict] | None = None, taxi_error: str = "") -> dict:
    return {
        "version": 1,
        "discovered_at": "2026-11-16T00:00:00Z",
        "months": list(months),
        "sources": [
            {
                "source": "tlc",
                "status": "error" if taxi_error else "ok",
                "asset": None,
                "error": taxi_error or None,
                "coverage": "published-file",
                "span_assets": [],
                "fallback_reason": None,
            },
            {
                "source": SUBWAY_SOURCE,
                "status": "ok",
                "asset": None,
                "error": None,
                "coverage": "monthly-observed-edges",
                "span_assets": [],
                "fallback_reason": None,
            },
        ],
        "rejected": rejected or [],
    }


def saved_files(directory: Path) -> dict[str, bytes]:
    return {
        file.relative_to(directory).as_posix(): file.read_bytes()
        for file in directory.rglob("*")
        if file.is_file()
    }


class RefreshTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.archive = self.root / "archive"
        self.published = self.root / "published"
        self.stage = self.root / "stage"
        self.published.mkdir()
        august = month_assets("2026-08", 744, run_id="a")
        (self.published / "yellow-taxi-2026-08.json").write_bytes(august["taxi"])
        (self.published / "subway-2026-08.json").write_bytes(august["subway"])
        (self.published / CATALOG).write_text(
            '{"version":1,"months":[{"month":"2026-08","taxi":true,"subway":true}]}\n'
        )
        self.baseline = saved_files(self.published)
        self.taxi = month_assets("2026-09", 720, run_id="b")["taxi"]
        self.subway = month_assets("2026-09", 720, run_id="c")["subway"]
        self.discover = self.block_provider("discover")
        self.taxi_capture = self.block_provider("resolved_run")
        self.subway_capture = self.block_provider("run_subway")
        self.taxi_export = self.block_provider("export_taxi")
        self.subway_export = self.block_provider("export_subway")
        self.addCleanup(self.assert_baseline_untouched)

    def assert_baseline_untouched(self) -> None:
        self.assertEqual(saved_files(self.published), self.baseline)

    def block_provider(self, name: str) -> MagicMock:
        return self.enterContext(
            patch(f"refresh.{name}", side_effect=AssertionError(f"Unexpected call to {name}"))
        )

    def permit_taxi(self) -> None:
        self.taxi_capture.side_effect = None
        self.taxi_capture.return_value = self.archive / "runs" / ("b" * 64)
        self.taxi_export.side_effect = None
        self.taxi_export.return_value = self.taxi

    def permit_subway(self) -> None:
        self.subway_capture.side_effect = None
        self.subway_capture.return_value = self.archive / "subway-runs" / ("c" * 64)
        self.subway_export.side_effect = None
        self.subway_export.return_value = self.subway

    def set_inventory(self, evidence: dict) -> None:
        self.discover.side_effect = None
        self.discover.return_value = evidence

    def run_cli(self, stage: Path) -> tuple[int, dict]:
        stdout = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(io.StringIO()):
            status = refresh.main(
                [
                    "--stage-dir",
                    str(stage),
                    "--data-dir",
                    str(self.archive),
                    "--published-dir",
                    str(self.published),
                ]
            )
        return status, json.loads(stdout.getvalue())

    def test_refuses_unsafe_stage_paths_before_creating_archive(self) -> None:
        archive_alias = self.root / "archive-alias"
        archive_alias.symlink_to(self.archive, target_is_directory=True)
        stage_alias = self.root / "stage-alias"
        stage_alias.symlink_to(self.stage, target_is_directory=True)
        existing_stage = self.root / "existing-stage"
        existing_stage.mkdir()
        for path in (
            self.published,
            self.published / "preview",
            self.root,
            self.archive / "preview",
            self.root / "ARCHIVE" / "preview",
            archive_alias / "preview",
            existing_stage,
            stage_alias,
        ):
            with self.subTest(path=path), self.assertRaises((OSError, ValueError)):
                refresh.refresh(path, self.archive, self.published)
        self.assertFalse(self.archive.exists())
        self.assertFalse(self.stage.exists())
        self.assertFalse((self.published / "preview").exists())
        self.assertEqual(list(existing_stage.iterdir()), [])
        self.discover.assert_not_called()

    def test_refuses_canonically_equivalent_future_paths(self) -> None:
        stage = self.root / "Caf\N{LATIN SMALL LETTER E WITH ACUTE}"
        archive = self.root / "Cafe\N{COMBINING ACUTE ACCENT}" / "archive"
        with self.assertRaises(ValueError):
            refresh.refresh(stage, archive, self.published)
        self.discover.assert_not_called()

    def test_refuses_archive_inside_read_only_baseline(self) -> None:
        archive = self.published / "archive"
        with self.assertRaises((OSError, ValueError)):
            refresh.refresh(self.stage, archive, self.published)
        self.assertFalse(archive.exists())
        self.assertFalse(self.stage.exists())
        self.discover.assert_not_called()

    def test_alternate_baseline_does_not_make_dashboard_data_writable(self) -> None:
        web = self.root / "web"
        dashboard = web / "public/data"
        dashboard.mkdir(parents=True)
        (dashboard / "existing.json").write_bytes(b"dashboard data")
        with patch("refresh.WEB", web):
            for stage, archive in (
                (dashboard / "preview", self.archive),
                (self.stage, dashboard / "archive"),
                (self.stage, web / "public"),
            ):
                with self.subTest(stage=stage, archive=archive), self.assertRaises(ValueError):
                    refresh.refresh(stage, archive, self.published)
        self.assertEqual(saved_files(dashboard), {"existing.json": b"dashboard data"})
        self.assertFalse(self.archive.exists())
        self.assertFalse(self.stage.exists())
        self.discover.assert_not_called()

    def test_refuses_writes_through_case_alias_of_dashboard(self) -> None:
        web = self.root / "web"
        dashboard = web / "public/data"
        dashboard.mkdir(parents=True)
        alias = web / "public/DATA"
        if not alias.is_dir() or not alias.samefile(dashboard):
            self.skipTest("Filesystem distinguishes case")
        with patch("refresh.WEB", web):
            for stage, archive in (
                (alias / "preview", self.archive),
                (self.stage, alias / "archive"),
            ):
                with self.subTest(stage=stage, archive=archive), self.assertRaises(ValueError):
                    refresh.refresh(stage, archive, self.published)
        self.assertEqual(list(dashboard.iterdir()), [])
        self.discover.assert_not_called()

    def test_stages_only_earliest_eligible_month_and_reports_source_lag(self) -> None:
        evidence = inventory(
            candidate("2026-10", taxi=True, subway=True),
            candidate("2026-09", taxi=True, subway=False),
            rejected=[
                {
                    "month": "2026-09",
                    "source": SUBWAY_SOURCE,
                    "reason": "partial observed month edges",
                }
            ],
        )
        self.set_inventory(evidence)
        self.permit_taxi()
        (self.published / "unregistered.json").write_bytes(b"orphan")
        self.baseline["unregistered.json"] = b"orphan"

        status, result = self.run_cli(self.stage)

        self.assertEqual(status, 0)
        self.assertEqual(result["month"], "2026-09")
        self.assertEqual(result["watermarks"], {"taxi": "2026-08", "subway": "2026-08"})
        self.assertEqual(result["modes"]["taxi"]["status"], "staged")
        self.assertEqual(result["modes"]["taxi"]["runId"], "b" * 64)
        self.assertEqual(result["modes"]["taxi"]["sourceSha256"], "a" * 64)
        self.assertEqual(result["modes"]["taxi"]["assetSha256"], sha256(self.taxi).hexdigest())
        self.assertEqual(result["modes"]["subway"]["status"], "partial")
        self.assertTrue(result["changesStaged"])
        self.assertEqual(result["sources"], evidence["sources"])
        self.assertEqual((self.stage / TAXI).read_bytes(), self.taxi)
        self.assertEqual(json.loads((self.stage / REPORT).read_bytes()), result)
        self.assertEqual(
            json.loads((self.stage / CATALOG).read_bytes())["months"],
            [
                {"month": "2026-09", "taxi": True, "subway": False},
                {"month": "2026-08", "taxi": True, "subway": True},
            ],
        )
        self.assertEqual(
            set(saved_files(self.stage)),
            {CATALOG, REPORT, TAXI, "yellow-taxi-2026-08.json", "subway-2026-08.json"},
        )
        self.assertEqual(
            (self.stage / "yellow-taxi-2026-08.json").read_bytes(),
            self.baseline["yellow-taxi-2026-08.json"],
        )
        # A locally edited preview must not change the published bytes.
        (self.stage / "yellow-taxi-2026-08.json").write_bytes(b"preview edit")

    def test_failed_subway_capture_preserves_valid_taxi_and_allows_later_counterpart(self) -> None:
        self.set_inventory(inventory(candidate("2026-09", taxi=True, subway=True)))
        self.permit_taxi()
        self.subway_capture.side_effect = ValueError("invalid archived subway coverage")
        status, result = self.run_cli(self.stage)

        self.assertEqual(status, 1)
        self.assertEqual(result["modes"]["taxi"]["status"], "staged")
        self.assertEqual(result["modes"]["subway"]["status"], "failed")
        self.assertIn("coverage", result["modes"]["subway"]["reason"])
        self.assertEqual((self.stage / TAXI).read_bytes(), self.taxi)
        self.assertFalse((self.stage / SUBWAY).exists())
        before = saved_files(self.stage)

        self.taxi_capture.side_effect = AssertionError("Taxi was already staged")
        self.permit_subway()
        counterpart_stage = self.root / "with-subway"
        result = refresh.refresh(counterpart_stage, self.archive, self.stage)

        self.assertEqual(result["month"], "2026-09")
        self.assertEqual(result["watermarks"], {"taxi": "2026-09", "subway": "2026-08"})
        self.assertEqual(result["modes"]["taxi"]["status"], "already-published")
        self.assertEqual(result["modes"]["subway"]["status"], "staged")
        self.assertEqual(saved_files(self.stage), before)
        self.assertEqual((counterpart_stage / TAXI).read_bytes(), self.taxi)
        self.assertEqual((counterpart_stage / SUBWAY).read_bytes(), self.subway)
        self.assertEqual(
            json.loads((counterpart_stage / CATALOG).read_bytes())["months"][0],
            {
                "month": "2026-09",
                "taxi": True,
                "subway": True,
                "taxiRunId": "b" * 64,
                "subwayRunId": "c" * 64,
            },
        )

    def test_invalid_new_asset_does_not_enter_catalog(self) -> None:
        self.set_inventory(inventory(candidate("2026-09", taxi=True, subway=True)))
        self.permit_taxi()
        self.permit_subway()
        invalid_taxi = json.loads(self.taxi)
        invalid_taxi["zones"]["1"].pop()
        self.taxi_export.return_value = json.dumps(invalid_taxi).encode()

        result = refresh.refresh(self.stage, self.archive, self.published)

        self.assertEqual(result["modes"]["taxi"]["status"], "failed")
        self.assertEqual(result["modes"]["subway"]["status"], "staged")
        self.assertFalse((self.stage / TAXI).exists())
        self.assertEqual((self.stage / SUBWAY).read_bytes(), self.subway)
        self.assertEqual(
            json.loads((self.stage / CATALOG).read_bytes())["months"][0],
            {"month": "2026-09", "taxi": False, "subway": True},
        )

    def test_noop_and_discovery_error_have_different_outcomes(self) -> None:
        old_month = candidate("2026-07", taxi=True, subway=True)
        self.set_inventory(inventory(old_month))

        status, noop = self.run_cli(self.stage)
        self.assertEqual(status, 0)
        self.assertIsNone(noop["month"])
        self.assertIsNone(noop["stageDir"])
        self.assertFalse(noop["changesStaged"])
        self.assertFalse(self.stage.exists())
        self.assertEqual(noop["modes"]["taxi"]["status"], "up-to-date")
        self.assertEqual(noop["modes"]["subway"]["status"], "up-to-date")

        self.set_inventory(inventory(old_month, taxi_error="TLC index timed out"))
        failed_stage = self.root / "failed-discovery"
        status, result = self.run_cli(failed_stage)
        self.assertEqual(status, 1)
        self.assertIsNone(result["month"])
        self.assertIsNone(result["stageDir"])
        self.assertFalse(failed_stage.exists())
        self.assertEqual(result["modes"]["taxi"]["status"], "discovery-failed")
        self.assertEqual(result["modes"]["subway"]["status"], "up-to-date")
        self.assertEqual(result["sources"][0]["error"], "TLC index timed out")

    def test_attempted_subway_asset_missing_calendar_edge_fails_refresh(self) -> None:
        self.set_inventory(inventory(candidate("2026-09", taxi=False, subway=True)))
        self.permit_subway()
        self.subway_export.side_effect = ValueError("No observations on one or both month edges")

        status, result = self.run_cli(self.stage)

        self.assertEqual(status, 1)
        self.assertEqual(result["modes"]["taxi"]["status"], "unavailable")
        self.assertEqual(result["modes"]["subway"]["status"], "failed")
        self.assertIn("month edges", result["modes"]["subway"]["reason"])
        self.assertFalse(result["changesStaged"])
        self.assertFalse((self.stage / SUBWAY).exists())
        self.assertEqual((self.stage / CATALOG).read_bytes(), self.baseline[CATALOG])

    def test_discovery_failure_keeps_other_provider_eligible(self) -> None:
        self.set_inventory(
            inventory(
                candidate("2026-09", taxi=False, subway=True),
                taxi_error="TLC index timed out",
            )
        )
        self.permit_subway()

        result = refresh.refresh(self.stage, self.archive, self.published)

        self.assertEqual(result["month"], "2026-09")
        self.assertEqual(result["modes"]["taxi"]["status"], "discovery-failed")
        self.assertEqual(result["modes"]["subway"]["status"], "staged")
        self.assertEqual((self.stage / SUBWAY).read_bytes(), self.subway)
        self.assertFalse((self.stage / TAXI).exists())


class SubwayCaptureReplayTests(unittest.TestCase):
    def test_recaptures_rejected_month_then_reuses_verified_capture(self) -> None:
        raw = (
            b"transit_timestamp,transit_mode,station_complex_id,station_complex,borough,"
            b"payment_method,fare_class_category,ridership,transfers,latitude,longitude\n"
            b"2026-09-01T00:00:00.000,subway,100,Example Station,Manhattan,omny,"
            b"full_fare,10,0,40.75,-73.99\n"
            b"2026-09-30T23:00:00.000,subway,100,Example Station,Manhattan,omny,"
            b"full_fare,4,0,40.75,-73.99\n"
        )
        metadata = b'{"id":"5wq4-mkjj","rowsUpdatedAt":1}'
        count = b"count\n2\n"
        payloads = {
            "metadata_before": metadata,
            "metadata_after": metadata,
            "count_before": count,
            "count_after": count,
            "subway": raw,
        }

        def synthetic_download(url: str, root: Path, name: str, suffix: str, **_limits) -> dict:
            return store_bytes(payloads[name], root, name, suffix, url)

        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary).resolve()
            payloads["subway"] = b"\n".join(raw.splitlines()[:-1]) + b"\n"
            payloads["count_before"] = payloads["count_after"] = b"count\n1\n"
            with patch("nyc_mobility.acquisition.download", side_effect=synthetic_download):
                with self.assertRaisesRegex(ValueError, "month edges"):
                    run_subway(archive, "2026-09")
                payloads["subway"] = raw
                payloads["count_before"] = payloads["count_after"] = count
                payloads["metadata_before"] = payloads["metadata_after"] = (
                    b'{"id":"5wq4-mkjj","rowsUpdatedAt":2}'
                )
                first = run_subway(archive, "2026-09")
            self.assertEqual(
                len(list((archive / "raw/refresh-subway-snapshots").glob("*.json"))), 2
            )
            recorded = json.loads(export_subway(first, require_month_edges=True))
            self.assertEqual(recorded["stations"][0]["counts"], [10] + [None] * 718 + [4])

            with patch(
                "nyc_mobility.acquisition.download",
                side_effect=AssertionError("Unexpected network"),
            ):
                self.assertEqual(run_subway(archive, "2026-09"), first)
                (first / "subway/station_hour.csv").write_text("tampered output\n")
                with self.assertRaisesRegex(ValueError, "differs from frozen"):
                    run_subway(archive, "2026-09")


if __name__ == "__main__":
    unittest.main()
