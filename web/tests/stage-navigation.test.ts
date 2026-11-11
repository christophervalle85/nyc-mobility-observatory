import{test}from'node:test';import assert from'node:assert/strict';
import{stageNavigation}from'../src/stage-navigation.ts';import type{StagePose}from'../src/stage-navigation.ts';
const city={longitude:-73.95,latitude:40.7,radius:33000,range:80000};
test('initial/overview and drag/button orbit are bounded one-shot operations with identity reset',()=>{
 const calls:string[]=[];const poses:StagePose[]=[];const nav=stageNavigation(city,{lookAt(pose){calls.push('lookAt');poses.push(pose)},reset(){calls.push('identity')}});
 assert.equal(poses.length,0);assert.equal(nav.overview(),true);assert.deepEqual(calls,['lookAt','identity']);
 nav.orbit(999,-999);assert.equal(poses.length,2);assert.ok(poses[1].pitch>=-Math.PI*75/180&&poses[1].pitch<=-Math.PI*20/180);assert.ok(poses[1].range>=200&&poses[1].range<=180000);assert.deepEqual(calls.slice(-2),['lookAt','identity']);
});
test('area pivot and wheel/pinch range are retained, nonfinite input ignored and dispose blocks movement',()=>{
 const poses:StagePose[]=[];const nav=stageNavigation(city,{lookAt(pose){poses.push(pose)},reset(){},range:()=>1200});
 nav.area({...city,longitude:-74,radius:500,range:2000});nav.orbit(.2,.1);assert.equal(poses[0]?.pivot.longitude,-74);assert.equal(poses[0]?.range,1200);
 assert.equal(nav.orbit(NaN,0),false);nav.dispose();assert.equal(nav.orbit(.2),false);
});
test('even a failed camera operation attempts identity reset',()=>{
 let resets=0;const nav=stageNavigation(city,{lookAt(){throw new Error('safe fixture')},reset(){resets++}});assert.equal(nav.overview(),false);assert.equal(resets,1);
});
test('keyboard zoom is bounded like wheel/pinch and rejects nonfinite factors',()=>{const poses:StagePose[]=[];const nav=stageNavigation(city,{lookAt(pose){poses.push(pose)},reset(){},range:()=>179000});assert.equal(nav.zoom(2),true);assert.equal(poses[0].range,180000);assert.equal(nav.zoom(NaN),false);assert.equal(nav.zoom(-1),false)});

test('skyline opening uses its own close pivot and overview still resets to the full city',()=>{
 const poses:StagePose[]=[];const nav=stageNavigation(city,{lookAt(pose){poses.push(pose)},reset(){}});
 const skyline={longitude:-73.99,latitude:40.75,radius:4500,range:12000};
 assert.equal(nav.opening(skyline),true);assert.equal(poses[0].pivot,skyline);assert.equal(poses[0].range,12000);
 assert.ok(poses[0].pitch<-Math.PI/6&&poses[0].pitch>-Math.PI/3);
 nav.overview();assert.equal(poses[1].pivot,city);assert.equal(poses[1].range,city.range);
 nav.dispose();assert.equal(nav.opening(skyline),false);
});
