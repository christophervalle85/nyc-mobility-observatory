// Cesium's recommended-resolution mode already ignores DPR. Never divide twice.
export function displayPolicy(_devicePixelRatio: number) {
  return { useBrowserRecommendedResolution: true, resolutionScale: 1, targetFrameRate: undefined as number | undefined };
}
export function tilePolicy() {
  return { maximumScreenSpaceError: 16, cacheBytes: 512 * 1024 * 1024, maximumCacheOverflowBytes: 256 * 1024 * 1024 };
}
