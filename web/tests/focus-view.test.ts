import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusView } from '../src/focus-view.ts';
import { areaTarget } from '../src/zones.ts';
import type { ZoneCollection } from '../src/zones.ts';

const geography:ZoneCollection={type:'FeatureCollection',features:[{
 type:'Feature',id:161,properties:{location_id:161,zone:'Synthetic focus area',borough:'Manhattan'},
 geometry:{type:'Polygon',coordinates:[[[-73.99,40.75],[-73.98,40.75],[-73.98,40.76],[-73.99,40.75]]]},
}]};
const target=areaTarget(geography,161)!;

for(const [name,heading,pitch] of [
 ['opening',-Math.PI/6,-Math.PI*40/180],
 ['previously orbited',2.4,-Math.PI*55/180],
] as const)test(`focus preserves the ${name} orientation and lets the engine choose flight height`,()=>{
 const view=focusView(target,{heading,pitch},1.2);
 assert.deepEqual(view,{heading,pitch,range:target.range,duration:1.2});
 assert.equal('maximumHeight' in view,false,'nearby focus must not request a fixed 20km flight apex');
 assert.ok(view.range>=800&&view.range<=20000,'focus uses the bounded local source fit');
});

test('reduced-motion focus retains source fit and current orientation with zero duration',()=>{
 const view=focusView(target,{heading:1.1,pitch:-.7},0);
 assert.deepEqual(view,{heading:1.1,pitch:-.7,range:target.range,duration:0});
 assert.equal('maximumHeight' in view,false);
});
