# Multi-month mobility pilot

Add month navigation inside the dashboard’s Start date and End date calendars. Start with the
verified August and September 2026 archives. Keep the date range within the
selected month. Preserve the TLC area and camera when switching months. Retain
the selected station if it is still available for that area.

## Data and provenance

Use the existing monthly TLC yellow taxi trip records and the MTA Subway Hourly
Ridership dataset (NY Open Data identifier `5wq4-mkjj`). Capture sources through
the existing ingestion pipeline and retain its manifest, quality reports and
input hashes. A successful capture must reconcile the monthly aggregates before
that month is offered in the dashboard.

Use an index of verified months and one static JSON file per mode per month.
Each file carries its month, timezone, run ID and source hash. The dashboard
derives hourly coverage from the exported counts and gaps. The archive keeps
the detailed quality report. Fetch only the selected month. Ignore late
responses from previous months. Track availability for each mode independently.

The current taxi metric counts in-month dropoffs found in that month's pickup
file. Adjacent pickup files are outside this pilot. Subway counts sum only
comparison-eligible observed station-hours. Keep missing and flagged subway
slots unavailable. Array positions are New York local clock labels, with 24
slots per calendar day. Transition months need their own export contract and
are excluded from the first release.

## Acceptance checks

- Re-export September and compare the existing counts and gaps exactly.
- Reconcile the additional month's manifest hashes, totals and coverage.
- Verify switching between a 30-day and 31-day month, valid calendar endpoints,
  preserved area, station disappearance, and a delayed previous-month response.
- Verify month-specific coverage copy and the existing taxi and subway charts.
  Cross-month ranges, broader historical backfill and forecasting are deferred.

## August feasibility

The August 2026 capture completed with 3,311,363 eligible yellow taxi
dropoffs and 310,376 comparison-eligible station-hours across an observed
roster of 424 subway station complexes. The capture used the official TLC
August yellow taxi file and August observations from NY Open Data
`5wq4-mkjj`. Archive run ID:

`de68b672cfe77db3694436432448e39a44c93c6bd700a0a4a59326d6d6526806`

August has 744 local-clock slots per location, compared with September's
720. Both are ordinary months with no clock transitions.

## Month catalog

The dashboard reads `/data/mobility-months.json` on first open. Each entry
provides a month in `YYYY-MM` format and separate taxi and subway availability
flags. The newest available month opens with the first seven days selected. Calendar
arrows browse published months. The dashboard loads a different month when the
user picks a date in it. The other endpoint keeps its day where possible and
adjusts to keep the range ordered and within the chosen month. The TLC area
stays selected.
Retain the station if it is still among the nearby options. Only load data for
the current month and ignore late responses from earlier selections.

Generate the catalog after exporting and validating the monthly files. The UI
uses the same file naming convention for every month, so publishing a new
month requires data and a refreshed catalog. If an asset fails to load, retain
the other mode and allow a retry. Existing September results serve as a
regression check. Returning to the prior release restores the prior catalog
and its assets together. Regenerate revised assets in a staging checkout and
publish the static build as a unit because this pilot uses stable month URLs.

## Historical and ongoing coverage

- Backfill in batches, starting with the current TLC and MTA formats. Track
  source, date coverage, input checksum, and validation status separately for
  each mode. Publish a month with either mode verified.
- The TLC yellow taxi archive goes back to 2009. Inspect the columns and
  geography at historical boundaries before counting dropoffs by today's TLC
  zones. See the [TLC archive](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page).
  If coordinates need to be mapped, validate the assignment and record
  the boundary version and uncertainty.
- The MTA publishes hourly station-complex data in two datasets, 2020–2024
  (`wujg-7c2s`) and 2025 onward (`5wq4-mkjj`). Confirm the actual first
  observation and validate a sample on both sides of the schema boundary.
  Older turnstile and daily totals have different metrics. See the
  [historical MTA dataset](https://data.ny.gov/Transportation/MTA-Subway-Hourly-Ridership-2020-2024/wujg-7c2s)
  and [current MTA dataset](https://data.ny.gov/d/5wq4-mkjj).
- Define transition-hour handling before extending coverage to March or
  November. Verify the 23-hour and 25-hour days, preserve unavailable slots,
  and document whether the repeated local hour can be distinguished.
- Add a resumable backfill command and then a scheduled job for future source
  releases. Validate and reconcile the new files before updating the catalog.
  Keep a short recheck window for source revisions, publish versioned files
  before switching the catalog, and preserve the last good catalog on failure.
- Keep the first release's date controls within one month. Cross-month
  comparisons can later load only the months needed for the chosen range.
