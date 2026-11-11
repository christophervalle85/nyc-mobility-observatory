# NYC map prototype

A standalone local Vite + TypeScript + CesiumJS client. A single city viewport uses official TLC zone geography from a local GeoJSON file; there is no separate 2D/SVG map. Optional Google Photorealistic 3D Tiles load through Cesium ion only after you select **Load 3D**. This prototype does not display mobility counts, charts, date filters or live traffic.

## Run locally

Use Node 22.17 or newer (verified here with Node 23.11 and npm 11.6).

```sh
cd web
npm ci --ignore-scripts
npm run dev:live
```

Open <http://127.0.0.1:5173>. The live preview disables file watching and hot reload so edits do not restart an active scene. The server accepts loopback connections only and fails rather than choosing another port if 5173 is busy. Local TLC search and the native result selector work without a token. The unloaded viewport displays status guidance, not imagery. Keep the dev server running while using the page. After a code update, select **Stop / unload**, restart `npm run dev:live`, then refresh the page; this preview does not apply edits automatically.

For 3D, edit the ignored `web/.env.local` file locally:

```dotenv
VITE_CESIUM_ION_TOKEN=
```

Place your public Cesium ion client token after `=` and restart the server. Do not paste it into chat, commit it or include it in screenshots/logs. Vite exposes this value to the browser; it is not a secret store. Use only a read-only `assets:read` token restricted to the necessary asset, Google Photorealistic 3D Tiles (ion asset 2275207), and the local URL where supported. Never use an administrative, secret or write-enabled token. Check asset enablement and your current ion plan and usage in your account. This app cannot verify those account settings.

The **Load 3D** button opens one fixed NYC scene. It does not load default imagery, terrain or geocoding services. Camera movement can request more tiles. Request-render mode avoids unnecessary idle rendering; it does not limit billing. Rendering uses CSS-pixel resolution at scale 1, without another device-pixel-ratio division, native 2× supersampling or an artificial 30 FPS cap. Tiles use screen-space error 16, a 512 MiB cache target and 256 MiB overflow allowance. These are not a hard total-memory limit and can increase bandwidth and memory use. **Stop / unload** destroys the viewer and listeners; requests already in flight may finish. One deliberate retry is available per page session, with no automatic retry loop. Retry stays disabled until all pending resource creation has settled, including work left after Stop or a timeout. A request-limit error asks you to stop and check usage instead. Reloading starts a new session, so avoid repeated reloads or loads.

Keep the imagery credits visible. Zone geometry comes from TLC, not Google imagery. Do not trace imagery, sample Google heights, export imagery-derived boundaries/statistics, or add a persistent imagery cache. See [Cesium usage and attribution guidance](https://cesium.com/learn/ion/content-usage-and-attribution-guide/) and [Google Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies).

## Find and focus a TLC area

Search by zone name, borough or exact TLC ID. Typing and clearing the query preserve the current selection. Selecting a result or restoring `?zone=ID` updates the inspector and highlight without loading 3D or moving the camera. The inspector identifies the area and states that mobility data is not connected.

Use **Focus area** separately once the scene is ready. It uses only the selected zone's local geometry, with an 800–20,000 metre range and a 20,000 metre maximum flight height. Movement lasts 1.2 seconds, or is immediate with reduced motion. Duplicate requests are ignored; selection changes and scene teardown cancel obsolete movement. Focus can request additional tiles. It adds no asset, geocoder, service or height query.

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

Official geometry and provenance are under `public/data/`. The exporter and independent verification instructions are documented in [geometry notes](geometry-notes.md). The overlay preserves polygon rings/multipart geometry. The native zone selector and text inspector provide selection without map picking.

## Verification limits

The city-dashboard update passed 46 unit tests, TypeScript checks (including updated E2E source), the isolated build and diff checks. M1's 110 tests and all 12 converter tests passed again; 27 protected files were unchanged. The updated E2E source was not executed. Earlier 16 browser-test passes are historical and do not validate this layout. See the [verification report](../docs/reports/m2-cesium-prototype.md).

A pre-update screenshot shows Google/Cesium imagery, East Village (79) highlighted and visible credits. It does not establish complete attribution compliance or validate the new layout, focus framing, rendering quality, frame rate, clamping, picking or rendered accessibility. Updated live acceptance remains pending. Token permissions and URL restrictions must be reviewed separately in the ion account. September 2026 M1 ingestion remains separate and unchanged; see the [prototype specification](../docs/specs/m2-cesium-prototype.md) for deferred scope.
