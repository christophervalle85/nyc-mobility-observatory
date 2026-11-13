# NYC city-stage prototype

The local Vite + TypeScript + CesiumJS prototype opens on the Midtown skyline with continuous Google Photorealistic 3D Tiles. With a usable Cesium ion token, 3D starts once the local geography validates and the page first becomes visible. Search and map selection use official TLC zones from local GeoJSON. The transportation dashboard shows yellow taxi dropoffs by area and estimated subway entries by station complex for August and September 2026.

## Run locally

Use Node 22.17 or newer (verified here with Node 23.11 and npm 11.6).

```sh
cd web
npm ci --ignore-scripts
npm run dev:live
```

Open <http://127.0.0.1:5173>. You can search for and select TLC areas without a token. The unloaded viewport shows setup or status guidance. The server accepts loopback connections only and requires port 5173 to be free. The live preview disables file watching and hot reload. After a code update, close the preview tab, restart `npm run dev:live`, then reopen the page.

For 3D, edit the ignored `web/.env.local` file locally:

```dotenv
VITE_CESIUM_ION_TOKEN=
```

Place your public Cesium ion client token after `=` and restart the server. Do not paste it into chat, commit it or include it in screenshots/logs. Vite exposes this value to the browser; it is not a secret store. Use only a read-only `assets:read` token restricted to the necessary asset, Google Photorealistic 3D Tiles (ion asset 2275207), and the local URL where supported. Never use an administrative, secret or write-enabled token. Check asset enablement and your current ion plan and usage in your account. This app cannot verify those account settings.

The stage makes one automatic startup attempt per page session. Leaving or closing the page cancels pending startup and unloads the viewer and listeners. Requests already in flight may finish. **Retry once** shares the two-attempt session budget and waits for pending resource creation to settle after a timeout. Errors never retry automatically. If you hit a request limit, stop and check your usage. Reloading starts a new session, so avoid repeated reloads or loads.

The app skips Cesium's default imagery, terrain and geocoding services. Request-render mode reduces idle rendering. Camera movement can still request more tiles and count toward ion usage and billing. Rendering starts at CSS-pixel resolution and applies device pixel ratio once, clamped between 1 and 1.5, with no fixed frame-rate cap. The tile settings use screen-space error 16, a 512 MiB cache target and 256 MiB overflow allowance. The cache settings can increase bandwidth and memory use and apply to tile cache only.

Keep the on-screen Cesium and imagery provider credits visible during live 3D. Do not trace imagery, sample Google heights, export imagery-derived boundaries/statistics, or add a persistent imagery cache. See [Cesium usage and attribution guidance](https://cesium.com/learn/ion/content-usage-and-attribution-guide/) and [Google Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies).

## Try the transportation dashboard

With the web dependencies installed, run `npm run dev:verify` from `web/` and open [Flatiron in the mock preview](http://127.0.0.1:5174/?mode=mock&zone=90). Select **Mobility data** on the area card. The newest month opens first. Flatiron shows 9,919 taxi dropoffs for September 1 through 7. Open **Start date**, choose the previous-month arrow, and select August 1 to see 11,005 for August 1 through 7. Browsing leaves the current results in place until you pick a date. When you select a date in a different month, the other endpoint moves to that month and adjusts if needed to keep the range valid. The selected area and camera view stay in place, and the subway station is retained if it remains available nearby. The dashboard also works in the live preview.

Choose a **Subway station complex** to compare both modes. The picker lists up to six station complexes within 1.2 km of the selected area's center, ordered by straight-line distance. Use **Start date** and **End date** to pick an inclusive range within the selected month in New York local time. Each field disables dates that would reverse the range. Choose the same day in both fields for a one-day range. Use **Chart date** to view both modes for one day. Each chart uses its own count scale. Hover or tap either chart, or focus it and use the arrow keys, to see both counts for the same hour.

Taxi counts cover in-month dropoffs from that month's frozen TLC yellow taxi pickup file. Trips from adjacent pickup months are excluded. Subway totals sum estimated entries over comparison-eligible observed hours. Missing and flagged hours appear as gaps. The current format uses 24 New York local-clock slots per day, so months with a daylight saving time transition are withheld. See the [historical and ongoing coverage plan](../docs/specs/multi-month-mobility.md#historical-and-ongoing-coverage).

## Publish the monthly browser assets

Use completed M1 archives. Run the following commands from the root of a separate staging checkout so the exports stay out of the directory already serving the dashboard. See the [August capture summary](../docs/specs/multi-month-mobility.md#august-feasibility) and the [September pilot report and offline replay instructions](../docs/reports/m1-pilot.md).

```sh
(
  for run in \
    .data/runs/de68b672cfe77db3694436432448e39a44c93c6bd700a0a4a59326d6d6526806 \
    .data/runs/0566a3a050ff0a2d1de02ccc510416f0d21f226725afdbf2ea6eab610cbc0ebe
  do
    python3 web/scripts/export_yellow_taxi_dashboard.py --run-dir "$run" || exit 1
    python3 web/scripts/export_subway_dashboard.py --run-dir "$run" || exit 1
  done
  python3 web/scripts/export_mobility_months.py
)
```

Replace the run paths if you keep your archives elsewhere. The mode exporters validate each archived hourly CSV and quality report against the run manifest, then write `yellow-taxi-YYYY-MM.json` and `subway-YYYY-MM.json` to `web/public/data/`. The catalog exporter validates the mode files in that directory and replaces `mobility-months.json` only after validation succeeds. A month can list a single available mode. When both modes are available for a month, their assets must share a run ID.

With the staging checkout's web dependencies installed, run `npm run build` from `web/` after validation. The local QA build omits the Cesium token. When publishing a revision, serve the catalog and monthly assets from the same static build. The asset URLs are reused when an existing month is revised, so updating the served directory in place can expose files from different revisions. Automated publication that preserves the last good release on failure is future work.

Run the focused exporter tests from the repository root.

```sh
python3 -m unittest discover -s web/scripts -p 'test_export_*_dashboard.py'
python3 -m unittest discover -s web/scripts -p 'test_export_mobility_months.py'
```

## Compare imagery cutouts

The default scene shows the Google tiles without a display cutout. Unrecognized `cutout` values use this default. Append one of these exact flags to compare display cutouts.

- `?cutout=boroughs` restores the previous renderer-only study footprint, made from five approximate TLC borough hulls (250 vertices).
- `?cutout=land` tries the experimental NYC DCP water-excluded land mask. The optional local asset has a three-second fetch and body-read timeout. TLC search stays usable while it loads.

The cutouts use generalized source boundaries and leave TLC area IDs, picking geometry and data joins intact. **Sources & usage** describes the active mode and links to its sources. If clipping is unavailable or the land asset fails to load, the scene shows unclipped imagery and reports the fallback.

## Find and focus a TLC area

Use **Search areas** to filter by name, borough or exact TLC ID. Results open when you enter a query and take the place of any open area card. Click the empty map to dismiss either panel. Each result shows the area's name, borough and TLC ID. Click or tap a row to select it.

Use the Up and Down arrow keys to move through the results. With the list open, Enter chooses the active row or the first match if no row is active. Escape closes the list and keeps the query and selection.

Choosing a result closes the list, keeps the query and opens the area details. When 3D is ready, the map highlights the selection and the camera flies to it. If the initial startup is still pending, the flight waits for it to finish. Choosing a result leaves a stopped scene unloaded.

Picking a point in the live scene or opening `?zone=ID` selects an area without moving the camera. Editing or clearing the query keeps the selected area, even if it falls outside the results. Close the details to clear the selection and return to search.

Use **Zoom to area** to center on the selection once 3D is ready. After the flight, **Return to previous view** flies back to the camera position, angle and zoom while keeping the area selected. The return action is also available after a search flight. Both automatic and manual flights use local zone geometry and an 800 to 20,000 metre range. Cesium chooses the flight height and keeps the current heading. Area flights tilt down if you were looking toward or above the horizon. The flight takes 1.2 seconds, or moves immediately with reduced motion. The app ignores duplicate requests and cancels obsolete flights when selection changes or the scene stops. Flying can request more tiles.

**Show all NYC** flies to a north-up, overhead view of all five boroughs. Use the same button again to return to the camera view you had before the overview. Drag to interrupt either flight. Starting the return uses the saved view, so interrupting that flight leaves you in control at the current position. With reduced motion, the map moves there immediately. The opening view uses source-derived Midtown bounds. Click and drag to move across the city. Swipe with two fingers over the map to look around in place. Pinch or hold Option (Alt) while scrolling to zoom. With the map focused, use the arrow keys to move, Shift with the arrow keys to look around, and + or − to zoom. Resizing keeps the current camera. Newark Airport is searchable and can be selected and flown to in any mode. In either cutout mode, flying to Newark adds its 61-vertex hull to an active cutout (311 vertices total in borough mode). **Show all NYC** removes the added hull.

Map picking intersects the camera ray with the ellipsoid and checks the point against local TLC polygons. This gives an approximate zone selection. The implementation has unit coverage, and live picking accuracy remains unverified.

## Diagnostics

Append `?diagnostics=1` to record bounded, numeric-only timings in the browser console under `[NYC diagnostics]`. With diagnostics off, the app adds no profiling clock, timer, observer or render listener. Records cover local geography, Cesium startup, tile readiness, selection and camera flights. Frame samples measure CPU render wall time and render-event gaps. Diagnostics exclude GPU FPS, provider URLs, credentials and raw errors.

Selected outlines stay available through tile refinement and camera movement. Fills wait for detail. See [measured results and limits](../docs/reports/city-performance-diagnostics.md).

## Safe preview and checks

These commands disable all Vite env-file loading and define an empty browser token, even if `.env.local` exists:

```sh
npm run dev:verify
# http://127.0.0.1:5174/?mode=mock
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The verification server supports explicit mock scenarios through `?mode=mock&scenario=auth` (`rate`, `timeout`, `network`, `webgl` and `partial` also work). Mock mode simulates controls and scene state using local geography, with no 2D map or city imagery; it never constructs a Cesium viewer or loads imagery. Playwright uses installed Google Chrome and blocks external requests. Its cases include synthetic geography for map controls and the published August and September counts for the transportation dashboard. Unit tests use Node's TypeScript stripping and mocked scene resources. Build output is intentionally token-free and is for local QA, not a configured deployment.

`npm run preview` serves that safe build at <http://127.0.0.1:4173>. Cesium worker/widget assets are copied from the pinned npm package into ignored `public/cesium/` during dev/build. No remote CDN or font request is needed at startup.

Official geometry and provenance are under `public/data/`. The overlay preserves polygon rings and multipart geometry. See the [exporter and verification instructions](geometry-notes.md).

## Verification limits

The earlier presentation refinement passed 76 unit tests, TypeScript, an env-isolated build and 24 mock/verification browser tests. It included inspection of desktop and narrow-screen live opening views. Earlier independent review and preservation checks on `2b5e6ea` recorded 110 M1 tests, Ruff lint/format and 12 exporter tests. The presentation pass preserved the core, data and converter files. See the [verification report](../docs/reports/m2-cesium-prototype.md).

The later diagnostics follow-up passed 96 unit tests, 30 browser tests, TypeScript, an isolated build and 9 offline exporter tests. Its limited live measurements include a matched local trial in which the DCP land cutout took longer to settle than the borough hulls. User acceptance, cold-device profiling, GPU performance, memory usage and provider quota remain unverified for the continuous-city prototype. See the [diagnostics report](../docs/reports/city-performance-diagnostics.md).

A pre-update screenshot shows Google/Cesium imagery, East Village (79) highlighted and visible credits. It does not establish complete attribution compliance or validate the new layout, focus framing, rendering quality, frame rate, clamping, picking or rendered accessibility. Updated live acceptance remains pending. Token permissions and URL restrictions must be reviewed separately in the ion account. September 2026 M1 ingestion remains separate and unchanged; see the [prototype specification](../docs/specs/m2-cesium-prototype.md) for deferred scope.
