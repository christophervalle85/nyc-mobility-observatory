import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zoneHighlight} from '../src/zone-highlight.ts';
test('selection touches only previous and next source IDs, including all multipart entities',()=>{
 const calls: [string,boolean][]=[];
 const highlight=zoneHighlight([{locationId:1,value:'a'},{locationId:1,value:'b'},{locationId:2,value:'c'},{locationId:3,value:'d'}],(value,selected)=>calls.push([value,selected]));
 highlight.select(1);assert.deepEqual(calls,[['a',true],['b',true]]);
 calls.length=0;highlight.select(2);assert.deepEqual(calls,[['a',false],['b',false],['c',true]]);
 calls.length=0;highlight.select(2);assert.deepEqual(calls,[]);
 calls.length=0;highlight.select(null);assert.deepEqual(calls,[['c',false]]);
});
test('unselected geography is not changed for unknown selection or clearing an empty selection',()=>{
 let writes=0;const highlight=zoneHighlight([{locationId:1,value:{}}],()=>{writes++});
 highlight.select(null);highlight.select(999);assert.equal(writes,0);
});
