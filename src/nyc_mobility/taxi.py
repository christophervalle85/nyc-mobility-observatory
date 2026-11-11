"""Validate source-file taxi rows and count destination local clock hours."""

import csv
from pathlib import Path

from .core import connect, month_bounds, write_json

INTEGER_TYPES = {
    "TINYINT",
    "SMALLINT",
    "INTEGER",
    "BIGINT",
    "UTINYINT",
    "USMALLINT",
    "UINTEGER",
    "UBIGINT",
}
TIMESTAMP_TYPES = {"TIMESTAMP", "TIMESTAMP_MS", "TIMESTAMP_NS", "TIMESTAMP_S"}
NUMERIC_TYPES = INTEGER_TYPES | {"FLOAT", "DOUBLE"}


def read_lookup(path: Path) -> list[tuple[int, str, str, str]]:
    result, keys = [], set()
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle, strict=True)
        if reader.fieldnames != ["LocationID", "Borough", "Zone", "service_zone"]:
            raise ValueError("unexpected lookup schema")
        for row in reader:
            if None in row or any(not value or not value.strip() for value in row.values()):
                raise ValueError("lookup has malformed row or missing required label")
            if not row["LocationID"].isdigit():
                raise ValueError("lookup LocationID must be a positive integer")
            key = int(row["LocationID"])
            if not 1 <= key <= 265 or key in keys:
                raise ValueError("lookup LocationID must be unique and in 1..265")
            keys.add(key)
            result.append((key, row["Borough"], row["Zone"], row["service_zone"]))
    if not result:
        raise ValueError("empty lookup")
    return result


def validate_taxi(input_path: Path, lookup_path: Path, output_dir: Path, month: str) -> dict:
    start, end = month_bounds(month)
    if any(character in str(input_path) for character in "*?[]"):
        raise ValueError("taxi input must identify a single local file without glob characters")
    if not input_path.is_file():
        raise ValueError("taxi input must be an existing single local file")
    lookup = read_lookup(lookup_path)
    with connect() as db:
        schema = dict(
            (row[0], row[1])
            for row in db.execute(
                "describe select * from read_parquet(?)", [str(input_path.resolve())]
            ).fetchall()
        )
        contracts = {
            "tpep_pickup_datetime": TIMESTAMP_TYPES,
            "tpep_dropoff_datetime": TIMESTAMP_TYPES,
            "PULocationID": INTEGER_TYPES,
            "DOLocationID": INTEGER_TYPES,
            "trip_distance": NUMERIC_TYPES,
            "total_amount": NUMERIC_TYPES,
        }
        for field, allowed in contracts.items():
            if schema.get(field) not in allowed:
                raise ValueError(f"taxi schema/type mismatch: {field} is {schema.get(field)}")
        db.execute(
            "create table zones (id integer primary key, borough varchar, "
            "zone varchar, service_zone varchar)"
        )
        db.executemany("insert into zones values (?, ?, ?, ?)", lookup)
        db.execute(
            "create table trips as select file_row_number + 1 as source_row, "
            "tpep_pickup_datetime, tpep_dropoff_datetime, PULocationID, DOLocationID, "
            "trip_distance, total_amount from read_parquet(?, file_row_number=true)",
            [str(input_path.resolve())],
        )
        unresolved = db.execute("""
            select count(*) from trips t
            left join zones p on t.PULocationID=p.id left join zones d on t.DOLocationID=d.id
            where (t.PULocationID is not null and t.PULocationID not in (264,265) and p.id is null)
               or (t.DOLocationID is not null and t.DOLocationID not in (264,265) and d.id is null)
        """).fetchone()[0]
        if unresolved:
            raise ValueError(f"unresolved non-sentinel zone IDs in {unresolved} taxi rows")
        db.execute(
            """create table classified as select *,
            tpep_dropoff_datetime is null as null_dropoff,
            tpep_pickup_datetime is null as null_pickup,
            coalesce(tpep_dropoff_datetime < ?::timestamp or
                     tpep_dropoff_datetime >= ?::timestamp, false) as outside_month,
            DOLocationID is null or DOLocationID in (264,265) as unknown_destination,
            PULocationID is null or PULocationID in (264,265) as unknown_origin,
            coalesce(tpep_dropoff_datetime <= tpep_pickup_datetime, false) as non_positive_duration,
            trip_distance is null or not isfinite(trip_distance) or trip_distance <= 0
                as distance_anomaly,
            total_amount is null or not isfinite(total_amount) or total_amount <= 0 as fare_anomaly
            from trips""",
            [start, end],
        )
        db.execute("""create table evaluated as select *,
            (null_dropoff or outside_month or unknown_destination) as excluded
            from classified""")
        flag_names = [
            "null_dropoff",
            "null_pickup",
            "outside_month",
            "unknown_destination",
            "unknown_origin",
            "non_positive_duration",
            "distance_anomaly",
            "fare_anomaly",
        ]
        # Only constant, internal identifiers enter SQL. File paths and timestamps are bound values.
        values = db.execute(
            "select count(*), count(*) filter (where not excluded), "
            + ", ".join(f"count(*) filter (where {name})" for name in flag_names)
            + " from evaluated"
        ).fetchone()
        raw, eligible = values[:2]
        flags = dict(zip(flag_names, values[2:], strict=True))
        db.execute("""create table aggregate_output as select
            date_trunc('hour', tpep_dropoff_datetime) as dropoff_hour_local,
            DOLocationID, count(*)::bigint as trip_count from evaluated where not excluded
            group by 1,2 order by 1,2""")
        if (
            db.execute("select coalesce(sum(trip_count),0) from aggregate_output").fetchone()[0]
            != eligible
        ):
            raise ValueError("taxi aggregate reconciliation failed")
        output_dir.mkdir(parents=True, exist_ok=True)
        db.execute(
            "copy aggregate_output to ? (header, delimiter ',')",
            [str((output_dir / "zone_hour.csv").resolve())],
        )
        reason_sql = ",".join(f"case when {name} then '{name}' end" for name in flag_names)
        db.execute(
            "copy (select source_row, excluded, concat_ws(';', "
            + reason_sql
            + ") as reasons from evaluated where "
            + " or ".join(flag_names)
            + " order by source_row) to ? (header, delimiter ',')",
            [str((output_dir / "row_ledger.csv").resolve())],
        )
        report = {
            "raw_rows": raw,
            "eligible_rows": eligible,
            "excluded_rows": raw - eligible,
            "flags": flags,
            "flag_counts_overlap": True,
            "exclusion_rule": "null dropoff OR outside month OR unknown/outside destination",
            "aggregate_rows": db.execute("select count(*) from aggregate_output").fetchone()[0],
            "duplicate_policy": "retain all source rows; no unique trip identifier",
            "coverage": (
                "Dropoffs covered by this source file, not exhaustive calendar-month dropoffs."
            ),
            "adjacent_pickup_month_files_included": False,
            "timezone": "America/New_York",
            "timestamp_semantics": "local clock labels; no UTC instant or DST fold inferred",
            "source_row_reference": "1-based physical Parquet row number within input asset",
            "inspected_schema": schema,
            "lookup_rows": len(lookup),
        }
        write_json(output_dir / "quality.json", report)
        return report
