export interface ZonePart<T> { locationId: number; value: T }
export function zoneHighlight<T>(parts: Iterable<ZonePart<T>>, apply: (part: T, selected: boolean) => void) {
  const groups = new Map<number, T[]>();
  for (const part of parts) {
    const group = groups.get(part.locationId) ?? [];
    group.push(part.value); groups.set(part.locationId, group);
  }
  let selected: number | null = null;
  return { select(id: number | null) {
    const next = id !== null && groups.has(id) ? id : null;
    if (next === selected) return false;
    if (selected !== null) for (const value of groups.get(selected) ?? []) apply(value, false);
    if (next !== null) for (const value of groups.get(next) ?? []) apply(value, true);
    selected = next;
    return true;
  } };
}
