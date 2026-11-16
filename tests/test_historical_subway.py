import csv
import hashlib

import pytest
from test_subway import BASE, write_csv

from nyc_mobility.historical_subway import validate_historical_subway
from nyc_mobility.subway import validate_subway

REFERENCE_FIELDS = ["complex_id", "display_name", "borough", "latitude", "longitude"]


def reference(tmp_path, **changes):
    row = dict(
        complex_id="100",
        display_name="Example Station",
        borough="M",
        latitude="40.75",
        longitude="-73.99",
    )
    row.update(changes)
    return write_csv(tmp_path / "reference.csv", [row], REFERENCE_FIELDS)


def source(tmp_path, rows=None):
    if rows is None:
        rows = [
            dict(BASE, transit_timestamp="2024-12-01T00:00:00.000", ridership="2.5", transfers="0"),
            dict(
                BASE,
                transit_timestamp="2024-12-01T00:00:00.000",
                fare_class_category="other",
                latitude="40.7505",
                ridership="3.5",
                transfers="1",
            ),
        ]
    return write_csv(tmp_path / "input.csv", rows)


def output(tmp_path, name="output"):
    path = tmp_path / name
    path.mkdir()
    return path


def test_historical_counts_raw_bytes_and_reference_points_preserved(tmp_path):
    raw = source(tmp_path)
    before = raw.read_bytes()
    ref = reference(tmp_path)
    dest = output(tmp_path)
    quality = validate_historical_subway(raw, dest, "2024-12", ref)
    assert raw.read_bytes() == before
    assert (
        quality["historical_coordinates"]["reference_sha256"]
        == hashlib.sha256(ref.read_bytes()).hexdigest()
    )
    pairs = quality["historical_coordinates"]["complexes"][0]["source_coordinate_pairs"]
    assert len(pairs) == 2
    assert sum(pair["rows"] for pair in pairs) == 2
    assert quality["observed_station_hours"] == 1
    assert quality["missing_station_hours"] == 743
    rows = list(csv.DictReader((dest / "station_hour.csv").open()))
    assert float(rows[0]["ridership"]) == 6
    assert float(rows[0]["latitude"]) == 40.75
    assert rows[1]["ridership"] == ""
    assert rows[1]["observation"] == "false"
    assert rows[0]["comparison_eligible"] == "true"


def test_shuffled_input_has_same_aggregate_and_quality(tmp_path):
    raw = source(tmp_path)
    ref = reference(tmp_path)
    first = output(tmp_path, "first")
    second = output(tmp_path, "second")
    quality = validate_historical_subway(raw, first, "2024-12", ref)
    rows = list(csv.DictReader(raw.open()))
    write_csv(raw, list(reversed(rows)))
    assert validate_historical_subway(raw, second, "2024-12", ref) == quality
    assert (first / "station_hour.csv").read_bytes() == (second / "station_hour.csv").read_bytes()


def test_modern_default_still_rejects_coordinate_variants(tmp_path):
    with pytest.raises(ValueError, match="coordinates"):
        validate_subway(source(tmp_path), output(tmp_path), "2024-12")


@pytest.mark.parametrize(
    "change",
    [
        dict(ridership="-1"),
        dict(transfers="20"),
        dict(latitude="NaN"),
        dict(longitude="-10"),
        dict(station_complex="Other name"),
        dict(borough="Queens"),
    ],
)
def test_original_validation_and_identity_conflicts_fail(tmp_path, change):
    rows = [
        dict(BASE, transit_timestamp="2024-12-01T00:00:00.000"),
        dict(BASE, transit_timestamp="2024-12-01T01:00:00.000", **change),
    ]
    dest = output(tmp_path)
    with pytest.raises(ValueError):
        validate_historical_subway(source(tmp_path, rows), dest, "2024-12", reference(tmp_path))
    assert not list(dest.iterdir())


def test_duplicate_compound_keys_still_fail_even_with_different_coordinates(tmp_path):
    rows = [
        dict(BASE, transit_timestamp="2024-12-01T00:00:00.000"),
        dict(BASE, transit_timestamp="2024-12-01T00:00:00.000", latitude="40.7505"),
    ]
    with pytest.raises(ValueError, match="duplicate compound"):
        validate_historical_subway(
            source(tmp_path, rows), output(tmp_path), "2024-12", reference(tmp_path)
        )


def test_negative_transfer_quarantines_whole_hour_without_losing_counts(tmp_path):
    raw = source(tmp_path)
    rows = list(csv.DictReader(raw.open()))
    rows[0]["transfers"] = "-1"
    write_csv(raw, rows)
    dest = output(tmp_path)
    quality = validate_historical_subway(raw, dest, "2024-12", reference(tmp_path))
    first = next(csv.DictReader((dest / "station_hour.csv").open()))
    assert float(first["ridership"]) == 6
    assert first["comparison_eligible"] == "false"
    assert quality["negative_transfer_quarantine"]["station_hours"] == 1


@pytest.mark.parametrize(
    "changes",
    [
        dict(complex_id="101"),
        dict(display_name="Unreviewed name"),
        dict(borough="Q"),
        dict(latitude="40.8"),
        dict(latitude="NaN"),
    ],
)
def test_unmatched_identity_alias_or_implausible_reference_fails(tmp_path, changes):
    with pytest.raises(ValueError):
        validate_historical_subway(
            source(tmp_path), output(tmp_path), "2024-12", reference(tmp_path, **changes)
        )


def test_explicit_reviewed_name_pair_is_id_scoped(tmp_path):
    raw = source(
        tmp_path,
        [
            dict(
                BASE,
                transit_timestamp="2024-12-01T00:00:00.000",
                station_complex_id="606",
                station_complex="Court Sq (E,G,M,7)",
                borough="Queens",
                latitude="40.747845",
                longitude="-73.94383",
            )
        ],
    )
    ref = reference(
        tmp_path,
        complex_id="606",
        display_name="Court Sq-23 St (7,E,F,G)",
        borough="Q",
        latitude="40.747845",
        longitude="-73.94383",
    )
    quality = validate_historical_subway(raw, output(tmp_path), "2024-12", ref)
    assert quality["historical_coordinates"]["complexes"][0]["reviewed_name_alias"] is True


@pytest.mark.parametrize("month", ["2025-01", "2019-12"])
def test_only_historical_years_are_supported(tmp_path, month):
    with pytest.raises(ValueError):
        validate_historical_subway(source(tmp_path), output(tmp_path), month, reference(tmp_path))


def test_reference_duplicates_fail_and_do_not_write_outputs(tmp_path):
    ref = reference(tmp_path)
    rows = list(csv.DictReader(ref.open()))
    write_csv(ref, rows + rows, REFERENCE_FIELDS)
    dest = output(tmp_path)
    with pytest.raises(ValueError, match="duplicate complex IDs"):
        validate_historical_subway(source(tmp_path), dest, "2024-12", ref)
    assert not list(dest.iterdir())


def test_cluster_spread_requires_review_even_when_each_point_is_near_reference(tmp_path):
    rows = [
        dict(BASE, transit_timestamp="2024-12-01T00:00:00.000", latitude="40.7525"),
        dict(BASE, transit_timestamp="2024-12-01T01:00:00.000", latitude="40.7475"),
    ]
    with pytest.raises(ValueError, match="cluster requires review"):
        validate_historical_subway(
            source(tmp_path, rows), output(tmp_path), "2024-12", reference(tmp_path)
        )


@pytest.mark.parametrize(
    "month,date,invalid", [("2024-03", "2024-03-10", True), ("2024-11", "2024-11-03", False)]
)
def test_transition_month_retains_existing_quarantine(tmp_path, month, date, invalid):
    rows = [
        dict(BASE, transit_timestamp=f"{date}T01:00:00.000"),
        dict(BASE, transit_timestamp=f"{date}T02:00:00.000"),
    ]
    dest = output(tmp_path)
    quality = validate_historical_subway(source(tmp_path, rows), dest, month, reference(tmp_path))
    assert quality["observed_station_hours"] == (1 if invalid else 2)
    assert quality["eligible_station_hours"] == 0
    observed = [
        r for r in csv.DictReader((dest / "station_hour.csv").open()) if r["observation"] == "true"
    ]
    assert all(r["comparison_eligible"] == "false" for r in observed)
