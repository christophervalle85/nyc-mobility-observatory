"""Validate a local MTA capture and preserve unknown station-hour observations."""

from __future__ import annotations

import csv
import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import duckdb

_SOURCE_FIELDS = (
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
)
_ROSTER_FIELDS = ("station_complex_id", "station_complex", "borough", "latitude", "longitude")
_COORDINATE_TOLERANCE = 0.000001
_NUMERIC = r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?"
_TIMESTAMP = r"[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:00:00(?:\.0{1,6})?"


def _month_grid(month: str) -> tuple[datetime, datetime, list[tuple[datetime, bool, bool]]]:
    if not isinstance(month, str) or re.fullmatch(r"[0-9]{4}-[0-9]{2}", month) is None:
        raise ValueError("month must be a valid YYYY-MM local month")
    try:
        start = datetime.strptime(month, "%Y-%m")
        end = (
            start.replace(year=start.year + 1, month=1)
            if start.month == 12
            else start.replace(month=start.month + 1)
        )
    except ValueError as exc:
        raise ValueError("month must be a valid YYYY-MM local month") from exc
    zone = ZoneInfo("America/New_York")
    labels: list[tuple[datetime, bool, bool]] = []
    transition_dates = set()
    hour = start
    while hour < end:
        early = hour.replace(tzinfo=zone, fold=0)
        late = hour.replace(tzinfo=zone, fold=1)
        if early.utcoffset() != late.utcoffset():
            transition_dates.add(hour.date())
        valid = early.astimezone(UTC).astimezone(zone).replace(tzinfo=None) == hour
        labels.append((hour, valid, False))
        hour += timedelta(hours=1)
    return start, end, [(hour, valid, hour.date() in transition_dates) for hour, valid, _ in labels]


def _local_file(path: Path, label: str) -> Path:
    path = Path(path)
    if any(character in str(path) for character in "*?[]"):
        raise ValueError(f"{label} must identify one local file without glob characters")
    if not path.is_file():
        raise ValueError(f"{label} must be an existing local file")
    return path.resolve()


def _load_csv(
    connection: duckdb.DuckDBPyConnection, path: Path, fields: tuple[str, ...], table: str
) -> None:
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            header = next(csv.reader(handle, strict=True), None)
    except (csv.Error, UnicodeError) as exc:
        raise ValueError(f"{table} CSV header is malformed") from exc
    if header is None or len(header) != len(fields) or set(header) != set(fields):
        raise ValueError(f"{table} schema must contain exactly: {', '.join(fields)}")
    # Identifiers and column types are fixed by this module. User paths are parameters.
    columns = "{" + ", ".join(f"'{field}': 'VARCHAR'" for field in header) + "}"
    connection.execute(
        f"CREATE TABLE {table} AS SELECT row_number() OVER () AS source_row, * "
        f"FROM read_csv(?, columns={columns}, header=true, auto_detect=false, "
        "delim=',', quote='\"', escape='\"', strict_mode=true, null_padding=false, "
        "parallel=false, max_line_size=1048576)",
        [str(path)],
    )


def _count(
    connection: duckdb.DuckDBPyConnection, query: str, parameters: list[object] | None = None
) -> int:
    row = connection.execute(query, parameters or []).fetchone()
    assert row is not None
    return int(row[0])


def _require_no_rows(
    connection: duckdb.DuckDBPyConnection, predicate: str, message: str, table: str = "typed"
) -> None:
    if _count(connection, f"SELECT count(*) FROM {table} WHERE {predicate}"):
        raise ValueError(message)


def _reference(connection: duckdb.DuckDBPyConnection, roster_path: Path | None) -> None:
    if roster_path is not None:
        _load_csv(
            connection,
            _local_file(roster_path, "station reference"),
            _ROSTER_FIELDS,
            "reference_raw",
        )
        connection.execute(
            "CREATE TABLE reference AS SELECT *, "
            "try_cast(station_complex_id AS BIGINT) AS station_id, "
            "try_cast(latitude AS DOUBLE) AS latitude_value, "
            "try_cast(longitude AS DOUBLE) AS longitude_value FROM reference_raw"
        )
        connection.execute("DROP TABLE reference_raw")
    else:
        connection.execute(
            "CREATE TABLE reference AS SELECT station_id, "
            "min(station_complex_id) AS station_complex_id, "
            "min(station_complex) AS station_complex, "
            "min(borough) AS borough, min(latitude_value) AS latitude_value, "
            "min(longitude_value) AS longitude_value, min(latitude) AS latitude, "
            "min(longitude) AS longitude FROM typed "
            "WHERE transit_mode='subway' AND station_id<>501 GROUP BY station_id"
        )
    if _count(connection, "SELECT count(*) FROM reference") == 0:
        raise ValueError("station reference has no ordinary subway stations")
    _require_no_rows(
        connection,
        "station_id IS NULL OR station_id<=0 OR station_id=501 "
        "OR NOT regexp_full_match(station_complex_id, '[0-9]+') "
        "OR station_complex IS NULL OR length(trim(station_complex))=0 "
        "OR borough IS NULL OR length(trim(borough))=0 "
        f"OR latitude IS NULL OR NOT regexp_full_match(latitude, '{_NUMERIC}') "
        f"OR longitude IS NULL OR NOT regexp_full_match(longitude, '{_NUMERIC}') "
        "OR latitude_value IS NULL OR longitude_value IS NULL "
        "OR NOT isfinite(latitude_value) OR NOT isfinite(longitude_value) "
        "OR latitude_value NOT BETWEEN -90 AND 90 OR longitude_value NOT BETWEEN -180 AND 180",
        "station reference has invalid identity or coordinates",
        "reference",
    )
    if _count(
        connection,
        "SELECT count(*) FROM (SELECT station_id FROM reference GROUP BY "
        "station_id HAVING count(*)>1)",
    ):
        raise ValueError("station reference contains duplicate station IDs")
    _require_no_rows(
        connection,
        "transit_mode='subway' AND station_id<>501 AND ("
        "NOT EXISTS (SELECT 1 FROM reference r WHERE typed.station_id=r.station_id "
        "AND regexp_replace(lower(trim(typed.station_complex)), '\\s+', ' ', 'g')="
        "regexp_replace(lower(trim(r.station_complex)), '\\s+', ' ', 'g') "
        "AND lower(trim(typed.borough))=lower(trim(r.borough)) "
        f"AND abs(typed.latitude_value-r.latitude_value)<={_COORDINATE_TOLERANCE} "
        f"AND abs(typed.longitude_value-r.longitude_value)<={_COORDINATE_TOLERANCE}))",
        "subway station identity or coordinates do not match the observed-source reference",
    )


def validate_subway(
    input_path: Path,
    output_dir: Path,
    month: str,
    roster_path: Path | None = None,
) -> dict:
    """Write deterministic local-clock tables in an unpublished caller-owned directory.

    Invalid schemas, values, keys or reference joins raise ValueError before any
    output is written. The caller owns atomic publication and raw-file provenance.
    """
    start, end, grid = _month_grid(month)
    input_path = _local_file(input_path, "MTA input")
    output_dir = Path(output_dir)
    if not output_dir.is_dir():
        raise ValueError("output_dir must be an existing unpublished staging directory")
    connection = duckdb.connect(
        ":memory:",
        config={
            "memory_limit": "4GiB",
            "threads": "2",
            "autoinstall_known_extensions": "false",
            "autoload_known_extensions": "false",
            "preserve_insertion_order": "true",
        },
    )
    try:
        _load_csv(connection, input_path, _SOURCE_FIELDS, "raw")
        input_rows = _count(connection, "SELECT count(*) FROM raw")
        if input_rows == 0:
            raise ValueError("MTA monthly input contains no observations")
        connection.execute(
            "CREATE TABLE typed AS SELECT *, try_cast(transit_timestamp AS TIMESTAMP) AS ts, "
            "try_cast(station_complex_id AS BIGINT) AS station_id, "
            "try_cast(ridership AS DOUBLE) AS ridership_value, "
            "try_cast(transfers AS DOUBLE) AS transfers_value, "
            "try_cast(latitude AS DOUBLE) AS latitude_value, "
            "try_cast(longitude AS DOUBLE) AS longitude_value FROM raw"
        )
        connection.execute("DROP TABLE raw")
        required = " OR ".join(
            f"{field} IS NULL OR length(trim({field}))=0" for field in _SOURCE_FIELDS
        )
        _require_no_rows(
            connection,
            required,
            "MTA required fields and compound keys must be non-null and nonempty",
        )
        _require_no_rows(
            connection,
            f"NOT regexp_full_match(transit_timestamp, '{_TIMESTAMP}') OR ts IS NULL "
            "OR ts<>date_trunc('hour', ts)",
            "MTA timestamps must be valid hourly New York local clock labels "
            "without timezone offsets",
        )
        if _count(connection, "SELECT count(*) FROM typed WHERE ts<? OR ts>=?", [start, end]):
            raise ValueError("MTA timestamps must lie in the requested local month")
        _require_no_rows(
            connection,
            "transit_mode NOT IN ('subway', 'staten_island_railway', 'tram')",
            "MTA transit_mode is unsupported",
        )
        _require_no_rows(
            connection,
            "(transit_mode<>'tram' AND (station_id IS NULL OR station_id<=0 OR NOT "
            "regexp_full_match(station_complex_id, '[0-9]+'))) OR "
            "(transit_mode='tram' AND station_complex_id NOT IN ('TRAM1', 'TRAM2'))",
            "MTA rail station IDs must be positive integers; tram IDs must be TRAM1 or TRAM2",
        )
        for metric in ("ridership", "transfers", "latitude", "longitude"):
            _require_no_rows(
                connection,
                f"NOT regexp_full_match({metric}, '{_NUMERIC}') OR {metric}_value IS NULL "
                f"OR NOT isfinite({metric}_value)",
                f"MTA {metric} must be a finite number",
            )
        _require_no_rows(
            connection,
            "ridership_value<0 OR transfers_value<0 OR transfers_value>ridership_value",
            "MTA ridership and transfers must be nonnegative with transfers<=ridership",
        )
        _require_no_rows(
            connection,
            "latitude_value NOT BETWEEN -90 AND 90 OR longitude_value NOT BETWEEN -180 AND 180",
            "MTA coordinates are out of range",
        )
        if _count(
            connection,
            "SELECT count(*) FROM (SELECT ts, transit_mode, "
            "CASE WHEN transit_mode='tram' THEN station_complex_id ELSE station_id::VARCHAR END, "
            "payment_method, fare_class_category "
            "FROM typed GROUP BY ALL HAVING count(*)>1)",
        ):
            raise ValueError("MTA contains duplicate compound keys; no deduplication is permitted")
        _reference(connection, roster_path)
        connection.execute(
            "CREATE TABLE clock (hour_local TIMESTAMP, valid BOOLEAN, transition_date BOOLEAN)"
        )
        connection.executemany("INSERT INTO clock VALUES (?, ?, ?)", grid)
        connection.execute(
            "CREATE TABLE classified AS SELECT typed.*, clock.valid, clock.transition_date, "
            "CASE WHEN transit_mode='staten_island_railway' THEN 'sir_mode' "
            "WHEN transit_mode='tram' THEN 'tram_mode' "
            "WHEN station_id=501 THEN 'st_george_501' "
            "WHEN NOT clock.valid THEN 'nonexistent_spring_hour' ELSE NULL END AS row_exclusion, "
            "CASE WHEN NOT clock.valid THEN 'nonexistent_spring_hour' "
            "WHEN clock.transition_date THEN 'dst_transition_date' "
            "WHEN ts BETWEEN TIMESTAMP '2026-03-28 01:00:00' AND TIMESTAMP '2026-03-28 04:00:00' "
            "OR ts BETWEEN TIMESTAMP '2026-08-16 21:00:00' AND TIMESTAMP '2026-08-16 22:00:00' "
            "THEN 'suspect_omny_window' ELSE NULL END AS comparison_quarantine "
            "FROM typed JOIN clock ON typed.ts=clock.hour_local"
        )
        connection.execute("DROP TABLE typed")
        connection.execute(
            "CREATE TABLE observed AS SELECT ts, station_id, "
            "fsum(ridership_value ORDER BY source_row) AS ridership, "
            "min(comparison_quarantine) AS quarantine FROM classified "
            "WHERE row_exclusion IS NULL GROUP BY ts, station_id"
        )
        _require_no_rows(
            connection,
            "NOT isfinite(ridership)",
            "MTA station-hour ridership sum is not finite",
            "observed",
        )
        connection.execute(
            "CREATE TABLE station_hours AS SELECT clock.hour_local AS transit_hour_local, "
            "r.station_id AS station_complex_id, r.station_complex, r.borough, "
            "r.latitude_value AS latitude, r.longitude_value AS longitude, observed.ridership, "
            "observed.station_id IS NOT NULL AS observation, "
            "observed.station_id IS NOT NULL AND NOT clock.transition_date AND "
            "observed.quarantine IS NULL AS model_eligible, "
            "observed.station_id IS NOT NULL AND NOT clock.transition_date AND "
            "observed.quarantine IS NULL AS comparison_eligible, "
            "CASE WHEN observed.station_id IS NULL THEN 'missing_observation' "
            "ELSE observed.quarantine END AS exclusion_reason "
            "FROM clock CROSS JOIN reference r LEFT JOIN observed "
            "ON observed.ts=clock.hour_local AND observed.station_id=r.station_id WHERE clock.valid"
        )
        row_exclusion_counts = dict(
            connection.execute(
                "SELECT row_exclusion, count(*) FROM classified WHERE "
                "row_exclusion IS NOT NULL GROUP BY row_exclusion ORDER BY row_exclusion"
            ).fetchall()
        )
        quarantine_counts = dict(
            connection.execute(
                "SELECT comparison_quarantine, count(*) FROM classified WHERE "
                "row_exclusion IS NULL "
                "AND comparison_quarantine IS NOT NULL GROUP BY "
                "comparison_quarantine ORDER BY comparison_quarantine"
            ).fetchall()
        )
        excluded_rows = sum(row_exclusion_counts.values())
        universe = _count(connection, "SELECT count(*) FROM reference")
        observed_count = _count(connection, "SELECT count(*) FROM station_hours WHERE observation")
        valid_labels = sum(valid for _, valid, _ in grid)
        quality = {
            "contract_version": "m1-subway-v1",
            "month": month,
            "timezone": "America/New_York",
            "timestamp_semantics": "local_clock_label_no_utc_or_fold",
            "input_rows": input_rows,
            "input_mode_counts": dict(
                connection.execute(
                    "SELECT transit_mode, count(*) FROM classified GROUP BY "
                    "transit_mode ORDER BY transit_mode"
                ).fetchall()
            ),
            "aggregate_input_rows": input_rows - excluded_rows,
            "excluded_input_rows": excluded_rows,
            "row_exclusion_counts": row_exclusion_counts,
            "comparison_quarantine_row_counts": quarantine_counts,
            "model_quarantine_input_rows": sum(quarantine_counts.values()),
            "station_universe_count": universe,
            "station_universe_ids": [
                row[0]
                for row in connection.execute(
                    "SELECT station_id FROM reference ORDER BY station_id"
                ).fetchall()
            ],
            "station_reference": {
                "source": "versioned_observed_source_roster"
                if roster_path is not None
                else "observed_month_inferred",
                "independent_authority": False,
                "coordinate_absolute_tolerance_degrees": _COORDINATE_TOLERANCE,
            },
            "valid_local_clock_labels": valid_labels,
            "invalid_local_clock_labels": len(grid) - valid_labels,
            "observed_local_clock_labels": _count(
                connection, "SELECT count(DISTINCT ts) FROM observed"
            ),
            "eligible_local_clock_labels": _count(
                connection,
                "SELECT count(DISTINCT transit_hour_local) FROM station_hours "
                "WHERE comparison_eligible",
            ),
            "station_hour_denominator": universe * valid_labels,
            "observed_station_hours": observed_count,
            "missing_station_hours": universe * valid_labels - observed_count,
            "eligible_station_hours": _count(
                connection, "SELECT count(*) FROM station_hours WHERE model_eligible"
            ),
            "service_status": "unknown",
            "service_calendar_validation": "pending",
            "full_21_month_audit": "pending",
            "warnings": [
                "The observed-source station reference is not independent "
                "station authority or a service calendar.",
                "Missing station-hours are unknown observations; they do not "
                "establish closure or zero travelers.",
                "M0 Rockaway service reconstruction and the full 21-month audit remain pending.",
                *(
                    []
                    if roster_path is not None
                    else [
                        "Incomplete reference: the station universe is "
                        "inferred only from this observed month."
                    ]
                ),
            ],
        }
        # Every validation and aggregate check completes before caller-owned staging is written.
        connection.execute(
            "COPY (SELECT * FROM station_hours ORDER BY transit_hour_local, station_complex_id) "
            "TO ? (FORMAT CSV, HEADER true, NULL '')",
            [str(output_dir / "station_hour.csv")],
        )
        connection.execute(
            "COPY (SELECT source_row, source_row+1 AS csv_record_number, "
            "transit_timestamp, transit_mode, "
            "station_complex_id, payment_method, "
            "fare_class_category, ridership_value AS ridership, "
            "transfers_value AS transfers, coalesce(row_exclusion, "
            "comparison_quarantine) AS reason, "
            "row_exclusion IS NOT NULL AS excluded_from_aggregate, true AS "
            "excluded_from_model_comparison "
            "FROM classified WHERE row_exclusion IS NOT NULL OR "
            "comparison_quarantine IS NOT NULL ORDER BY source_row) "
            "TO ? (FORMAT CSV, HEADER true, NULL '')",
            [str(output_dir / "exclusions.csv")],
        )
        (output_dir / "quality.json").write_text(
            json.dumps(quality, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
        return quality
    except duckdb.Error as exc:
        raise ValueError(f"MTA CSV or local validation query failed: {exc}") from exc
    finally:
        connection.close()
