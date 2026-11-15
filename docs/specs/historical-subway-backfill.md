# Historical subway backfill

## Scope

Add 2020–2024 MTA subway entry estimates to the existing taxi comparison.
Qualify October 2022, December 2022, and December 2024 first, then process the
other ordinary months. The current 24-slot local-clock format excludes March
and November. A daylight-saving export change is outside this backfill.

## Pilot evidence

The archived inputs are official MTA hourly files from dataset `wujg-7c2s`.
Each pilot month had 27 station complexes with multiple source coordinate pairs,
stable names and boroughs within each complex, and zero duplicate hourly
fare-category keys. The largest measured spread was approximately 435 metres.

| Month | Comparable entries | Observed complex-hours | Missing complex-hours |
| --- | ---: | ---: | ---: |
| October 2022 | 95,493,810 | 308,529 | 6,927 |
| December 2022 | 92,386,999 | 310,351 | 5,105 |
| December 2024 | 104,952,378 | 311,604 | 3,852 |

The isolated experiment changed only display coordinates in a temporary copy.
The existing validator reconciled every observed complex-hour, including its
comparison eligibility, against independent aggregation from the archived
source. Direct MTA queries confirmed Court Square and Bryant Park–5 Avenue
samples in October 2022 and December 2024. The December 2022 API query timed
out, so that month has archived-source reconciliation.

## Proposed implementation

Use the MTA complex ID and existing hourly fare-category key for validation and
aggregation. Preserve the raw CSV, source version and hashes. Keep duplicate
rejection, count and transfer checks, quarantine rules, and missing-hour
semantics. Validate finite source coordinates and record each observed pair,
its complex ID and spread in the historical quality report. Review any
identity conflict or coordinate cluster inconsistent with the reference.

Pin a verified snapshot of the
[MTA station-complex reference](https://data.ny.gov/d/5f5g-n3cz) for display.
Match validated IDs and boroughs and review naming aliases. Confirm the
reference provides a unique, plausible point for each affected complex.
Review historical IDs absent from the reference before approving an observed
point as a fallback. A month is publishable only after its observed complex
IDs have validated display points. This keeps a stable marker when users
switch months. The reference supplies no ridership observations.

Add historical subway through a separate, resumable validated run. Extend the
catalog to record the expected run ID for each historical mode and validate each
loaded asset against the catalog. Keep the current matching-run check for
older catalog entries without independent provenance. Existing taxi files
remain byte-for-byte intact. Stage all assets and publish the catalog last.
On failure, preserve the previous catalog and record the reason per month.

## Acceptance

- The three real pilot months reproduce the archived complex-hour totals,
  comparison eligibility and missing slots. Spot checks reconcile to MTA
  responses where available.
- Shuffling input preserves display points and counts. Duplicate keys,
  inconsistent identity, invalid coordinates and invalid source versions
  still fail validation. Raw source bytes remain intact.
- A pilot rerun from frozen inputs produces the same aggregate bytes.
- The dashboard displays both modes for a historical month, carries a selected
  complex across adjacent months where available, and rejects asset provenance
  mismatches. Verify a comparison that spans December 2024 and January 2025.
- Once the pilot passes, backfill from the pinned source and report exactly
  which of the 50 ordinary months validated or failed. Leave the ten
  daylight-saving transition months out of the catalog.

## Local replay

From the repository root, pin the official complex reference once, then run
the three pilot months. The reference snapshot is retained under `.data`.

```sh
PYTHONPATH=src uv run python web/scripts/backfill_historical_subway.py --pin-reference
PYTHONPATH=src uv run python web/scripts/backfill_historical_subway.py 2022-10 2022-12 2024-12
```

Pass `--publish` to add validated subway files to the catalog. Omit the
month arguments to validate all 50 supported months. Each completed capture
and validation run is reusable, so the same command can resume a partial
run. The report lists individual failures and the process returns a
nonzero status if any requested month fails. Prior taxi exports are
verified again when the updated catalog is built.

The display reference requires a matching complex ID and borough. Name
differences require an explicit reviewed alias. The historical validator
also checks that each source point lies within 300 metres of its pinned
point and that the observed cluster is at most 500 metres across.
