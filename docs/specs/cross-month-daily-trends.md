# Cross-month date ranges and daily trends

Use the existing Start and End calendar popovers to select inclusive dates
across published months. The two endpoints stay independent, and dates that
would reverse the range are disabled. Browsing leaves results in place until
a day is selected. Keep the current calendar layout and map position.

## Monthly data and coverage

Use the existing catalog, payloads, and month-specific validation. Fetch only
published files intersecting the range. Ignore stale work after the range
changes, reuse successful month data during the session, and retry a failed
mode without dropping the other mode. Enforce same-run provenance separately
for each month when both exports are available.

Represent missing days and unavailable station-hours as gaps. Keep observed
zero distinct from missing data. If a daily subway total excludes missing or
flagged hours, identify it as partial and show its coverage when selected.
Summarize each mode's range coverage independently. Preserve the selected
station when available in any month of the range. Months where that station
is absent have no subway count for it.

The existing taxi data still comes from each month's pickup file. Show the
coverage limit and do not imply complete dropoff capture at month boundaries.
A pilot audit of the effect of adjacent pickup files can inform a later
re-export. Historical backfill and new acquisition formats are out of scope.

## Daily trend and hourly detail

Show one date-aligned row of daily bars per mode. Give the modes separate
scales and keep the same date positions so gaps remain visible. Day buttons
support mouse, touch, and keyboard. Choosing a day updates the existing hourly
comparison and Key statistics. Keep the chart date control synchronized as a
second way to choose a day. Keep existing AM/PM labels.

## Verification

- Flatiron across August 29 to September 4 shows independently reconciled
  totals and seven daily points. Choosing September 1 shows its hourly values.
- Calendar arrows still center the month title and disable invalid endpoint
  dates. Same-month one-day ranges work.
- Missing mode files, unlisted months, station absences and partial hours have
  explicit coverage. Stale responses cannot replace the active range.
- Verify keyboard selection, responsive layout and the existing area/map
  controls. Preserve shipped monthly assets so reverting the feature returns
  the previous behavior.
