import { Cartesian2, Cartesian3 } from 'cesium';
import type { Camera, Scene } from 'cesium';
import type { ZoneGeometry } from './zones.ts';

export interface SelectionAnchor { x: number; y: number }

interface ProjectionScene {
  canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight'>;
  camera: Pick<Camera, 'positionWC' | 'directionWC'> & { frustum: { near: number; far: number } };
  cartesianToCanvasCoordinates: Scene['cartesianToCanvasCoordinates'];
}

export function selectionAnchorPosition(geometry: ZoneGeometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let position: { longitude: number; latitude: number } | undefined;
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
      position = { longitude: (left + right) / 2, latitude };
    }
  }
  return position;
}

export function selectionAnchorPublisher(publish: (point: SelectionAnchor | null) => void) {
  let previousId: number | null = null;
  let previousPoint: SelectionAnchor | null = null;
  return (id: number | null, point: SelectionAnchor | null) => {
    const nextId = point ? id : null;
    if (nextId === previousId && previousPoint?.x === point?.x && previousPoint?.y === point?.y) return;
    previousId = nextId;
    previousPoint = point;
    publish(point);
  };
}

export function selectionAnchorProjection(scene: ProjectionScene) {
  const offset = new Cartesian3();
  const screen = new Cartesian2();
  return (position: Cartesian3): SelectionAnchor | null => {
    const { camera, canvas } = scene;
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return null;
    const depth = Cartesian3.dot(Cartesian3.subtract(position, camera.positionWC, offset), camera.directionWC);
    if (!(depth >= camera.frustum.near && depth <= camera.frustum.far)) return null;
    const point = scene.cartesianToCanvasCoordinates(position, screen);
    if (!point || !(point.x >= 0 && point.x < width && point.y >= 0 && point.y < height)) return null;
    // Ignore subpixel changes without rounding an in-bounds point past the viewport edge.
    return { x: Math.floor(point.x), y: Math.floor(point.y) };
  };
}
