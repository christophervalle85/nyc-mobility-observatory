import importlib.util
import io
import json
import urllib.request
from urllib.error import URLError

import pytest


class Response(io.BytesIO):
    def __init__(self, data, length=None):
        super().__init__(data)
        self.headers = {} if length is None else {"Content-Length": str(length)}
        self.url = "https://data.ny.gov/resource/a.csv"

    def geturl(self):
        return self.url


class Opener:
    def __init__(self, response):
        self.response = response
        self.calls = 0

    def open(self, request, timeout):
        self.calls += 1
        return self.response


def test_acquisition_exists():
    assert importlib.util.find_spec("nyc_mobility.acquisition"), "acquisition is not implemented"


def test_acquisition_hash_immutability_and_tamper(tmp_path):
    from nyc_mobility.acquisition import download, verify_asset

    asset = download(
        "https://data.ny.gov/resource/a.csv",
        tmp_path,
        "subway",
        ".csv",
        max_bytes=20,
        opener=Opener(Response(b"a,b\n1,2\n", 8)),
    )
    assert asset["bytes"] == 8
    path = verify_asset(asset, tmp_path)
    assert path.read_bytes() == b"a,b\n1,2\n"
    duplicate = download(
        "https://data.ny.gov/resource/a.csv",
        tmp_path,
        "subway",
        ".csv",
        max_bytes=20,
        opener=Opener(Response(b"a,b\n1,2\n", 8)),
    )
    assert duplicate["path"] == asset["path"]
    path.write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="checksum|length"):
        verify_asset(asset, tmp_path)


@pytest.mark.parametrize(
    "data,length,limit", [(b"123", 5, 10), (b"12345", 5, 4), (b"12345", None, 4)]
)
def test_truncation_and_size_fail_without_publication(tmp_path, data, length, limit):
    from nyc_mobility.acquisition import download

    with pytest.raises(ValueError):
        download(
            "https://data.ny.gov/resource/a.csv",
            tmp_path,
            "subway",
            ".csv",
            max_bytes=limit,
            opener=Opener(Response(data, length)),
        )
    assert not list((tmp_path / "raw").rglob("*.csv")) if (tmp_path / "raw").exists() else True
    assert not list((tmp_path / "tmp").iterdir())


@pytest.mark.parametrize(
    "url",
    [
        "http://data.ny.gov/a",
        "https://evil.test/a",
        "https://data.ny.gov.evil.test/a",
        "https://user@data.ny.gov/a",
        "https://data.ny.gov:8443/a",
    ],
)
def test_unapproved_origin_and_redirect_rejected(url):
    from nyc_mobility.acquisition import SafeRedirectHandler, validate_url

    with pytest.raises(ValueError):
        validate_url(url)
    handler = SafeRedirectHandler()
    request = urllib.request.Request("https://data.ny.gov/a")
    with pytest.raises(ValueError):
        handler.redirect_request(request, None, 302, "Found", {}, url)


def test_manifest_path_escape_fails(tmp_path):
    from nyc_mobility.acquisition import verify_asset

    with pytest.raises(ValueError, match="path"):
        verify_asset({"path": "../escape", "sha256": "0" * 64, "bytes": 1}, tmp_path)


def test_retry_transient_network_error(tmp_path):
    from nyc_mobility.acquisition import download

    class Flaky(Opener):
        def open(self, request, timeout):
            self.calls += 1
            if self.calls == 1:
                raise URLError("temporary")
            return Response(b"ok", 2)

    opener = Flaky(None)
    assert (
        download("https://data.ny.gov/a", tmp_path, "subway", ".csv", max_bytes=10, opener=opener)[
            "bytes"
        ]
        == 2
    )
    assert opener.calls == 2


def test_mutable_source_checks_fail_closed(tmp_path, monkeypatch):
    from nyc_mobility import acquisition

    counts = iter([2, 3])

    def fake_download(url, root, name, suffix, **kwargs):
        if name.startswith("metadata"):
            data = json.dumps({"rowsUpdatedAt": 4, "columns": []}).encode()
        elif name.startswith("count"):
            data = f"count\n{next(counts)}\n".encode()
        else:
            data = b"a\n1\n2\n"
        return acquisition.store_bytes(data, root, name, suffix, url)

    monkeypatch.setattr(acquisition, "download", fake_download)
    with pytest.raises(ValueError, match="changed|count"):
        acquisition.capture_mta(tmp_path, "2026-09")


def test_new_snapshot_preserves_old_snapshot(tmp_path):
    from nyc_mobility.acquisition import save_snapshot

    first = save_snapshot({"assets": {"a": "one"}}, tmp_path)
    second = save_snapshot({"assets": {"a": "two"}}, tmp_path)
    assert first != second
    assert first.read_bytes() == b'{\n  "assets": {\n    "a": "one"\n  }\n}\n'
    assert not list((tmp_path / "snapshots").glob(".*"))


def test_retained_polygon_zip_is_validated_without_extraction(tmp_path):
    from nyc_mobility.acquisition import validate_polygon_zip

    path = tmp_path / "bad.zip"
    path.write_bytes(b"<html>upstream error</html>")
    with pytest.raises(ValueError, match="ZIP"):
        validate_polygon_zip(path)


def test_mta_query_uses_calendar_date_iso_literal(tmp_path, monkeypatch):
    from urllib.parse import parse_qs, urlparse

    from nyc_mobility import acquisition

    def inspect_download(url, root, name, suffix, **kwargs):
        if name == "metadata_before":
            return acquisition.store_bytes(b'{"rowsUpdatedAt": 4}', root, name, suffix, url)
        where = parse_qs(urlparse(url).query)["$where"][0]
        assert "'2026-09-01T00:00:00'" in where
        assert "'2026-10-01T00:00:00'" in where
        raise RuntimeError("query inspected")

    monkeypatch.setattr(acquisition, "download", inspect_download)
    with pytest.raises(RuntimeError, match="query inspected"):
        acquisition.capture_mta(tmp_path, "2026-09")


@pytest.mark.parametrize("component", ["tmp", "raw", "raw/subway", "snapshots"])
def test_archive_rejects_descendant_symlink_without_outside_write(tmp_path, component):
    from nyc_mobility.acquisition import save_snapshot, store_bytes

    root = tmp_path / "data"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    link = root / component
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink|symbolic"):
        if component == "snapshots":
            save_snapshot({"ok": True}, root)
        else:
            store_bytes(b"example", root, "subway", ".csv", "fixture")
    assert not list(outside.iterdir())


def test_download_deadline_checked_after_single_read(tmp_path, monkeypatch):
    from nyc_mobility import acquisition

    now = [0.0]

    class Slow(Response):
        def read1(self, size):
            now[0] = 601.0
            return super().read(size)

    monkeypatch.setattr(acquisition.time, "monotonic", lambda: now[0])
    with pytest.raises(ValueError, match="time limit"):
        acquisition.download(
            "https://data.ny.gov/a",
            tmp_path,
            "subway",
            ".csv",
            max_bytes=20,
            opener=Opener(Slow(b"example", 7)),
        )
    assert not list((tmp_path / "raw").rglob("*.csv")) if (tmp_path / "raw").exists() else True
