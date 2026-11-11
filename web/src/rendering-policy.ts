// Recommended-resolution mode starts at CSS pixels; apply bounded DPR exactly once.
export function displayPolicy(devicePixelRatio: number) {
  const resolutionScale = Number.isFinite(devicePixelRatio) ? Math.min(1.5, Math.max(1, devicePixelRatio)) : 1;
  return { useBrowserRecommendedResolution: true, resolutionScale, targetFrameRate: undefined as number | undefined };
}
export function tilePolicy() {
  return { maximumScreenSpaceError: 16, cacheBytes: 512 * 1024 * 1024, maximumCacheOverflowBytes: 256 * 1024 * 1024 };
}
