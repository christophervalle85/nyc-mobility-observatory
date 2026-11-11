# M1: reproducible local ingestion

Status: implementation plan accepted by the coordinator against approved scope; focused security guidance reviewed. Implementation and independent code/QA review are pending. The repository was empty except for `.git/` on inspection. Everything below describes planned behavior, not completed validation.

## Purpose and scope

One command downloads and validates September 2026 yellow-taxi data, TLC reference assets, and a bounded monthly MTA companion snapshot. An offline rerun reproduces the same tables and quality findings from archived bytes. Python 3.12, uv, a pinned DuckDB dependency, the standard library and pytest are sufficient. No service, UI, map, model, station-to-zone spatial join, deployment or historical backfill belongs to M1. Create meaningful local checkpoint commits to preserve version history. Do not push or merge.

Proposed interface: `uv run mobility ingest --month 2026-09`; `--offline` requires a recorded snapshot and makes no network requests. Permit other months only where the same explicit contracts apply. A failed run exits nonzero, writes a failure report, and never publishes partial successful outputs.

## Components and ownership

- CLI: validate the month, select sources, orchestrate one run and return its manifest path.
- Acquisition/provenance: bounded HTTPS downloads, hashes, immutable raw assets, source metadata and offline verification. Transforms read local files, never live URLs.
- Taxi transform: validate schema/reference joins, classify rows and aggregate dropoffs.
- Subway transform: validate the snapshot, classify exclusions and aggregate ridership.
- Quality/publication: reconcile counts, write deterministic outputs, dictionary and reports, then atomically publish a completed run.

Use a small Python package with these responsibilities separated by functions/modules, not a framework or plugin system. Raw assets live outside Git under content-addressed source directories. Derived runs are identified by input hashes, transformation/contract version, runtime/dependency versions and parameters. Git contains code, lockfile, docs and tiny synthetic fixtures only.

## Sources and provenance

Archive:
- Taxi: https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2026-09.parquet
- Zone lookup: https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv
- Polygon ZIP: https://d37ci6vzurychx.cloudfront.net/misc/taxi_zones.zip (retain ZIP; geometry processing is deferred).
- MTA: https://data.ny.gov/resource/5wq4-mkjj.csv with an explicit local-month timestamp predicate.

Each asset manifest records SHA-256, bytes, requested/final URL, exact query and pagination, fetch start/end instants, response metadata including Last-Modified/ETag when present, and publication/version metadata when provided. Unknown publication dates remain null with an explanation; HTTP Last-Modified is not asserted to be a publication date. Refetching changed bytes creates a new snapshot, never overwrites one. Use one filtered MTA CSV export with an explicit row cap and count/metadata checks before and after capture. Record its retrieval interval. Label this best-effort mutable-source capture, not a transaction snapshot; equal counts cannot prove unchanged content.

No persisted M0 roster is available. Archive a versioned distinct-station query of the same MTA dataset (ID, name, borough, latitude and longitude for subway, excluding St George 501). Use it for observed-source consistency checks; report 424 stations only if observed. This is not independent station authority or a service calendar; the independent station/coordinate audit remains pending. No secrets or large source/derived datasets enter Git. Bound download size/time, validate response content and write through temporary files. Keep DuckDB extension installation/network reads disabled. Apply the reviewed security guidance to these external-input boundaries; do not extract the ZIP in M1.

## Taxi contract

Require compatible, explicit timestamp and integer zone-ID types for `tpep_pickup_datetime`, `tpep_dropoff_datetime`, `PULocationID`, `DOLocationID`. Document other inspected fields and their types; do not silently coerce malformed values. Lookup `LocationID` must be unique and non-null; required labels must exist. Unexpected schema/type, duplicate reference keys or unresolved non-sentinel zone IDs fail the run. Null and documented unknown/outside zone values enter the exclusion/flag ledger.

Treat timestamps as New York local clock labels. Never invent UTC instants or infer DST folds. The aggregate key is `(dropoff_hour_local, DOLocationID)`; output `trip_count` is a nonnegative integer, sorted by that key. Count rows with a valid in-month dropoff label and recognized ordinary destination zone. September means dropoff in [2026-09-01 00:00, 2026-10-01 00:00), even when the nominal TLC file contains boundary records. Counts cover this source file only; without adjacent pickup-month files, do not claim exhaustive calendar-month dropoffs.

Preserve apparent duplicate trips: TLC supplies no valid unique trip ID. Flag null timestamps, non-positive durations, distance/fare anomalies and unknown origins separately. Fare/distance/origin flags do not silently remove an otherwise eligible dropoff count. Unknown/outside destinations and invalid/out-of-month dropoffs remain in the ledger and never enter ordinary destination aggregates. Store reason counts and row references sufficient to trace exclusions to the raw asset.

## MTA companion contract

Persist the exact monthly CSV export before transformation. Require unique non-null compound keys `(transit_timestamp, transit_mode, station_complex_id, payment_method, fare_class_category)`, valid types, supported modes, observed-reference membership and finite/in-range coordinates consistent with the versioned observed-source reference/tolerance. Unexpected violations fail; the documented station 501 St George records mislabeled subway are quarantined.

Station-hour ridership sums observed `ridership` across payment/fare categories. Never add `transfers`. Missing station-hours remain unknown, never generated zeroes. Report the station universe, valid local clock-label denominator, observed labels and eligible labels separately, with the universe/reference source and exclusion policy. This denominator measures coverage, not scheduled service.

All New York DST transition dates are initially model-ineligible; nonexistent spring 02:00 labels are excluded from the valid-label denominator. Do not resolve repeated fall labels into invented instants. Quarantine local hours 2026-03-28 01:00 through 04:00 and 2026-08-16 21:00 through 22:00 inclusive from comparisons/features, while retaining raw rows and reason counts. Fixtures must exercise these rules even when the pilot month does not.

## Acceptance and checks

1. **Replay/provenance:** online fixture acquisition followed by offline replay yields identical sorted table values and quality findings; only operational fetch/run metadata may differ. Tampered bytes fail checksum verification. Changed source bytes cannot overwrite a snapshot.
2. **Taxi arithmetic:** a tiny manually checkable fixture proves duplicate retention, destination/hour sums, month boundaries, unknown/outside handling and metric-specific flags. Raw row counts reconcile to eligible and excluded rows without double-counting overlapping flags.
3. **Hard failures:** fixtures test missing/wrong types, duplicate lookup/output keys, unexpected zone join failures, malformed CSV and MTA compound-key duplicates. No successful publication remains after a failure.
4. **MTA meaning:** fixtures prove category sums, no transfer addition, unknown missing hours, station/mode/coordinate validation, St George quarantine, both suspect windows and spring/fall DST rules.
5. **Pilot evidence:** execute the September command and offline replay; inspect manifests, hashes, row reconciliations, dictionary and quality report. Cite actual commands/results and disclose source unavailability or incomplete checks.

Every completed run includes a machine-readable manifest and quality report, taxi zone-hour and MTA station-hour outputs, an exclusion/flag ledger and a human-readable data dictionary defining units, grain, eligibility, timezone and lineage. The quality report explicitly marks the full 21-month M0 audit and service-calendar validation pending unless actually reproduced. A successful pilot does not certify that historical audit.

## Phases, tradeoffs and review

Implement acquisition/provenance and fixture contracts first, taxi/reference transforms next, then bounded MTA validation, reports and live/offline verification. Keep each phase testable without network access.

The simpler alternative is standard-library-only ingestion, but Parquet parsing would need another engine; DuckDB supplies local columnar aggregation without a database service. Pandas/geospatial stacks and orchestration frameworks add dependencies M1 does not need. Candidate ADRs: local DuckDB/file ownership, immutable snapshots, local clock labels, and metric-specific eligibility with explicit quarantine.

Remaining risks: upstream schema/revisions, partial or changing MTA exports, ambiguous local DST labels and incomplete station/service references. Surface them in reports. The coordinator accepted this implementation plan and reviewed focused security guidance. Independent code review and QA evidence remain required; the architect has not self-approved this design.
