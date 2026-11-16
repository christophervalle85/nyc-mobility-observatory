# October 2026 data refresh pilot

The November 16 dry run staged October 2026 subway data from the official MTA
hourly ridership export (`5wq4-mkjj`). TLC's yellow taxi index listed files through
September 2026 at the time of the run, so the prospective October catalog entry
offers subway only. [MTA hourly ridership](https://data.ny.gov/d/5wq4-mkjj) ·
[TLC trip records](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page)

## Inspect the stage

The final preview data and report are in the ignored
`.data/refresh-preview-2026-10-verified/` directory. The archive is
`.data/refresh-pilot-archive/`. Read `refresh-result.json` for the selected month,
baseline watermarks, source evidence and the outcome for each mode. The subway
outcome was `staged` and taxi was `unavailable`. A provider that exposes only
part of a month can report `partial`. `up-to-date` means the source offers no
eligible month beyond that mode's published watermark. `already-published`
identifies a mode present in the baseline for the selected month.
`outside-refresh-window` identifies an older gap. `discovery-failed` and
`failed` return a nonzero exit code for discovery or capture and validation
errors. A dry run that finds no candidate leaves the stage path unused.
Rejected subway captures stay in the archive for inspection. Later runs can
skip a previously rejected capture and check the provider again.

The stage holds the candidate catalog and aggregate JSON. To inspect them in the
dashboard, use a token-free `npm run dev:verify` preview with the staged catalog
and assets. The pilot used Playwright to serve
`/data/mobility-months.json` and `/data/subway-2026-10.json` from the stage while
the rest of the page came from the regular local preview. Open
`/?mode=mock&zone=90`, select **Mobility data**, set October 1 through 7, and choose
**14 St/6 Av** (station complex 601). See the [refresh command](../../README.md#stage-one-monthly-refresh).

## Observed results

- The official CSV contained 1,547,783 source rows. The staged export contains
  424 station complexes and 311,899 comparable station-hours. An independent
  SQL check on the official CSV reconciled to 123,972,640 estimated entries.
- Chrome showed 267,989 estimated entries for station complex 601 over
  October 1 through 7 and 682 for the October 1 midnight hour. The final stage
  showed the same values. Chrome requested no October taxi asset.
- All 252 published data files retained their starting SHA-256 hashes through
  the final run.
- The first two runs used the same archive and run ID, and produced identical
  subway and catalog files. The final validation used updated code and recorded
  a new run ID. The catalog bytes, source hash and staged station counts matched
  the earlier run. The generated report records the snapshot, source and asset
  hashes for the final stage.
- With `capture_mta` blocked, replaying the archived capture reproduced the
  final subway export and catalog byte for byte. The published hashes still
  matched the baseline.

The final checks passed 151 core Python tests, 71 web script tests including all
12 refresh tests, and 163 web tests. One web script test was skipped because its
frozen M1 fixture was absent. Ruff lint and format checks, TypeScript, and the
token-free build passed.

Dashboard publication, scheduling and revision handling remain follow-up work.
See the [refresh specification](../specs/automated-data-refresh.md).
