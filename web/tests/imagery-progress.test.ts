import{test}from'node:test';import assert from'node:assert/strict';
import{imageryProgress,startupStatus}from'../src/imagery-progress.ts';
function fixture(){const visible=new Set<()=>void>(),frames=new Set<()=>void>(),changes:string[]=[];
 const progress=imageryProgress(callback=>{visible.add(callback);return()=>{visible.delete(callback);};},callback=>{frames.add(callback);return()=>{frames.delete(callback);};},stage=>{changes.push(stage);});
 return{progress,changes,visible,frames,tile(){for(const callback of [...visible])callback();},render(){for(const callback of [...frames])callback();}};
}
test('metadata or render alone cannot claim imagery; tile visibility must complete a rendered frame',()=>{
 const f=fixture();f.render();assert.deepEqual(f.changes,[]);f.tile();assert.deepEqual(f.changes,[]);f.render();assert.deepEqual(f.changes,['refining']);assert.equal(f.visible.size,0);assert.equal(f.frames.size,0);
 f.progress.settled();assert.deepEqual(f.changes,['refining','settled']);f.progress.wait();f.progress.settled();assert.deepEqual(f.changes,['refining','settled','refining','settled']);
});
test('cached settled signal before first tile frame never regresses settled presentation',()=>{
 const f=fixture();f.progress.settled();assert.deepEqual(f.changes,[]);f.tile();f.render();assert.deepEqual(f.changes,['settled']);f.progress.settled();assert.deepEqual(f.changes,['settled']);
});
test('movement before first image clears an obsolete settled signal without restoring the starting cue later',()=>{
 const f=fixture();f.progress.settled();f.progress.wait();f.tile();f.render();assert.deepEqual(f.changes,['refining']);f.progress.settled();f.progress.wait();assert.equal(f.progress.stage,'refining');
});
test('dispose removes listeners and ignores captured late frame/detail callbacks',()=>{
 const f=fixture();f.tile();const late=[...f.frames][0];f.progress.dispose();late();f.progress.settled();f.progress.wait();assert.deepEqual(f.changes,[]);assert.equal(f.visible.size,0);assert.equal(f.frames.size,0);
});
test('startup announces imagery milestones and stays quiet when the live city is ready', () => {
  for (const phase of ['setup', 'error', 'partial', 'stopped', 'idle'] as const) {
    assert.equal(startupStatus(phase, 'settled', false), undefined);
  }
  assert.equal(startupStatus('ready', 'waiting-first-frame', false), 'Opening city imagery…');
  assert.equal(startupStatus('ready', 'refining', false), 'City visible. Refining detail…');
  assert.equal(startupStatus('ready', 'settled', false), undefined);
  assert.equal(startupStatus('ready', 'settled', true), undefined);
});
test('settled imagery waits for area resources before ending the status', () => {
  assert.equal(startupStatus('loading', 'settled', false), 'City visible. Preparing area controls…');
});
