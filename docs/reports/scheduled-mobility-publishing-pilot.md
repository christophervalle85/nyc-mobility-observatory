# Scheduled mobility publishing

**Mobility data refresh** is configured to run on Fridays at 10:23 UTC
(`23 10 * * 5`) once the workflow is on the default branch. The MTA dataset
lists a weekly posting frequency. The pilot recorded a Thursday MTA update,
so Friday is a reasonable time to check. TLC normally publishes monthly trip
files after about two months. A release that arrives after a check can wait
until the following Friday. [MTA hourly ridership](https://data.ny.gov/d/5wq4-mkjj) ·
[TLC trip records](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page)
Publishing runs on the default `main` of
`christophervalle85/nyc-mobility-observatory` on schedule or when a manual
run opts in. A successful release uses an ordinary fast-forward data commit
with no separate approval or pull request. The commit contains the catalog and validated additions for at most
one completed New York calendar month. Raw source files and archives stay in
the runner's temporary directory. See the [workflow](../../.github/workflows/mobility-refresh.yml).

The repository had no hosted site configured for the pilot. The workflow
publishes to GitHub `main`. A hosted dashboard requires a separate deployment.
GitHub skips push-triggered Actions workflows and Pages builds for a commit
pushed with the repository's `GITHUB_TOKEN`. [GitHub token behavior](https://docs.github.com/en/actions/concepts/security/github_token)

## Run and inspect

In GitHub, open **Actions**, select **Mobility data refresh**, and choose
**Run workflow** on `main` to check a candidate on demand. Leave **Publish now**
unchecked to preview and test the candidate. Select it to publish automatically
once the checks pass. The pause variable applies to
both scheduled and manual publishing. Check the run summary for each
mode's outcome, and download the `mobility-refresh-report-<attempt>` artifact
for details. When a candidate passes, the
`mobility-release-bundle-<attempt>` artifact contains the catalog, new mode
files and their manifest. [GitHub manual runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

A run with no new validated data creates no commit. One mode can publish even
if its counterpart fails. In that case the run is marked failed after the
verified mode is published. Check the report and `main` before deciding
whether to retry. If `main` advanced after preparation, the workflow rejects the
stale candidate. The next scheduled run prepares against the new tip.

## Pause and roll back

1. Under **Settings**, open **Secrets and variables**, then **Actions** and
   the **Variables** tab. Set the repository variable
   `MOBILITY_AUTO_PUBLISH_PAUSED` to `true`. Cancel any in-progress refresh and
   check the current `main` tip. [GitHub repository variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables#creating-configuration-variables-for-a-repository)
2. On an up-to-date checkout of `main`, use `git revert COMMIT_SHA` with the
   data commit's SHA. Check that the revert restores the intended catalog
   entries and mode files, then publish the revert to `main`.
3. Fix the candidate and check it with a manual run before removing the
   pause variable. The next scheduled run can rediscover the reverted month,
   so leave the pause in place until the fix is ready.

## October 2026 pilot

- The frozen official MTA export supplied 424 station complexes and 311,899
  comparable station-hours. The [capture report](automated-data-refresh-pilot.md)
  records the independent source reconciliation.
- The final release was prepared, applied and pushed normally to a disposable
  bare Git repository as `f8ab202`. The commit changed only
  `web/public/data/subway-2026-10.json` and `web/public/data/mobility-months.json`.
  Both files matched the build tested in Chrome byte for byte. All 252
  published data files in the working repository kept their original hashes.
  A repeat refresh found no new data. The publisher rejected changed Git index
  bytes and a stale remote tip. Release tests cover current and future months.
- Chrome loaded the fresh build. For Flatiron's **14 St/6 Av** station complex
  (601), the dashboard showed 267,989 estimated entries over October 1 through
  7 and 682 at midnight on October 1. October taxi data was unavailable.
- In the disposable clone, `git revert` restored the original catalog and
  removed the October asset.

The pilot passed 151 core Python tests, 83 web script tests including all 12
release tests, and 163 web tests. One web script test was skipped because its
historical fixture was absent. TypeScript, Ruff, the build, workflow YAML and
Bash syntax checks passed. The pilot exercised the local release path. A run
on GitHub Actions remains unverified.
