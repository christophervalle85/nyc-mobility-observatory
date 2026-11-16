# Daylight-saving months

## Scope

Restore the ten March and November months from 2020 through 2024 to the
taxi and subway dashboard. Pilot March and November 2024 using frozen
official TLC and MTA inputs. The other eight months must pass the same
source, calendar and count checks before publication.

## Source behavior

Both sources provide local clock labels. The TLC Parquet timestamp is not
adjusted to UTC, and the MTA hourly timestamp has no offset. The records
cannot distinguish the first occurrence of 1 a.m. in November from the second.

- March 10, 2024 has three eligible TLC records labelled 2 a.m., a time that
  did not occur in New York. The MTA file has no observations for that label.
  Retain the taxi records in the source reconciliation and report them as
  invalid clock labels.
- November 3, 2024 has 10,684 eligible TLC dropoffs and 36,381 estimated
  subway entries recorded under the repeated 1 a.m. label. The MTA file has no
  duplicate hourly fare keys. The archived records do not establish how much
  ridership belongs to each occurrence.

The isolated pilot reconciled the TLC monthly dropoff totals and every
observed MTA station-hour against independent queries on the frozen source
files. The existing MTA comparison eligibility matched for every station-hour.

| Month | TLC eligible source dropoffs | MTA recorded entries | MTA comparison-eligible entries |
| --- | ---: | ---: | ---: |
| March 2024 | 3,551,118 | 101,031,532 | 99,208,602 |
| November 2024 | 3,616,710 | 103,606,445 | 100,986,863 |

## Proposed dashboard contract

Keep 24 local-clock display positions per day and accept existing version 1
assets. Give transition-month assets explicit calendar metadata and distinguish
recorded counts from comparison-eligible counts. The spring 2 a.m. slot
shows “Hour did not occur.” The fall 1 a.m. slot shows the recorded count
and explains that the source does not distinguish the two occurrences.
Keep missing observations distinct from recorded zeros.

The existing MTA validator excludes the whole transition day from comparison.
Preserve that policy and apply the same date exclusion to the taxi subtotal
when comparing the two modes. Show recorded counts with their source
limitations on the day itself. Range coverage should name the excluded date
and count eligible clock slots rather than claiming elapsed-hour coverage.
Ordinary days in these months contribute to totals and charts as usual.

Narrowing the exclusion to one clock slot would show more comparisons but
changes the project's existing treatment of transition dates. Expanding the
arrays to elapsed 23- or 25-hour days would require offsets that the archived
data cannot supply.

## Publication and acceptance

- Reconcile raw, invalid-label, recorded and comparison-eligible totals by mode
  for both pilot months. The fall count appears once in recorded totals.
- Test daylight-saving dates for all five years. Keep ambiguous or invalid
  slots outside comparison coverage. Use the correct New York dates regardless
  of the runner or browser timezone.
- Verify both dates in Chrome with taxi and subway active. Test an adjacent
  ordinary date, a range crossing each transition, and keyboard chart access.
- Preserve established asset validation and mode provenance. Reject unreviewed
  duplicate MTA keys, retain archive hashes and stage files before updating the
  catalog. Leave existing monthly files intact.
- Run the remaining eight months after the pilots pass. Report the exact months
  added and the count or source errors for any month that fails.

## Local run

Use the existing archived MTA complex reference, or pin it with
`backfill_historical_subway.py --pin-reference` from the project root.

```sh
PYTHONPATH=src uv run python web/scripts/backfill_historical_subway.py --publish 2024-03 2024-11
PYTHONPATH=src uv run python web/scripts/backfill_historical_subway.py --publish --clock-change-months
```

The second command skips the pilot pairs once they are published. Each run
reuses completed official captures and publishes a month only after both
exports validate. A month with an unreviewed duplicate fare key stays out of
the catalog and appears in the run report.
