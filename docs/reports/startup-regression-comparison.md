# Reported blank-city startup delay

Christopher reported a 10–30 second blank wait on `a4f9fb4`, before any city appeared, and authorized temporary servers for diagnosis. This report does not resolve that report or claim a speed improvement.

## Protocol

Compared main checkpoint `dfff7dc` with branch checkpoint `a4f9fb4` sequentially in the **same** `nyc-refinement` worktree, using the same loopback port, `npm run dev:live`, default opening camera, default hull cutout and `?diagnostics=1`. Each scene was stopped before the next run. No builds or test suites ran during measurement. Actual in-app-browser viewport was read back as 577 × 871 CSS pixels at DPR 2; canvas 577 × 809 CSS pixels, drawing buffer 865 × 1213. This is not a reproduction of an independently controlled Chrome/device environment.

Two ordinary runs per version were followed by a separate `--force` dependency-rebuild run per version. Browser and provider caches were **not cleared**. The latter runs are not certified cold-cache tests. Provider/network conditions and run order were not randomized. Vite reported a 186 ms ready time on the first server; that is not the city-visible time.

## Recorded results

All values below are milliseconds from application diagnostics initialization during main-module evaluation, **not from browser navigation**. Engine import values are span durations; they are not additive to the event times.

| Run | Engine import | First tile-bearing frame | Detail settled |
| --- | ---: | ---: | ---: |
| Main A1, warm | 18.3 | 764.4 | 1359.9 |
| Main A2, warm | 18.8 | 772.5 | 1325.3 |
| Branch B1, warm | 28.3 | 775.4 | 1424.8 |
| Branch B2, warm | 38.1 | 843.1 | 1432.0 |
| Branch, forced dependency rebuild | 25.9 | 551.5 | 1155.8 |
| Main, forced dependency rebuild | 20.0 | 748.1 | 1351.4 |

The warm branch runs were slightly slower in these small samples; they did not reproduce the reported much longer blank-city wait. The forced-rebuild result changed direction. These results establish neither a reliable speed improvement nor the cause of the user's slow run. City imagery was visually inspected after arrival, and each scene was explicitly unloaded afterward. First tile-bearing frame is an event-based proxy, not a pixel-coverage or center-building-quality measurement.

Numeric records are preserved in [startup-regression-samples.json](startup-regression-samples.json). They contain no provider URLs or credentials.

## Remaining hypotheses and measurement gap

Source review confirms that the branch changes early engine-import scheduling and progress presentation, not camera, tile SSE, DPR, cache budget or provider waits. The early import could compete with geography processing on a slower/cold device, but that did not establish an attributable delay here.

The worktree's `node_modules` symlink shares the original repository's physical `.vite/deps` cache. The pinned Vite implementation includes absolute project root in `getConfigHash`, so switching those roots can invalidate dependency preparation. This is a confirmed cache-risk path, **not proof** that it caused the user's wait. Forcing preparation did not reproduce a major delay in this session.

Existing app diagnostics omit time before main-module evaluation. The next useful slow-run trace must include browser navigation through app initialization as well as engine import, metadata, first imagery and settled detail, ideally in the user's actual browser. An ordinary warm reload cannot resolve a cold first-visit report.

## Diagnostic follow-up

Added the opt-in numeric `page.toApp` label: a `performance.now()` snapshot during diagnostics initialization, relative to the document's performance time origin. Existing phase/event origins remain unchanged. This separates time before application startup from subsequent engine/provider work on a future slow run. Disabled diagnostics do not read the snapshot; unsupported, negative and nonfinite snapshots are omitted. No resource URLs, tokens or navigation details are recorded.

A separate 1280 × 720, DPR 2 probe verified the new label live (`page.toApp` 45 ms). Its first-frame event was 1022.1 ms and settled detail 2733.8 ms after app initialization. Another previously unloaded preview was found active at the end of this probe; its activation time was not established. Therefore this probe verifies instrumentation and visible imagery, **not isolated performance**, and must not be compared against the six matched-width samples. The additional record preserves that limitation.

Independent QA passed all 117 unit tests, TypeScript and whitespace checks; it also verified all six table rows against numeric evidence and reviewed the diagnostic-only path. No new full browser suite or build was run for this small instrumentation change. The earlier branch build remains historical evidence, not a fresh build claim.

No normal loading behavior was changed as a speculative fix. The 10–30 second blank wait remains unresolved and the branch remains unmerged. All task-started test servers were stopped, ports 5173–5175 were verified clear, and the worktree was restored to `improve-progressive-city-startup`.
