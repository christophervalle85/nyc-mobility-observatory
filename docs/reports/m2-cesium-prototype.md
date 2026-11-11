# M2 local map prototype

The bounded prototype provides a local TLC taxi-zone map, zone selection and an
optional Cesium ion Google Photorealistic 3D Tiles scene. M1 ingestion is unchanged.
Date filters, mobility counts, statistical charts, models and deployment are not implemented.

## Try it

```sh
cd web
npm ci --ignore-scripts
npm run dev:live
```

Open <http://127.0.0.1:5173>. This loopback-only preview has no file watching or hot
reload. Local geography works without a token. Follow the [web README](../../web/README.md)
for public client-token setup, quota precautions and attribution requirements before
selecting **Load 3D**. Token restrictions, asset enablement and account quota are not verified.

For a mock session that disables Vite env-file loading and uses an empty client token:

```sh
npm run dev:verify
```

Open <http://127.0.0.1:5174/?mode=mock>. Mock mode never creates a Cesium viewer.

## Completed checks

- The rendering/selection update passed 29 unit tests, TypeScript checks, the
  isolated token-free build and diff checks.
- Before this update, 16 external-network-blocked browser tests and 12 converter
  tests passed, including deterministic exports of the frozen source. The retained
  M1 suite passed all 110 tests and lint. Browser checks were not rerun for this
  update; core ingestion and source geometry are unchanged.

## Rendering and selection update

Rendering uses CSS-pixel resolution at scale 1, without dividing again by device
pixel ratio. Native 2× supersampling is not enabled. The artificial 30 FPS cap is
removed; request-render mode and disabled clock animation remain. Tiles use
screen-space error 16, a 512 MiB cache target and 256 MiB overflow allowance. These
settings are not a hard total-memory limit and can increase bandwidth/memory use.
See the [Viewer reference](https://cesium.com/learn/cesiumjs/ref-doc/Viewer.html) and
[tileset reference](https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html).

Indexed fills change only the old and new selection groups. Offline checks across
354 actual Cesium entities reduced repeated-selection `definitionChanged` events
from 1,062 to zero; selection from zone 161 to 79 emitted two events. These are
property-event counts, not live frame-rate measurements. Explicit clamped ring
lines mark the selected zone while preserving holes, multipart geometry and cleanup.

To load updated code, select **Stop / unload**, restart `npm run dev:live`, then
refresh the page. File watching and hot reload are disabled.

From `web/`, rerun the frontend checks with:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Build and browser-verification commands disable Vite env-file loading. The live
preview intentionally loads the user's public client token; browser-exposed tokens
are not secrets. The browser tests use an isolated loopback server on port 5175.

## Geography and source limits

The versioned official TLC overlay contains 263 zones. The offline converter
preserves source IDs, multipart polygons and full projected coordinates. It uses
no imagery-derived boundaries or heights. Raw trip/subway data and local credentials
remain ignored. [Geometry notes](../../web/geometry-notes.md) contain the frozen-source
reproduction command, provenance, projection accuracy and validation limits.

## Live verification pending

A user-supplied pre-update screenshot shows Google/Cesium imagery, East Village
(79) highlighted and visible credits. This is limited visual evidence, not proof
of complete attribution compliance, token permissions or quota settings.

The updated rendering quality, live frame rate, overlay clamping and 3D picking
remain unverified. Updated live acceptance and request-origin checks are pending.
Account token permissions, URL restrictions and quota require separate review.
