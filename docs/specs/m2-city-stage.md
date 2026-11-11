# M2: the city as the stage

Status: frontend implementation and independent review are complete; no remaining production defect was found. Stable baseline: `aa2ef1e`. Allowed offline checks passed: 72 unit tests, TypeScript, the env-isolated build, whitespace and static shell/DOM checks. Browser, E2E, provider and rendered validation remain pending authorization.

## Outcome and evidence

The configured page should open directly into a realistic, semi-floating NYC visualization, with compact floating local search/controls and an inspector that becomes prominent after selection. The city fills the viewport; remove the masthead/control-row composition that makes it a map panel. Keep a protected, always-visible attribution strip. No normal setup/launcher card, 2D map, glowing/translucent buildings, fake data or fabricated solid terrain base.

Baseline `web/src/main.ts:120,125–138` started only through the Load button after local geography; this contradicts the new automatic-start request. `web/src/cesium-adapter.ts:29,40–46` already disables globe/sky, but starts at longitude −74.008, latitude 40.682, height 6,500 m, pitch −45°, and limits navigation to 20 km. That is local aerial framing, not a fitted whole-city composition. Its native camera controller has no city pivot configured; source inspection cannot establish actual orbit feel.

## Lifecycle contract

Frontend owns a small tested once-per-document startup gate, invoked after validated local geography and usable configuration. Consume its entitlement before calling the existing SessionController load method. Do not trigger from render, selection, URL restoration, resize, pageshow or retry settlement. An initially hidden document may defer its one initial entitlement to the first visible event; later visibility events never restart it. Latch Stop/pagehide before geography resolves so late callbacks cannot start anything. A stopped session remains stopped until deliberate **Resume 3D**.

One automatic attempt counts toward the existing two-attempt budget. Errors never auto-retry. Resume/retry uses the same controller single-flight, drain, timeout and disposal locks; rate-limit/WebGL failures remain non-retryable. Preserve cancellation/generation guards and sanitized errors. Mock/verify mode uses only fake/no scene regardless of configuration; automated builds continue disabling Vite env-file loading. Missing configuration/geography shows an honest compact failure/status, never a normal launcher or fake city.

## Renderer-only cutout

Use five convex hulls from the official TLC zone outer rings, grouped by the five NYC boroughs. Local inspection of `web/public/data/taxi-zones.geojson` found 263 zones and 98,192 total vertices; the five borough hulls require only 250 vertices. Enforce at most six polygons and 384 clipping vertices; never feed the full source geometry into clipping or simplify boundaries from imagery.

Pinned Cesium 1.147's installed `ClippingPolygonCollection` supports `inverse: true`, which retains the union inside the polygons, and `isSupported(scene)`. Attach one collection to the existing tileset. Use a neutral scene background, existing globe/sky-off settings and unchanged realistic tile materials. These are display masks, not extracted/exportable meshes or exact shoreline. TLC hulls include water and other areas; label them “TLC-derived study footprint.” Do not translate/scale the Google model, build a derived underside, sample heights, persist imagery or claim a watertight floating object.

All 263 zones remain searchable. EWR is Newark airport, not NYC: initial overview/cutout excludes it. Selecting it shows an outside-city notice without camera/footprint change. Explicit EWR **Focus area** may add its separately named 61-vertex hull (311 total); caption the result “NYC + Newark airport study area.” **City overview** removes this add-on. Do not silently hide an explicitly focused selection.

If clipping support/budget fails, keep truthful unclipped realistic 3D with a persistent “City cutout unavailable” capability notice. Do not silently substitute 2D, restart the viewer or spend a retry. Full attribution stays visible in either mode.

Reference evidence supplied by the coordinator: [official clipping tutorial](https://cesium.com/learn/cesiumjs-learn/cesiumjs-clipping-polygons/), [clipping API](https://cesium.com/learn/cesiumjs/ref-doc/ClippingPolygonCollection.html), [Google visualization/extraction policies](https://developers.google.com/maps/documentation/tile/policies). This supports technical feasibility, not a licensing guarantee or proof of visual quality.

## Camera and interaction

Compute five-borough bounds/pivot from TLC geometry, not Google heights. The complete source extent is approximately 46.9 × 46.7 km. Fit a bounding sphere using current viewport aspect/FOV plus padding; permit an overview/navigation range up to 180 km instead of the global 20 km ceiling. Keep existing area-focus target range 800–20,000 m. Validate all bounds/ranges as finite and capped.

Set the initial view once without an entrance flight, using a proposed oblique pitch near −35° and modest heading. Fit all five boroughs, not Manhattan alone. Whole-city buildings will inherently look small; retain explicit area focus and a **City overview** reset for detail. No endless orbit or auto-motion after startup; resizing updates layout without repeated flights.

Minimal safe object navigation: retain bounded wheel/pinch zoom and provide compact **Orbit left/right** controls around the current TLC-derived city/area pivot. Disable native globe-style drag rotation/translation, but preserve dragging with the bounded TLC-pivot orbit handler described below. Each deliberate orbit cancels active focus, applies a small heading step with bounded pitch, and uses a one-shot camera lookAt followed immediately by an identity-transform reset. Never retain a lookAt transform across focus, cancellation or teardown. Keyboard controls give the same operation; reduced-motion uses immediate changes. Interaction feel remains pending real/user evidence.

## Ownership, checks and sequence

1. frontend_engineer: startup gate and lifecycle tests first; prove exactly one automatic attempt, Stop-before-geography, pagehide, visibility/pageshow, mock/verify exclusion, no auto-retry and preserved drain/two-attempt behavior.
2. frontend_engineer: pure hull/overview helpers and adapter presentation. Tests prove five-borough coverage, source-only finite bounds, 250/311 vertex counts, budget/support fallback, truthful EWR extension/reset and unchanged token/asset routes.
3. frontend_engineer: viewport-first shell, floating local controls, conditional inspector, protected credits and explicit overview/area/orbit controls. Retain old/new-only highlight updates, selected rings, resolution scale 1, SSE 16 and 512+256 MiB cache policy.
4. qa_engineer/code_reviewer: independently check source/Node tests, TypeScript and isolated build; verify cancellation/identity reset, reduced motion, accessibility semantics, attribution layout rules and unchanged M1/data.
5. Browser/E2E/live/provider tests, screenshots, actual composition, cutout behavior, framing, FPS and rendered accessibility remain pending authorization. No token/env reads, server control, new dependency/service, model/backfill, commit or push in this assignment.

Alternative: one rectangular clipping window is simpler but slab-like and includes surrounding NJ/water. Borough hulls offer a better bounded silhouette while remaining explicitly approximate. ADR candidate: automatic-once city stage with independent renderer-only footprint and explicit local detail navigation. Independent review is complete; no remaining production defect was found. The architect does not approve its own design.


## Accepted implementation adjustments

- If geography is ready while the document is initially hidden, the one automatic entitlement waits for the first visible event. Later visibility events never restart it. Stop and pagehide consume the pending entitlement before late callbacks. Verification mode cannot create a live scene; explicit mock mode uses only the fake adapter.
- Drag remains available as bounded pivot orbit, sharing the one-shot lookAt and immediate identity reset used by the native Orbit/Tilt controls. Wheel/pinch remain enabled, with native Zoom buttons as keyboard/single-pointer alternatives. No persistent lookAt transform or automatic orbit is introduced.
- The initial five-borough fit is immediate, with oblique pitch and an 180 km navigation ceiling. Explicit area focus retains 800–20,000 m targets and a 1.2-second maximum flight duration; reduced motion uses duration 0.
- The render mask is only a TLC-derived study footprint, not a shoreline or exported mesh. Default EWR overlays remain hidden until explicit EWR Focus. Only selected-zone overlays are shown after a settled view observes tileset.tilesLoaded with neither camera nor focus moving. The existing allTilesLoaded event is a hint; an owned postRender listener also checks cached navigation and load completion before moveEnd. It does not poll or request provider data and is removed on disposal. Metadata/root readiness still reports scene-opened/detail-streaming, not completed imagery.
- City-click selection uses a camera ray/ellipsoid intersection plus local TLC point-in-polygon, including holes/multipart. It does not sample Google heights. Oblique roof/ground projection is approximate; the native area list is the fallback.
- Browser/E2E/provider tests and screenshots remain unexecuted while approval is pending. Source/Node checks do not establish rendered clipping, framing, interaction feel, FPS or credit layout.


## Offline implementation evidence

`npm test` completed with 72 passing tests, including automatic-start/Stop/drain integration, 250/311-vertex hull counts, clipping-budget/capability fallback, bounded orbit/zoom identity-reset behavior, source-only point selection, cached/post-movement detail restoration, cumulative slow dragging and disabling an existing cutout when an extension exceeds its budget. `npm run typecheck`, env-isolated `npm run build` and `git diff --check` passed. The static shell check found 30 referenced elements with none missing, one city viewport, no SVG/2D map, six native Orbit/Tilt/Zoom alternatives and a credit footer outside the scene overlays.

The official geography hash remains `01f2d4cec934e163588f8f2ac10880fbf2ee908fcf7f891da65e745c8578b58f`; no core, exporter, geometry or dependency change is part of this patch. E2E source is updated but unexecuted. No browser, provider request, screenshot, token/env inspection or server control was used for these checks. These checks do not establish actual framing, cutout appearance, drag feel, FPS, rendered accessibility or attribution visibility.


Targeted review fixes were reproduced RED, then verified in the 72-test rerun: cached orbit/zoom and early load-completion no longer leave selection hidden; repeated 1 px pointer motion accumulates from the last applied position without suppressing ordinary clicks; and a successful city mask is disabled before an over-budget EWR extension reports an unclipped fallback. Browser/live confirmation remains pending.
