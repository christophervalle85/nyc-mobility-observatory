import { Cartesian2, Cartesian3 } from 'cesium';
import type { Camera, Scene } from 'cesium';
import type { Ring, ZoneGeometry } from './zones.ts';

export interface SelectionAnchor { x: number; y: number; outlineTop?: number }

interface ProjectionScene {
  canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight'>;
  camera: Pick<Camera, 'positionWC' | 'directionWC'> & { frustum: { near: number; far: number } };
  cartesianToCanvasCoordinates: Scene['cartesianToCanvasCoordinates'];
}

export function selectionAnchorPosition(geometry: ZoneGeometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let position: { longitude: number; latitude: number; outerRing: Ring } | undefined;
  let widest = 0;
  for (const rings of polygons) {
    let south = Infinity, north = -Infinity;
    for (const [, latitude] of rings[0]) {
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
    const middle = (south + north) / 2;
    let onVertex = false;
    let nextLatitude = north;
    for (const ring of rings) {
      for (const [, latitude] of ring) {
        if (latitude === middle) onVertex = true;
        if (latitude > middle) nextLatitude = Math.min(nextLatitude, latitude);
      }
    }
    // Keep the scanline off horizontal boundaries, including the edges of holes.
    const latitude = onVertex ? (middle + nextLatitude) / 2 : middle;
    const crossings: number[] = [];
    for (const ring of rings) {
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const [startLongitude, startLatitude] = ring[previous];
        const [endLongitude, endLatitude] = ring[index];
        if ((startLatitude > latitude) !== (endLatitude > latitude)) {
          crossings.push(startLongitude + (endLongitude - startLongitude) * (latitude - startLatitude) / (endLatitude - startLatitude));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    // Every pair spans the interior, so holes and gaps cannot become the anchor.
    for (let index = 1; index < crossings.length; index += 2) {
      const left = crossings[index - 1], right = crossings[index];
      if (right - left <= widest) continue;
      widest = right - left;
      position = { longitude: (left + right) / 2, latitude, outerRing: rings[0] };
    }
  }
  return position;
}

export function selectionAnchorPublisher(publish: (point: SelectionAnchor | null) => void) {
  let previousId: number | null = null;
  let previousPoint: SelectionAnchor | null = null;
  return (id: number | null, point: SelectionAnchor | null) => {
    const nextId = point ? id : null;
    if (nextId === previousId && previousPoint?.x === point?.x && previousPoint?.y === point?.y &&
        previousPoint?.outlineTop === point?.outlineTop) return;
    previousId = nextId;
    previousPoint = point;
    publish(point);
  };
}

export function selectionAnchorProjection(scene: ProjectionScene) {
  const offset = new Cartesian3();
  const screen = new Cartesian2();
  const previousScreen = new Cartesian2();
  return (position: Cartesian3, outline: readonly Cartesian3[] = []): SelectionAnchor | null => {
    const { camera, canvas } = scene;
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return null;
    const { positionWC, directionWC, frustum } = camera;
    function project(world: Cartesian3, result: Cartesian2) {
      const depth = Cartesian3.dot(Cartesian3.subtract(world, positionWC, offset), directionWC);
      if (!(depth >= frustum.near && depth <= frustum.far)) return undefined;
      const point = scene.cartesianToCanvasCoordinates(world, result);
      return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
    }
    const point = project(position, screen);
    if (!point || !(point.x >= 0 && point.x < width && point.y >= 0 && point.y < height)) return null;
    // Ignore subpixel changes without rounding an in-bounds point past the viewport edge.
    const x = Math.floor(point.x), y = Math.floor(point.y);
    const last = outline.at(-1);
    if (!last) return { x, y };

    // Clear the whole projected component so a widened or edge-clamped card cannot cover its apex.
    let outlineTop = Infinity;
    let previous = project(last, previousScreen);
    for (const vertex of outline) {
      const next = project(vertex, screen);
      if (next) {
        if (next.x >= 0 && next.x <= width) outlineTop = Math.min(outlineTop, next.y);
        if (previous) outlineTop = Math.min(outlineTop, topOfSegment(previous, next, width));
      }
      previous = next && Cartesian2.clone(next, previousScreen);
    }
    return outlineTop < y ? { x, y, outlineTop: Math.floor(outlineTop) } : { x, y };
  };
}

function topOfSegment(start: Cartesian2, end: Cartesian2, width: number) {
  const firstX = Math.max(0, Math.min(start.x, end.x));
  const lastX = Math.min(width, Math.max(start.x, end.x));
  if (firstX > lastX) return Infinity;
  if (start.x === end.x) return Math.min(start.y, end.y);
  const upperX = start.y < end.y ? start.x : end.x;
  const clippedX = Math.max(firstX, Math.min(lastX, upperX));
  return start.y + (end.y - start.y) * (clippedX - start.x) / (end.x - start.x);
}
