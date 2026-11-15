# Automatic historical backfill

Discover months from the [TLC yellow taxi index](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page)
and the [historical](https://data.ny.gov/d/wujg-7c2s) and
[current](https://data.ny.gov/d/5wq4-mkjj) MTA hourly datasets. Use the existing local pipeline, retain frozen inputs and quality
reports, and publish the same monthly JSON consumed by the calendar. Process
newest eligible months first and test a bounded batch before extending it.
A repeat invocation reuses completed validated files and frozen snapshots.

Only published, compatible source formats are eligible. Keep uncovered months
and failed captures distinguishable from zero. Log source, outcome and reason
per month, and continue after an isolated failure. Current exports exclude
daylight-saving transition months pending an explicit representation. Older
taxi files without compatible zone IDs require a separate verified adapter.
Taxicab totals retain their pickup-file coverage limit.

Use fixed official origins and dataset IDs, bounded responses, and the existing
archive verification. A discovery result is only a candidate. Validate monthly
exports in staging, retain the last good catalog, and add the catalog entry
only after assets are in place. Preserve existing files and avoid replacing
a published month in this append-only workflow. Raw archives stay local.
No scheduler or external deployment is required.

Verify discovery filters and source boundaries, resume after interruption,
retries without overwrites, month-by-month rejection, and real August/September
and newly captured pilot counts. Report observed source and dashboard limits.

## Pilot evidence

- Live discovery on November 15, 2026 returned 204 TLC links and 214 source months before applying the taxi format boundary. The current MTA dataset showed coverage through October. The
  historical dataset's grouped query timed out, so discovery used its observed
  January 2020 through December 2024 span. These are candidates. Subway exports
  from the span must have observations on the first and last days of each month.
- May, June and July 2026 were validated from frozen official files. Both
  exports for each month replayed byte-for-byte and the catalog rebuilt
  identically. A repeat batch skipped all three already published months.
- Flatiron showed 2,799 taxi dropoffs over June 30–July 1 in Chrome. Clicking
  July 1 changed the midnight count from 37 to 33.
- All 24 TLC Parquet footers from 2009–2010 use coordinates. January 2011
  has zone IDs and timestamps, so discovery reports the coordinate files as
  requiring a separate adapter. Each month from 2011 still needs validation.
