# City presentation implementation plan

**Goal:** Improve the inspected city-stage composition using existing Cesium imagery.
**Spec:** Christopher approved the preceding live-inspection findings and requested optimization around them.
**Architecture:** Add source-derived skyline opening framing; preserve the explicit whole-city overview, startup and quota guards. Refine the existing UI with compact light controls over the dark scene. No imagery processing, new dependency or data integration.

## Acceptance
- Opening shows a closer angled Manhattan skyline; City overview still fits five boroughs.
- Opening bounds derive from official local TLC geography. They never depend on imagery or height sampling.
- Keep approximate existing clipping and honest attribution; do not claim shoreline repair.
- Desktop and narrow screens keep substantial clear city space. Search, selection, focus, Stop, retries and keyboard controls remain usable.
- Preserve token isolation for automated tests/builds; never inspect credentials.

## Task 1: Opening composition
- [x] Write and run failing tests for source-derived skyline framing, invalid/missing geometry and opening-to-overview navigation.
- [x] Implement skylineOpening in study-footprint.ts; add opening pose in stage-navigation.ts and wire initial camera in cesium-adapter.ts.
- [x] Run frontend tests and typecheck.

## Task 2: Compact controls
- [x] Refine index.html/styles.css/tokens.css and ready-state copy in main.ts, preserving DOM control IDs and truthful failures.
- [x] Verify existing E2E flows and add responsive layout coverage that catches obscured city, attribution or overlapping controls.
- [x] Run frontend tests, TypeScript, token-isolated build and E2E. Inspect live desktop/mobile in one batch, fix observed problems once, confirm.
- [x] Update report with actual verification and limits, then save a meaningful local Git checkpoint. Do not push.

## Review focus
Narrow/short viewports; selected inspector with expanded controls; missing skyline reference zones; Stop before startup; overview after area focus. Existing lifecycle tests cover cancellation; targeted tests and rendered checks cover framing and layout.

## Specialist verification follow-up

Christopher requested his architect/frontend/QA workflow. The native local CLI could not invoke agents because its configured model was rejected; with Christopher's subsequent authorization, separate delegated workers apply the saved profiles in ~/.codex/agents. This is not native profile invocation.

- Architect: assess the actual diff, scope and bounded improvement criteria (read-only).
- QA: reproduce keyboard-focus occlusion and enlarged-text toolbar overlap in bounded test files before fixes.
- Frontend: implement approved bounded fixes after architect assessment and failing tests.
- Parent: integrate findings, rerun appropriate checks, inspect the rendered result, save a local checkpoint without pushing.

## Completed verification

Architect assessment found no additional architecture blocker. Frontend fixed bounded keyboard/menu and enlarged-text problems in main.ts/styles.css. QA independently reproduced five RED browser cases, then confirmed GREEN: 76 unit tests, 24 browser tests, TypeScript, isolated build, whitespace checks. Core/data/exporter/dependency diff against 2b5e6ea is empty. Parent inspected the refreshed live scene and Escape dismissal. Angular clipping remains unchanged; no FPS claim is made. Local checkpoint only; no merge or push.
