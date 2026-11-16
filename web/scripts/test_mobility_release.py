"""Release bundles remain data-only and reject bad input before checkout writes."""

import hashlib
import io
import json
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import mobility_release as release
from export_mobility_months import catalog
from test_backfill import month_assets

BASE = "a" * 40


def state(path):
    return {p.name: p.read_bytes() for p in path.iterdir() if p.is_file()}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        clock = patch("mobility_release.datetime")
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.clock.now.side_effect = lambda zone: datetime(2026, 11, 16, tzinfo=UTC).astimezone(
            zone
        )
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.baseline = root / "published"
        self.stage = root / "stage"
        self.bundle = root / "bundle"
        self.checkout = root / "checkout"
        self.baseline.mkdir()
        september = month_assets("2026-09", 720, run_id="a")
        for mode, prefix in release.FILES.items():
            (self.baseline / f"{prefix}-2026-09.json").write_bytes(september[mode])
        (self.baseline / release.INDEX).write_bytes(catalog(self.baseline))
        shutil.copytree(self.baseline, self.stage)
        shutil.copytree(self.baseline, self.checkout)
        self.name = "subway-2026-10.json"
        payload = month_assets("2026-10", 744, run_id="b")["subway"]
        (self.stage / self.name).write_bytes(payload)
        (self.stage / release.INDEX).write_bytes(catalog(self.stage))
        document = json.loads(payload)
        self.report = {
            "version": 1,
            "month": "2026-10",
            "changesStaged": True,
            "modes": {
                "taxi": {"status": "failed", "reason": "provider unavailable"},
                "subway": {
                    "status": "staged",
                    "reason": "verified",
                    "runId": document["runId"],
                    "sourceSha256": document["sourceSha256"],
                    "assetSha256": hashlib.sha256(payload).hexdigest(),
                },
            },
            "sources": [{"source": "tlc", "status": "error"}],
        }
        self.write_report()
        self.original = state(self.baseline)
        self.addCleanup(lambda: self.assertEqual(state(self.baseline), self.original))

    def write_report(self):
        (self.stage / release.REPORT).write_text(json.dumps(self.report))

    def prepare(self):
        return release.prepare(self.stage, self.bundle, self.baseline, BASE)

    def test_compact_october_release_and_mixed_failure(self):
        prepared = self.prepare()
        self.assertEqual(
            set(self.bundle.iterdir()),
            {self.bundle / name for name in (release.MANIFEST, release.INDEX, self.name)},
        )
        self.assertEqual(prepared["modes"]["taxi"]["status"], "failed")
        before = state(self.checkout)
        applied = release.apply(self.bundle, self.checkout, BASE)
        self.assertEqual(applied["paths"], [release.INDEX, self.name])
        self.assertEqual(state(self.checkout)[self.name], (self.stage / self.name).read_bytes())
        for name, data in before.items():
            if name != release.INDEX:
                self.assertEqual((self.checkout / name).read_bytes(), data)
        after = state(self.checkout)
        with self.assertRaisesRegex(ValueError, "Stale"):
            release.apply(self.bundle, self.checkout, BASE)
        self.assertEqual(state(self.checkout), after)

    def test_only_completed_new_york_months_are_eligible(self):
        self.prepare()
        for utc_time in (datetime(2026, 9, 30, tzinfo=UTC), datetime(2026, 11, 1, 2, tzinfo=UTC)):
            self.clock.now.side_effect = lambda zone, stamp=utc_time: stamp.astimezone(zone)
            with self.subTest(utc_time=utc_time):
                with self.assertRaisesRegex(ValueError, "completed New York calendar month"):
                    release.prepare(self.stage, self.bundle.with_name("early"), self.baseline, BASE)
                with self.assertRaisesRegex(ValueError, "completed New York calendar month"):
                    release.apply(self.bundle, self.checkout, BASE)
        self.assertEqual(state(self.checkout), self.original)

    def test_stale_base_commit_rejected_before_writes(self):
        self.prepare()
        before = state(self.checkout)
        with self.assertRaisesRegex(ValueError, "stale"):
            release.apply(self.bundle, self.checkout, "b" * 40)
        self.assertEqual(state(self.checkout), before)

    def test_baseline_change_rejected_before_writes(self):
        self.prepare()
        path = self.checkout / release.INDEX
        path.write_bytes(path.read_bytes() + b" ")
        before = state(self.checkout)
        with self.assertRaisesRegex(ValueError, "Stale"):
            release.apply(self.bundle, self.checkout, BASE)
        self.assertEqual(state(self.checkout), before)

    def test_existing_stage_asset_edit_rejected(self):
        name = "yellow-taxi-2026-09.json"
        path = self.stage / name
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "Existing published asset changed"):
            self.prepare()
        self.assertFalse(self.bundle.exists())

    def test_bad_hash_and_unexpected_bundle_file_rejected(self):
        self.prepare()
        before = state(self.checkout)
        path = self.bundle / self.name
        original = path.read_bytes()
        path.write_bytes(original + b" ")
        with self.assertRaisesRegex(ValueError, "hash"):
            release.apply(self.bundle, self.checkout, BASE)
        path.write_bytes(original)
        (self.bundle / "untrusted.py").write_text("raise Exception('never execute')")
        with self.assertRaisesRegex(ValueError, "unexpected"):
            release.apply(self.bundle, self.checkout, BASE)
        self.assertEqual(state(self.checkout), before)

    def test_traversal_symlink_and_unexpected_manifest_keys_rejected(self):
        self.prepare()
        path = self.bundle / release.MANIFEST
        original = path.read_bytes()
        document = json.loads(original)
        document["files"]["../escape.json"] = {"sha256": "b" * 64, "bytes": 1}
        path.write_text(json.dumps(document))
        with self.assertRaisesRegex(ValueError, "paths"):
            release.apply(self.bundle, self.checkout, BASE)
        document = json.loads(original)
        document["command"] = "untrusted"
        path.write_text(json.dumps(document))
        with self.assertRaisesRegex(ValueError, "manifest"):
            release.apply(self.bundle, self.checkout, BASE)
        path.write_bytes(original)
        asset = self.bundle / self.name
        asset.unlink()
        asset.symlink_to(self.stage / self.name)
        with self.assertRaisesRegex(ValueError, "regular"):
            release.apply(self.bundle, self.checkout, BASE)
        self.assertEqual(state(self.checkout), self.original)

    def test_bad_catalog_even_with_updated_hash_rejected(self):
        self.prepare()
        path = self.bundle / release.INDEX
        document = json.loads(path.read_bytes())
        document["months"] = document["months"][:1]
        data = json.dumps(document).encode()
        path.write_bytes(data)
        manifest_path = self.bundle / release.MANIFEST
        manifest = json.loads(manifest_path.read_bytes())
        manifest["files"][release.INDEX] = release._digest(data)
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "catalog"):
            release.apply(self.bundle, self.checkout, BASE)
        self.assertEqual(state(self.checkout), self.original)

    def test_conflicting_orphan_file_rejected(self):
        self.prepare()
        (self.checkout / self.name).write_bytes(b"orphan")
        before = state(self.checkout)
        with self.assertRaisesRegex(ValueError, "existing asset"):
            release.apply(self.bundle, self.checkout, BASE)
        self.assertEqual(state(self.checkout), before)

    def test_stage_extra_month_and_no_change_rejected(self):
        self.report["changesStaged"] = False
        self.write_report()
        with self.assertRaisesRegex(ValueError, "no verified changes"):
            self.prepare()
        self.report["changesStaged"] = True
        self.write_report()
        (self.stage / "extra.txt").write_text("not part of release")
        with self.assertRaisesRegex(ValueError, "Unexpected stage"):
            self.prepare()
        self.assertFalse(self.bundle.exists())

    def test_old_gap_rejected_independently_at_apply(self):
        self.prepare()
        manifest_path = self.bundle / release.MANIFEST
        manifest = json.loads(manifest_path.read_bytes())
        original = self.bundle / self.name
        document = json.loads(original.read_bytes())
        document["month"] = "2026-08"
        name = "subway-2026-08.json"
        original.unlink()
        data = json.dumps(document).encode()
        (self.bundle / name).write_bytes(data)
        del manifest["files"][self.name]
        manifest["files"][name] = release._digest(data)
        manifest["month"] = "2026-08"
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "watermark"):
            release.apply(self.bundle, self.checkout, BASE)
        self.assertEqual(state(self.checkout), self.original)

    def test_cli_paths_are_basenames(self):
        with redirect_stdout(io.StringIO()) as stdout:
            code = release.main(
                [
                    "prepare",
                    "--stage-dir",
                    str(self.stage),
                    "--bundle-dir",
                    str(self.bundle),
                    "--published-dir",
                    str(self.baseline),
                    "--base-sha",
                    BASE,
                ]
            )
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout.getvalue())["paths"], [release.INDEX, self.name])
        with redirect_stdout(io.StringIO()) as stdout:
            code = release.main(
                [
                    "apply",
                    "--bundle-dir",
                    str(self.bundle),
                    "--published-dir",
                    str(self.checkout),
                    "--base-sha",
                    "bad",
                ]
            )
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(stdout.getvalue())["paths"], [])


if __name__ == "__main__":
    unittest.main()
