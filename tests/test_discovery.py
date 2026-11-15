import csv
import io
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse

import pytest

from nyc_mobility import acquisition, discovery


def coverage(*rows):
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(["month", "first", "last", "count"])
    writer.writerows(rows)
    return stream.getvalue().encode()


def test_tlc_accepts_only_exact_official_yellow_links():
    base = "https://d37ci6vzurychx.cloudfront.net/trip-data/"
    urls = [
        base + "yellow_tripdata_2026-09.parquet",
        base + "yellow_tripdata_2026-09.parquet",
        base + "green_tripdata_2026-08.parquet",
        base + "yellow_tripdata_2026-08.parquet?x=1",
        base.replace(".net/", ".net.evil.test/") + "yellow_tripdata_2026-08.parquet",
        "http://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2026-08.parquet",
        base + "yellow_tripdata_2026-13.parquet",
    ]
    html = "".join(f'<a href="{url}">record</a>' for url in urls)
    html += f'<script>"{base}yellow_tripdata_2026-07.parquet"</script>'
    assert discovery.parse_tlc(html.encode()) == ["2026-09"]


def test_tlc_handles_surrounding_html_whitespace_in_archive_links():
    base = "https://d37ci6vzurychx.cloudfront.net/trip-data/"
    html = f'<a href="\t{base}yellow_tripdata_2024-01.parquet ">yellow</a>'
    html += f'<a href="{base}yellow_tripdata_2024-02.parquet ?alternate=1 ">other</a>'
    assert discovery.parse_tlc(html.encode()) == ["2024-01"]


def test_discovery_index_origin_is_narrowly_allowed():
    acquisition.validate_url(acquisition.TLC_INDEX)
    for url in (
        "https://www.nyc.gov/other",
        acquisition.TLC_INDEX + "?url=evil",
        "https://www.nyc.gov.evil.test/site/tlc/about/tlc-trip-record-data.page",
    ):
        with pytest.raises(ValueError):
            acquisition.validate_url(url)


def test_coverage_query_is_bounded_and_dataset_fixed():
    url = discovery.coverage_url("wujg-7c2s")
    parsed = urlparse(url)
    assert parsed.netloc == "data.ny.gov"
    assert parsed.path == "/resource/wujg-7c2s.csv"
    query = parse_qs(parsed.query)
    assert query["$limit"] == [str(discovery.MAX_MONTHS + 1)]
    assert query["$group"] == ["date_trunc_ym(transit_timestamp)"]
    assert query["$where"] == ["transit_mode = 'subway'"]
    with pytest.raises(ValueError):
        discovery.coverage_url("https://evil.test")


def test_coverage_marks_partial_edges_without_claiming_station_completeness():
    rows = discovery.parse_coverage(
        coverage(
            ("2024-02-01T00:00:00.000", "2024-02-01T00:00:00.000", "2024-02-29T23:00:00.000", 10),
            ("2024-03-01T00:00:00.000", "2024-03-02T00:00:00.000", "2024-03-31T23:00:00.000", 10),
            ("2024-04-01T00:00:00.000", "2024-04-01T00:00:00.000", "2024-04-29T23:00:00.000", 10),
        ),
        "wujg-7c2s",
    )
    assert [row["complete_edges"] for row in rows] == [True, False, False]


@pytest.mark.parametrize(
    "row",
    [
        ("2024-02-02T00:00:00", "2024-02-01T00:00:00", "2024-02-29T23:00:00", 10),
        ("2024-02-01T00:00:00", "2024-01-01T00:00:00", "2024-02-29T23:00:00", 10),
        ("2025-02-01T00:00:00", "2025-02-01T00:00:00", "2025-02-28T23:00:00", 10),
        ("2024-02-01T00:00:00", "2024-02-01T00:00:00", "2024-02-29T23:00:00", -1),
        ("2024-02-01T00:00:00", "2024-02-01T00:00:00+00:00", "2024-02-29T23:00:00", 10),
    ],
)
def test_invalid_coverage_fails_closed(row):
    with pytest.raises(ValueError):
        discovery.parse_coverage(coverage(row), "wujg-7c2s")


def test_duplicate_and_truncated_coverage_rejected(monkeypatch):
    row = ("2024-02-01T00:00:00", "2024-02-01T00:00:00", "2024-02-29T23:00:00", 10)
    with pytest.raises(ValueError, match="Duplicate"):
        discovery.parse_coverage(coverage(row, row), "wujg-7c2s")
    monkeypatch.setattr(discovery, "MAX_MONTHS", 1)
    with pytest.raises(ValueError, match="bounded"):
        discovery.parse_coverage(coverage(row, row), "wujg-7c2s")


def test_discovery_independent_empty_errors_and_rejections(tmp_path, monkeypatch):
    def fake_download(url, root, name, suffix, **kwargs):
        assert kwargs["max_bytes"] <= 5 * 1024**2
        if name == "discovery-tlc":
            data = b"".join(
                f'<a href="https://d37ci6vzurychx.cloudfront.net/trip-data/'
                f'yellow_tripdata_{month}.parquet">x</a>'.encode()
                for month in ("2010-12", "2011-01", "2015-01", "2024-02", "9998-01")
            )
        elif "wujg" in name:
            data = coverage()
        else:
            raise URLError("source unavailable")
        return acquisition.store_bytes(data, root, name, suffix, url)

    monkeypatch.setattr(discovery, "download", fake_download)
    result = discovery.discover(tmp_path)
    assert [item["month"] for item in result["months"]] == ["2024-02", "2015-01", "2011-01"]
    assert all(item["taxi"] and not item["subway"] for item in result["months"])
    assert [source["status"] for source in result["sources"]] == ["ok", "empty", "error"]
    assert {item["month"] for item in result["rejected"]} == {"2010-12", "9998-01"}
    legacy = next(item for item in result["rejected"] if item["month"] == "2010-12")
    assert legacy["source"] == "tlc"
    assert legacy["reason"] == "legacy taxi coordinates require a verified zone-ID adapter"


def test_current_and_partial_mta_months_are_rejected(tmp_path, monkeypatch):
    current = discovery.datetime.now(discovery.ZoneInfo("America/New_York"))
    first = current.replace(day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    last = first.replace(day=discovery.calendar.monthrange(first.year, first.month)[1], hour=23)

    def fake_download(url, root, name, suffix, **kwargs):
        if name == "discovery-tlc":
            data = b"<html></html>"
        elif "wujg" in name:
            data = coverage()
        else:
            data = coverage(
                (first.isoformat(), first.isoformat(), last.isoformat(), 10),
                ("2025-01-01", "2025-01-02", "2025-01-31", 20),
            )
        return acquisition.store_bytes(data, root, name, suffix, url)

    monkeypatch.setattr(discovery, "download", fake_download)
    result = discovery.discover(tmp_path)
    assert result["months"] == []
    assert {r["reason"] for r in result["rejected"]} == {
        "current or future calendar month",
        "partial observed month edges",
    }


def test_historical_capture_uses_fixed_dataset_and_existing_fields(tmp_path, monkeypatch):
    requested = []

    def fake_download(url, root, name, suffix, **kwargs):
        requested.append(url)
        if name.startswith("metadata"):
            data = b'{"rowsUpdatedAt":4,"id":"wujg-7c2s"}'
        elif name.startswith("count"):
            data = b"count\n1\n"
        else:
            data = (
                acquisition.MTA_FIELDS + "\n"
                "2024-02-01T00:00:00,subway,1,Station,Queens,omny,full,1,0,40,-73\n"
            ).encode()
        return acquisition.store_bytes(data, root, name, suffix, url)

    monkeypatch.setattr(acquisition, "download", fake_download)
    assets, provenance = acquisition.capture_mta(tmp_path, "2024-02")
    assert all("wujg-7c2s" in url for url in requested)
    assert provenance["export_rows"] == 1
    assert provenance["dataset_version"]["id"] == "wujg-7c2s"
    assert assets["subway"]["requested_url"].startswith(
        "https://data.ny.gov/resource/wujg-7c2s.csv?"
    )
    assert acquisition.mta_dataset("2026-09") == "5wq4-mkjj"
    with pytest.raises(ValueError):
        acquisition.mta_dataset("2019-12")


def test_unsupported_historical_capture_fails_before_download(tmp_path, monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("must validate period before download")

    monkeypatch.setattr(acquisition, "download", unexpected)
    with pytest.raises(ValueError, match="2020"):
        acquisition.acquire(tmp_path, "2019-12")


def test_provider_timeout_falls_back_to_explicit_span_candidates(tmp_path, monkeypatch):
    from urllib.error import HTTPError

    def fake_download(url, root, name, suffix, **kwargs):
        if name == "discovery-tlc":
            data = b"<html></html>"
        elif "wujg" in name:
            data = coverage()
        elif name.endswith("-asc"):
            data = b"transit_timestamp\n2025-01-02T00:00:00.000\n"
        elif name.endswith("-desc"):
            data = b"transit_timestamp\n2025-04-15T23:00:00.000\n"
        else:
            raise HTTPError(url, 504, "Gateway timeout", {}, None)
        return acquisition.store_bytes(data, root, name, suffix, url)

    monkeypatch.setattr(discovery, "download", fake_download)
    result = discovery.discover(tmp_path)
    assert [entry["month"] for entry in result["months"]] == ["2025-03", "2025-02"]
    assert all(entry["subway_coverage"] == "date-span-candidate" for entry in result["months"])
    source = result["sources"][-1]
    assert source["coverage"] == "date-span-candidate"
    assert "504" in source["fallback_reason"]
    assert len(source["span_assets"]) == 2
    assert {entry["month"] for entry in result["rejected"]} == {"2025-01", "2025-04"}
