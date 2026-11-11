"""Hand-checkable examples of the M1 MTA local-clock contract."""

import csv
import importlib
import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
FIELDS = [
    "transit_timestamp",
    "transit_mode",
    "station_complex_id",
    "station_complex",
    "borough",
    "payment_method",
    "fare_class_category",
    "ridership",
    "transfers",
    "latitude",
    "longitude",
]
ROSTER_FIELDS = ["station_complex_id", "station_complex", "borough", "latitude", "longitude"]
BASE = dict(
    zip(
        FIELDS,
        [
            "2026-09-01T00:00:00.000",
            "subway",
            "100",
            "Example Station",
            "Manhattan",
            "omny",
            "full_fare",
            "10",
            "2",
            "40.75",
            "-73.99",
        ],
        strict=True,
    )
)


def validate(input_path, output_dir, month="2026-09", roster_path=FIXTURES / "subway_roster.csv"):
    module = importlib.util.find_spec("nyc_mobility.subway")
    assert module is not None, "M1 subway validation is not implemented"
    return importlib.import_module("nyc_mobility.subway").validate_subway(
        input_path,
        output_dir,
        month,
        roster_path,
    )


def write_csv(path, rows, fields=FIELDS):
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return path


def read_output(path):
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def run_rows(tmp_path, rows, month="2026-09", roster_path=FIXTURES / "subway_roster.csv"):
    source = write_csv(tmp_path / "input.csv", rows)
    output = tmp_path / "output"
    output.mkdir()
    quality = validate(source, output, month, roster_path)
    return quality, read_output(output / "station_hour.csv"), output


def test_category_sum_includes_future_category_but_never_adds_transfers(tmp_path):
    output = tmp_path / "output"
    output.mkdir()
    quality = validate(FIXTURES / "subway.csv", output)
    rows = read_output(output / "station_hour.csv")
    assert rows[0]["transit_hour_local"] == "2026-09-01 00:00:00"
    assert rows[0]["station_complex_id"] == "100"
    assert float(rows[0]["ridership"]) == 15
    assert rows[0]["observation"] == "true"
    assert rows[0]["model_eligible"] == "true"
    assert rows[0]["comparison_eligible"] == "true"
    assert quality["input_rows"] == 3
    assert quality["observed_station_hours"] == 2
    assert quality["station_universe_count"] == 2
    assert quality["valid_local_clock_labels"] == 720
    assert quality["station_hour_denominator"] == 1440
    assert quality["missing_station_hours"] == 1438
    assert quality["eligible_station_hours"] == 2
    assert json.loads((output / "quality.json").read_text()) == quality


def test_missing_observations_stay_null_and_observed_zero_is_preserved(tmp_path):
    quality, rows, _ = run_rows(tmp_path, [dict(BASE, ridership="0", transfers="0")])
    assert len(rows) == 1440
    assert rows[0]["ridership"] == "0.0"
    assert rows[0]["observation"] == "true"
    assert rows[1]["ridership"] == ""
    assert rows[1]["observation"] == "false"
    assert rows[1]["model_eligible"] == "false"
    assert rows[1]["exclusion_reason"] == "missing_observation"
    assert quality["service_calendar_validation"] == "pending"
    assert quality["full_21_month_audit"] == "pending"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("ridership", "NaN"),
        ("ridership", "inf"),
        ("ridership", "-1"),
        ("ridership", "broken"),
        ("ridership", ""),
        ("transfers", "NaN"),
        ("transfers", "broken"),
        ("transfers", "inf"),
        ("transfers", "11"),
        ("latitude", "nan"),
        ("latitude", "91"),
        ("longitude", "-181"),
        ("station_complex_id", "1.5"),
        ("station_complex_id", ""),
        ("payment_method", ""),
        ("fare_class_category", ""),
        ("station_complex", ""),
        ("borough", ""),
        ("transit_mode", "bus"),
        ("transit_timestamp", "2026-09-01T00:30:00.000"),
        ("transit_timestamp", "2026-10-01T00:00:00.000"),
        ("transit_timestamp", "2026-09-01T00:00:00Z"),
        ("transit_timestamp", "2026-09-31T00:00:00.000"),
    ],
)
def test_invalid_source_values_fail_without_writing_outputs(tmp_path, field, value):
    source = write_csv(tmp_path / "input.csv", [dict(BASE, **{field: value})])
    output = tmp_path / "output"
    output.mkdir()
    with pytest.raises(ValueError):
        validate(source, output)
    assert list(output.iterdir()) == []


def test_duplicate_compound_key_fails_instead_of_deduplicating(tmp_path):
    with pytest.raises(ValueError, match="duplicate"):
        run_rows(tmp_path, [BASE, BASE])


def test_equivalent_timestamp_formats_have_same_compound_key(tmp_path):
    with pytest.raises(ValueError, match="duplicate"):
        run_rows(tmp_path, [BASE, dict(BASE, transit_timestamp="2026-09-01 00:00:00")])


@pytest.mark.parametrize(
    "fields", [FIELDS[:-1], FIELDS + ["georeference"], [*FIELDS[:-1], "latitude"]]
)
def test_unexpected_or_duplicate_columns_fail(tmp_path, fields):
    source = tmp_path / "input.csv"
    source.write_text(
        ",".join(fields) + "\n" + ",".join(BASE.get(field, "extra") for field in fields) + "\n",
    )
    output = tmp_path / "output"
    output.mkdir()
    with pytest.raises(ValueError, match="schema"):
        validate(source, output)


def test_malformed_csv_fails(tmp_path):
    source = tmp_path / "input.csv"
    source.write_text(",".join(FIELDS) + '\n"2026-09-01T00:00:00.000,subway,100\n')
    output = tmp_path / "output"
    output.mkdir()
    with pytest.raises(ValueError):
        validate(source, output)


@pytest.mark.parametrize(
    "change",
    [
        {"station_complex_id": "999"},
        {"station_complex": "Wrong Station"},
        {"borough": "Bronx"},
        {"latitude": "40.8"},
        {"longitude": "-73.5"},
    ],
)
def test_unexpected_station_identity_or_coordinate_join_fails(tmp_path, change):
    with pytest.raises(ValueError, match="reference"):
        run_rows(tmp_path, [dict(BASE, **change)])


def test_small_coordinate_rounding_difference_matches_reference(tmp_path):
    quality, _, _ = run_rows(tmp_path, [dict(BASE, latitude="40.7500004")])
    assert quality["observed_station_hours"] == 1


def test_duplicate_roster_ids_fail(tmp_path):
    row = {field: BASE[field] for field in ROSTER_FIELDS}
    roster = write_csv(tmp_path / "roster.csv", [row, row], ROSTER_FIELDS)
    with pytest.raises(ValueError, match="reference"):
        run_rows(tmp_path, [BASE], roster_path=roster)


def test_inferred_universe_has_explicit_incomplete_reference_warning(tmp_path):
    quality, rows, _ = run_rows(tmp_path, [BASE], roster_path=None)
    assert quality["station_universe_count"] == 1
    assert len(rows) == 720
    assert quality["station_reference"]["source"] == "observed_month_inferred"
    assert any("incomplete" in warning.lower() for warning in quality["warnings"])


def test_sir_and_mislabeled_st_george_are_separate_exclusions(tmp_path):
    sir = dict(
        BASE,
        transit_mode="staten_island_railway",
        station_complex_id="502",
        station_complex="Tompkinsville",
    )
    george = dict(
        BASE, station_complex_id="501", station_complex="St George", borough="Staten Island"
    )
    quality, rows, output = run_rows(tmp_path, [BASE, sir, george])
    assert quality["input_rows"] == 3
    assert quality["aggregate_input_rows"] == 1
    assert quality["excluded_input_rows"] == 2
    assert quality["row_exclusion_counts"] == {"sir_mode": 1, "st_george_501": 1}
    assert all(row["station_complex_id"] in {"100", "101"} for row in rows)
    ledger = read_output(output / "exclusions.csv")
    assert [(row["source_row"], row["reason"]) for row in ledger] == [
        ("2", "sir_mode"),
        ("3", "st_george_501"),
    ]


@pytest.mark.parametrize(
    ("month", "timestamps", "reasons"),
    [
        (
            "2026-03",
            [
                "2026-03-28T00:00:00",
                "2026-03-28T01:00:00",
                "2026-03-28T04:00:00",
                "2026-03-28T05:00:00",
            ],
            ["", "suspect_omny_window", "suspect_omny_window", ""],
        ),
        (
            "2026-08",
            [
                "2026-08-16T20:00:00",
                "2026-08-16T21:00:00",
                "2026-08-16T22:00:00",
                "2026-08-16T23:00:00",
            ],
            ["", "suspect_omny_window", "suspect_omny_window", ""],
        ),
    ],
)
def test_both_suspect_windows_quarantine_inclusive_endpoints(tmp_path, month, timestamps, reasons):
    inputs = [dict(BASE, transit_timestamp=stamp) for stamp in timestamps]
    quality, rows, output = run_rows(tmp_path, inputs, month)
    observed = [row for row in rows if row["observation"] == "true"]
    assert [row["exclusion_reason"] for row in observed] == reasons
    assert [row["model_eligible"] for row in observed] == ["true", "false", "false", "true"]
    assert [row["comparison_eligible"] for row in observed] == ["true", "false", "false", "true"]
    assert sum(float(row["ridership"]) for row in observed) == 40
    assert quality["eligible_station_hours"] == 2
    assert quality["model_quarantine_input_rows"] == 2
    assert {row["reason"] for row in read_output(output / "exclusions.csv")} == {
        "suspect_omny_window"
    }


def test_spring_nonexistent_hour_is_absent_and_whole_transition_date_is_ineligible(tmp_path):
    stamps = [
        "2026-03-08T01:00:00",
        "2026-03-08T02:00:00",
        "2026-03-08T03:00:00",
        "2026-03-09T00:00:00",
    ]
    quality, rows, output = run_rows(
        tmp_path, [dict(BASE, transit_timestamp=stamp) for stamp in stamps], "2026-03"
    )
    assert quality["valid_local_clock_labels"] == 743
    assert quality["station_hour_denominator"] == 1486
    assert not any(row["transit_hour_local"] == "2026-03-08 02:00:00" for row in rows)
    observed = [row for row in rows if row["observation"] == "true"]
    assert [row["model_eligible"] for row in observed] == ["false", "false", "true"]
    assert quality["observed_station_hours"] == 3
    assert quality["row_exclusion_counts"] == {"nonexistent_spring_hour": 1}
    assert quality["input_rows"] == quality["aggregate_input_rows"] + quality["excluded_input_rows"]
    assert {row["reason"] for row in read_output(output / "exclusions.csv")} == {
        "dst_transition_date",
        "nonexistent_spring_hour",
    }


def test_fall_repeated_label_is_single_hour_and_whole_date_ineligible(tmp_path):
    inputs = [
        dict(BASE, transit_timestamp="2026-11-01T01:00:00"),
        dict(BASE, transit_timestamp="2026-11-01T23:00:00"),
        dict(BASE, transit_timestamp="2026-11-02T00:00:00"),
    ]
    quality, rows, _ = run_rows(tmp_path, inputs, "2026-11")
    observed = [row for row in rows if row["observation"] == "true"]
    assert quality["valid_local_clock_labels"] == 720
    assert [row["model_eligible"] for row in observed] == ["false", "false", "true"]
    assert len([row for row in rows if row["transit_hour_local"] == "2026-11-01 01:00:00"]) == 2
    assert all("+" not in row["transit_hour_local"] for row in rows)


def test_output_is_deterministic_and_local_paths_with_apostrophes_are_safe(tmp_path):
    special = tmp_path / "O'Brien"
    special.mkdir()
    source = write_csv(special / "input's.csv", [BASE])
    outputs = []
    for name in ("one", "two"):
        output = special / name
        output.mkdir()
        validate(source, output)
        outputs.append({path.name: path.read_bytes() for path in output.iterdir()})
    assert outputs[0] == outputs[1]


@pytest.mark.parametrize("month", ["2026-9", "2026-13", "../2026-09"])
def test_month_must_be_canonical_and_valid(tmp_path, month):
    with pytest.raises(ValueError, match="month"):
        run_rows(tmp_path, [BASE], month)


def test_station_hour_sum_overflow_is_a_hard_failure(tmp_path):
    inputs = [
        dict(BASE, ridership="1e308"),
        dict(BASE, payment_method="metrocard", ridership="1e308"),
    ]
    with pytest.raises(ValueError, match="sum.*finite"):
        run_rows(tmp_path, inputs)


def test_conflicting_inferred_station_identity_fails(tmp_path):
    inputs = [
        BASE,
        dict(BASE, transit_timestamp="2026-09-01T01:00:00", station_complex="Different Station"),
    ]
    with pytest.raises(ValueError, match="reference"):
        run_rows(tmp_path, inputs, roster_path=None)


def test_reference_name_formatting_can_vary_without_changing_primary_id(tmp_path):
    quality, _, _ = run_rows(
        tmp_path, [dict(BASE, station_complex="  EXAMPLE   Station ", borough="manhattan")]
    )
    assert quality["observed_station_hours"] == 1


@pytest.mark.parametrize(
    "change",
    [
        {"latitude": "NaN"},
        {"longitude": "-181"},
        {"station_complex_id": ""},
        {"station_complex_id": "501"},
        {"station_complex": ""},
    ],
)
def test_invalid_reference_values_fail(tmp_path, change):
    row = {field: BASE[field] for field in ROSTER_FIELDS}
    roster = write_csv(tmp_path / "roster.csv", [dict(row, **change)], ROSTER_FIELDS)
    with pytest.raises(ValueError, match="reference"):
        run_rows(tmp_path, [BASE], roster_path=roster)


def test_empty_monthly_capture_fails(tmp_path):
    with pytest.raises(ValueError, match="no observations"):
        run_rows(tmp_path, [])


def test_missing_local_file_fails_before_any_output(tmp_path):
    with pytest.raises(ValueError, match="local file"):
        validate(tmp_path / "missing.csv", tmp_path)


def test_fractional_category_totals_keep_precision_and_repeatable_source_order(tmp_path):
    inputs = [
        dict(BASE, ridership="0.1", transfers="0"),
        dict(BASE, payment_method="metrocard", ridership="0.2", transfers="0"),
        dict(BASE, payment_method="future_payment", ridership="0.3", transfers="0"),
    ]
    _, rows, _ = run_rows(tmp_path, inputs)
    assert rows[0]["ridership"] == "0.6"


@pytest.mark.parametrize("reverse", [False, True])
def test_category_sum_keeps_small_positive_counts_next_to_large_counts(tmp_path, reverse):
    inputs = [dict(BASE, ridership="10000000000000000", transfers="0")]
    inputs.extend(
        dict(BASE, fare_class_category=f"future_category_{index}", ridership="1", transfers="0")
        for index in range(10)
    )
    if reverse:
        inputs.reverse()
    _, rows, _ = run_rows(tmp_path, inputs)
    assert float(rows[0]["ridership"]) == 10000000000000010.0


def test_both_tram_ids_are_preserved_as_non_subway_exclusions(tmp_path):
    rows = [
        dict(BASE),
        dict(
            BASE,
            transit_mode="tram",
            station_complex_id="TRAM1",
            station_complex="RI Tramway (Manhattan)",
        ),
        dict(
            BASE,
            transit_mode="tram",
            station_complex_id="TRAM2",
            station_complex="RI Tramway (Roosevelt)",
        ),
    ]
    quality, output, directory = run_rows(tmp_path, rows)
    assert quality["input_mode_counts"] == {"subway": 1, "tram": 2}
    assert quality["row_exclusion_counts"] == {"tram_mode": 2}
    assert sum(float(row["ridership"] or 0) for row in output) == 10
    exclusions = read_output(directory / "exclusions.csv")
    assert [row["station_complex_id"] for row in exclusions] == ["TRAM1", "TRAM2"]


def test_negative_transfer_flag_quarantines_entire_hour_without_dropping_entries(tmp_path):
    source = [
        dict(BASE, transfers="-1"),
        dict(BASE, payment_method="metrocard", ridership="5", transfers="1"),
        dict(BASE, transit_timestamp="2026-09-01T01:00:00.000", ridership="7"),
    ]
    quality, rows, output = run_rows(tmp_path, source)
    # The roster also includes an unobserved station, so select this station explicitly.
    observed = [
        row for row in rows if row["station_complex_id"] == "100" and row["observation"] == "true"
    ]
    assert [float(row["ridership"]) for row in observed] == [15, 7]
    assert observed[0]["model_eligible"] == "false"
    assert observed[0]["comparison_eligible"] == "false"
    assert observed[0]["exclusion_reason"] == "negative_transfer"
    assert observed[1]["model_eligible"] == "true"
    assert quality["input_rows"] == quality["aggregate_input_rows"] == 3
    assert quality["excluded_input_rows"] == 0
    assert quality["source_flag_counts"] == {"negative_transfer": 1}
    impact = quality["negative_transfer_quarantine"]
    assert impact["station_hours"] == 1
    assert impact["stations"] == 1
    assert impact["source_rows_at_affected_hours"] == 2
    assert impact["affected_station_hour_ridership"] == 15
    assert impact["flagged_category_ridership"] == 10
    assert quality["comparison_quarantine_row_counts"] == {"negative_transfer": 2}
    flags = read_output(output / "flags.csv")
    assert len(flags) == 1
    assert flags[0]["source_row"] == "1"
    assert flags[0]["flag"] == "negative_transfer"
    assert flags[0]["excluded_from_aggregate"] == "false"
    ledger = read_output(output / "exclusions.csv")
    assert len(ledger) == 2
    assert {row["excluded_from_aggregate"] for row in ledger} == {"false"}
    assert {row["exclusion_scope"] for row in ledger} == {"model_comparison"}


def test_transfer_flags_are_independent_of_mode_exclusions(tmp_path):
    quality, rows, output = run_rows(
        tmp_path, [dict(BASE), dict(BASE, transit_mode="staten_island_railway", transfers="-1")]
    )
    assert quality["input_rows"] == 2
    assert quality["aggregate_input_rows"] == quality["excluded_input_rows"] == 1
    assert quality["source_flag_counts"] == {"negative_transfer": 1}
    assert quality["negative_transfer_quarantine"]["station_hours"] == 0
    assert quality["model_quarantine_input_rows"] == 0
    station = next(row for row in rows if row["station_complex_id"] == "100")
    assert station["ridership"] == "10.0"
    assert station["model_eligible"] == "true"
    assert read_output(output / "flags.csv")[0]["excluded_from_aggregate"] == "true"
    assert read_output(output / "exclusions.csv")[0]["reason"] == "sir_mode"
