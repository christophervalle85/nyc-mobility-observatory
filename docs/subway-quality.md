# Subway station-hour quality

`validate_subway(input_path, output_dir, month, roster_path=None)` validates an archived monthly CSV and writes `station_hour.csv`, `exclusions.csv`, `flags.csv` and `quality.json` to an existing unpublished staging directory. Invalid inputs raise `ValueError` before any output is written. The pipeline owns input hashes, source queries, runtime versions and atomic publication.

The station-hour table reports MTA entry estimates in the `ridership` field. These estimates do not identify unique riders or destinations. Missing observations remain unknown. Its denominator is a reference station universe crossed with valid New York local clock labels, without a service calendar. Neither a missing label nor an observed zero establishes a closure or the absence of travelers.

## Inputs and hard failures

The monthly CSV must have exactly these columns, in any order:

`transit_timestamp,transit_mode,station_complex_id,station_complex,borough,payment_method,fare_class_category,ridership,transfers,latitude,longitude`

All fields must be present and nonempty. Subway and Staten Island Railway station IDs are positive integer labels. Tram IDs must be `TRAM1` or `TRAM2`. Timestamps accept `YYYY-MM-DDTHH:00:00` or `YYYY-MM-DD HH:00:00`, optionally followed by one to six zero fractional digits. They must be valid dates in the requested local month. Offset or UTC suffixes and non-hour timestamps fail validation.

Ridership, transfers and coordinates must be finite decimal/scientific numeric values. Ridership must be nonnegative, and transfers must be no greater than ridership. Negative transfers are preserved and flagged rather than rejected. Latitude must be within [-90, 90] and longitude within [-180, 180]. Malformed CSV, unexpected columns, invalid values and duplicate compound keys fail the run. The compound key uses the parsed local timestamp, mode, station ID, payment method and fare category; equivalent timestamp spellings cannot hide duplicates.

Supported modes are `subway`, `staten_island_railway` and `tram`. Tram rows receive `tram_mode` and remain outside the subway aggregate. Payment methods and fare categories are open categories. Every returned category in an eligible ordinary subway row contributes to station-hour ridership. Transfers are already included in ridership and are never added to it. Aggregation uses source-ordered compensated floating-point summation to make repeated runs deterministic without imposing a decimal rounding scale. Values remain subject to IEEE-754 double precision; nonfinite aggregate results fail.

The validator reads one existing local file per input. Glob characters are rejected. DuckDB uses an in-memory database, a 4 GiB memory limit and two threads, with extension autoinstallation and autoloading disabled. Paths are query parameters. Source rows stay in DuckDB rather than becoming a list of Python dictionaries.

## Observed-source station reference

The roster CSV has exactly these fields:

`station_complex_id,station_complex,borough,latitude,longitude`

Reference IDs must be unique, positive, non-null and exclude station 501. Every ordinary subway row must match a reference ID, station name, borough and coordinates. Name comparison ignores letter case and surrounding/repeated whitespace; borough comparison ignores case and surrounding whitespace. Coordinates may differ by at most 0.000001 degrees independently in latitude and longitude. Output identity and coordinates come from the reference.

The pipeline derives this roster from the same observed monthly MTA capture. It checks source consistency and does not establish independent station authority, operating dates or scheduled service. It cannot detect stations absent for the entire month. The quality report states the actual number and IDs present, without assuming 424 stations. When no roster is provided, the universe is inferred from this month's ordinary subway rows and the report carries an explicit incomplete-reference warning. Conflicting inferred identities still fail.

Staten Island Railway rows are legitimate observations of a separate mode. They receive `sir_mode` and do not require subway roster membership. Subway-mode station 501 receives `st_george_501`, covering the documented St George misclassification. These exclusions and `tram_mode` retain row references in the ledger and remain outside the ordinary subway universe.

## Negative-transfer handling

Every source row remains in the archived input. A negative transfer value does not remove observed ridership or get replaced with zero. `flags.csv` records each negative-transfer category row, including its source record reference, raw timestamp and station ID, payment/fare keys, numeric ridership/transfers, `flag`, `excluded_from_aggregate` and `station_hour_quarantined`.

For an ordinary subway row otherwise eligible for aggregation, one negative-transfer category makes the entire station-hour comparison- and model-ineligible. All categories and their entry estimates still contribute to that hour's observed total. The cause of the negative source values remains unknown. Negative-transfer flags can also overlap aggregate exclusions; an already excluded mode or station does not create an ordinary subway hour.

The separate `exclusions.csv` ledger contains aggregate exclusions and comparison quarantines. All categories at affected ordinary subway hours appear there, not just the categories with negative transfers. Existing DST or suspect-window reasons take precedence when they overlap; the quality report separately records negative-transfer impact.

## Local clock and comparison eligibility

Source timestamps remain New York local clock labels. No UTC instant or fall DST fold is assigned to an observation. Calendar classification uses the host's `America/New_York` zoneinfo rules. The time-zone database version should be recorded with run provenance, but the current manifest records only Python and DuckDB runtime versions. Calendar-rule provenance remains incomplete.

- Every spring and fall DST transition date is model- and comparison-ineligible.
- The nonexistent spring 02:00 label is absent from the valid denominator and output grid. Any returned input row for it receives `nonexistent_spring_hour` and is excluded from aggregation.
- The repeated fall hour appears once per station as a local clock label. Duplicate source compound keys still fail; the validator never invents two folds.
- Hours 2026-03-28 01:00 through 04:00 inclusive and 2026-08-16 21:00 through 22:00 inclusive receive `suspect_omny_window`. Their observed totals remain visible, with both eligibility flags false.

The calendar denominator is 743 local labels for March 2026, 720 for September 2026 and 720 for November 2026. November's repeated local label does not add an invented observation slot.

## Output dictionary

`station_hour.csv` has one row per `(transit_hour_local, station_complex_id)`, sorted by that key:

- `transit_hour_local`: local clock label, formatted `YYYY-MM-DD HH:00:00`, without offset.
- `station_complex_id`: positive reference station ID.
- `station_complex`, `borough`, `latitude`, `longitude`: reference identity and coordinates in degrees.
- `ridership`: sum of observed category entry estimates for this station-hour. An empty CSV cell is SQL NULL and means unknown. A returned zero stays zero.
- `observation`: true if at least one ordinary subway source row contributes to the station-hour.
- `model_eligible`, `comparison_eligible`: true only for observed, valid local labels outside DST transition dates, the explicit suspect windows and negative-transfer affected station-hours. These flags do not certify service-calendar completeness or downstream model readiness.
- `exclusion_reason`: `missing_observation`, `dst_transition_date`, `suspect_omny_window`, `negative_transfer`, or NULL for an eligible observed hour.

`exclusions.csv` preserves every excluded or quarantined source row, sorted by `source_row`. `source_row` is the one-based data-record index; `csv_record_number` also counts the header. These are record numbers, not physical line numbers when CSV fields contain newlines. The ledger includes the raw timestamp label, mode, station ID, payment/fare keys, ridership and transfers. `reason` distinguishes the exclusions above; `exclusion_scope` distinguishes aggregate exclusions from comparison quarantine. `excluded_from_aggregate` is false for valid observed DST/suspect or negative-transfer affected hours; `excluded_from_model_comparison` is always true. Missing generated station-hours have no source record and appear only in the station-hour table.

`quality.json` reports input counts by mode, mutually exclusive aggregate exclusion counts, comparison quarantine counts, the reference universe, valid calendar labels, observed labels, eligible labels and station-hour counts. Input reconciliation is:

`input_rows = aggregate_input_rows + excluded_input_rows`

`station_hour_denominator = observed_station_hours + missing_station_hours`

Quarantine counts overlap aggregate input rows and must not be added to aggregate exclusions. A header-only exclusion ledger is valid when no source rows need exclusions.

## Remaining validation

Service status is unknown. The M0 Rockaway service reconstruction, independent station/coordinate audit, service-calendar validation and full 21-month audit remain pending. Passing M1 fixtures or one monthly pilot does not complete those checks or establish unqualified completeness.

Run the offline synthetic contract tests with `.venv/bin/python -m pytest tests/test_subway.py`. They cover category arithmetic and precision, missing observations, both suspect windows, spring/fall DST, source/reference failures, mode exclusions and deterministic output with apostrophes in local paths. Separate pipeline tests exercise acquisition and replay contracts. The September pilot completed and offline replays reproduced all nine output hashes. See the [pilot report](reports/m1-pilot.md) for evidence and scope.
