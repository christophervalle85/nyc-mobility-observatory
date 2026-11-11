# City loading, feedback and land-cutout refinement

Christopher requested diagnostics for slow initial loading and area clicks, and a less artificial map edge. Baseline: `595936f`. Keep the city interactive and directly loaded, without a 2D map, launcher or fabricated base.

## Decisions

- Measure local CPU work, tile root readiness, first rendered tiles, detail settlement and deliberate camera flight separately. Diagnostics are opt-in and bounded. Disabled mode adds no profiling clocks, observers, timers or render listeners. Never record credentials, provider URLs or raw errors.
- Keep the source-derived selection outline through camera movement and tile refinement. Gate fill independently. Preserve the 1.2-second focus flight and zero-duration reduced-motion behavior. Reuse native option nodes when selection changes within unchanged filtered results.
- Keep TLC geometry for area identifiers, picking, focus and data joins. Derive a separate display mask from official DCP 26c water-excluded land geometry. GEOS/PROJ remain isolated, pinned offline exporter tools; no browser or core package dependency is added.
- The initial 4,096-position trial could not meet both topology and the sampled deviation limit. The approved 8,192-position trial retained all dissolved land components with 20 m simplification. Numerical union-hole artifacts were later removed without changing any emitted outer coastline coordinate or the genuine water-hole array. The final optional asset has 88 components, one hole and 5,546 positions.
- Keep the land trial behind `?cutout=land` until matched live rendering is acceptable. Construct the clipping collection once with its complete polygons and holes; do not rebuild on ordinary selection. Invalid, missing or unsupported optional land geometry produces an explicit unclipped fallback, never a silent convex-hull substitute.
- Bound optional land fetch and body decoding to three seconds. Local TLC controls become usable before that wait. Preserve Stop, retry, drain and no-autoresume contracts.

## Validation

Architect: source-grounded cause analysis and geometry alternatives. QA: RED regressions and final checks. Frontend: runtime changes. Geometry worker: frozen source, derivation, provenance and validation. Independent reviewer: correctness and disclosure. Parent: live measurements and the default-mode decision.

A next scene frame, CPU render timing or passing correctness test does not establish GPU FPS, visible clamped-pixel latency or universal network speed. Report browser, viewport, cache and device limits.

## Bounded trial outcome

The full 88-component, 43-hole trial regressed live detail settlement and CPU render timing. Its 42 numerical hole artifacts were removed while retaining all coastlines and the genuine water hole. The cleaned trial still settled in 6.13 seconds versus 2.03 seconds for the matched local hull control, with greater CPU stalls.

Keep the natural mask opt-in and the default hulls unchanged. Retain the feedback and selector fixes. Further edge/rendering work needs a new scoped architecture decision; no additional unmeasured tuning is included in this pass.
