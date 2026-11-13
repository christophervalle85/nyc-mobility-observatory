import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSubwayData } from '../src/subway-data.ts';

function archive() {
  return {
    version: 1,
    month: '2026-09',
    timezone: 'America/New_York',
    runId: 'a'.repeat(64),
    sourceSha256: 'b'.repeat(64),
    stations: Array.from({ length: 2 }, (_, index) => ({
      id: index + 1,
      name: 'Station',
      borough: 'Queens',
      counts: Array<number | null>(720).fill(null),
    })),
  };
}

test('subway parsing preserves unknown, observed zero and fractional estimates', () => {
  const data = archive();
  data.stations[0].counts[1] = 0;
  data.stations[0].counts[2] = 2.5;
  assert.deepEqual(parseSubwayData(data).stations[0].counts.slice(0, 3), [null, 0, 2.5]);
});

test('subway parsing rejects invalid provenance and malformed station series', () => {
  const data = archive();
  assert.throws(() => parseSubwayData({ ...data, sourceSha256: 'invalid' }));
  data.stations[0].counts[1] = -1;
  assert.throws(() => parseSubwayData(data));
  data.stations[0].counts[1] = null;
  data.stations[0].counts.pop();
  assert.throws(() => parseSubwayData(data));
  data.stations[0].counts.push(0);
  data.stations[0].id = data.stations[1].id;
  assert.throws(() => parseSubwayData(data));
});
