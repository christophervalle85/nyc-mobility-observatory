# September transportation comparison

Open **Transportation data** from a selected TLC area. Choose an MTA subway station complex by name and borough. The station choice is explicit and can be outside the selected TLC area. Keep the same inclusive September 2026 date range and chart day for both modes.

- Show separate totals for yellow taxi dropoffs in the selected TLC area and estimated entries at the selected station. Show how many station hours contribute to the subway total. If none are comparable, show unavailable.
- Stack the hourly plots on the same local New York clock, with separate vertical scales and a labeled color legend. Distinguish subway gaps from observed zeros in both the plot and the exact-count table.
- Publish a same-origin static aggregate from the same completed September run as taxi. Preserve station identity and comparison eligibility. Verify the archived input against its manifest and reconcile coverage to the quality report. No new service, dependency, raw rows or station-to-zone join.
- Keep taxi usable when subway data is unavailable. Bound and validate the subway data request. Use a labeled native station picker and keep the charts and exact counts keyboard-accessible.
- Verify archive replay, real totals and missing/flagged hours, shared dates, keyboard use, narrow layout and existing map/taxi behavior. Reverting the feature restores the taxi-only panel.
