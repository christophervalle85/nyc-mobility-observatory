import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayPolicy } from '../src/rendering-policy.ts';
for (const [dpr,expectedRatio] of [[1,1],[1.25,1.25],[1.5,1.5],[2,1.5],[3,1.5]]) test(`DPR ${dpr} uses a bounded ${expectedRatio} pixels per CSS pixel`, () => {
 const policy=displayPolicy(dpr);
 // Recommended-resolution mode already removes native DPR; scale it exactly once.
 assert.equal(policy.useBrowserRecommendedResolution,true);
 const effectiveRatio=(policy.useBrowserRecommendedResolution?1:dpr)*policy.resolutionScale;
 assert.equal(1000*effectiveRatio,1000*expectedRatio,'the 1000px map should gain bounded detail without double-DPR scaling');
});
test('invalid or sub-CSS device ratios keep a finite one-pixel-per-CSS-pixel fallback',()=>{
 for(const dpr of [NaN,Infinity,-Infinity,0,-1,.5]){
  const policy=displayPolicy(dpr);
  assert.equal(policy.useBrowserRecommendedResolution,true);
  assert.equal(policy.resolutionScale,1);
 }
});
test('interactive rendering can follow the browser frame cadence instead of a 30fps cap',()=>{
 assert.equal(displayPolicy(2).targetFrameRate,undefined);
});
test('detail and estimated tile-cache budget stay within the approved bounded quality policy',async()=>{
 const {tilePolicy}=await import('../src/rendering-policy.ts');const policy=tilePolicy();
 assert.equal(policy.maximumScreenSpaceError,16);
 assert.equal(policy.cacheBytes,512*1024*1024);
 assert.equal(policy.cacheBytes+policy.maximumCacheOverflowBytes,768*1024*1024);
});
