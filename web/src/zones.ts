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
