# Progressive city startup

The startup now overlaps local engine preparation with geography loading and reports actual imagery milestones. It keeps the existing source-derived Midtown camera, SSE 16, bounded 1.5 DPR, cache limits, clipping, credits and focus behavior.

## Engine preparation

`engine-loader.ts` shares one local module promise between optional warming and the gated scene load. `main.ts` warms before geography loading only when the document is configured, visible, live (not mock or verification), and still entitled to its initial startup. The visibility handler prepares the module before asking the existing gate to attempt startup.

Warming imports local code only; the existing gate still owns viewer/provider construction after geography validates. Stop/pagehide may leave an unabortable module import finishing, but the disposed adapter cannot construct its delegate afterward. Warm rejection is handled and cached without a visibility-driven retry loop. Explicit Resume/Retry can clear a failed import; successful preparation is reused.

## Actual image arrival

`imagery-progress.ts` owns the first `tileVisible` followed by its `postRender` callback. This runs regardless of diagnostics mode. It distinguishes waiting for a tile-bearing frame, visible imagery refining, and the existing stationary/detail-ready state. An early cached-detail signal is retained until a real tile-bearing frame completes, avoiding a settled-to-refining regression.

The session's resource-ready phase is unchanged and is not presented as proof of visible imagery. Stop, error, partial, mock and missing-geography presentation take precedence. Disposal removes owned listeners and ignores captured late callbacks. Camera movement returns the visible scene to refinement wording without restoring the starting cue.

A single nonblocking header line names Midtown Manhattan as the starting point until the first tile-bearing frame. It introduces no city placeholder, extra map, percentage, loading cover, entrance flight or animation. Status after imagery arrival refers to the city rather than claiming that the user is still looking at Midtown after navigation.

## Verification and limits

Independent QA reran the complete Node suite: all 114 tests passed, including ten new tests for shared import/rejection/manual retry, eligibility/Stop guards, actual tile/frame ordering, cached readiness ordering, movement, disposal and presentation precedence. TypeScript, the token-isolated production build and whitespace checks passed. The reviewer identified that settled imagery could advertise interaction before area resources finished loading; the added regression now requires “City visible. Preparing area controls…” until the session is ready. QA inspected the shared-import, original startup entitlement and disposed-callback wiring.

No server, browser, E2E, provider or credential access was used for this implementation. The user-owned server discovered by the parent was not used, restarted or stopped. Browser layout/accessibility, real arrival feel and comparative cold/warm latency remain unverified; overlapping two local phases is not a measured speed or seamless-refinement claim. A coarse SSE 32 startup pass was deliberately not added without live evidence.
