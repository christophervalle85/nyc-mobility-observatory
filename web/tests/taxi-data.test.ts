import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseTaxiData, taxiDateRange, taxiHourLabel, taxiSeries } from '../src/taxi-data.ts';

test('September ranges include every hour of both selected dates', () => {
  assert.deepEqual(taxiDateRange('2026-09-01', '2026-09-07'), { firstHour: 0, endHour: 168 });
  assert.deepEqual(taxiDateRange('2026-09-30', '2026-09-30'), { firstHour: 696, endHour: 720 });
  assert.equal(taxiHourLabel(0), 'Sep 1, 00:00');
  assert.equal(taxiHourLabel(719), 'Sep 30, 23:00');
});

test('invalid dates and reversed ranges cannot produce a total', () => {
  for (const [start, end] of [
    ['', '2026-09-07'], ['2026-09-08', '2026-09-07'], ['2026-09-01', '2026-09-31'],
    ['2026-08-31', '2026-09-01'], ['2026-09-01', '2026-10-01'], ['2026-09-1', '2026-09-07'],
  ]) assert.equal(taxiDateRange(start, end), null);
});

function fixture() {
  const counts = Array<number>(720).fill(0);
  counts[0] = 27;
  counts[23] = 12;
  counts[24] = 50;
  return {
    version: 1, month: '2026-09', timezone: 'America/New_York',
    runId: 'a'.repeat(64), sourceSha256: 'b'.repeat(64), totalDropoffs: 89,
    zones: Object.fromEntries(Array.from({ length: 263 }, (_, index) => [
      index + 1, index === 89 ? counts : Array<number>(720).fill(0),
    ])),
  };
}

test('a range totals only its hours and distinguishes zero from an unknown zone', () => {
  const data = parseTaxiData(fixture());
  const range = taxiDateRange('2026-09-01', '2026-09-01')!;
  const flatiron = taxiSeries(data, 90, range);
  assert.equal(flatiron?.total, 39);
  assert.equal(flatiron?.counts.length, 24);
  assert.equal(flatiron?.counts[23], 12);
  assert.equal(taxiSeries(data, 103, range)?.total, 0);
  assert.equal(taxiSeries(data, 264, range), null);
});

test('data rejects incomplete arrays, invalid numbers and inconsistent totals', () => {
  const missing = fixture();
  delete missing.zones[103];
  assert.throws(() => parseTaxiData(missing));
  const incomplete = fixture();
  incomplete.zones[90].pop();
  assert.throws(() => parseTaxiData(incomplete));
  for (const invalid of [-1, 1.1, Infinity, Number.MAX_SAFE_INTEGER + 1, '27']) {
    const data = fixture();
    (data.zones[90] as unknown[])[0] = invalid;
    assert.throws(() => parseTaxiData(data));
  }
  assert.throws(() => parseTaxiData({ ...fixture(), totalDropoffs: 90 }));
});

test('published pilot reconciles to the archived eligibility total and has real Flatiron hours', () => {
  const raw: unknown = JSON.parse(readFileSync(
    new URL('../public/data/yellow-taxi-2026-09.json', import.meta.url), 'utf8',
  ));
  const data = parseTaxiData(raw);
  assert.equal(data.runId, '0566a3a050ff0a2d1de02ccc510416f0d21f226725afdbf2ea6eab610cbc0ebe');
  assert.equal(data.totalDropoffs, 3_851_119);
  assert.equal(taxiSeries(data, 90, taxiDateRange('2026-09-01', '2026-09-01')!)?.counts[0], 27);
});
