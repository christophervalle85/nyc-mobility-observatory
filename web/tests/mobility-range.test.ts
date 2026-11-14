import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildMobilityRange } from '../src/mobility-range.ts';
import type { MobilityMonthData } from '../src/mobility-range.ts';
import { daysInMonth } from '../src/mobility-months.ts';
import { parseTaxiData } from '../src/taxi-data.ts';
import { parseSubwayData } from '../src/subway-data.ts';

function fixture(month: string, value = 1): MobilityMonthData {
  const hours = daysInMonth(month) * 24;
  return { taxi: { runId: 'a', sourceSha256: 'b', totalDropoffs: hours * value,
    zones: new Map([[90, Array<number>(hours).fill(value)]]) },
  subway: { runId: 'a', stations: [{ id: 1, name: 'Station', borough: 'Manhattan',
    latitude: 40.7, longitude: -73.9, counts: Array<number | null>(hours).fill(value) }] } };
}
function range(start: string, end: string, months = new Map<string, MobilityMonthData>()) {
  return buildMobilityRange({ start, end, zoneId: 90, stationId: 1, months });
}

test('inclusive month boundary uses each month slots and independent monthly run IDs', () => {
  const august = fixture('2026-08', 2), september = fixture('2026-09', 3);
  september.taxi!.runId = september.subway!.runId = 'other-month-run';
  const result = range('2026-08-31', '2026-09-01', new Map([['2026-08', august], ['2026-09', september]]))!;
  assert.deepEqual(result.days.map(day => day.date), ['2026-08-31', '2026-09-01']);
  assert.deepEqual(result.days.map(day => day.taxi.total), [48, 72]);
  assert.equal(result.taxi.total, 120);
  assert.equal(result.subway.total, 120);
  assert.equal(result.taxi.observedHours, 48);
  assert.equal(result.taxi.completeDays, 2);
  assert.equal(result.taxi.partial, false);
});

test('observed zero differs from null; fractional partial subway sums exclude missing hours', () => {
  const data = fixture('2026-09', 0);
  data.subway!.stations[0].counts[0] = null;
  data.subway!.stations[0].counts[1] = 2.5;
  const result = range('2026-09-01', '2026-09-01', new Map([['2026-09', data]]))!;
  assert.equal(result.taxi.total, 0);
  assert.equal(result.taxi.observedHours, 24);
  assert.deepEqual(result.subway, { total: 2.5, observedHours: 23, expectedHours: 24,
    availableDays: 1, completeDays: 0, partial: true });
  assert.equal(result.days[0].subway.counts[0], null);
  assert.equal(result.days[0].subway.counts[2], 0);
});

test('unlisted intervening month stays visible as date-aligned gaps', () => {
  const result = range('2026-08-31', '2026-10-01', new Map([
    ['2026-08', fixture('2026-08')], ['2026-10', fixture('2026-10')],
  ]))!;
  assert.equal(result.days.length, 32);
  assert.equal(result.days[1].date, '2026-09-01');
  assert.equal(result.days[30].date, '2026-09-30');
  assert.equal(result.days[1].taxi.total, null);
  assert.equal(result.days[1].taxi.counts.length, 24);
  assert.equal(result.taxi.availableDays, 2);
  assert.equal(result.taxi.expectedHours, 768);
  assert.equal(result.taxi.observedHours, 48);
});

test('mode failures and absent stations preserve independent coverage', () => {
  const august = fixture('2026-08'), september = fixture('2026-09');
  august.taxi = null;
  september.subway!.stations[0].id = 2;
  const result = range('2026-08-31', '2026-09-01', new Map([['2026-08', august], ['2026-09', september]]))!;
  assert.deepEqual(result.days.map(day => day.taxi.total), [null, 24]);
  assert.deepEqual(result.days.map(day => day.subway.total), [24, null]);
  assert.equal(result.subway.availableDays, 1);
  assert.equal(result.taxi.availableDays, 1);
});

test('same-month provenance mismatch excludes only subway; absent taxi permits subway', () => {
  const data = fixture('2026-09');
  data.subway!.runId = 'other';
  const months = new Map([['2026-09', data]]);
  const result = range('2026-09-01', '2026-09-01', months)!;
  assert.equal(result.taxi.total, 24);
  assert.equal(result.subway.total, null);
  assert.equal(result.subway.observedHours, 0);
  data.taxi = null;
  assert.equal(range('2026-09-01', '2026-09-01', months)!.subway.total, 24);
});

test('calendar traversal handles year boundaries, leap days and early years', () => {
  assert.deepEqual(range('2026-12-31', '2027-01-01')!.days.map(day => day.date), ['2026-12-31', '2027-01-01']);
  assert.deepEqual(range('2024-02-28', '2024-03-01')!.days.map(day => day.date), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.equal(range('1900-02-28', '1900-03-01')!.days.length, 2);
  assert.equal(range('2000-02-28', '2000-03-01')!.days.length, 3);
  assert.equal(range('9999-12-31', '9999-12-31')!.days.length, 1);
  assert.equal(range('0099-12-31', '0100-01-01')!.days.length, 2);
});

test('invalid and reversed dates return no model', () => {
  for (const [start, end] of [['', '2026-09-01'], ['2026-09-02', '2026-09-01'],
    ['2026-02-29', '2026-03-01'], ['0000-01-01', '2026-01-01'],
    ['2026-8-01', '2026-09-01'], ['2026-09-01', '2026-09-31']]) {
    assert.equal(range(start, end), null);
  }
});

test('real August 29–September 4 independently reconciles Flatiron and station observations', () => {
  const months = new Map<string, MobilityMonthData>();
  for (const month of ['2026-08', '2026-09']) {
    months.set(month, {
      taxi: parseTaxiData(JSON.parse(readFileSync(new URL(`../public/data/yellow-taxi-${month}.json`, import.meta.url), 'utf8')), month),
      subway: parseSubwayData(JSON.parse(readFileSync(new URL(`../public/data/subway-${month}.json`, import.meta.url), 'utf8')), month),
    });
  }
  const stationId = months.get('2026-09')!.subway!.stations[0].id;
  const result = buildMobilityRange({ start: '2026-08-29', end: '2026-09-04', zoneId: 90, stationId, months })!;
  assert.equal(result.days.length, 7);
  let taxiTotal = 0, subwayTotal = 0, subwayHours = 0;
  for (const [month, first, end] of [['2026-08', 28 * 24, 31 * 24], ['2026-09', 0, 4 * 24]] as const) {
    const data = months.get(month)!;
    taxiTotal += data.taxi!.zones.get(90)!.slice(first, end).reduce((sum, value) => sum + value, 0);
    for (const count of data.subway!.stations.find(station => station.id === stationId)!.counts.slice(first, end)) {
      if (count !== null) { subwayTotal += count; subwayHours++; }
    }
  }
  assert.equal(result.taxi.total, taxiTotal);
  assert.equal(result.subway.total, subwayTotal);
  assert.equal(result.subway.observedHours, subwayHours);
  assert.deepEqual(result.days[3].taxi.counts, months.get('2026-09')!.taxi!.zones.get(90)!.slice(0, 24));
  assert.equal(result.taxi.expectedHours, 168);
});
