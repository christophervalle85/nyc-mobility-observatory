import { dateLabel, daysInMonth, hoursPerDay, monthDate } from './mobility-months.ts';

const ZONE_COUNT = 263;

export interface TaxiData {
  runId: string;
  sourceSha256: string;
  totalDropoffs: number;
  zones: ReadonlyMap<number, readonly number[]>;
}

interface TaxiRange {
  firstHour: number;
  endHour: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function parseTaxiData(value: unknown, month: string): TaxiData {
  const monthHours = daysInMonth(month) * hoursPerDay;
  if (!monthHours || !record(value) || value.version !== 1 || value.month !== month
    || value.timezone !== 'America/New_York' || !sha256(value.runId) || !sha256(value.sourceSha256)
    || !record(value.zones) || Object.keys(value.zones).length !== ZONE_COUNT) {
    throw new Error('Invalid monthly taxi data');
  }
  const zones = new Map<number, readonly number[]>();
  let totalDropoffs = 0;
  for (let id = 1; id <= ZONE_COUNT; id++) {
    const counts = value.zones[id];
    if (!Array.isArray(counts) || counts.length !== monthHours) {
      throw new Error('Missing monthly taxi hours');
    }
    for (const count of counts) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid taxi dropoff count');
      totalDropoffs += count;
    }
    zones.set(id, counts);
  }
  if (!Number.isSafeInteger(totalDropoffs) || value.totalDropoffs !== totalDropoffs) {
    throw new Error('Inconsistent monthly taxi total');
  }
  return { runId: value.runId, sourceSha256: value.sourceSha256, totalDropoffs, zones };
}

export function taxiDateRange(start: string, end: string): TaxiRange | null {
  const month = start.slice(0, 7);
  const days = daysInMonth(month);
  const first = Number(start.slice(8)), last = Number(end.slice(8));
  if (!days || start !== monthDate(month, first) || end !== monthDate(month, last)
    || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last > days || first > last) return null;
  return {
    firstHour: (first - 1) * hoursPerDay,
    endHour: last * hoursPerDay,
  };
}

export function taxiSeries(data: TaxiData, id: number, range: TaxiRange) {
  const zone = data.zones.get(id);
  if (!zone) return null;
  const counts = zone.slice(range.firstHour, range.endHour);
  return { total: counts.reduce((sum, count) => sum + count, 0), counts };
}

export function hourLabel(hour: number): string {
  const clockHour = hour % hoursPerDay;
  return `${clockHour % 12 || 12}:00 ${clockHour < 12 ? 'AM' : 'PM'}`;
}

export function taxiHourLabel(month: string, hour: number): string {
  const day = Math.floor(hour / hoursPerDay) + 1;
  return `${dateLabel(monthDate(month, day))}, ${hourLabel(hour)}`;
}
