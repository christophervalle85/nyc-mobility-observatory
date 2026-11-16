# M3 automated data refresh preview

## Scope

Discover one newly available calendar month, validate each source that is ready
for that month, and stage a complete preview of the dashboard data. Reuse the
official TLC and MTA discovery, capture, and export contracts. Existing published
data is the read-only baseline. The preview command performs real downloads and
writes local archive and preview files.

This slice ends after a live dry run of one month. Scheduling, publishing to
the dashboard, replacing revised source months, and filling older catalog
gaps are follow-up work.

## Behavior

- Read the latest published month separately for each mode. Select the earliest
  discovered month with a newly eligible mode. Attempt each eligible mode for
  that one calendar month. A later invocation can add a missing counterpart
  when its provider releases the data.
- Distinguish an up-to-date mode, unavailable or partial source evidence,
  failed validation, and a staged result. A discovery or capture failure for
  one mode leaves the other eligible mode able to stage independently.
- Validate source hashes, coverage, and export contracts before creating the
  candidate catalog. Subway observations must reach both calendar edges.
  Preserve observed gaps and transition-hour rules. When two independently
  captured modes share a month, bind their actual run IDs explicitly.
- Require a fresh staging directory separate from the published dashboard and
  its read-only baseline. Reject path aliases and overlapping write locations
  before access to providers. Copy registered assets into the preview and
  preserve their bytes and run bindings. Write the prospective catalog last.
- Report the selected month, per-mode outcome and reason, provider evidence,
  and run or asset identities for successfully staged data. Return failure
  for an attempted mode that fails validation even if another mode was staged.

## Verification

The backend owns selection, runner, archive validation, and stage creation.
Independent QA covers the one-month limit, provider failure and lag, explicit
run binding, and the staging boundary. Check that a successful preview adds
only validated assets, every catalog entry resolves, a second run can reuse
verified captures, and the published catalog and file hashes are unchanged.
Run the one-month pilot against the official sources and retain the report
and generated data locally for inspection.
