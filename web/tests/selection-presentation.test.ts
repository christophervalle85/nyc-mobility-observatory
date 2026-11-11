import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionPresentation } from '../src/selection-presentation.ts';

test('selected NYC outline is available before streamed detail, while fill waits', () => {
  assert.deepEqual(selectionPresentation(161, false, false), { outlineId: 161, fillId: null });
  assert.deepEqual(selectionPresentation(161, false, true), { outlineId: 161, fillId: 161 });
});

test('clearing selection removes both outline and fill at either readiness state', () => {
  for (const ready of [false, true]) {
    assert.deepEqual(selectionPresentation(null, false, ready), { outlineId: null, fillId: null });
  }
});

test('Newark stays absent until its footprint is explicitly included', () => {
  for (const ready of [false, true]) {
    assert.deepEqual(selectionPresentation(1, false, ready), { outlineId: null, fillId: null });
  }
});

test('included Newark has an immediate outline and detail-gated fill', () => {
  assert.deepEqual(selectionPresentation(1, true, false), { outlineId: 1, fillId: null });
  assert.deepEqual(selectionPresentation(1, true, true), { outlineId: 1, fillId: 1 });
});
