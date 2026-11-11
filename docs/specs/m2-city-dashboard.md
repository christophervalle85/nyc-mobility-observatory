# M2: city-centered dashboard

Status: coordinator accepted within the user-approved realistic-city/dashboard direction; production implementation pending. Baseline inspected: clean `ae33417`. This is a bounded presentation/navigation pass, not completion of M2 data/date/chart work. Browser/live validation remains pending. Independent code_reviewer will explicitly check focus input/network invariants.

## Decision

Make the realistic 3D city the main workspace. Remove the separate SVG/2D map from the normal experience, including unloaded/error states. Use a restrained application shell with compact local-area controls, a dominant city viewport and an inspector for selected-zone identity. Buildings retain their real imagery/materials; the dashboard feel comes from controls and layout, not glowing/translucent buildings. Evolve the existing tokens and visual language with focused layout/accessibility changes, without introducing a new theme. A clearly labeled mock-only geometry surface may remain for offline tests; it is never the normal unloaded/error fallback.

Before explicit **Load 3D**, show an honest unloaded viewport with setup/status guidance, not fabricated city imagery. **Stop / unload**, loading/error/retry state and source attribution remain readily available. The inspector shows name, borough and TLC ID, plus a short “Mobility data is not connected” state. Do not add numerical cards, charts or fake metrics.

## Existing components and ownership

- `web/index.html`, `web/src/main.ts`, `styles.css` and `tokens.css`: frontend_engineer owns the single-viewport layout, compact search/results, inspector, accessible states and URL selection. Remove the normal `#zone-map` rendering/toggling path; a second map is unnecessary.
- `web/src/zones.ts`: extend the existing validated local data contract with pure filtering and finite zone-extent helpers. Use `web/public/data/taxi-zones.geojson` and its provenance unchanged: all 263 official TLC zones, including holes/multipart geometry.
- `session.ts`, `managed-adapter.ts`, `cesium-adapter.ts`: preserve lifecycle ownership while adding guarded, deliberate camera focus. The adapter owns Cesium operations and cancellation; the UI never bypasses the controller.
- `rendering-policy.ts`, `zone-highlight.ts`, `selected-boundary.ts`: retain CSS-pixel resolution scale 1, SSE 16, 512 MiB cache plus 256 MiB overflow, stable material instances, old/new-only fill updates and selected rings.
- qa_engineer verifies offline behavior; code_reviewer independently reviews the diff. documentation_editor records actual commands and remaining limits in the existing report. Coordinator assesses this recommendation; the architect does not self-approve.

The current state/lifecycle and earlier verification limits are recorded in `docs/specs/m2-cesium-prototype.md` and `docs/reports/m2-cesium-prototype.md`. No existing browser result certifies this new layout.

## Search, selection and focus contracts

Search is explicitly “TLC areas,” not address/geocoding search. Filter only the already-loaded local collection by zone name, borough or exact numeric TLC ID; match case-insensitively and sort deterministically. A labeled search input plus a native keyboard-operable result selector is sufficient; no custom combobox dependency is needed. Empty/no-results/loading/unavailable states are explicit. Typing or clearing a query changes results only, preserving the current selected zone.

Resolve every selection/URL ID through the validated collection. Selection updates inspector, source-backed highlight and the existing `?zone=ID` restoration/replaceState convention. It does not load/reload 3D, move the camera or use the network. Invalid IDs produce no focus. Clearing selection removes its details/highlight/URL value without camera movement. Reloading/restoring a selection also never auto-loads or focuses.

A separate **Focus area** action is enabled only for a known selected zone and a ready scene. Mock mode may record/simulate the intent, but never constructs a live viewer. Compute camera bounds from that zone's TLC longitude/latitude coordinates, validating finite ordered extents within the parser's existing NYC bounds. Use all polygon parts, a conservative nonzero minimum span and a bounded viewing range compatible with the current 200–20,000 metre camera limits. Do not derive coordinates/heights from Google content or issue terrain/height queries.

Use one bounded focus movement per deliberate action, with a short fixed maximum duration; reduced-motion uses an immediate view change. Ignore duplicate requests while focusing. Cancel obsolete movement on selection change, Stop, error/teardown or replacement; late completion cannot affect another session. Focus never creates a viewer/tileset, spends a retry, or queues a delayed flight after Load. Explain that camera travel can request additional tiles; it is not quota-free.

## Acceptance and checks

1. **City-first UI:** normal HTML/state paths contain one city viewport and no visible 2D map. Setup, idle, loading, ready, partial, error and stopped remain truthful; inspector metrics are explicitly pending.
2. **Local controls:** unit tests cover name/borough/ID matching, stable results, query clearing/no results, invalid/restored IDs and selection without adapter loads/focus calls. All 263 source zones remain selectable.
3. **Camera boundary:** pure tests cover multipart/hole extents, degenerate/invalid/nonfinite data and bounded targets. Adapter/controller fakes prove explicit-only focus, readiness guards, cancellation, single-flight behavior and reduced motion.
4. **Regression:** retain session drain/retry/Stop, rendering-policy, highlight and selected-boundary tests. Run `npm test`, `npm run typecheck` and isolated `npm run build`; preserve M1 ingestion/data and report retained checks accurately.
5. **Access and safety:** labeled keyboard controls, visible focus, non-color-only selection, polite status and readable credits are required. Small, compact and zoomed layouts keep Stop/status usable and move inspector/results without covering or clipping any attribution. Automated checks keep Vite env loading disabled; existing loopback-only strict ports and token/origin restrictions remain unchanged.
6. **Explicitly pending:** Chrome/browser/E2E/live calls, screenshots, actual camera framing, visual responsiveness and live clamping/picking. Do not run them or inspect tokens while browser approval is pending. Offline checks cannot establish visual quality or live performance.

## Sequence and alternatives

First restructure the shell without changing lifecycle; then add pure local search/extents and guarded focus; finally run allowed checks and independent review. No new dependency, service, geocoder, token/asset change, map layer, backfill, model or deployment is needed.

Keeping the SVG as a fallback conflicts with the approved single-city experience. Automatic flight on each result/keystroke creates motion and tile requests without a distinct action. Both are rejected. ADR candidate: separate local selection from explicit camera focus.

Main risks are accidental auto-load/focus, stale flight callbacks, controls obscuring credits and camera framing across irregular zones. Focus input/network invariants receive focused security review through the coordinator. Browser/live evidence remains a later authorization boundary. No commits or push in this assignment.
