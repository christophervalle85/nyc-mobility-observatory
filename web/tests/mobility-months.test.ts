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

test('calendar slot lengths follow Gregorian century leap-year rules', () => {
  assert.equal(daysInMonth('2000-02'), 29);
  assert.equal(daysInMonth('2100-02'), 28);
  assert.equal(daysInMonth('0000-02'), 0);
});
