# Clarity, focus and photographic color follow-up

Branch: `improve-city-clarity-focus-color`, based on merged `8e4a350`. Christopher requested a separate commit for each issue.

## 1. High-density canvas clarity

The old policy always rendered one drawing-buffer pixel per CSS pixel, even on a DPR 2 screen. The new policy uses physical DPR once, capped at 1.5, with a finite fallback of 1. SSE 16, cache limits, dynamic SSE, request-render behavior and the optional natural mask are unchanged.

Live browser checks confirmed DPR 2 with a 577 × 798 CSS canvas previously drawing at 577 × 798, and the new policy with a 1280 × 676 CSS canvas drawing at 1920 × 1014. These are verified pixel ratios, not a matched performance or image-sharpness benchmark: the preview dimensions changed between captures. The new canvas supplies up to 2.25 times the pixel count; it does not guarantee finer streamed mesh or texture detail.

All eight rendering-policy tests, TypeScript and whitespace checks passed. Tests cover fractional DPR, high-DPR cap, invalid values and unchanged tile/cache policy. A final complete frontend suite follows the remaining scoped work.
