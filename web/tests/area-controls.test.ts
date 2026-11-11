import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveZone,filterZones,zoneExtent,areaTarget} from '../src/zones.ts';
import type {Zone,ZoneCollection} from '../src/zones.ts';
const ring=[[-74,40.7],[-73.99,40.7],[-73.99,40.71],[-74,40.7]];
const zone=(id:number,name:string,borough:string):Zone=>({type:'Feature',id,properties:{location_id:id,zone:name,borough},geometry:{type:'Polygon',coordinates:[ring]}});
const collection:ZoneCollection={type:'FeatureCollection',features:[zone(216,'Alpha','Queens'),zone(16,'Zulu','Brooklyn'),zone(2,'Beta','Queens'),zone(1,'Alpha','Queens')]};
test('local area query matches name/borough case-insensitively and exact numeric ID',()=>{
 assert.deepEqual(filterZones(collection,' aLpHa ').map(z=>z.id),[1,216]);
 assert.deepEqual(filterZones(collection,'queens').map(z=>z.id),[1,216,2]);
 assert.deepEqual(filterZones(collection,'16').map(z=>z.id),[16]);
 assert.deepEqual(filterZones(collection,'missing'),[]);
});
test('query clearing returns every source ID in stable order without mutating input or selection',()=>{
 const before=JSON.stringify(collection);const selected=resolveZone(collection,'2');
 filterZones(collection,'Alpha');assert.equal(selected?.id,2);
 assert.deepEqual(filterZones(collection,' ').map(z=>z.id),[16,1,216,2]);assert.equal(JSON.stringify(collection),before);
});
test('restored IDs must resolve through the local collection, never arbitrary coordinates or partial parsing',()=>{
 assert.equal(resolveZone(collection,'16')?.id,16);
 for(const id of ['16x','1e1','-74,40.7','https://example.com','0','999',NaN,Infinity,1.5,null]) assert.equal(resolveZone(collection,id),undefined);
});
test('extent includes every multipart and hole ring',()=>{
 const feature=zone(1,'Multi','Queens');feature.geometry={type:'MultiPolygon',coordinates:[[ring,[[-73.98,40.72],[-73.97,40.72],[-73.97,40.73],[-73.98,40.72]]],[[[-73.8,40.8],[-73.79,40.8],[-73.79,40.81],[-73.8,40.8]]]]};
 assert.deepEqual(zoneExtent(feature),{west:-74,south:40.7,east:-73.79,north:40.81});
});
test('nonfinite, out-of-NYC and degenerate geometry never produce camera targets',()=>{
 for(const value of [NaN,Infinity,-80]){
  const feature=zone(1,'Invalid','Queens');feature.geometry={type:'Polygon',coordinates:[[[value,40.7],[-74,40.7],[-74,40.8],[value,40.7]]]};assert.equal(zoneExtent(feature),undefined);
 }
 const feature=zone(1,'Degenerate','Queens');feature.geometry={type:'Polygon',coordinates:[[[-74,40.7],[-74,40.7],[-74,40.7],[-74,40.7]]]};
 assert.equal(zoneExtent(feature),undefined);assert.equal(areaTarget({type:'FeatureCollection',features:[feature]},1),undefined);
});
test('camera targets have finite ordered padded bounds and200–20000m range without height queries',()=>{
 const tiny=zone(1,'Tiny','Queens');tiny.geometry={type:'Polygon',coordinates:[[[-74,40.7],[-73.999999,40.7],[-73.999999,40.700001],[-74,40.7]]]};
 const target=areaTarget({type:'FeatureCollection',features:[tiny]},1);assert.ok(target);
 assert.ok(target.east-target.west>=0.00099);assert.ok(target.north-target.south>=0.00099);
 assert.ok(target.range>=200&&target.range<=20000);assert.ok(Object.values(target).every(Number.isFinite));
 assert.equal(areaTarget(collection,999),undefined);
});
test('the smallest-area focus stays above the200m camera floor at the fixed45-degree pitch',()=>{
 const feature=zone(1,'Tiny','Queens');feature.geometry={type:'Polygon',coordinates:[[[-74,40.7],[-73.999999,40.7],[-73.999999,40.700001],[-74,40.7]]]};
 const target=areaTarget({type:'FeatureCollection',features:[feature]},1);assert.ok(target);assert.ok(target.range*Math.sin(Math.PI/4)>=200);
});
test('all263 official source zones remain searchable, resolvable and within bounded camera targets',async()=>{
 const {readFileSync}=await import('node:fs');const {parseZones}=await import('../src/zones.ts');
 const source=parseZones(JSON.parse(readFileSync(new URL('../public/data/taxi-zones.geojson',import.meta.url),'utf8')));
 const results=filterZones(source,'');assert.equal(results.length,263);assert.equal(new Set(results.map(z=>z.id)).size,263);
 for(const zone of results){assert.equal(resolveZone(source,String(zone.id)),zone);const target=areaTarget(source,zone.id);assert.ok(target,`source zone ${zone.id}`);assert.ok(target.range>=200&&target.range<=20000);assert.ok(Object.values(target).every(Number.isFinite));}
});
