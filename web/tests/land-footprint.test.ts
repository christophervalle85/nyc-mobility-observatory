import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseLandFootprint, landFootprintMask} from '../src/land-footprint.ts';
import type {LandFootprint} from '../src/land-footprint.ts';
import {parseZones} from '../src/zones.ts';
const raw=JSON.parse(readFileSync(new URL('../public/data/city-land.json',import.meta.url),'utf8'));
const geography=parseZones(JSON.parse(readFileSync(new URL('../public/data/taxi-zones.geojson',import.meta.url),'utf8')));
const source='NYC DCP water-excluded borough boundaries 26c';
const triangle={name:'Source land',ring:[[-74,40.7],[-73.99,40.7],[-74,40.71]]};
function small(){return {version:1,source,polygons:[structuredClone(triangle)]};}
test('frozen land asset retains all88unioncomponents and the real hole with5546positions',()=>{
 const parsed=parseLandFootprint(raw);assert.ok(parsed);assert.equal(parsed.polygons.length,88);assert.equal(parsed.vertices,5546);
 assert.equal(parsed.polygons.reduce((n,p)=>n+(p.holes?.length??0),0),1);
 assert.notEqual(parsed.polygons,raw.polygons);
});
test('invalid source, metadata, names, coordinate arrays and distinct-point failures are rejected',()=>{
 for(const bad of [null,{},[],{...small(),version:2},{...small(),source:'untrusted'}, {...small(),polygons:[]}, {...small(),polygons:[{...triangle,name:'x'.repeat(97)}]}, {...small(),polygons:[{...triangle,ring:[[-74,40.7],[-74,40.7],[-74,40.7]]}]}, {...small(),polygons:[{...triangle,ring:[[-74,40.7],[NaN,40.7],[-74,40.71]]}]}, {...small(),polygons:[{...triangle,ring:[[-75,40.7],[-73.99,40.7],[-74,40.71]]}]}, {...small(),polygons:[{...triangle,holes:[null]}]}])assert.equal(parseLandFootprint(bad),undefined);
});
test('outer and hole positions both count toward8192vertex and128polygon budgets',()=>{
 const oversized=small();oversized.polygons=Array.from({length:129},()=>structuredClone(triangle));assert.equal(parseLandFootprint(oversized),undefined);
 const withHole={...small(),polygons:[{...triangle,holes:[triangle.ring]}]};assert.equal(parseLandFootprint(withHole)?.vertices,6);
 const ring=Array.from({length:8192},(_,i)=>[-74+.01*Math.cos(i*Math.PI/4096),40.7+.01*Math.sin(i*Math.PI/4096)]);
 assert.equal(parseLandFootprint({...small(),polygons:[{...triangle,ring}]} )?.vertices,8192);
 assert.equal(parseLandFootprint({...small(),polygons:[{...triangle,ring,holes:[triangle.ring]}]}),undefined);
});
test('land mask starts with source contours and adds Newark only explicitly then resets cheaply',()=>{
 const land=parseLandFootprint(raw);assert.ok(land);const counts:number[]=[];let disabled=0;
 const mask=landFootprintMask(geography,land,true,p=>counts.push(p.length),()=>{disabled++});
 assert.deepEqual(mask.state(),{kind:'city',includesNewark:false});assert.deepEqual(counts,[88]);
 mask.city();assert.deepEqual(counts,[88]);mask.newark();assert.deepEqual(mask.state(),{kind:'newark',includesNewark:true});assert.deepEqual(counts,[88,89]);
 mask.newark();assert.deepEqual(counts,[88,89]);mask.city();assert.deepEqual(mask.state(),{kind:'city',includesNewark:false});assert.deepEqual(counts,[88,89,88]);assert.equal(disabled,0);
});
test('missing, invalid or unsupported land never silently substitutes convex hulls',()=>{
 const cases:Array<[LandFootprint|undefined,boolean]>=[[undefined,true],[parseLandFootprint(raw),false],[{polygons:[triangle],vertices:999},true]];
 for(const [land,supported]of cases){
  let replaced=0,disabled=0;const mask=landFootprintMask(geography,land,supported,()=>{replaced++},()=>{disabled++});
  assert.equal(mask.state().kind,'unavailable');assert.equal(replaced,0);assert.equal(disabled,1);
 }
});
test('an over-budget Newark extension disables an active cutout and never publishes invalid polygons',()=>{
 const ring=Array.from({length:8192},(_,i)=>[-74+.01*Math.cos(i*Math.PI/4096),40.7+.01*Math.sin(i*Math.PI/4096)]);
 const land=parseLandFootprint({...small(),polygons:[{...triangle,ring}]});assert.ok(land);
 let replacements=0,disabled=0;const mask=landFootprintMask(geography,land,true,()=>{replacements++},()=>{disabled++});
 assert.equal(replacements,1);mask.newark();assert.equal(mask.state().kind,'unavailable');assert.equal(replacements,1);assert.equal(disabled,1);
 mask.city();assert.equal(replacements,1);assert.equal(mask.state().includesNewark,false);
});
test('renderer assignment failure disables clipping without retrying the renderer',()=>{
 let calls=0,disabled=0;const mask=landFootprintMask(geography,parseLandFootprint(raw),true,()=>{calls++;throw new Error('fixture')},()=>{disabled++});
 assert.equal(mask.state().kind,'unavailable');mask.newark();mask.city();assert.equal(calls,1);assert.equal(disabled,1);
});
