import{test}from'node:test';import assert from'node:assert/strict';
import{stageNavigation}from'../src/stage-navigation.ts';import type{StagePose}from'../src/stage-navigation.ts';
const city={longitude:-73.95,latitude:40.7,radius:33000,range:80000};
test('even a failed camera operation attempts identity reset',()=>{
 let resets=0;const nav=stageNavigation({lookAt(){throw new Error('safe fixture')},reset(){resets++}});assert.equal(nav.overview(city),false);assert.equal(resets,1);
});
test('skyline opening uses its own close pivot and overview still resets to the full city',()=>{
 const poses:StagePose[]=[];const nav=stageNavigation({lookAt(pose){poses.push(pose)},reset(){}});
 const skyline={longitude:-73.99,latitude:40.75,radius:4500,range:12000};
 assert.equal(nav.opening(skyline),true);assert.equal(poses[0].pivot,skyline);assert.equal(poses[0].range,12000);
 assert.ok(poses[0].pitch<-Math.PI/6&&poses[0].pitch>-Math.PI/3);
 nav.overview(city);assert.equal(poses[1].pivot,city);assert.equal(poses[1].range,city.range);
});
