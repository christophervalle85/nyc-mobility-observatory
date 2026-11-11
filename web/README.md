# NYC map prototype

A standalone local Vite + TypeScript + CesiumJS client. The initial map uses official TLC zone geography from a local GeoJSON file. Optional Google Photorealistic 3D Tiles load through Cesium ion only after you select **Load 3D**. This prototype does not display mobility counts, charts, date filters or live traffic.

## Run locally

Use Node 22.17 or newer (verified here with Node 23.11 and npm 11.6).

```sh
cd web
npm ci --ignore-scripts
npm run dev:live
```

Open <http://127.0.0.1:5173>. The live preview disables file watching and hot reload so edits do not restart an active scene. The server accepts loopback connections only and fails rather than choosing another port if 5173 is busy. The local map and zone list work without a token. Keep the dev server running while using the page.

For 3D, edit the ignored `web/.env.local` file locally:

```dotenv
VITE_CESIUM_ION_TOKEN=
```

Place your public Cesium ion client token after `=` and restart the server. Do not paste it into chat, commit it or include it in screenshots/logs. Vite exposes this value to the browser; it is not a secret store. Use only a read-only `assets:read` token restricted to the necessary asset, Google Photorealistic 3D Tiles (ion asset 2275207), and the local URL where supported. Never use an administrative, secret or write-enabled token. Check asset enablement and your current ion plan and usage in your account. This app cannot verify those account settings.

The **Load 3D** button opens one fixed NYC scene. It does not load default imagery, terrain or geocoding services. Camera movement can request more tiles. Request-render mode and conservative detail/cache settings reduce rendering demand, not billing. **Stop / unload** destroys the viewer and listeners; requests already in flight may finish. One deliberate retry is available per page session, with no automatic retry loop. Retry stays disabled until all pending resource creation has settled, including work left after Stop or a timeout. A request-limit error asks you to stop and check usage instead. Reloading starts a new session, so avoid repeated reloads or loads.

Keep the imagery credits visible. Zone geometry comes from TLC, not Google imagery. Do not trace imagery, sample Google heights, export imagery-derived boundaries/statistics, or add a persistent imagery cache. See [Cesium usage and attribution guidance](https://cesium.com/learn/ion/content-usage-and-attribution-guide/) and [Google Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies).

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

The verification server supports explicit mock scenarios through `?mode=mock&scenario=auth` (`rate`, `timeout`, `network`, `webgl` and `partial` also work). Mock mode uses only local geography and labels the session as mock; it never constructs a Cesium viewer or loads imagery. The Playwright suite uses synthetic geography, blocks external requests, and uses installed Google Chrome. Unit tests use Node's TypeScript stripping and mocked scene resources. Build output is intentionally token-free and is for local QA, not a configured deployment.

`npm run preview` serves that safe build at <http://127.0.0.1:4173>. Cesium worker/widget assets are copied from the pinned npm package into ignored `public/cesium/` during dev/build. No remote CDN or font request is needed at startup.

Official geometry and provenance are under `public/data/`. The exporter and independent verification instructions are documented in [geometry notes](geometry-notes.md). The local SVG map preserves polygon rings/multipart geometry; the accessible native zone selector and text panel are alternatives to map picking.

## Verification limits

Completed checks: 19 unit tests, 16 external-network-blocked browser tests, TypeScript checks and the isolated build passed. The converter passed 12 tests, including deterministic regeneration from the frozen real archive. The retained M1 suite passed all 110 tests and lint. See the [verification report](../docs/reports/m2-cesium-prototype.md).

Mock tests do not prove that Google imagery loads, attribution is complete, ground-clamped TLC polygons stay visible, or 3D picking works. Those require one user-authorized live check with a suitable token. Token permissions and URL restrictions must be reviewed separately in the ion account. September 2026 M1 ingestion remains separate and unchanged; see the [prototype specification](../docs/specs/m2-cesium-prototype.md) for deferred scope.
