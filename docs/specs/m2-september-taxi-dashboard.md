# M2 September taxi dashboard

Select a TLC area, open **Taxi dropoffs** from its map card, and choose a start and end date in September 2026. Show the total for those inclusive dates and a chart with one value per hour. The map card stays compact and the map remains usable with or without 3D imagery.

## Data contract

Publish one same-origin JSON file at `/data/yellow-taxi-2026-09.json`. It contains `version: 1`, `month: "2026-09"`, `timezone: "America/New_York"`, `runId`, `sourceSha256` for `taxi/zone_hour.csv`, `totalDropoffs`, and `zones`, an object keyed by TLC ID. Each zone has 720 nonnegative integer counts in New York local-clock order beginning September 1 at midnight. September has no daylight-saving clock change. The export reads an explicitly selected completed M1 run and the map's geography, validates the archived aggregate against its manifest and reconciles the total to the taxi quality report. Missing rows within known zones represent zero counted dropoffs in the archived file. Missing files, invalid data and unrecognized zones are unavailable states. No trip-level records or credentials enter the browser.

## Interaction and checks

- Dates default to September 1–7. Both endpoints are inclusive. Keep the range as users switch areas. Reject blank, reversed and out-of-month dates without showing a stale total.
- Make the chart and numeric hour values available without pointer interaction. Format dates and hours as New York local clock labels. Explain that the September pickup-month file provides the observed dropoffs and that adjacent pickup-month files are excluded.
- Use a bounded, same-origin fetch when the dashboard opens. A load failure leaves search, selection and the map usable. Close the dashboard when selection is cleared. Area changes update the same panel if it is open.
- Check deterministic export, manifest mismatch, invalid rows, whole-month reconciliation, inclusive slicing, zeroes and date errors. Verify the real Flatiron data in Chrome at desktop and phone widths without requiring provider imagery. Verify on `main`'s existing camera and map controls through regression tests.

## Delivery

1. Archive export and provenance, with exporter tests.
2. Date range, total and chart on the existing map, with browser regression coverage.

Subway data, a historical backfill, forecasts and deployment are future work. This dashboard uses local static assets and adds no service or new dependencies.
