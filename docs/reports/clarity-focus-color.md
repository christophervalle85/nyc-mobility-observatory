# Clarity, focus and photographic color follow-up

Branch: `improve-city-clarity-focus-color`, based on merged `8e4a350`. Christopher requested a separate commit for each issue.

## 1. High-density canvas clarity

The old policy always rendered one drawing-buffer pixel per CSS pixel, even on a DPR 2 screen. The new policy uses physical DPR once, capped at 1.5, with a finite fallback of 1. SSE 16, cache limits, dynamic SSE, request-render behavior and the optional natural mask are unchanged.

Live browser checks confirmed DPR 2 with a 577 × 798 CSS canvas previously drawing at 577 × 798, and the new policy with a 1280 × 676 CSS canvas drawing at 1920 × 1014. These are verified pixel ratios, not a matched performance or image-sharpness benchmark: the preview dimensions changed between captures. The new canvas supplies up to 2.25 times the pixel count; it does not guarantee finer streamed mesh or texture detail.

All eight rendering-policy tests, TypeScript and whitespace checks passed. Tests cover fractional DPR, high-DPR cap, invalid values and unchanged tile/cache policy. A final complete frontend suite follows the remaining scoped work.

## 2. Focus flight

Source inspection of the pinned Cesium camera flight path established that `maximumHeight: 20000` requests a high flight apex rather than merely limiting altitude. The adapter no longer supplies that constant. It preserves current heading/pitch and synchronizes navigation with the actual arrival orientation, so a subsequent orbit does not reset the view. Flight duration remains 1.2 seconds, or zero for reduced motion.

Existing focus generation ownership now returns callback acceptance; the adapter checks it before arrival/navigation mutations. Stale, canceled and duplicate completions cannot update the navigation state. No second generation state machine or custom height projection was added.

QA independently verified 14 focus/navigation tests, TypeScript and whitespace checks. A local live Midtown focus was inspected during flight and after arrival: it reached the close area view without the previous forced high-altitude detour, preserving its oblique orientation. This is limited visual evidence, not an altitude-sampled trajectory or device-wide animation benchmark.

## 3. Photographic color boundary — unresolved

Christopher identified lighter imagery around Central Park and below it, with a darker Midtown area even when no area was selected. That observation does not match a selection-only tint explanation, so the selected fill, outline colors and imagery textures were not changed.

A single controlled trial compared the default scene with an opt-in `CustomShader({lightingModel: LightingModel.UNLIT})` override. It supplied no shader text, uniforms, textures, opacity changes or color grading. Both captures used the same opening pose, a verified 1280 × 720 viewport, DPR 2 and no selection. The saved PNGs are byte-identical, with SHA-256 `d6d4a6955221cb738178166238251bc4da07b6d9cc991f29721a190020312cb6`:

- [Control capture](</Users/cvalle/Documents/Codex/2026-11-11/task/nyc-color-control.png>)
- [Unlit trial capture](</Users/cvalle/Documents/Codex/2026-11-11/task/nyc-color-unlit-trial.png>)

These are local evidence artifacts outside the Git repository. The result establishes no visible improvement in the recorded view; it does not identify the exact capture date, processing boundary or underlying material of the darker area. A difference in the photographic source content remains an inference, not a proved asset-level diagnosis.

The trial was rejected and all of its runtime changes were removed. `main.ts` and `cesium-adapter.ts` match focus checkpoint `b5eb7e7`; the committed clarity and focus fixes are preserved. No `lighting` query flag, custom shader or blanket color correction is shipped. Sources & usage now explains that photographic tones/shadows come from imagery and that no mobility-data color overlay is applied. The color mismatch remains unresolved.

Reference context:

- [Google Photorealistic 3D Tiles documentation](https://developers.google.com/maps/documentation/tile/3d-tiles) describes a mesh textured with photographic imagery.
- [Cesium CustomShader documentation](https://cesium.com/learn/cesiumjs/ref-doc/CustomShader.html) documents the lighting-model override and application-owned shader cleanup used in the temporary trial.
- A [historical Cesium discussion of Google tile lighting](https://community.cesium.com/t/google-3dtiles-do-not-cast-shadows/23929) explains baked lighting and unlit materials in its Unreal integration. It supports investigating source lighting, but does not prove the cause of this particular NYC color boundary or establish the material configuration of the current streamed asset.


## Final verification

After removing the unsuccessful lighting trial, QA independently ran the complete frontend checks on the final source:

- `npm test`: 104 tests passed, including the eight rendering-policy tests and 14 focus/navigation tests.
- `npm run typecheck`: passed.
- `npm run build`: the token-isolated production build passed.
- `npm run test:e2e -- --global-timeout=60000`: all 30 browser tests passed; the runner completed with exit code 0 in 47.1 seconds including teardown. No extra cleanup change or rerun was needed.
- `git diff --check`: passed.

The browser suite uses synthetic/mock or verification mode with provider requests blocked. Its results establish application contracts and browser controls, not live image sharpness, FPS or source-color correction. QA confirmed that `main.ts` and `cesium-adapter.ts` match focus checkpoint `b5eb7e7`, and independently recomputed the identical control/trial PNG hashes reported above.
