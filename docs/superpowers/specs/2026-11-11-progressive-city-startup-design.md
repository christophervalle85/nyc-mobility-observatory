# Progressive city startup

The user wants an intentional starting point that appears sooner and gains detail smoothly. Keep the existing source-derived Midtown opening and Cesium's center/progressive tile prioritization. Remove serialized local work by warming only the engine module while local geography loads, then report actual imagery milestones instead of equating attached metadata with visible buildings.

Constraints: no servers or provider requests during this work; no token/env reads; no fake imagery, 2D map, camera introduction flight, new dependency or loading percentage. Keep final SSE 16, bounded DPR 1.5, masks, credits and Stop/retry ownership unchanged. An engine module import must never construct a viewer or request tiles by itself. Only configured, visible, live entitled startup may warm it. Stop/pagehide must prevent later scene construction. Failed warming must not cause an unhandled rejection or automatic retry loop.

Approaches: a coarse SSE 32 startup pass was considered but rejected for default use without live evidence: waiting for peripheral coarse tiles could delay center detail. Placeholder city imagery would introduce a misleading extra scene and assets. Chosen approach is overlapping engine preparation plus factual progressive presentation, using existing tile prioritization. No measured speed or seamless visual claim is made until live testing is authorized.

Presentation: show a restrained, nonblocking Midtown starting cue before actual tile-bearing frames. Remove it once imagery appears; the map remains visible throughout. Status distinguishes opening imagery, refining detail and interaction-ready settled detail. No full-screen loading cover or fabricated completion. Error, partial and stopped states take precedence. Stale callbacks after disposal cannot repaint them. Reduced motion gets no mandatory animation.

Validation: deterministic unit tests for engine sharing, warm rejection, visibility/configuration/Stop guards and imagery milestone ordering/disposal; complete units, TypeScript and token-isolated production build. Browser and live cold/warm timing checks are explicitly pending because the server must stay stopped.
