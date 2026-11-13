export const hoursPerDay = 24;

export interface MobilityMonth {
  month: string;
  taxi: boolean;
  subway: boolean;
}

export function daysInMonth(month: unknown): number {
  if (typeof month !== 'string' || !/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) return 0;
  const year = Number(month.slice(0, 4)), index = Number(month.slice(5));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][index - 1];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseMobilityMonths(value: unknown): MobilityMonth[] {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.months) || !value.months.length) {
    throw new Error('Invalid mobility month catalog');
  }
  const months = new Map<string, MobilityMonth>();
  for (const entry of value.months) {
    if (!record(entry) || typeof entry.month !== 'string' || !daysInMonth(entry.month)
      || typeof entry.taxi !== 'boolean' || typeof entry.subway !== 'boolean'
      || (!entry.taxi && !entry.subway) || months.has(entry.month)) throw new Error('Invalid mobility month');
    months.set(entry.month, { month: entry.month, taxi: entry.taxi, subway: entry.subway });
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export function monthDate(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`;
}

const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthNameFormat = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayLongFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
const fullDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function monthLabel(month: string, includeYear = true): string {
  const formatter = includeYear ? monthFormat : monthNameFormat;
  return formatter.format(new Date(`${monthDate(month, 1)}T00:00:00Z`));
}

export function dateLabel(value: string, format: 'short' | 'long' | 'full' = 'short'): string {
  const formatter = format === 'full' ? fullDateFormat : format === 'long' ? dayLongFormat : dayFormat;
  return formatter.format(new Date(`${value}T00:00:00Z`));
}
