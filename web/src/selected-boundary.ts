import type { Ring, ZoneCollection } from './zones.ts';
export function selectedBoundary<T>(geography: ZoneCollection, add: (ring: Ring, locationId: number) => T, remove: (part: T) => void) {
  const zones = new Map(geography.features.map(zone => [zone.properties.location_id, zone]));
  let selected: number | null = null;
  let owned: T[] = [];
  function clear() { for (const part of owned) remove(part); owned = []; }
  return {
    select(id: number | null) {
      const zone = id === null ? undefined : zones.get(id);
      const next = zone?.properties.location_id ?? null;
      if (next === selected) return;
      clear(); selected = next;
      if (!zone) return;
      const polygons = zone.geometry.type === 'Polygon' ? [zone.geometry.coordinates] : zone.geometry.coordinates;
      for (const polygon of polygons) for (const ring of polygon) owned.push(add(ring, zone.properties.location_id));
    },
    dispose() { clear(); selected = null; },
  };
}
