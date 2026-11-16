import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysInMonth } from '../src/mobility-months.ts';
import type { MobilityMonthData } from '../src/mobility-range.ts';
import { buildTypicalDay, typicalDayDates } from '../src/typical-day.ts';

const date = '2026-09-01';

function fixture(keys = ['2026-07', '2026-08', '2026-09']) {
  const months = new Map<string, MobilityMonthData>();
  for (const month of keys) {
    const hours = daysInMonth(month) * 24;
    months.set(month, {
      taxi: { runId: month, sourceSha256: 'hash', totalDropoffs: 0, zones: new Map([[90, Array<number>(hours).fill(0)]]) },
      subway: { runId: month, stations: [{ id: 601, name: 'Station', borough: 'Manhattan',
        latitude: 40.7, longitude: -73.9, counts: Array<number | null>(hours).fill(null) }] },
    });
  }
  return months;
}

test('takes exactly eight earlier matching weekdays across date boundaries', () => {
  assert.deepEqual(typicalDayDates(date), [
    '2026-08-25', '2026-08-18', '2026-08-11', '2026-08-04',
    '2026-07-28', '2026-07-21', '2026-07-14', '2026-07-07',
  ]);
  assert.equal(typicalDayDates('2024-03-07')[0], '2024-02-29');
  assert.equal(typicalDayDates('2024-01-02')[0], '2023-12-26');
  assert.deepEqual(typicalDayDates('2024-02-30'), []);
});

test('uses independent per-hour medians, including true zero and excluding the target', () => {
  const months = fixture();
  const samples = [20, 0, 8, 12, 100, 3, 1, 10];
  typicalDayDates(date).forEach((day, index) => {
    const month = months.get(day.slice(0, 7))!;
    const slot = (Number(day.slice(-2)) - 1) * 24;
    (month.taxi!.zones.get(90)! as number[])[slot] = samples[index];
    const counts = month.subway!.stations[0].counts;
    if (index < 4) counts[slot] = index * 2;
    if (index < 3) counts[slot + 1] = 999;
  });
  (months.get('2026-09')!.taxi!.zones.get(90)! as number[])[0] = 1000;
  const result = buildTypicalDay({ date, zoneId: 90, stationId: 601, months });
  assert.equal(result.taxi.counts[0], 9);
  assert.equal(result.taxi.samples[0], 8);
  assert.equal(result.taxi.counts[1], 0);
  assert.equal(result.subway.counts[0], 3);
  assert.equal(result.subway.samples[0], 4);
  assert.equal(result.subway.counts[1], null);
  assert.equal(result.subway.samples[1], 3);
});

test('uses established mode bindings and excludes clock-change days from the samples', () => {
  const months = fixture(['2024-03']);
  const march = months.get('2024-03')!;
  const change = { date: '2024-03-10', hour: 2, kind: 'nonexistent' } as const;
  march.taxi!.clockChange = change;
  march.taxiRunId = 'a'.repeat(64);
  march.taxi!.runId = march.taxiRunId;
  march.subwayRunId = 'b'.repeat(64);
  march.subway!.stations[0].counts.fill(25);
  const result = buildTypicalDay({ date: '2024-04-07', zoneId: 90, stationId: 601, months });
  assert.equal(result.taxi.samples[0], 4);
  assert.equal(result.taxi.counts[0], 0);
  assert.equal(result.subway.samples[0], 0);
  assert.equal(result.subway.counts[0], null);
  march.subway!.runId = march.subwayRunId;
  assert.equal(buildTypicalDay({ date: '2024-04-07', zoneId: 90, stationId: 601, months }).subway.counts[0], 25);
  for (const [month, data] of fixture(['2024-01', '2024-02'])) months.set(month, data);
  assert(buildTypicalDay({ date: '2024-03-11', zoneId: 90, stationId: 601, months }).taxi.samples[0] >= 4);
  const disabled = buildTypicalDay({ date: change.date, zoneId: 90, stationId: 601, months });
  assert(disabled.taxi.counts.every(value => value === null));
});
