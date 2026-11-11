import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayPolicy } from '../src/rendering-policy.ts';
for (const dpr of [1, 1.5, 2, 3]) test(`DPR ${dpr} never downsamples below the map's CSS dimensions`, () => {
 const policy=displayPolicy(dpr);
 const effectiveRatio=(policy.useBrowserRecommendedResolution?1:dpr)*policy.resolutionScale;
 assert.ok(effectiveRatio>=1, `a 1000px CSS map must not become ${1000*effectiveRatio}px wide`);
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
