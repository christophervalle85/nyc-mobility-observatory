# NYC Mobility Observatory

Explore a city-stage prototype with optional Google Photorealistic 3D Tiles
through Cesium ion. The bounded M2 prototype supports local TLC area search,
selection and a separate camera-focus action. Date filters, mobility counts, charts and models are not implemented.
The separate M1 ingestion pipeline remains unchanged.

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
This makes external requests that can consume quota. **Stop / unload** cancels pending
startup and prevents automatic resumption; **Resume 3D** is deliberate. Follow the [web setup and safety notes](web/README.md).
For a token-free mock preview, use `npm run dev:verify` and open
[the mock controls](http://127.0.0.1:5174/?mode=mock).

See the [M2 verification report](docs/reports/m2-cesium-prototype.md) for completed
checks and live-validation limits.

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
for M2. Raw trip/subway data and local credentials remain ignored. No deployment
or remote publishing is included.
