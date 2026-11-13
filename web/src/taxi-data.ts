export const TAXI_MONTH = '2026-09';
export const TAXI_START = '2026-09-01';
export const TAXI_END = '2026-09-30';
const HOURS_PER_DAY = 24;
const MONTH_HOURS = 30 * HOURS_PER_DAY;
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

export function parseTaxiData(value: unknown): TaxiData {
  if (!record(value) || value.version !== 1 || value.month !== TAXI_MONTH
    || value.timezone !== 'America/New_York' || !sha256(value.runId) || !sha256(value.sourceSha256)
    || !record(value.zones) || Object.keys(value.zones).length !== ZONE_COUNT) {
    throw new Error('Invalid September taxi data');
  }
  const zones = new Map<number, readonly number[]>();
  let totalDropoffs = 0;
  for (let id = 1; id <= ZONE_COUNT; id++) {
    const counts = value.zones[id];
    if (!Array.isArray(counts) || counts.length !== MONTH_HOURS) {
      throw new Error('Missing September taxi hours');
    }
    for (const count of counts) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid taxi dropoff count');
      totalDropoffs += count;
    }
    zones.set(id, counts);
  }
  if (!Number.isSafeInteger(totalDropoffs) || value.totalDropoffs !== totalDropoffs) {
    throw new Error('Inconsistent September taxi total');
  }
  return { runId: value.runId, sourceSha256: value.sourceSha256, totalDropoffs, zones };
}

export function taxiDateRange(start: string, end: string): TaxiRange | null {
  const datePattern = /^2026-09-(0[1-9]|[12]\d|30)$/;
  if (!datePattern.test(start) || !datePattern.test(end) || end < start) return null;
  return {
    firstHour: (Number(start.slice(-2)) - 1) * HOURS_PER_DAY,
    endHour: Number(end.slice(-2)) * HOURS_PER_DAY,
  };
}

export function taxiSeries(data: TaxiData, id: number, range: TaxiRange) {
  const zone = data.zones.get(id);
  if (!zone) return null;
  const counts = zone.slice(range.firstHour, range.endHour);
  return { total: counts.reduce((sum, count) => sum + count, 0), counts };
}

export function taxiHourLabel(hour: number): string {
  const day = Math.floor(hour / HOURS_PER_DAY) + 1;
  const clock = String(hour % HOURS_PER_DAY).padStart(2, '0');
  return `Sep ${day}, ${clock}:00`;
}
