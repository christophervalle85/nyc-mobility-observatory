# Progressive City Startup Implementation Plan

> **For agentic workers:** Use the configured frontend specialist for scoped implementation and QA/reviewer specialists for independent verification.

**Goal:** Reduce avoidable engine startup serialization and give the existing prioritized Midtown scene an honest, continuous arrival.

**Architecture:** Share a lazily warmed module promise while preserving the existing geography/visibility/startup gate. Use tile-bearing postRender and detail-readiness events for presentation; keep rendering policies unchanged.

**Tech Stack:** TypeScript, Cesium 1.147.0, Vite, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-11-progressive-city-startup-design.md`

## Global Constraints

- No servers, browser runs, provider requests or token/env reads.
- Preserve Stop/retry and visibility entitlement; warm imports never construct scenes.
- Keep SSE 16, DPR cap 1.5, credits, clipping and final quality unchanged.

## Review Focus

- Stop/pagehide during module or geography loading must prevent viewer creation.
- Rejected prefetch must be handled without retries on visibility churn.
- Late image callbacks after disposal must not overwrite stopped/error presentation.
- Root-ready with no rendered tiles must remain honestly in an opening state.
- Partial failures and missing geography must not leave a misleading opening cue.

## Task 1: Engine preparation

- [x] Add failing unit coverage for shared warm/load import, handled rejection and explicit retry.
- [x] Implement a small engine loader and wire `main.ts` to warm only during entitled visible live startup, in parallel with geography; preserve gate semantics.
- [x] Check units and TypeScript; inspect no viewer/provider work before the existing gate.

## Task 2: Progressive presentation

- [x] Add failing tests for first-frame/detail/movement/disposal transitions and presentation precedence.
- [x] Wire `cesium-adapter.ts` actual tile-bearing postRender and detail readiness to a lifecycle-guarded presentation callback.
- [x] Update `main.ts`, `index.html`, and existing CSS for a nonblocking starting cue and opening/refining/ready wording, with no map cover or fake percentage.
- [x] Run complete units, TypeScript, isolated build and whitespace checks; have an independent reviewer inspect lifecycle wiring.
- [x] Record source changes and verification limits in a report.
- [x] Create meaningful local commits only; no push/merge until requested.

## Deferred live validation

- [ ] Browser layout/accessibility and provider-backed progressive arrival checks, only after explicit authorization to run servers.
- [ ] Comparative cold/warm startup timings and actual refinement feel; no measured speed or seamless visual claim yet.
