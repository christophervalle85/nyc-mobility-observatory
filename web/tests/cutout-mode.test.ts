import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutoutMode } from '../src/cutout-mode.ts';

test('the default and unknown cutout settings show continuous imagery', () => {
  for (const value of [null, '', 'unknown', 'LAND', 'Boroughs']) {
    assert.equal(cutoutMode(value), 'none', String(value));
  }
});

test('only the exact comparison settings enable clipping', () => {
  assert.equal(cutoutMode('boroughs'), 'boroughs');
  assert.equal(cutoutMode('land'), 'land');
});
