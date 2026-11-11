import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionController, failureCategory } from '../src/session.ts';
import type { SceneAdapter, SessionState } from '../src/session.ts';

function fixture(configured = true, timeout = 1000) {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  let update!: (phase: 'ready' | 'partial') => void;
  const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const calls = { create: 0, load: 0, dispose: 0, selection: null as number | null };
  const states: SessionState[] = [];
  const adapter: SceneAdapter = {
    load: (change) => { calls.load++; update = change; return pending; },
    whenSettled: () => pending.catch(() => undefined),
    dispose: () => { calls.dispose++; }, select: (id) => { calls.selection = id; },
  };
  const controller = new SessionController(configured, () => { calls.create++; return adapter; }, (state) => states.push(state), timeout);
  return { controller, calls, states, resolve, reject, update: (phase: 'ready' | 'partial') => update(phase) };
}

test('missing token never creates a live adapter', async () => {
  const f = fixture(false); await f.controller.load();
  assert.equal(f.controller.state.phase, 'setup'); assert.equal(f.calls.create, 0);
});
test('startup is idle and creates no adapter', () => {
  const f = fixture(); assert.equal(f.controller.state.phase, 'idle'); assert.equal(f.calls.create, 0);
});
test('load is single-flight and successful load is not repeated', async () => {
  const f = fixture(); const first = f.controller.load(); const duplicate = f.controller.load(); await Promise.resolve();
  assert.equal(f.calls.create, 1); assert.equal(f.calls.load, 1);
  assert.equal(f.controller.state.phase, 'loading');
  f.resolve(); await Promise.all([first, duplicate]);
  assert.equal(f.controller.state.phase, 'ready'); await f.controller.load(); assert.equal(f.calls.load, 1);
});
test('stop disposes immediately and late results cannot resurrect the scene', async () => {
  const f = fixture(); const work = f.controller.load(); await Promise.resolve(); f.controller.stop();
  assert.equal(f.calls.dispose, 1); f.resolve(); await work;
  assert.equal(f.controller.state.phase, 'stopped'); f.update('ready');
  assert.equal(f.controller.state.phase, 'stopped');
});
test('timeout disposes pending scene and late completion stays stopped', async () => {
  const f = fixture(true, 5); const work = f.controller.load(); await work;
  assert.equal(f.controller.state.failure, 'timeout'); assert.equal(f.calls.dispose, 1);
  f.resolve(); await Promise.resolve(); assert.equal(f.controller.state.phase, 'error');
});
test('one deliberate retry is the entire session budget', async () => {
  const f = fixture(); const one = f.controller.load(); await Promise.resolve(); f.reject({ statusCode: 401, message: 'secret token URL' }); await one;
  assert.equal(f.controller.state.failure, 'auth'); assert.equal(f.calls.dispose, 1);
  await f.controller.load(); await f.controller.load(); assert.equal(f.calls.create, 2);
  assert.equal(JSON.stringify(f.states).includes('secret'), false);
});
test('partial streaming is distinct and selection does not reload the scene', async () => {
  const f = fixture(); const work = f.controller.load(); f.resolve(); await work;
  f.update('partial'); assert.equal(f.controller.state.phase, 'partial');
  f.controller.select(161); assert.equal(f.calls.selection, 161); assert.equal(f.calls.load, 1);
});
test('only safe status categories escape resource errors', () => {
  assert.equal(failureCategory({ statusCode: 403 }), 'auth');
  assert.equal(failureCategory({ statusCode: 429 }), 'rate');
  assert.equal(failureCategory({ message: 'WebGL unsupported' }), 'network');
});

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
for (const ending of ['stop', 'timeout'] as const) test(`${ending} blocks retry until unresolved work drains, then permits one retry`, async () => {
  const f = fixture(true, ending === 'timeout' ? 5 : 1000);
  const first = f.controller.load(); await Promise.resolve();
  if (ending === 'stop') f.controller.stop();
  await first;
  assert.equal(f.controller.state.phase, ending === 'stop' ? 'stopped' : 'error');
  assert.equal(f.controller.state.draining, true);
  assert.equal(f.calls.dispose, 1);
  await f.controller.load(); await flush();
  assert.equal(f.calls.create, 1, 'retry must not create another unresolved adapter');
  assert.equal(f.controller.state.attempts, 1);
  f.resolve(); await flush();
  assert.equal(f.controller.state.draining, false);
  await f.controller.load();
  assert.equal(f.calls.create, 2, 'a deliberate retry is permitted after all work settles');
});
