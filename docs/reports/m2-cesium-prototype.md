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

- 19 unit tests passed, including cleanup and retry serialization. Retry waits for
  pending resource creation to settle after Stop, timeout or failure.
- 16 browser tests passed with external network requests blocked.
- TypeScript checks and the isolated, token-free build passed.
- 12 converter tests passed, including two identical exports of the frozen official source.
- The unchanged M1 suite passed all 110 tests and lint.

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

Automated mocks do not establish that imagery loads, credits are complete,
ground-clamped polygons remain visible against the 3D mesh, or 3D picking works.
Those observations and live request origins still need a bounded authorized live
check. Account token permissions, URL restrictions and quota need separate review.
No live acceptance result is claimed here.
