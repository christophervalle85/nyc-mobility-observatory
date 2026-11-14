import { daysInMonth, hoursPerDay, monthDate } from './mobility-months.ts';
import type { TaxiData } from './taxi-data.ts';
import type { SubwayData } from './subway-data.ts';

export interface MobilityMonthData {
  taxi?: TaxiData | null;
  subway?: SubwayData | null;
}

export interface ModeDay {
  counts: readonly (number | null)[];
  total: number | null;
  observedHours: number;
  expectedHours: number;
  partial: boolean;
}

export interface ModeCoverage {
  total: number | null;
  observedHours: number;
  expectedHours: number;
  availableDays: number;
  completeDays: number;
  partial: boolean;
}

export interface MobilityDay {
  date: string;
  taxi: ModeDay;
  subway: ModeDay;
}

export interface MobilityRange {
  days: MobilityDay[];
  taxi: ModeCoverage;
  subway: ModeCoverage;
}

export interface MobilityRangeInput {
  start: string;
  end: string;
  zoneId: number;
  stationId: number | null;
  /** Only successfully validated, published month payloads belong in this map. */
  months: ReadonlyMap<string, MobilityMonthData>;
}

function validDate(date: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return false;
  const day = Number(date.slice(8));
  return day >= 1 && day <= daysInMonth(date.slice(0, 7));
}

function nextDate(date: string): string {
  const month = date.slice(0, 7), day = Number(date.slice(8));
  if (day < daysInMonth(month)) return monthDate(month, day + 1);
  const year = Number(month.slice(0, 4)), monthNumber = Number(month.slice(5));
  return monthNumber === 12
    ? `${String(year + 1).padStart(4, '0')}-01-01`
    : `${month.slice(0, 4)}-${String(monthNumber + 1).padStart(2, '0')}-01`;
}

function modeDay(series: readonly (number | null)[] | undefined, firstHour: number): ModeDay {
  // Missing payloads/stations are gaps; an observed zero remains an observed hour.
  const counts = Array.from({ length: hoursPerDay }, (_, hour) => series?.[firstHour + hour] ?? null);
  let observedHours = 0, sum = 0;
  for (const value of counts) {
    if (value !== null) {
      observedHours++;
      sum += value;
    }
  }
  return {
    counts, total: observedHours ? sum : null, observedHours, expectedHours: hoursPerDay,
    partial: observedHours < hoursPerDay,
  };
}

function coverage(days: readonly ModeDay[]): ModeCoverage {
  let sum = 0, observedHours = 0, availableDays = 0, completeDays = 0;
  for (const day of days) {
    sum += day.total ?? 0;
    observedHours += day.observedHours;
    if (day.observedHours) availableDays++;
    if (!day.partial) completeDays++;
  }
  const expectedHours = days.length * hoursPerDay;
  return {
    total: observedHours ? sum : null, observedHours, expectedHours, availableDays, completeDays,
    partial: observedHours < expectedHours,
  };
}

/** Inclusive local-clock days, including months absent from the published catalog.
 * Partial totals sum only comparable observed hours; null means no comparable hours.
 * Run provenance is checked per month, and a mismatch excludes that month's subway only.
 */
export function buildMobilityRange(input: MobilityRangeInput): MobilityRange | null {
  const { start, end, zoneId, stationId, months } = input;
  if (!validDate(start) || !validDate(end) || start > end) return null;
  const days: MobilityDay[] = [];
  for (let date = start; ; date = nextDate(date)) {
    const data = months.get(date.slice(0, 7));
    const firstHour = (Number(date.slice(8)) - 1) * hoursPerDay;
    const taxi = data?.taxi;
    const subway = data?.subway;
    const matchingRun = !taxi || taxi.runId === subway?.runId;
    const station = matchingRun ? subway?.stations.find(item => item.id === stationId) : undefined;
    days.push({
      date,
      taxi: modeDay(taxi?.zones.get(zoneId), firstHour),
      subway: modeDay(station?.counts, firstHour),
    });
    if (date === end) break;
  }
  return { days, taxi: coverage(days.map(day => day.taxi)), subway: coverage(days.map(day => day.subway)) };
}
