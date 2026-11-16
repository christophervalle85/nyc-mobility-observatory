import { hoursPerDay } from './mobility-months.ts';
import { buildMobilityRange } from './mobility-range.ts';
import type { MobilityMonthData, ModeDay } from './mobility-range.ts';

export const typicalDayWeeks = 8;
export const typicalDayMinimum = 4;

interface HourlyBaseline {
  counts: (number | null)[];
  samples: number[];
}

export interface TypicalDay {
  taxi: HourlyBaseline;
  subway: HourlyBaseline;
}

interface TypicalDayInput {
  date: string;
  zoneId: number;
  stationId: number | null;
  months: ReadonlyMap<string, MobilityMonthData>;
}

export function typicalDayDates(date: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== date) return [];
  const dates: string[] = [];
  for (let week = 0; week < typicalDayWeeks; week++) {
    day.setUTCDate(day.getUTCDate() - 7);
    if (day.getUTCFullYear() < 1) break;
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

function hourlyBaseline(days: readonly ModeDay[]): HourlyBaseline {
  const counts: HourlyBaseline['counts'] = [];
  const samples: HourlyBaseline['samples'] = [];
  for (let hour = 0; hour < hoursPerDay; hour++) {
    const observed = days.flatMap(day => {
      const count = day.counts[hour];
      return count === null ? [] : [count];
    }).sort((a, b) => a - b);
    samples.push(observed.length);
    if (observed.length < typicalDayMinimum) {
      counts.push(null);
    } else {
      const middle = Math.floor(observed.length / 2);
      counts.push(observed.length % 2
        ? observed[middle]
        : (observed[middle - 1] + observed[middle]) / 2);
    }
  }
  return { counts, samples };
}

export function buildTypicalDay({ date, zoneId, stationId, months }: TypicalDayInput): TypicalDay {
  const readDay = (day: string) => buildMobilityRange({
    start: day, end: day, zoneId, stationId, months,
  })?.days[0];
  const target = readDay(date);
  const eligibleDays = target && !target.clockChange ? typicalDayDates(date).flatMap(day => {
    const candidate = readDay(day);
    return candidate && !candidate.clockChange ? [candidate] : [];
  }) : [];
  return {
    taxi: hourlyBaseline(eligibleDays.map(day => day.taxi)),
    subway: hourlyBaseline(eligibleDays.map(day => day.subway)),
  };
}
