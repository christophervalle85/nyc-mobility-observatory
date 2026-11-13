# NYC city-stage prototype

The local Vite + TypeScript + CesiumJS prototype opens on the Midtown skyline with continuous Google Photorealistic 3D Tiles. With a usable Cesium ion token, 3D starts once the local geography validates and the page first becomes visible. Search and map selection use official TLC zones from local GeoJSON. The prototype has one 3D viewport and leaves mobility counts, charts, date filters and live traffic out of scope.

## Run locally

Use Node 22.17 or newer (verified here with Node 23.11 and npm 11.6).

```sh
cd web
npm ci --ignore-scripts
npm run dev:live
```

Open <http://127.0.0.1:5173>. You can search for and select TLC areas without a token. The unloaded viewport shows setup or status guidance. The server accepts loopback connections only and requires port 5173 to be free. The live preview disables file watching and hot reload. After a code update, select **Stop 3D**, restart `npm run dev:live`, then refresh the page.

For 3D, edit the ignored `web/.env.local` file locally:

```dotenv
VITE_CESIUM_ION_TOKEN=
```

Place your public Cesium ion client token after `=` and restart the server. Do not paste it into chat, commit it or include it in screenshots/logs. Vite exposes this value to the browser; it is not a secret store. Use only a read-only `assets:read` token restricted to the necessary asset, Google Photorealistic 3D Tiles (ion asset 2275207), and the local URL where supported. Never use an administrative, secret or write-enabled token. Check asset enablement and your current ion plan and usage in your account. This app cannot verify those account settings.

The stage makes one automatic startup attempt per page session. Use **Stop 3D** during startup or viewing to cancel pending startup, prevent automatic resumption and destroy the viewer and listeners. Requests already in flight may finish. **Resume 3D** and **Retry once** share the two-attempt session budget and wait for pending resource creation to settle, including after stopping or a timeout. Errors never retry automatically. If you hit a request limit, stop and check your usage. Reloading starts a new session, so avoid repeated reloads or loads.

The app skips Cesium's default imagery, terrain and geocoding services. Request-render mode reduces idle rendering. Camera movement can still request more tiles and count toward ion usage and billing. Rendering starts at CSS-pixel resolution and applies device pixel ratio once, clamped between 1 and 1.5, with no fixed frame-rate cap. The tile settings use screen-space error 16, a 512 MiB cache target and 256 MiB overflow allowance. The cache settings can increase bandwidth and memory use and apply to tile cache only.

Keep the on-screen Cesium and imagery provider credits visible during live 3D. Do not trace imagery, sample Google heights, export imagery-derived boundaries/statistics, or add a persistent imagery cache. See [Cesium usage and attribution guidance](https://cesium.com/learn/ion/content-usage-and-attribution-guide/) and [Google Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies).

## Compare imagery cutouts

The default scene shows the Google tiles without a display cutout. Unrecognized `cutout` values use this default. Append one of these exact flags to compare display cutouts.

- `?cutout=boroughs` restores the previous renderer-only study footprint, made from five approximate TLC borough hulls (250 vertices).
- `?cutout=land` tries the experimental NYC DCP water-excluded land mask. The optional local asset has a three-second fetch and body-read timeout. TLC search stays usable while it loads.

The cutouts use generalized source boundaries and leave TLC area IDs, picking geometry and data joins intact. **Sources & usage** describes the active mode and links to its sources. If clipping is unavailable or the land asset fails to load, the scene shows unclipped imagery and reports the fallback.

## Find and focus a TLC area

Use **Search areas** to filter by name, borough or exact TLC ID. Leave the field blank to browse all 263 TLC areas. Each result shows the area's name, borough and TLC ID. Click or tap a row to select it.

Use the Up and Down arrow keys to move through the results. With the list open, Enter chooses the active row or the first match if no row is active. Escape closes the list and keeps the query and selection.

Choosing a result closes the list, keeps the query and opens the area details. When 3D is ready, the map highlights the selection and the camera flies to it. If the initial startup is still pending, the flight waits for it to finish. Choosing a result leaves a stopped scene unloaded.

Picking a point in the live scene or opening `?zone=ID` selects an area without moving the camera. Editing or clearing the query keeps the selected area, even if it falls outside the results. Close the details to clear the selection and return to search.

Use **Focus** to recenter on the selected area once 3D is ready. Both automatic and manual flights use local zone geometry and an 800 to 20,000 metre range. Cesium chooses the flight height and keeps the current viewing direction. The flight takes 1.2 seconds, or moves immediately with reduced motion. The app ignores duplicate requests and cancels obsolete flights when selection changes or the scene stops. Flying can request more tiles.

**Show all NYC** frames the five boroughs in a north-up view. The opening view uses source-derived Midtown bounds. Drag to move across the city and scroll or pinch to zoom. With the map focused, use the arrow keys to move and + or − to zoom. Resizing keeps the current camera. Newark Airport is searchable and can be selected and flown to in any mode. In either cutout mode, flying to Newark adds its 61-vertex hull to an active cutout (311 vertices total in borough mode). **Show all NYC** removes the added hull.

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

The verification server supports explicit mock scenarios through `?mode=mock&scenario=auth` (`rate`, `timeout`, `network`, `webgl` and `partial` also work). Mock mode simulates controls and scene state using local geography, with no 2D map or city imagery; it never constructs a Cesium viewer or loads imagery. The Playwright suite uses synthetic geography, blocks external requests, and uses installed Google Chrome. Unit tests use Node's TypeScript stripping and mocked scene resources. Build output is intentionally token-free and is for local QA, not a configured deployment.

`npm run preview` serves that safe build at <http://127.0.0.1:4173>. Cesium worker/widget assets are copied from the pinned npm package into ignored `public/cesium/` during dev/build. No remote CDN or font request is needed at startup.

Official geometry and provenance are under `public/data/`. The overlay preserves polygon rings and multipart geometry. See the [exporter and verification instructions](geometry-notes.md).

## Verification limits

The earlier presentation refinement passed 76 unit tests, TypeScript, an env-isolated build and 24 mock/verification browser tests. It included inspection of desktop and narrow-screen live opening views. Earlier independent review and preservation checks on `2b5e6ea` recorded 110 M1 tests, Ruff lint/format and 12 exporter tests. The presentation pass preserved the core, data and converter files. See the [verification report](../docs/reports/m2-cesium-prototype.md).

The later diagnostics follow-up passed 96 unit tests, 30 browser tests, TypeScript, an isolated build and 9 offline exporter tests. Its limited live measurements include a matched local trial in which the DCP land cutout took longer to settle than the borough hulls. User acceptance, cold-device profiling, GPU performance, memory usage and provider quota remain unverified for the continuous-city prototype. See the [diagnostics report](../docs/reports/city-performance-diagnostics.md).

A pre-update screenshot shows Google/Cesium imagery, East Village (79) highlighted and visible credits. It does not establish complete attribution compliance or validate the new layout, focus framing, rendering quality, frame rate, clamping, picking or rendered accessibility. Updated live acceptance remains pending. Token permissions and URL restrictions must be reviewed separately in the ion account. September 2026 M1 ingestion remains separate and unchanged; see the [prototype specification](../docs/specs/m2-cesium-prototype.md) for deferred scope.
