# M1 data dictionary

All derived timestamps are America/New_York local clock labels, not UTC instants.
No DST fold or nonexistent instant is invented. Sources and hashes are in manifest.json.

- taxi/zone_hour.csv: one row per (dropoff_hour_local, DOLocationID). trip_count is an
  integer source-file trip-row count, including apparent duplicates. Only recognized
  ordinary destination zones and in-month non-null dropoffs count. Adjacent pickup-month
  files are not included, so this is not exhaustive calendar-month dropoff coverage.
- taxi/row_ledger.csv: source_row is the 1-based physical Parquet row; excluded is the
  unique destination/dropoff exclusion decision; reasons is a semicolon-separated set.
  Flags overlap. Unknown origin, null pickup, nonpositive duration, and distance/fare
  anomalies do not remove an otherwise valid dropoff. Distance/fare anomalies mean
  null, nonfinite or nonpositive trip_distance (miles) / total_amount (USD).
- subway/station_hour.csv: observed station-hour entry estimates in the ridership
  field, summed across payment/fare categories. These are not unique riders or
  destinations; transfers are never added. Missing hours are unknown, not generated zeroes.
  Consult subway/quality.json and exclusions for DST and suspect-window eligibility.
- quality.json: row reconciliations, overlapping flags, coverage limitations and audit state.
  The monthly observed-source station reference is not independent station authority
  or a service calendar and cannot detect stations absent for the entire month.
- manifest.json: frozen input hashes/provenance, code/runtime contract, output hashes.
  snapshot is a portable sha256:<digest> reference to the archived snapshot bytes.
  Locate it as snapshots/<digest>.json under the selected data root. The historical
  absolute path is operational.snapshot_path and may be stale after relocation.
  HTTP Last-Modified is response metadata, never asserted to be source publication date.
  Runtime identity currently includes Python and DuckDB versions, but does not
  record the time-zone database version required for calendar-rule provenance.

Full 21-month M0 audit, independent station/coordinate audit and service-calendar
validation remain pending. This bounded M1 pilot does not certify them.
