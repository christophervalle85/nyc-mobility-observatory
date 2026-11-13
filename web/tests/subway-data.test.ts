import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nearbyStations, parseSubwayData } from '../src/subway-data.ts';

function archive() {
  return {
    version: 1,
    month: '2026-09',
    timezone: 'America/New_York',
    runId: 'a'.repeat(64),
    sourceSha256: 'b'.repeat(64),
    stations: Array.from({ length: 2 }, (_, index) => ({
      id: index + 1,
      name: 'Station',
      borough: 'Queens',
      latitude: 40.75,
      longitude: -73.99,
      counts: Array<number | null>(720).fill(null),
    })),
  };
}

test('subway parsing preserves unknown, observed zero and fractional estimates', () => {
  const data = archive();
  data.stations[0].counts[1] = 0;
  data.stations[0].counts[2] = 2.5;
  assert.deepEqual(parseSubwayData(data, '2026-09').stations[0].counts.slice(0, 3), [null, 0, 2.5]);
});

test('subway parsing rejects invalid provenance and malformed station series', () => {
  const data = archive();
  assert.throws(() => parseSubwayData({ ...data, sourceSha256: 'invalid' }, '2026-09'));
  data.stations[0].counts[1] = -1;
  assert.throws(() => parseSubwayData(data, '2026-09'));
  data.stations[0].counts[1] = null;
  data.stations[0].counts.pop();
  assert.throws(() => parseSubwayData(data, '2026-09'));
  data.stations[0].counts.push(0);
  data.stations[0].id = data.stations[1].id;
  assert.throws(() => parseSubwayData(data, '2026-09'));
});

test('subway parsing validates the requested calendar and preserves the last August gap', () => {
  const data = archive();
  data.month = '2026-08';
  for (const station of data.stations) station.counts.push(...Array<null>(24).fill(null));
  assert.equal(parseSubwayData(data, '2026-08').stations[0].counts[743], null);
  assert.throws(() => parseSubwayData(data, '2026-09'));
});


test('nearby stations are distance ordered, bounded, and empty when too far away', () => {
  const center = { latitude: 40.75, longitude: -73.99 };
  const base = parseSubwayData(archive(), '2026-09').stations[0];
  const stations = Array.from({ length: 8 }, (_, index) => ({
    ...base, id: index + 1, latitude: center.latitude + (8 - index) / 1000,
  }));
  assert.deepEqual(nearbyStations(stations, center).map(({ station }) => station.id), [8, 7, 6, 5, 4, 3]);
  assert.deepEqual(nearbyStations(stations, { ...center, latitude: 40.6 }), []);
});


test('a station just inside the great-circle radius remains eligible', () => {
  const center = { latitude: 40.75, longitude: -73.99 };
  const station = { ...parseSubwayData(archive(), '2026-09').stations[0], latitude: center.latitude + .01079 };
  const [result] = nearbyStations([station], center);
  assert.equal(result.station, station);
  assert.equal(Math.round(result.distance), 1_200);
});
