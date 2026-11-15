"""Exercise historical capture replay against genuine immutable asset manifests."""

import json
import tempfile
import unittest
from http.client import IncompleteRead
from pathlib import Path
from unittest.mock import patch

from backfill_historical_subway import validate_job, verify_capture

from nyc_mobility.acquisition import mta_requests, store_bytes


class CaptureVerificationTests(unittest.TestCase):
    def test_exhausted_body_retry_fails_only_its_month(self) -> None:
        with patch("backfill_historical_subway.run_month", side_effect=IncompleteRead(b"")):
            result = validate_job((Path("unused"), "2024-12", {}))
        self.assertEqual(result["month"], "2024-12")
        self.assertEqual(result["status"], "failed")
        self.assertIn("IncompleteRead", result["reason"])

    def test_replay_checks_source_queries_and_archived_version_and_counts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            month = "2024-12"
            metadata, count, subway, query = mta_requests(month)

            def asset(name: str, data: bytes, url: str, suffix: str = ".csv") -> dict:
                record = store_bytes(data, root, name, suffix, url)
                return {**record, "requested_url": url, "final_url": url}

            version = {
                "id": "wujg-7c2s",
                "name": None,
                "rowsUpdatedAt": 1,
                "viewLastModified": None,
                "publicationDate": None,
                "provenance": None,
            }
            version_asset = asset("meta", json.dumps(version).encode(), metadata, ".json")
            count_asset = asset("count", b"count\n3\n", count)
            assets = {
                "subway": asset("subway", b"file\n", subway),
                "count_before": count_asset,
                "count_after": count_asset,
                "metadata_before": version_asset,
                "metadata_after": version_asset,
            }
            capture = {
                "version": 1,
                "month": month,
                "assets": assets,
                "mta": {
                    "rows_before": 3,
                    "rows_after": 3,
                    "export_rows": 3,
                    "export_query": query,
                    "dataset_version": version,
                },
            }
            self.assertEqual(verify_capture(root, month, capture).read_bytes(), b"file\n")
            for field, invalid, message in (
                ("count_before", asset("wrong-count", b"count\n2\n", count), "do not reconcile"),
                (
                    "metadata_after",
                    asset("wrong-meta", b'{"rowsUpdatedAt":2}', metadata, ".json"),
                    "do not reconcile",
                ),
                ("subway", {**assets["subway"], "requested_url": subway + "x"}, "source URL"),
            ):
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, message):
                    verify_capture(root, month, {**capture, "assets": {**assets, field: invalid}})


if __name__ == "__main__":
    unittest.main()
