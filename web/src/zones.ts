export type Ring = number[][];
export type ZoneGeometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
export interface Zone { type: 'Feature'; id: number; properties: { location_id: number; zone: string; borough: string }; geometry: ZoneGeometry }
export interface ZoneCollection { type: 'FeatureCollection'; features: Zone[] }
export function parseZones(input: unknown): ZoneCollection {
  if (typeof input !== 'object' || input === null || !('type' in input) || input.type !== 'FeatureCollection' || !('features' in input) || !Array.isArray(input.features) || input.features.length > 1000) throw new Error('Invalid local zone collection');
  for (const feature of input.features) {
    const p = feature?.properties, g = feature?.geometry;
    if (feature?.type !== 'Feature' || !Number.isInteger(feature.id) || feature.id < 1 || feature.id > 263 || p?.location_id !== feature.id || typeof p?.zone !== 'string' || typeof p?.borough !== 'string' || !['Polygon', 'MultiPolygon'].includes(g?.type)) throw new Error('Invalid local zone metadata');
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (!Array.isArray(polygons) || polygons.length === 0) throw new Error('Missing local zone geometry');
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || polygon.length === 0) throw new Error('Missing polygon');
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid polygon ring');
        for (const point of ring) {
          if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < -74.3 || point[0] > -73.6 || point[1] < 40.45 || point[1] > 40.95) throw new Error('Zone outside NYC bounds');
        }
      }
    }
  }
  return input as ZoneCollection;
}
export function zonePath(zone: Zone): string {
  const polygons = zone.geometry.type === 'Polygon' ? [zone.geometry.coordinates] : zone.geometry.coordinates;
  return polygons.flatMap(polygon => polygon.map(ring => ring.map(([lon, lat], i) => `${i === 0 ? 'M' : 'L'}${((lon + 74.3) * 1370).toFixed(2)},${((40.95 - lat) * 1800).toFixed(2)}`).join('') + 'Z')).join('');
}
export interface ZoneExtent { west: number; south: number; east: number; north: number }
export interface AreaTarget extends ZoneExtent { locationId: number; longitude: number; latitude: number; range: number; radius: number }
export function resolveZone(collection: ZoneCollection, id: unknown): Zone | undefined {
  const value = typeof id === 'string' && /^[1-9]\d{0,2}$/.test(id.trim()) ? Number(id.trim()) : id;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 263) return undefined;
  return collection.features.find(zone => zone.id === value && zone.properties.location_id === value);
}
export function filterZones(collection: ZoneCollection, query: string): Zone[] {
  const text = query.trim().toLowerCase();
  const numeric = /^\d+$/.test(text);
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return collection.features.filter(zone => !text || (numeric
    ? String(zone.properties.location_id) === text
    : zone.properties.zone.toLowerCase().includes(text) || zone.properties.borough.toLowerCase().includes(text)))
    .sort((a, b) => compare(a.properties.borough.toLowerCase(), b.properties.borough.toLowerCase()) || compare(a.properties.zone.toLowerCase(), b.properties.zone.toLowerCase()) || a.id - b.id);
}
export function zoneExtent(zone: Zone): ZoneExtent | undefined {
  try { parseZones({ type: 'FeatureCollection', features: [zone] }); } catch { return undefined; }
  const polygons = zone.geometry.type === 'Polygon' ? [zone.geometry.coordinates] : zone.geometry.coordinates;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (const [longitude, latitude] of ring) {
    west = Math.min(west, longitude); east = Math.max(east, longitude);
    south = Math.min(south, latitude); north = Math.max(north, latitude);
  }
  if (!(west < east && south < north)) return undefined;
  return { west, south, east, north };
}
export function areaTarget(collection: ZoneCollection, id: unknown): AreaTarget | undefined {
  const zone = resolveZone(collection, id), extent = zone && zoneExtent(zone);
  if (!zone || !extent) return undefined;
  const fit = (low: number, high: number, minimum: number, maximum: number) => {
    const span = Math.max(0.001, (high - low) * 1.12);
    let start = Math.max(minimum, (low + high - span) / 2);
    const end = Math.min(maximum, start + span); start = Math.max(minimum, end - span);
    return [start, end];
  };
  const [west, east] = fit(extent.west, extent.east, -74.3, -73.6);
  const [south, north] = fit(extent.south, extent.north, 40.45, 40.95);
  const longitude = (west + east) / 2, latitude = (south + north) / 2;
  const width = (east - west) * 111_320 * Math.cos(latitude * Math.PI / 180), height = (north - south) * 111_320;
  const radius = Math.max(50, Math.hypot(width, height) / 2);
  return { locationId: zone.id, west, south, east, north, longitude, latitude, radius, range: Math.min(20_000, Math.max(800, radius * 3.6)) };
}
