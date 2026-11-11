# M2 visual spike: Cesium NYC prototype

Status: the bounded local prototype and offline geometry converter are implemented.
Automated checks passed: 19 unit tests, 16 external-network-blocked browser tests,
TypeScript checks, the isolated build, 12 converter tests and the retained 110-test
M1 suite plus lint. Live imagery, attribution, overlay clamping and 3D picking
verification remain pending. This does not complete the original M2 date/zone/chart scope.
See the [verification report](../reports/m2-cesium-prototype.md).

## Design and boundaries

Use isolated `web/` Vite + TypeScript + CesiumJS, pinned dependencies and lockfile. No server/framework. Preserve `src/nyc_mobility/`, Python dependencies, tests and frozen `.data/` bytes. Existing provenance is in `src/nyc_mobility/acquisition.py`; source-coverage limits remain in `README.md` and `docs/reports/m1-pilot.md`.

A controller owns UI state; a Cesium adapter owns one Viewer/tileset and cleanup; a zone module owns local GeoJSON, styling and selection. Setup/mock mode makes no external requests. Only **Load 3D** starts live tiles. Disable duplicate loads; distinguish loading, ready, partial streaming and sanitized failure. Allow one manual retry, no automatic loop/reload. Timeout/Stop must clean up late results and handlers. Use `requestRenderMode: true`, no clock animation, one fixed NYC camera and conservative memory/detail settings. This reduces idle rendering, not billing. Disable default imagery, terrain services, geocoder and asset pickers.

## Verified tile route and token

[Cesium's tutorial](https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/) recommends CesiumJS 1.124+. Current reference source is [tag 1.147](https://github.com/CesiumGS/cesium/blob/1.147/packages/engine/Source/Scene/createGooglePhotorealistic3DTileset.js): `createGooglePhotorealistic3DTileset(apiOptions, tilesetOptions)` selects ion asset 2275207 without a Google key. Minimal fixed route: `Cesium3DTileset.fromIonAssetId(2275207, {showCreditsOnScreen: true, ...})`, using `Ion.defaultAccessToken` only after Load. Pin a release matching the verified API. No arbitrary asset/URL input or separate Google key. The [direct Google API](https://developers.google.com/maps/documentation/tile/3d-tiles) instead requires its own Google project, key and billing; its older Cesium 1.105 examples are not the current async API.

The user alone edits ignored `web/.env.local` with `VITE_CESIUM_ION_TOKEN`; never request, read, print, log or commit it. Bundled VITE values are browser-visible. Use public `assets:read` with minimum asset/URL access, never administrative scopes ([token guidance](https://cesium.com/learn/ion/cesium-ion-access-tokens/)). Asset enablement remains a prerequisite, not a verified fact. Fixed requests go through ion asset metadata and its official tiles route, never token-bearing arbitrary URLs. No geocoder is needed; if added, only Google's may accompany Google content ([usage guide](https://cesium.com/learn/ion/content-usage-and-attribution-guide/)). Keep tileset credits/Google attribution visible, with TLC credit separate. No extraction, tracing, persistent imagery cache or derived statistics ([Google policies](https://developers.google.com/maps/documentation/tile/policies)).

## TLC geometry contract

Prefer an offline converter under `web/scripts/` over a new endpoint. M1 already archived the [official TLC ZIP](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page), SHA-256 `f6d711917bb4340f8f644d5366c51665489eb2d426dd1a4a55677721ae5adf17`. Its inspected PRJ is NAD83/New York Long Island StatePlane, US survey feet (EPSG:2263), not longitude/latitude.

Use isolated pinned pyshp + pyproj, or an equivalently reputable JS parser/projection pair. Verify the archived hash; read only bounded expected ZIP members without extract-all; export WGS84 longitude/latitude with explicit axis order. Preserve holes/multipart geometry, source `LocationID` (not `OBJECTID`), name and borough. Validate geometry, NYC bounds and archived lookup joins. A sidecar records source terms/credit, input/output hashes, CRS and converter/dependency versions. Frozen assets remain unchanged; do not invent boundaries.

Load local GeoJSON using [GeoJsonDataSource](https://cesium.com/learn/cesiumjs/ref-doc/GeoJsonDataSource.html), ground clamping and translucent styling. Ellipsoid height zero can put polygons below the mesh: actual clamping/picking remains a live acceptance check. Do not sample/export Google heights. Selection shows zone ID/name/borough as text, metrics explicitly pending, with a zone-list fallback.

## Acceptance and delivery

1. Controller: no-token/mock startup makes zero external requests; setup/load/error states work with keyboard input and mock mode is labeled.
2. Adapter: mocked success/auth/rate-limit/timeout/partial failure/teardown prove single-flight loading, bounded retry and no token-bearing error leakage.
3. Converter/overlay: offline regeneration is deterministic; CRS, holes, IDs and lookup checks pass; selection uses source metadata.
4. Local checks: TypeScript/build/tests and retained M1 pytest/lint pass; inspect no-token UI/credits without live calls. Automated build/tests disable Vite env-file loading with `envDir: false` or an empty envDir; token overrides alone are insufficient. Dev/preview bind only to loopback with a strict port.
5. Live check, pending: one user-authorized bounded NYC session verifies imagery, attribution, overlay height/picking and request origins. Record sanitized findings without token-bearing URLs. Never run automatically in tests/CI.

Controller/mock mode and offline overlay are implemented; authorized live verification remains pending. ADR candidate: isolated static client, fixed ion asset and independent overlay. Risks: public token exposure, quota use, availability, WebGL/occlusion and source terms. Framework/service, direct Google key and new GeoJSON service add unnecessary boundaries. Date controls, statistical charts, backfills, models and deployment are deferred. Local meaningful checkpoint commits are authorized under the user's standing instruction; push and deployment remain unauthorized.
