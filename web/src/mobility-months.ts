export const hoursPerDay = 24;

export interface MobilityRunBindings {
  taxiRunId?: string;
  subwayRunId?: string;
}

export interface MobilityMonth extends MobilityRunBindings {
  month: string;
  taxi: boolean;
  subway: boolean;
}

export type ClockChange =
  | { date: string; hour: 2; kind: 'nonexistent' }
  | { date: string; hour: 1; kind: 'repeated' };

export function daysInMonth(month: unknown): number {
  if (typeof month !== 'string' || !/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) return 0;
  const year = Number(month.slice(0, 4)), index = Number(month.slice(5));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][index - 1];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function mobilityRunMatches(
  binding: MobilityRunBindings,
  mode: 'taxi' | 'subway',
  runId: string,
  legacyTaxiRunId?: string,
): boolean {
  const { taxiRunId, subwayRunId } = binding;
  if (taxiRunId === undefined && subwayRunId === undefined) {
    return mode === 'taxi' || legacyTaxiRunId === undefined || runId === legacyTaxiRunId;
  }
  return isRunId(taxiRunId) && isRunId(subwayRunId) && runId === (mode === 'taxi' ? taxiRunId : subwayRunId);
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
    const month: MobilityMonth = { month: entry.month, taxi: entry.taxi, subway: entry.subway };
    if ('taxiRunId' in entry || 'subwayRunId' in entry) {
      const { taxiRunId, subwayRunId } = entry;
      if (!entry.taxi || !entry.subway || !isRunId(taxiRunId) || !isRunId(subwayRunId)) {
        throw new Error('Invalid mobility run bindings');
      }
      month.taxiRunId = taxiRunId;
      month.subwayRunId = subwayRunId;
    }
    months.set(entry.month, month);
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export function monthDate(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** New York's calendar rule in effect since 2007. */
function expectedClockChange(month: string): ClockChange | undefined {
  const spring = month.endsWith('-03');
  if (!daysInMonth(month) || Number(month.slice(0, 4)) < 2007 || (!spring && !month.endsWith('-11'))) return undefined;
  const firstWeekday = new Date(`${monthDate(month, 1)}T00:00:00Z`).getUTCDay();
  const date = monthDate(month, (spring ? 8 : 1) + (7 - firstWeekday) % 7);
  return spring ? { date, hour: 2, kind: 'nonexistent' } : { date, hour: 1, kind: 'repeated' };
}

/** The 2020–24 clock-change backfill publishes each verified run pair in the catalog. */
export function publishedClockChange(month: string, binding: MobilityRunBindings): ClockChange | undefined {
  const year = Number(month.slice(0, 4));
  if (year >= 2020 && year <= 2024 && isRunId(binding.taxiRunId) && isRunId(binding.subwayRunId)) {
    return expectedClockChange(month);
  }
}

export function parseAssetClockChange(asset: Record<string, unknown>, month: string): ClockChange | undefined {
  if (asset.version === 1 && !('clockChange' in asset)) return undefined;
  const change = asset.clockChange;
  const expected = expectedClockChange(month);
  if (asset.version !== 2 || !expected || !record(change) || Object.keys(change).length !== 3
    || change.date !== expected.date || change.hour !== expected.hour || change.kind !== expected.kind) {
    throw new Error('Invalid monthly clock change');
  }
  return expected;
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
