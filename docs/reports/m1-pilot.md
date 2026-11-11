# September 2026 M1 pilot

The local pilot completed on 2026-11-11 from frozen live source bytes. Two offline
replays reproduced all nine output hashes. This verifies the bounded ingestion
pipeline, not full-history coverage or service-calendar completeness.

## Reproduce the run

Keep the archived raw assets and snapshot together under `.data/`. From the repository
root with the locked environment installed:

```sh
uv run mobility ingest --month 2026-09 --offline \
  --snapshot .data/snapshots/99fe7db5f3a0e717bee4ef2d2042a1021464f298a77adee25b5a917d2358a101.json \
  --output-dir .data/replay
```

The command prints the completed manifest path. Compare its `outputs` hashes with
those in the original manifest. A different source-code fingerprint or runtime
produces a different run identity. An online capture may retrieve revised source
bytes and is not a replay of this pilot.

## Identity and sources

- Month: `2026-09`; capture date: `2026-11-11` UTC.
- Run: `0566a3a050ff0a2d1de02ccc510416f0d21f226725afdbf2ea6eab610cbc0ebe`.
- Snapshot SHA-256: `99fe7db5f3a0e717bee4ef2d2042a1021464f298a77adee25b5a917d2358a101`.
- Python: `3.12.14`; DuckDB: `1.4.3`; pipeline contract: `m1-v1`; subway contract: `m1-subway-v2`.
- Source-code SHA-256: `34f4f9ae749b6aa9cc7a08431c22463e28d4c2daf83e4ba421494ee52fa8bf19`.
- Taxi: TLC `yellow_tripdata_2026-09.parquet`, 67,374,896 bytes.
- MTA: NY Open Data dataset `5wq4-mkjj`, monthly ordered CSV export, 208,664,134 bytes.

The manifest and quality report are under `.data/runs/<run>/`. The manifest records
source URLs, queries, raw-asset hashes and response metadata. Its `snapshot` is a
portable `sha256:<digest>` reference; `operational.snapshot_path` is historical and
may be stale after relocation. HTTP Last-Modified is not a publication date.

## Reconciled counts

- Taxi: 3,876,044 source rows = 3,851,119 eligible + 24,925 excluded;
  131,687 zone-hour rows.
- MTA: 1,527,909 source category rows = 1,517,093 aggregate inputs + 10,816
  exclusions. Exclusions comprise 6,063 Staten Island Railway rows, 4,751 tram rows
  and two subway-mode station-501 rows.
- Observed-month roster: 424 stations. The 305,280 station-hour grid contains
  301,267 observed and 4,013 unknown hours. Of the observed hours, 301,225 are
  comparison- and model-eligible; 42 are quarantined for negative transfers.

Negative transfers occur in 42 category rows containing 1,859 entry estimates.
The entire affected station-hours contain 245 category rows and 36,429 entry
estimates across 42 hours at four stations. Both totals are retained, but they
measure different scopes. The flags ledger identifies the 42 source rows; the
comparison quarantine covers all 245 categories at those hours. The source's cause
is unknown. Entry estimates are not unique riders or destinations.

## Verification

- 110 tests passed; Ruff lint and formatting checks passed.
- Offline wheel and source-distribution builds passed.
- Two offline replays matched all nine output hashes. The independently guarded
  replay observed zero application-level network attempts.
- Independent review found no remaining verified bug in the final code diff.

Routine checks can be rerun with:

```sh
uv run pytest
uv run ruff check src tests
uv run ruff format --check src tests
```

## Remaining limits

Taxi counts cover one nominal pickup-month file, not exhaustive calendar-month
dropoffs. The station roster comes from the observed month and cannot detect
stations missing for that entire month. Independent station/coordinate validation,
service-calendar reconstruction, the full 21-month audit and time-zone database
provenance remain pending. Missing hours remain unknown; they do not prove closure
or zero entries.

MTA acquisition is best-effort mutable-source capture. Equal before/after counts
and metadata do not prove unchanged content. Downloads check a 600-second budget
between reads; in-flight timeouts and DNS mean this is not a strict wall-clock cap.
See [subway quality](../subway-quality.md) for DST rules, suspect windows and
negative-transfer handling.
