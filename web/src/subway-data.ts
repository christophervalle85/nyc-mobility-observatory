import { TAXI_MONTH } from './taxi-data.ts';

export interface SubwayStation {
  id: number;
  name: string;
  borough: string;
  counts: (number | null)[];
}

export interface SubwayData {
  runId: string;
  stations: SubwayStation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isStation(value: unknown): value is SubwayStation {
  return isRecord(value) && typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0
    && typeof value.name === 'string' && value.name.trim().length > 0
    && typeof value.borough === 'string' && value.borough.trim().length > 0
    && Array.isArray(value.counts) && value.counts.length === 720
    && Array.from(value.counts).every(count => count === null ||
      (typeof count === 'number' && Number.isFinite(count) && count >= 0 && count <= Number.MAX_SAFE_INTEGER));
}

export function parseSubwayData(value: unknown): SubwayData {
  if (!isRecord(value) || value.version !== 1 || value.month !== TAXI_MONTH
    || value.timezone !== 'America/New_York' || !isDigest(value.runId) || !isDigest(value.sourceSha256)
    || !Array.isArray(value.stations) || value.stations.length === 0 || !Array.from(value.stations).every(isStation)
    || new Set(value.stations.map(station => station.id)).size !== value.stations.length) {
    throw new Error('Invalid September subway data');
  }
  return { runId: value.runId, stations: value.stations };
}
