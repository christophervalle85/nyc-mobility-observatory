import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectedBoundary } from '../src/selected-boundary.ts';
import type { ZoneCollection } from '../src/zones.ts';
const outer=[[-74,40.7],[-73.9,40.7],[-73.9,40.8],[-74,40.7]];
const hole=[[-73.98,40.72],[-73.96,40.72],[-73.96,40.74],[-73.98,40.72]];
const geography:ZoneCollection={type:'FeatureCollection',features:[
 {type:'Feature',id:1,properties:{location_id:1,zone:'Source zone one',borough:'Manhattan'},geometry:{type:'MultiPolygon',coordinates:[[outer,hole],[outer]]}},
 {type:'Feature',id:2,properties:{location_id:2,zone:'Source zone two',borough:'Manhattan'},geometry:{type:'Polygon',coordinates:[outer]}},
]};
test('only the selected source zone gets boundary rings, preserving multipart and holes',()=>{
 const added:{ring:number[][];id:number}[]=[];const original=JSON.stringify(geography);
 const boundary=selectedBoundary(geography,(ring,id)=>{const value={ring,id};added.push(value);return value},()=>{});
 assert.equal(added.length,0);boundary.select(1);
 assert.equal(added.length,3);assert.deepEqual(added.map(x=>x.ring),[outer,hole,outer]);
 assert.ok(added.every(x=>x.id===1));assert.equal(JSON.stringify(geography),original);
});
test('changing, clearing and disposing selection removes only its owned rings, with same-ID no-op',()=>{
 let next=0;const live=new Set<number>();const removed:number[]=[];
 const boundary=selectedBoundary(geography,()=>{live.add(++next);return next},value=>{removed.push(value);live.delete(value)});
 boundary.select(1);assert.equal(live.size,3);boundary.select(1);assert.equal(next,3);
 boundary.select(2);assert.equal(live.size,1);assert.deepEqual(removed,[1,2,3]);
 boundary.select(null);assert.equal(live.size,0);assert.deepEqual(removed,[1,2,3,4]);
 boundary.select(1);boundary.dispose();boundary.dispose();assert.equal(live.size,0);assert.equal(removed.length,7);
});
