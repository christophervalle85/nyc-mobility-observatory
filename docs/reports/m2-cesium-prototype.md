# M2 city-stage prototype

Latest follow-up: see [city loading and interaction diagnostics](city-performance-diagnostics.md) for the outline/selector fixes, optional DCP land mask, measured tradeoff and current validation. The sections below preserve the earlier presentation checkpoint evidence.

Status: city-stage presentation is refined; limited desktop/narrow-screen live inspection and automated browser regression checks completed. Christopher's visual acceptance and quantitative performance measurement remain pending.

## Presentation refinement — November 11, 2026

- The page now opens directly at the Midtown skyline using the local TLC extents of areas 161, 162, 163, 164 and 230, with an oblique camera pose. Missing skyline geography falls back to the existing full-city fit. Overview still resets to all five boroughs.
- Large pale panels were replaced with a compact bottom toolbar, independent selection inspector, quiet heading/status and a smaller attribution strip. Find/View use exclusive native details menus; Sources & usage retains the quota explanation in the footer. All external imagery credits remain visible.
- 76 unit tests, TypeScript, the token-isolated production build, 24 mock/verification browser tests and whitespace checks passed. Browser tests include 320/640/1440px layout, menu exclusivity, selection, Stop, retries, reduced motion and 200% text.
- Live desktop (1440 × 900) and narrow in-app preview inspected the opening composition. This is limited visual evidence, not an FPS/memory benchmark, general device certification or account/quota verification.
- Clipping geometry is unchanged. Angular TLC hull edges remain visible in overview and some camera positions; this pass improves composition without claiming exact shorelines or a solid floating model. Data ingestion, official geography, exporter and dependencies are unchanged.
- The design detector reported four warnings: two root overflow warnings and two nested-surface warnings. These refer to the viewport-bound floating menus and their toolbar. Menu visibility/fit is covered by browser tests; they were retained intentionally rather than treated as proof of a rendering defect.

### Specialist verification follow-up

Separate delegated architect, frontend and QA workers used the saved role instructions in `~/.codex/agents`; this was not native local-profile invocation (the CLI rejected its configured model). Named optional architecture/Hallmark/Jakub/verify-change skills were unavailable, so workers used the actual repository and package commands.

The architect found no additional architecture blocker and recommended bounded accessibility fixes. QA reproduced five failing browser cases before frontend changes: inspector focus obscured by a menu at 320/640px, toolbar label overflow at 320px/200% text, and Escape dismissal for area and source menus. The frontend agent added focus-exit/Escape dismissal and toolbar wrapping with intrinsic control widths. QA then verified 76/76 unit tests, 24/24 browser tests, TypeScript, the isolated build and whitespace checks. Parent inspected the refreshed live view and Escape interaction. No failing checks remain; this is not a performance benchmark or user visual acceptance.

The remaining sections record the earlier prototype and its historical checks.

The bounded prototype provides one city viewport, local TLC search, zone selection, explicit camera focus and an
optional Cesium ion Google Photorealistic 3D Tiles scene. M1 ingestion is unchanged.
Date filters, mobility counts, statistical charts, models and deployment are not implemented.

## Try it

```sh
cd web
npm ci --ignore-scripts
npm run dev:live
```

Open <http://127.0.0.1:5173>. This loopback-only preview has no file watching or hot
reload. Local search and selection work without a token; the unloaded viewport shows status guidance. Follow the [web README](../../web/README.md)
for public client-token setup, quota precautions and attribution requirements before
opening the configured page. It now makes one automatic startup attempt after geography
validates and the page is visible. Stop cancels pending startup and prevents auto-resume;
Resume is deliberate and retains the two-attempt/drain guard. Token restrictions, asset enablement and account quota are not verified.

For a mock session that disables Vite env-file loading and uses an empty client token:

```sh
npm run dev:verify
```

Open <http://127.0.0.1:5174/?mode=mock>. Mock mode simulates controls and state without a Cesium viewer, imagery or a 2D map.

## Current revision

The final revision passed 72 unit tests, TypeScript checks, the env-isolated build and diff checks. Independent QA repeated these checks successfully. Offline M1 pytest passed 110/110 tests, Ruff lint and formatting passed, and the exporter passed 12/12 tests. The protected core/data/converter diff against `aa2ef1e` is clean. Independent review reran all 72 tests, TypeScript and diff checks and found no remaining production defect. The full-window shell, source-only footprint and navigation are implemented. Visual/live acceptance remains pending. Five borough hulls use 250 vertices; explicit EWR focus adds 61 (311 total), and City overview resets the footprint. These are renderer-only masks on realistic tiles, not an extracted model, exact shoreline or fake base. Unsupported clipping leaves an explicit capability notice.

Bounded drag/buttons/tilt/zoom and overview use local TLC bounds. The implemented, unit-tested picker intersects the camera with the ellipsoid and checks local TLC polygons. It is approximate and does not sample mesh surfaces or heights. Live picking accuracy remains unverified.

## Historical city-dashboard checks

- The city-dashboard update passed 46 unit tests, TypeScript checks (including updated E2E source), the isolated token-free build and diff checks.
- Static checks found all 26 required DOM IDs among 30 unique IDs, one normal city viewport and no 2D/SVG map. All 263 local zone IDs resolve to finite bounded focus targets; actual ranges were 1,057–20,000 metres.
- M1's 110 tests and all 12 converter tests passed again. Core source, geography and exporter are unchanged against `ae33417`; 27 protected files matched.
- Updated E2E source was not executed. The earlier 16 browser-test passes are historical, not evidence for this layout.

## Local search and deliberate focus

Compact TLC search filters name, borough or exact ID. Typing/clearing preserves selection. Selection and URL restoration update the inspector/highlight without auto-loading or camera movement. The inspector states that mobility data is not connected.

A separate ready-only **Focus area** action uses local source geometry, an 800–20,000 metre range and maximum flight height of 20,000 metres. Duration is 1.2 seconds, or zero for reduced motion. Duplicate, cancellation and stale-session guards prevent obsolete movement. No new asset, service, geocoder or height query is added; camera movement can still request more tiles. Building materials remain realistic, with a lighter selection overlay.

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
refresh the page. The restarted preview returns HTTP 200 at `http://127.0.0.1:5173/`. Served HTML confirms the city stage, one viewport, no SVG, an initially hidden Resume control, six view buttons and a credit footer. This is HTTP/source evidence only, not rendered/live verification or confirmation of a user refresh. File watching and hot reload are disabled.

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

The city-stage layout, cutout, navigation, approximate picking, focus framing, rendering quality, live frame rate, overlay clamping,
3D picking and rendered accessibility remain unverified. Updated live acceptance and request-origin checks are pending.
Account token permissions, URL restrictions and quota require separate review.
