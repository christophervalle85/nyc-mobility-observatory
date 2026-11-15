import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysInMonth, monthLabel, parseMobilityMonths } from '../src/mobility-months.ts';

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
