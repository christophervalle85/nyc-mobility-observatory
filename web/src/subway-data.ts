import { TAXI_MONTH } from './taxi-data.ts';

export interface SubwayStation {
  id: number;
  name: string;
  borough: string;
  latitude: number;
  longitude: number;
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
    && typeof value.latitude === 'number' && Math.abs(value.latitude) <= 90
    && typeof value.longitude === 'number' && Math.abs(value.longitude) <= 180
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

export function nearbyStations(stations: readonly SubwayStation[], center: { longitude: number; latitude: number }) {
  const radians = Math.PI / 180;
  const latitude = center.latitude * radians;
  return stations.map(station => {
    const stationLatitude = station.latitude * radians;
    const halfLatitude = (stationLatitude - latitude) / 2;
    const halfLongitude = (station.longitude - center.longitude) * radians / 2;
    const chord = Math.sin(halfLatitude) ** 2
      + Math.cos(latitude) * Math.cos(stationLatitude) * Math.sin(halfLongitude) ** 2;
    return { station, distance: 12_742_000 * Math.asin(Math.sqrt(Math.min(1, chord))) };
  }).filter(item => item.distance <= 1_200)
    .sort((a, b) => a.distance - b.distance || a.station.id - b.station.id)
    .slice(0, 6);
}
