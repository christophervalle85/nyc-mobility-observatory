import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseZones} from '../src/zones.ts';
import {studyFootprint,cityOverview} from '../src/study-footprint.ts';
const geography=parseZones(JSON.parse(readFileSync(new URL('../public/data/taxi-zones.geojson',import.meta.url),'utf8')));
test('five-borough source-only hulls stay at250vertices and preserve official geography',()=>{
 const original=JSON.stringify(geography),footprint=studyFootprint(geography);assert.ok(footprint);
 assert.deepEqual(footprint.polygons.map(p=>p.name),['Bronx','Brooklyn','Manhattan','Queens','Staten Island']);assert.equal(footprint.vertices,250);assert.equal(JSON.stringify(geography),original);
 assert.ok(footprint.polygons.every(p=>p.ring.length>=3&&p.ring.every(point=>point.every(Number.isFinite))));
});
test('Newark is excluded by default and adds its named61vertex hull only when requested',()=>{
 const city=studyFootprint(geography),extended=studyFootprint(geography,true);assert.ok(city&&extended);
 assert.equal(city.polygons.length,5);assert.equal(extended.polygons.length,6);assert.equal(extended.polygons[5].name,'Newark airport');assert.equal(extended.vertices,311);
 assert.equal(studyFootprint(geography)?.vertices,250);
});
test('missing/invalid borough geometry cannot silently create a partial cutout',()=>{
 assert.equal(studyFootprint({...geography,features:geography.features.filter(z=>z.properties.borough!=='Bronx')}),undefined);
 const invalid=structuredClone(geography);invalid.features[0].geometry.coordinates=[[[NaN,40.7],[-74,40.7],[-74,40.8],[NaN,40.7]]] as never;
 assert.equal(studyFootprint(invalid,true),undefined);
});
test('whole-city framing remains finite and capped across aspect/FOV edge cases',()=>{
 for(const aspect of [.2,.5,1,2,5,NaN,Infinity]){const target=cityOverview(geography,aspect,Math.PI/3);assert.ok(target);assert.ok(Object.values(target).every(Number.isFinite));assert.ok(target.range>20000&&target.range<=180000);}
 assert.equal(cityOverview({type:'FeatureCollection',features:[]},1,1),undefined);
});
test('capability fallback is truthful; Newark extension/reset only follows explicit mask actions',async()=>{
 const{footprintMask,visibleStudySelection}=await import('../src/study-footprint.ts');const sizes:number[]=[];
 const mask=footprintMask(geography,true,polygons=>sizes.push(polygons.length));assert.equal(mask.state().kind,'city');assert.deepEqual(sizes,[5]);
 assert.equal(visibleStudySelection(1,false,true),false);assert.equal(visibleStudySelection(161,false,false),false);assert.equal(visibleStudySelection(161,false,true),true);
 mask.newark();assert.equal(mask.state().kind,'newark');assert.equal(visibleStudySelection(1,mask.state().includesNewark,true),true);assert.deepEqual(sizes,[5,6]);
 mask.city();assert.equal(mask.state().kind,'city');assert.deepEqual(sizes,[5,6,5]);
 const unsupported=footprintMask(geography,false,()=>{throw new Error('must not construct unsupported clipping')});assert.equal(unsupported.state().kind,'unavailable');
});
test('clipping geometry exceeding384vertices falls back instead of sending full rings to the renderer',()=>{
 const synthetic=structuredClone(geography);const circle=Array.from({length:200},(_,i)=>[-74+.01*Math.cos(i*Math.PI/100),40.7+.01*Math.sin(i*Math.PI/100)]);circle.push(circle[0]);
 for(const zone of synthetic.features)if(zone.properties.borough!=='EWR')zone.geometry={type:'Polygon',coordinates:[circle]};
 assert.equal(studyFootprint(synthetic),undefined);
});
test('clipping assignment failure reports unclipped capability without retrying the sink',async()=>{const{footprintMask}=await import('../src/study-footprint.ts');let calls=0;const mask=footprintMask(geography,true,()=>{calls++;throw new Error('safe fixture')});assert.equal(mask.state().kind,'unavailable');mask.newark();mask.city();assert.equal(calls,1)});
test('over-budget EWR extension disables an already-active city cutout before reporting unclipped fallback',async()=>{
 const{footprintMask}=await import('../src/study-footprint.ts');const synthetic=structuredClone(geography);
 const circle=Array.from({length:65},(_,i)=>[-74+.01*Math.cos(i*Math.PI*2/65),40.7+.01*Math.sin(i*Math.PI*2/65)]);circle.push(circle[0]);
 for(const zone of synthetic.features)if(zone.properties.borough!=='EWR')zone.geometry={type:'Polygon',coordinates:[circle]};
 assert.equal(studyFootprint(synthetic)?.vertices,325);assert.equal(studyFootprint(synthetic,true),undefined);
 let active=0,disabled=0;const mask=footprintMask(synthetic,true,polygons=>{active=polygons.length},()=>{active=0;disabled++});
 assert.equal(active,5);mask.newark();assert.equal(mask.state().kind,'unavailable');assert.equal(active,0);assert.equal(disabled,1);
});

test('skyline opening fits source-derived central Manhattan substantially closer than whole NYC',async()=>{
 const {skylineOpening}=await import('../src/study-footprint.ts');
 for(const aspect of [.4,1,1.6,2.5]){
  const opening=skylineOpening(geography,aspect,Math.PI/3),city=cityOverview(geography,aspect,Math.PI/3);
  assert.ok(opening&&city);assert.ok(Object.values(opening).every(Number.isFinite));
  assert.ok(opening.longitude>-74.03&&opening.longitude<-73.96);
  assert.ok(opening.latitude>40.72&&opening.latitude<40.78);
  assert.ok(opening.range<city.range*.4);if(aspect>=1)assert.ok(opening.range<6000);assert.ok(opening.range>=200&&opening.range<=40000);
 }
 assert.equal(skylineOpening({type:'FeatureCollection',features:[]},1,1),undefined);
 const original=JSON.stringify(geography);skylineOpening(geography,NaN,Infinity);assert.equal(JSON.stringify(geography),original);
});

test('skyline opening declines a missing required area so the adapter can use the city overview',async()=>{
 const {skylineOpening}=await import('../src/study-footprint.ts');
 const missing={...geography,features:geography.features.filter(zone=>zone.id!==162)};
 assert.equal(skylineOpening(missing,1.6,Math.PI/3),undefined);
 assert.ok(cityOverview(missing,1.6,Math.PI/3));
});
test('skyline opening declines invalid source extents without producing a nonfinite camera target',async()=>{
 const {skylineOpening}=await import('../src/study-footprint.ts');
 const invalid=structuredClone(geography),zone=invalid.features.find(zone=>zone.id===161)!;
 zone.geometry={type:'Polygon',coordinates:[[[NaN,40.75],[-73.98,40.75],[-73.98,40.76],[NaN,40.75]]]};
 assert.equal(skylineOpening(invalid,1.6,Math.PI/3),undefined);
});
