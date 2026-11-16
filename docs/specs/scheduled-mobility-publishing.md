# Scheduled mobility publishing

## Release flow

Run a daily GitHub Actions job on the default main branch. The job discovers
one newly available calendar month and uses the existing refresh and archive
validators. An available and validated mode can advance independently. A mode
whose source is missing or fails validation retains its existing published
coverage. A run with nothing new makes no data commit. No approval or dashboard
account is needed for successful runs.

The repository's static dashboard data is the release target. Publish the
catalog and any new mode files together in one ordinary fast-forward commit
to main. Existing data files remain immutable. GitHub owns the workflow and
permissions. This change does not configure a hosting service or production
deployment credentials. A hosted site still needs a deployment that consumes
the data commit.

## Trust boundaries

- The preparation job checks out an exact commit with read access. It calls
  the fixed TLC and MTA sources, writes a local stage, and prepares a small
  release bundle containing only verified additions and the prospective
  catalog. The bundle identifies the exact baseline commit and binds file
  contents to hashes.
- The write job consumes only the artifact from its own run. It rechecks the
  bundle paths, hashes, catalog, existing assets and run bindings before Git
  sees any new files. The release diff may contain only one month's expected
  new mode assets and the catalog. Raw inputs and unrelated files stay out
  of Git.
- Recheck the default branch tip against the prepared baseline. A concurrent
  change supersedes the candidate and requires a fresh run. A normal push
  rejects a race after the check. Keep scheduled runs serialized and allow
  write access only on the trusted main workflow. Do not run untrusted
  pull request code with write access.
- Preserve the source and per-mode result in the workflow report. Validation
  failures or rejected publication surface as a failed run. A good independent
  mode can still publish when its counterpart fails. A maintainer can pause
  the workflow before reverting a data commit so the rejected release is not
  immediately reapplied.

## October acceptance

Use October 2026 subway data from the frozen official pilot with the current
published catalog as the baseline. Run the same release preparation and
publication logic against a disposable Git remote. Verify the commit changes
only the October subway file and catalog, the dashboard can load October
subway with taxi unavailable, and a repeat is a no-op. Test bad hashes,
unexpected paths, existing asset edits and a stale remote tip with isolated
fixtures. Preserve the workspace's published data during the pilot.
