import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaCardPosition } from '../src/area-card-position.ts';

const viewport = { left: 0, top: 0, right: 800, bottom: 500 };
const card = { width: 240, height: 100 };

test('keeps a 24px gap above the anchor and aligns the pointer after horizontal clamping', () => {
  assert.deepEqual(areaCardPosition({ x: 45, y: 200 }, card, viewport, []),
    { left: 12, top: 76, pointer: 33 });
});

test('falls back when the card would cover controls or leave the visible map', () => {
  const search = { left: 20, top: 25, right: 320, bottom: 160 };
  assert.equal(areaCardPosition({ x: 220, y: 200 }, card, viewport, [search]), null);
  assert.equal(areaCardPosition({ x: 400, y: 130 }, card, viewport, []), null);
  assert.equal(areaCardPosition({ x: 400, y: 510 }, card, viewport, []), null);
});
