# NYC Mobility Observatory

The city-stage prototype opens on the Midtown skyline with continuous Google
Photorealistic 3D Tiles through Cesium ion when configured. Search and select
local TLC areas, use **Zoom to area** to move the camera, or select **Show all NYC**
to frame the five boroughs. The **Transportation data** dashboard shows yellow taxi
dropoffs for a selected TLC area alongside estimated entries at a nearby subway
station complex. Both modes are available for August and September 2026.

## Open the local map

Use Node 22.17 or newer:

```sh
cd web
npm ci --ignore-scripts
npm run dev:live
```

Open [the local preview](http://127.0.0.1:5173) while the server is running.
The live preview disables hot reload and file watching. Local search and selection work
without a token. With a configured public Cesium ion client token, the stage makes
one automatic startup attempt after local geography validates and the page is visible.
This makes external requests that can consume quota. Close or leave the page to unload 3D.
Follow the [web setup and safety notes](web/README.md).

To try the dashboard without a token, run `npm run dev:verify` from `web/` and
open [Flatiron in the mock preview](http://127.0.0.1:5174/?mode=mock&zone=90).
Select **Mobility data** and use the Start and End calendars to select a range
within or across months. Choose a day in **Daily trend** to see its hourly
charts. Flatiron shows 10,165 taxi dropoffs from August 29 through September 4.
See the [dashboard controls, coverage and export instructions](web/README.md#try-the-transportation-dashboard).

The dashboard uses frozen monthly archives. Historical backfill and recurring
publication are described in the [multi-month specification](docs/specs/multi-month-mobility.md#historical-and-ongoing-coverage).

See the [M2 verification report](docs/reports/m2-cesium-prototype.md) for completed
checks and live-validation limits. The previous borough and land masks are available
as [comparison modes](web/README.md#compare-imagery-cutouts).

## Run M1 ingestion

From the repository root, M1 validates and archives yellow-taxi dropoffs and MTA
subway entry estimates before publishing a completed run. It does not backfill history.

Install [uv](https://docs.astral.sh/uv/) and use Python 3.12. Dependencies are pinned
in `uv.lock`; the project environment stays in `.venv`.

```sh
uv sync --locked
uv run mobility ingest --month 2026-09
```

Both taxi and MTA are captured by default. The command prints the completed
`manifest.json` path. Raw data, immutable snapshots, runs and failure reports live
in `.data/`, outside Git. Use `--data-dir /path/to/data` to change that location.
`--taxi-only` explicitly omits the MTA companion and produces a separate snapshot.

An online run captures new source bytes. A completed manifest identifies its snapshot
as `sha256:<digest>`. To replay, use `snapshots/<digest>.json` under the current data
root, replacing the placeholder below with that digest. `operational.snapshot_path`
records the original absolute path and may be stale after moving the data directory:

```sh
uv run mobility ingest --month 2026-09 --offline \
  --snapshot .data/snapshots/REPLACE_WITH_SHA256.json
```

Offline mode checks every archived hash and recomputes the outputs. Existing
completed outputs are reused only after the regenerated hashes match. If there is
exactly one matching snapshot, `--snapshot` can be omitted. Multiple snapshots
require an explicit choice. `--output-dir .data/replay` publishes an independent
replay directory for comparison. A corrupt asset, schema/join failure, changing MTA
capture or conflicting existing output exits nonzero, writes `.data/failures/`, and
publishes no partial successful run.

## Tiny no-network example

```sh
SNAPSHOT=$(uv run mobility fixture --data-dir .data-fixture)
uv run mobility ingest --month 2026-09 --offline \
  --data-dir .data-fixture --snapshot "$SNAPSHOT"
```

The fixture contains eight taxi rows: four eligible, four excluded, with one count
at zone 1 / midnight and three counts at zone 2 / 01:00. The first two rows are
identical and both count. Distance and fare each have three overlapping anomaly
flags: negative, zero and missing. Subway categories sum to 15 estimated entries
at midnight; adding transfers would incorrectly give 20. An observed zero follows
at 01:00. Missing hours stay unknown. See [the data dictionary](docs/data-dictionary.md) and
[the M1 contracts](docs/specs/m1-ingestion.md).

## Limits that affect interpretation

- Taxi counts cover the nominal pickup-month source file, not every calendar-month
  dropoff. Adjacent pickup-month files are deferred. Timestamps stay New York local
  clock labels; duplicates remain because TLC provides no unique trip identifier.
- Subway values estimate station entries, not unique riders or destinations.
- MTA capture uses one bounded, ordered monthly export and count/version checks
  before and after. This is best-effort mutable-source capture without a transaction
  guarantee. Equal counts cannot prove unchanged content.
- The archived station reference is derived from the observed month after checking
  identity/coordinate conflicts. It is not independent authority or a service
  calendar and cannot detect stations absent for that whole month. The full
  21-month M0 audit and independent station/coordinate and service-calendar checks
  remain pending. A successful pilot does not certify them.
- Downloads use only the approved TLC and NY Open Data HTTPS origins. Redirects,
  byte/row limits and checksums are checked. Downloads have socket timeouts and
  a 600-second budget checked between 64 KiB reads. An in-flight socket operation
  can run until its 180-second timeout, and DNS resolution can add delay, so the
  budget is not a hard wall-clock cap. The polygon ZIP is archived and checked as
  a ZIP, never extracted. DuckDB uses two threads, a 4 GiB memory limit,
  disabled extension auto-install/load and disabled HTTP filesystem reads.

The September pilot completed, and offline replays reproduced all nine output hashes.
Negative-transfer source values remain unchanged; affected station-hours retain their
entry estimates but are ineligible for comparisons and models. See the
[pilot report](docs/reports/m1-pilot.md) for counts, replay commands and remaining limits.
Run identity records Python and DuckDB versions, but not the time-zone database version.

## Develop

```sh
uv run pytest
uv run ruff check src tests
uv run ruff format --check src tests
```

Only tiny synthetic CSV fixtures belong in Git for M1. The derived official TLC
GeoJSON and its provenance are intentionally versioned under `web/public/data/`
for M2. Raw trip/subway data and local credentials remain ignored.

## Backfill published history

From the repository root, discover eligible source months first, then run a
bounded backfill. The command uses the official TLC index and MTA hourly
datasets, archives raw files locally, and publishes verified aggregates to
the dashboard data directory.

```sh
PYTHONPATH=src uv run python web/scripts/backfill.py --discover-only
PYTHONPATH=src uv run python web/scripts/backfill.py --limit 3
PYTHONPATH=src uv run python web/scripts/backfill.py
```

Rerun the same command to pick up unfinished months. It skips published
months, validates and reuses matching completed runs or frozen snapshots, and
prints a result per attempted month. Use `--since` and `--through` for
inclusive month bounds or `--dashboard-dir` to stage a separate local data
directory. An incomplete discovery report exits before trying candidate
captures. Other months continue after a per-month capture or validation
failure, and the command exits nonzero if any attempted month fails.

The catalog advertises files only after validation. Existing published
months stay in place. Use the [daylight-saving backfill](docs/specs/daylight-saving-backfill.md)
for March and November 2020–2024. The general backfill skips transition
months. The 2009–2010 taxi files use coordinates and need a validated zone
assignment. See the [historical backfill specification](docs/specs/historical-backfill.md).

## Stage one monthly refresh

From the repository root, use the locked Python environment to check the latest
official releases and stage at most one newly available month. The command
tracks the last published month for taxi and subway separately.

```sh
PYTHONPATH=src uv run --locked python web/scripts/refresh.py \
  --stage-dir .data/refresh-preview-next \
  --data-dir .data/refresh-pilot-archive
```

Both paths are required. Use a fresh, nonexistent stage directory on every run.
The stage, archive and read-only published baseline must be separate,
non-overlapping directories. The baseline defaults to `web/public/data/`.
Use `--published-dir` to read a different baseline with an existing catalog.
The command can download source files and stores its captures and validated
runs in the archive. When it selects a month, it copies the registered baseline
assets to the stage and writes `refresh-result.json` and a prospective
`mobility-months.json` there.

Read the taxi and subway outcomes separately. One mode can stage while the
other is still unavailable or partial. Discovery and validation failures return
a nonzero exit code even if the other mode stages successfully. The archive
retains rejected subway captures for inspection. A later run can capture newer
provider data. See the [October dry run and dashboard check](docs/reports/automated-data-refresh-pilot.md).

## Scheduled data publishing

GitHub Actions is configured to check for new months on Fridays at 10:23 UTC.
Scheduled runs on the canonical `main` can publish a validated data commit.
Manual runs default to a preview. Select **Publish now** on `main` to run the
same publish job on demand. The workflow publishes repository data. A hosted
dashboard needs its own deployment. See the
[publishing runbook and pilot evidence](docs/reports/scheduled-mobility-publishing-pilot.md).
