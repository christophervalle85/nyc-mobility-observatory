import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysInMonth, monthLabel, parseAssetClockChange, parseMobilityMonths } from '../src/mobility-months.ts';

test('catalog selects the newest verified month and keeps separate mode availability', () => {
  const august = { month: '2026-08', taxi: false, subway: true };
  const september = { month: '2026-09', taxi: true, subway: false };
  assert.deepEqual(parseMobilityMonths({ version: 1, months: [august, september] }), [september, august]);
  assert.equal(monthLabel(august.month), 'August 2026');
});

test('catalog rejects malformed, duplicate, and empty month entries', () => {
  const valid = { month: '2026-09', taxi: true, subway: true };
  for (const months of [
    [],
    [valid, valid],
    [{ ...valid, month: '2026-13' }],
    [{ ...valid, month: '../../taxi' }],
    [{ ...valid, subway: 'true' }],
    [{ ...valid, taxi: false, subway: false }],
  ]) assert.throws(() => parseMobilityMonths({ version: 1, months }));
});

test('version one catalog keeps validated paired run bindings', () => {
  const entry = { month: '2024-12', taxi: true, subway: true, taxiRunId: 'a'.repeat(64), subwayRunId: 'b'.repeat(64) };
  assert.deepEqual(parseMobilityMonths({ version: 1, months: [entry] }), [entry]);
  for (const changed of [
    { ...entry, taxiRunId: undefined },
    { ...entry, subwayRunId: undefined },
    { ...entry, subwayRunId: 'B'.repeat(64) },
    { ...entry, subwayRunId: 'b'.repeat(63) },
    { ...entry, subway: false },
  ]) assert.throws(() => parseMobilityMonths({ version: 1, months: [changed] }));
});

test('calendar slot lengths follow Gregorian century leap-year rules', () => {
  assert.equal(daysInMonth('2000-02'), 29);
  assert.equal(daysInMonth('2100-02'), 28);
  assert.equal(daysInMonth('0000-02'), 0);
});

test('version two metadata agrees with the New York local clock for all five backfill years', () => {
  const dates = [
    ['2020-03-08', '2020-11-01'], ['2021-03-14', '2021-11-07'], ['2022-03-13', '2022-11-06'],
    ['2023-03-12', '2023-11-05'], ['2024-03-10', '2024-11-03'],
  ];
  for (const [spring, fall] of dates) {
    for (const clockChange of [{ date: spring, hour: 2, kind: 'nonexistent' }, { date: fall, hour: 1, kind: 'repeated' }]) {
      const month = clockChange.date.slice(0, 7);
      assert.deepEqual(parseAssetClockChange({ version: 2, clockChange }, month), clockChange);
      assert.throws(() => parseAssetClockChange({ version: 2 }, month));
      assert.throws(() => parseAssetClockChange({ version: 1, clockChange }, month));
      assert.throws(() => parseAssetClockChange({ version: 2, clockChange: { ...clockChange, date: `${month}-17` } }, month));
      assert.throws(() => parseAssetClockChange({ version: 2, clockChange: { ...clockChange, hour: '1' } }, month));
      assert.throws(() => parseAssetClockChange({ version: 2, clockChange: { ...clockChange, extra: 0 } }, month));
    }
  }
  assert.equal(parseAssetClockChange({ version: 1 }, '2024-03'), undefined);
  assert.throws(() => parseAssetClockChange({ version: 2, clockChange: { date: '2024-04-07', hour: 1, kind: 'repeated' } }, '2024-04'));
});
