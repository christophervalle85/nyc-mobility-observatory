import csv
import importlib.util

import duckdb
import pytest

COLUMNS = (
    "tpep_pickup_datetime TIMESTAMP, tpep_dropoff_datetime TIMESTAMP, "
    "PULocationID INTEGER, DOLocationID INTEGER, trip_distance DOUBLE, total_amount DOUBLE"
)


def fixture_inputs(tmp_path, rows=None, columns=COLUMNS, lookup=None):
    path = tmp_path / "taxi's input.parquet"
    db = duckdb.connect()
    db.execute(f"create table trips ({columns})")
    if rows is None:
        rows = [
            ("2026-09-01 00:00", "2026-09-01 01:20", 1, 2, 1.0, 10.0),
            ("2026-09-01 00:00", "2026-09-01 01:20", 1, 2, 1.0, 10.0),
            ("2026-08-31 23:00", "2026-09-01 00:00", 264, 1, -1.0, -5.0),
            ("2026-09-30 23:00", "2026-10-01 00:00", 1, 2, 1.0, 10.0),
            ("2026-09-01 02:00", "2026-09-01 01:00", 1, 2, 0.0, 0.0),
            (None, None, None, None, None, None),
            ("2026-09-01 00:00", "2026-09-01 01:30", 1, 264, 1.0, 10.0),
            ("2026-09-01 00:00", "2026-09-01 01:30", 1, 265, 1.0, 10.0),
        ]
    if rows:
        db.executemany("insert into trips values (?, ?, ?, ?, ?, ?)", rows)
    db.execute("copy trips to ? (format parquet)", [str(path)])
    db.close()
    ref = tmp_path / "zone's lookup.csv"
    ref.write_text(
        lookup
        or (
            "LocationID,Borough,Zone,service_zone\n"
            "1,Manhattan,A,Yellow Zone\n2,Manhattan,B,Yellow Zone\n"
            "264,Unknown,NV,Unknown\n265,Unknown,NA,Unknown\n"
        )
    )
    return path, ref


def test_taxi_exists():
    assert importlib.util.find_spec("nyc_mobility.taxi"), "taxi transform is not implemented"


def test_duplicates_boundaries_and_flags_reconcile(tmp_path):
    from nyc_mobility.taxi import validate_taxi

    path, ref = fixture_inputs(tmp_path)
    out = tmp_path / "out"
    out.mkdir()
    report = validate_taxi(path, ref, out, "2026-09")
    with (out / "zone_hour.csv").open() as handle:
        actual = list(csv.DictReader(handle))
    assert actual == [
        {"dropoff_hour_local": "2026-09-01 00:00:00", "DOLocationID": "1", "trip_count": "1"},
        {"dropoff_hour_local": "2026-09-01 01:00:00", "DOLocationID": "2", "trip_count": "3"},
    ]
    assert report["raw_rows"] == 8
    assert report["eligible_rows"] == 4
    assert report["excluded_rows"] == 4
    assert report["flags"]["non_positive_duration"] == 1
    assert report["flags"]["distance_anomaly"] == 3
    assert report["flags"]["fare_anomaly"] == 3
    assert report["flags"]["unknown_origin"] == 2
    assert report["duplicate_policy"] == "retain all source rows; no unique trip identifier"
    with (out / "row_ledger.csv").open() as handle:
        ledger = list(csv.DictReader(handle))
    assert len(ledger) == 6
    assert sum(row["excluded"] == "true" for row in ledger) == 4
    assert report["raw_rows"] == report["eligible_rows"] + report["excluded_rows"]


def test_unexpected_zone_id_fails(tmp_path):
    from nyc_mobility.taxi import validate_taxi

    path, ref = fixture_inputs(tmp_path, [("2026-09-01", "2026-09-01", 999, 2, 1.0, 1.0)])
    with pytest.raises(ValueError, match="unresolved|zone"):
        validate_taxi(path, ref, tmp_path, "2026-09")


@pytest.mark.parametrize(
    "lookup",
    [
        "LocationID,Borough,Zone,service_zone\n1,A,B,C\n1,A,B,C\n",
        "LocationID,Borough,Zone,service_zone\n,A,B,C\n",
        "LocationID,Borough,Zone,service_zone\n1,,B,C\n",
    ],
)
def test_bad_lookup_fails(tmp_path, lookup):
    from nyc_mobility.taxi import validate_taxi

    path, ref = fixture_inputs(tmp_path, lookup=lookup)
    with pytest.raises(ValueError):
        validate_taxi(path, ref, tmp_path, "2026-09")


def test_schema_wrong_type_fails(tmp_path):
    from nyc_mobility.taxi import validate_taxi

    path, ref = fixture_inputs(
        tmp_path, rows=[], columns=COLUMNS.replace("PULocationID INTEGER", "PULocationID VARCHAR")
    )
    with pytest.raises(ValueError, match="schema|type"):
        validate_taxi(path, ref, tmp_path, "2026-09")


def test_source_columns_cannot_shadow_internal_eligibility(tmp_path):
    from nyc_mobility.taxi import validate_taxi

    source, lookup = fixture_inputs(tmp_path, [(None, None, 1, 264, 1.0, 1.0)])
    database = duckdb.connect()
    database.execute(
        "create table malicious as select *, false as excluded, false as null_dropoff, "
        "false as unknown_destination, 999 as source_row from read_parquet(?)",
        [str(source)],
    )
    database.execute("copy malicious to ? (format parquet)", [str(tmp_path / "shadow.parquet")])
    report = validate_taxi(tmp_path / "shadow.parquet", lookup, tmp_path / "out", "2026-09")
    assert report["eligible_rows"] == 0
    assert report["excluded_rows"] == 1
    assert report["flags"]["null_dropoff"] == 1
    assert list(csv.DictReader((tmp_path / "out/zone_hour.csv").open())) == []


def test_taxi_glob_paths_are_not_expanded(tmp_path):
    from nyc_mobility.taxi import validate_taxi

    source, lookup = fixture_inputs(tmp_path)
    literal = tmp_path / "taxi[1].parquet"
    literal.write_bytes(source.read_bytes())
    with pytest.raises(ValueError, match="glob|single local"):
        validate_taxi(literal, lookup, tmp_path / "out", "2026-09")
