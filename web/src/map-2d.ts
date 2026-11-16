import { parseLandFootprint } from './land-footprint.ts';
import type { StationMarker } from './session.ts';
import { zonePicker } from './zone-picker.ts';
import { areaTarget, zoneExtent } from './zones.ts';
import type { Zone, ZoneCollection, ZoneExtent } from './zones.ts';

interface Point { x: number; y: number }
interface Bounds { left: number; top: number; right: number; bottom: number }
interface Camera { center: Point; scale: number }
type View = Camera | { bounds: Bounds };
type Line = number[][];
type Polygon = Line[];
interface PathGroup { path: Path2D; bounds: Bounds }
interface RoadPaths { minor: PathGroup[]; major: PathGroup[] }

// Local equidistant map with distances in metres at Manhattan's standard parallel.
const metresPerDegree = 111_320;
const metresPerLongitude = metresPerDegree * Math.cos(40.75 * Math.PI / 180);
const minimumScale = .005;
const maximumScale = 1.1;

const palette = {
  water: '#102432',
  waterLight: '#193241',
  waterDeep: '#0a1825',
  waterEdge: '#4264772a',
  contextLand: '#22313b',
  contextOverviewStreet: '#30414d',
  contextStreet: '#3b4c57',
  contextMainStreet: '#596a77',
  contextOverviewMainStreet: '#4b5e6b',
  contextPark: '#293f36',
  land: '#293640',
  coast: '#5b727f',
  overviewStreet: '#35444f',
  street: '#4c5b65',
  mainStreet: '#74818a',
  park: '#2d4b3e',
  parkEdge: '#537262',
  label: '#becbd2',
  contextLabel: '#93a8b3',
  waterLabel: '#a6c0cd',
  parkLabel: '#bbd7c4',
  highlightEdge: '#a8bcff',
  station: '#7ddaf2',
};

function project(longitude: number, latitude: number): Point {
  return { x: (longitude + 74) * metresPerLongitude, y: (40.75 - latitude) * metresPerDegree };
}

function boundsFromExtent({ west, south, east, north }: ZoneExtent): Bounds {
  const upperLeft = project(west, north), lowerRight = project(east, south);
  return { left: upperLeft.x, top: upperLeft.y, right: lowerRight.x, bottom: lowerRight.y };
}

const opening: View = {
  bounds: boundsFromExtent({ west: -74.037, south: 40.698, east: -73.913, north: 40.863 }),
};
const panBounds = boundsFromExtent({ west: -74.34, south: 40.39, east: -73.53, north: 41 });
const detailExtent = { west: -74.26, south: 40.49, east: -73.69, north: 40.93 };
const harborExtent = { west: -74.42, south: 40.43, east: -73.57, north: 41 };
const harborBounds = boundsFromExtent(harborExtent);
const maxDetailVertices = 250_000;
const maxHarborVertices = 60_000;
const maxHarborRoadVertices = 250_000;
const maxHarborParkVertices = 40_000;
const pathGroupSize = 5_000;
const cityBoroughs = new Set(['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island']);

function overviewBounds(zones: ZoneCollection): Bounds {
  const extents = zones.features.filter(zone => cityBoroughs.has(zone.properties.borough))
    .flatMap(zone => zoneExtent(zone) ?? []);
  if (!extents.length) return boundsFromExtent(detailExtent);
  return boundsFromExtent({
    west: Math.min(...extents.map(extent => extent.west)),
    south: Math.min(...extents.map(extent => extent.south)),
    east: Math.max(...extents.map(extent => extent.east)),
    north: Math.max(...extents.map(extent => extent.north)),
  });
}

function addLine(path: Path2D, line: Line, close = false, bounds?: Bounds) {
  for (let index = 0; index < line.length; index++) {
    const point = project(line[index][0], line[index][1]);
    if (index === 0) path.moveTo(point.x, point.y);
    else path.lineTo(point.x, point.y);
    if (bounds) {
      bounds.left = Math.min(bounds.left, point.x);
      bounds.top = Math.min(bounds.top, point.y);
      bounds.right = Math.max(bounds.right, point.x);
      bounds.bottom = Math.max(bounds.bottom, point.y);
    }
  }
  if (close) path.closePath();
}

function polygonPath(polygons: readonly Polygon[]): Path2D {
  const path = new Path2D();
  for (const polygon of polygons) for (const ring of polygon) addLine(path, ring, true);
  return path;
}

function zonePolygons(zone: Zone): Polygon[] {
  return zone.geometry.type === 'Polygon' ? [zone.geometry.coordinates] : zone.geometry.coordinates;
}

function assetRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function geometryReader(extent: ZoneExtent, cap: number) {
  let vertices = 0;
  const actual = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  return {
    line(value: unknown, closed = false): value is Line {
      if (!Array.isArray(value) || value.length < (closed ? 4 : 2) || vertices + value.length > cap) return false;
      for (const point of value) {
        if (!Array.isArray(point) || point.length !== 2) return false;
        const [longitude, latitude] = point;
        if (!Number.isFinite(longitude) || longitude < extent.west || longitude > extent.east
          || !Number.isFinite(latitude) || latitude < extent.south || latitude > extent.north) return false;
        actual.west = Math.min(actual.west, longitude);
        actual.south = Math.min(actual.south, latitude);
        actual.east = Math.max(actual.east, longitude);
        actual.north = Math.max(actual.north, latitude);
      }
      if (closed && (value[0][0] !== value.at(-1)[0] || value[0][1] !== value.at(-1)[1])) return false;
      vertices += value.length;
      return true;
    },
    count() { return vertices; },
    bounds() { return [actual.west, actual.south, actual.east, actual.north]; },
  };
}

function groupedPaths() {
  const groups = new Map<string, PathGroup>();
  return {
    add(lines: readonly Line[], closed = false) {
      const point = project(lines[0][0][0], lines[0][0][1]);
      const key = `${Math.floor(point.x / pathGroupSize)},${Math.floor(point.y / pathGroupSize)}`;
      let group = groups.get(key);
      if (!group) {
        group = { path: new Path2D(), bounds: { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity } };
        groups.set(key, group);
      }
      for (const line of lines) addLine(group.path, line, closed, group.bounds);
    },
    list() { return [...groups.values()]; },
  };
}

function roadPaths(reader: ReturnType<typeof geometryReader>, streets: unknown, majorStreets: unknown): RoadPaths | undefined {
  if (!Array.isArray(streets) || !Array.isArray(majorStreets)) return;
  const minor = groupedPaths(), major = groupedPaths();
  for (const [lines, paths] of [[streets, minor], [majorStreets, major]] as const) {
    for (const line of lines) {
      if (!reader.line(line)) return;
      paths.add([line]);
    }
  }
  return { minor: minor.list(), major: major.list() };
}

function parkPaths(reader: ReturnType<typeof geometryReader>, parks: unknown) {
  if (!Array.isArray(parks)) return;
  const green = groupedPaths();
  for (const polygon of parks) {
    if (!Array.isArray(polygon) || !polygon.length || !polygon.every(ring => reader.line(ring, true))) return;
    green.add(polygon, true);
  }
  return green.list();
}

function streetAndParkPaths(input: unknown) {
  if (!assetRecord(input)) return;
  const { version, streets, majorStreets, parks, bounds, totalVertices } = input;
  if (version !== 1 || typeof totalVertices !== 'number' || !Number.isInteger(totalVertices)
    || totalVertices < 1 || totalVertices > maxDetailVertices || !Array.isArray(bounds) || bounds.length !== 4) return;
  const reader = geometryReader(detailExtent, totalVertices);
  const roads = roadPaths(reader, streets, majorStreets);
  const parksLayer = parkPaths(reader, parks);
  if (!roads || !parksLayer || reader.count() !== totalVertices
    || reader.bounds().some((value, index) => value !== bounds[index])) return;
  return { roads, parks: parksLayer };
}

function harborPaths(input: unknown) {
  if (!assetRecord(input) || input.version !== 1 || !Array.isArray(input.polygons) || !input.polygons.length) return;
  const reader = geometryReader(harborExtent, maxHarborVertices);
  for (const polygon of input.polygons) {
    if (!Array.isArray(polygon) || !polygon.length || !polygon.every(ring => reader.line(ring, true))) return;
  }
  return {
    land: polygonPath(input.polygons),
    roads: roadPaths(geometryReader(harborExtent, maxHarborRoadVertices), input.streets, input.majorStreets),
    parks: parkPaths(geometryReader(harborExtent, maxHarborParkVertices), input.parks),
  };
}

interface PlaceLabel {
  name: string;
  point: Point;
  color: string;
  size: number;
  minimum: number;
  layer?: 'detail' | 'harbor';
}

const labels: PlaceLabel[] = [
  { name: 'MANHATTAN', point: project(-73.974, 40.7656), color: palette.label, size: 13, minimum: .019 },
  { name: 'Central Park', point: project(-73.966, 40.784), color: palette.parkLabel, size: 11, minimum: .025, layer: 'detail' },
  { name: 'Hudson River', point: project(-74.014, 40.748), color: palette.waterLabel, size: 11, minimum: .022 },
  { name: 'East River', point: project(-73.951, 40.759), color: palette.waterLabel, size: 11, minimum: .032 },
  { name: 'Upper New York Bay', point: project(-74.047, 40.653), color: palette.waterLabel, size: 11, minimum: .012 },
  { name: 'Newark Bay', point: project(-74.132, 40.673), color: palette.waterLabel, size: 11, minimum: .012 },
  { name: 'BROOKLYN', point: project(-73.958, 40.691), color: palette.label, size: 12, minimum: 0 },
  { name: 'QUEENS', point: project(-73.876, 40.753), color: palette.label, size: 12, minimum: 0 },
  { name: 'BRONX', point: project(-73.878, 40.86), color: palette.label, size: 12, minimum: 0 },
  { name: 'STATEN ISLAND', point: project(-74.141, 40.583), color: palette.label, size: 12, minimum: 0 },
  { name: 'NEW JERSEY', point: project(-74.108, 40.765), color: palette.contextLabel, size: 11, minimum: .012, layer: 'harbor' },
  { name: 'Jersey City', point: project(-74.058, 40.722), color: palette.contextLabel, size: 11, minimum: .03, layer: 'harbor' },
  { name: 'Hoboken', point: project(-74.034, 40.746), color: palette.contextLabel, size: 11, minimum: .042, layer: 'harbor' },
];

function fitView(view: View, width: number, height: number): Camera {
  if ('center' in view) return view;
  const { left, top, right, bottom } = view.bounds;
  return {
    center: { x: (left + right) / 2, y: (top + bottom) / 2 },
    scale: Math.max(minimumScale, Math.min(maximumScale, width * .92 / (right - left), height * .9 / (bottom - top))),
  };
}

function screen(point: Point, camera: Camera, width: number, height: number): Point {
  return { x: width / 2 + (point.x - camera.center.x) * camera.scale,
    y: height / 2 + (point.y - camera.center.y) * camera.scale };
}

function world(point: Point, camera: Camera, width: number, height: number): Point {
  return { x: camera.center.x + (point.x - width / 2) / camera.scale,
    y: camera.center.y + (point.y - height / 2) / camera.scale };
}

function intersects(a: Bounds, b: Bounds) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function waterRipples(ctx: CanvasRenderingContext2D) {
  const tile = document.createElement('canvas');
  tile.width = 288;
  tile.height = 180;
  const pen = tile.getContext('2d');
  if (!pen) return null;
  let seed = 314159;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  }
  pen.lineCap = 'round';
  for (let index = 0; index < 140; index++) {
    const x = random() * tile.width;
    const y = 3 + random() * (tile.height - 6);
    const length = 4 + random() * 19;
    const lift = .5 + random() * 1.2;
    pen.lineWidth = .55 + random() * .55;
    pen.strokeStyle = index % 3 === 0 ? '#040e1933' : '#8ab3cb26';
    pen.beginPath();
    for (const offset of [0, -tile.width]) {
      const start = x + offset;
      pen.moveTo(start, y);
      pen.quadraticCurveTo(start + length * .55, y - lift, start + length, y);
    }
    pen.stroke();
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  pattern?.setTransform(new DOMMatrix().scale(25));
  return pattern;
}

function paintWater(ctx: CanvasRenderingContext2D, visible: Bounds, scale: number, ripples: CanvasPattern | null) {
  const start = project(-74.28, 40.93), end = project(-73.85, 40.49);
  const depth = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  depth.addColorStop(0, palette.waterLight);
  depth.addColorStop(.52, palette.water);
  depth.addColorStop(1, palette.waterDeep);
  const width = visible.right - visible.left, height = visible.bottom - visible.top;
  ctx.fillStyle = depth;
  ctx.fillRect(visible.left, visible.top, width, height);
  if (!ripples || scale < .011) return;
  ctx.globalAlpha = scale > .13 ? .4 : scale < .022 ? .55 : .84;
  ctx.fillStyle = ripples;
  ctx.fillRect(visible.left, visible.top, width, height);
  ctx.globalAlpha = 1;
}

function paintHarbor(
  ctx: CanvasRenderingContext2D, harbor: NonNullable<ReturnType<typeof harborPaths>>,
  visible: Bounds, scale: number, system: boolean, buffer: HTMLCanvasElement,
) {
  if (!intersects(harborBounds, visible)) return;
  function layers(target: CanvasRenderingContext2D) {
    target.fillStyle = system ? 'ButtonFace' : palette.contextLand;
    target.fill(harbor.land, 'evenodd');
    if (harbor.parks) paintParks(target, harbor.parks, visible, scale, system, true);
    if (harbor.roads) paintRoads(target, harbor.roads, visible, scale, system, true);
  }
  const { left, top, right, bottom } = harborBounds;
  const margin = 4_000;
  const inner = { left: left + margin, top: top + margin, right: right - margin, bottom: bottom - margin };
  if (system || (visible.left >= inner.left && visible.top >= inner.top
    && visible.right <= inner.right && visible.bottom <= inner.bottom)) {
    layers(ctx);
    return;
  }

  // Feather the whole context layer at the source crop so its roads and parks fade with the land.
  if (buffer.width !== ctx.canvas.width) buffer.width = ctx.canvas.width;
  if (buffer.height !== ctx.canvas.height) buffer.height = ctx.canvas.height;
  const layer = buffer.getContext('2d');
  if (!layer) { layers(ctx); return; }
  layer.resetTransform();
  layer.clearRect(0, 0, buffer.width, buffer.height);
  layer.setTransform(ctx.getTransform());
  layer.lineJoin = layer.lineCap = 'round';
  layers(layer);
  layer.globalCompositeOperation = 'destination-out';
  const edges = [
    { ...visible, right: inner.left, x: left, y: 0, dx: margin, dy: 0 },
    { ...visible, left: inner.right, x: right, y: 0, dx: -margin, dy: 0 },
    { ...visible, bottom: inner.top, x: 0, y: top, dx: 0, dy: margin },
    { ...visible, top: inner.bottom, x: 0, y: bottom, dx: 0, dy: -margin },
  ];
  for (const edge of edges) {
    if (edge.left >= edge.right || edge.top >= edge.bottom) continue;
    const fade = layer.createLinearGradient(edge.x, edge.y, edge.x + edge.dx, edge.y + edge.dy);
    fade.addColorStop(0, '#000');
    fade.addColorStop(1, '#0000');
    layer.fillStyle = fade;
    layer.fillRect(edge.left, edge.top, edge.right - edge.left, edge.bottom - edge.top);
  }
  layer.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.resetTransform();
  ctx.drawImage(buffer, 0, 0);
  ctx.restore();
}

function paintRoads(ctx: CanvasRenderingContext2D, roads: RoadPaths, visible: Bounds, scale: number, system: boolean, context = false) {
  const overview = scale < .023;
  const width = context ? .84 : 1;
  if (scale >= (context ? .014 : .012)) {
    ctx.strokeStyle = system ? 'GrayText' : overview
      ? (context ? palette.contextOverviewStreet : palette.overviewStreet)
      : (context ? palette.contextStreet : palette.street);
    ctx.lineWidth = width * (overview ? .47 : scale < .075 ? .7 : 1.05) / scale;
    for (const { path, bounds } of roads.minor) if (intersects(visible, bounds)) ctx.stroke(path);
  }
  ctx.strokeStyle = system ? 'CanvasText' : context
    ? (overview ? palette.contextOverviewMainStreet : palette.contextMainStreet)
    : palette.mainStreet;
  ctx.lineWidth = width * (overview ? .67 : scale < .075 ? .85 : 1.35) / scale;
  for (const { path, bounds } of roads.major) if (intersects(visible, bounds)) ctx.stroke(path);
}

function paintParks(ctx: CanvasRenderingContext2D, parks: readonly PathGroup[], visible: Bounds, scale: number, system: boolean, context = false) {
  ctx.fillStyle = system ? 'ButtonFace' : context ? palette.contextPark : palette.park;
  ctx.strokeStyle = system ? 'CanvasText' : palette.parkEdge;
  ctx.lineWidth = .7 / scale;
  for (const { path, bounds } of parks) {
    if (!intersects(visible, bounds)) continue;
    ctx.fill(path);
    if (!context && scale >= .023) ctx.stroke(path);
  }
}

export function createMap2D(canvas: HTMLCanvasElement, zones: ZoneCollection, onPick: (id: number | null) => void) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const ripples = ctx && waterRipples(ctx);
  const harborBuffer = document.createElement('canvas');
  const picker = zonePicker(zones);
  const zonesById = new Map(zones.features.map(zone => [zone.id, zone]));
  const city: View = { bounds: overviewBounds(zones) };
  const layers = new AbortController();
  const events = new AbortController();
  const controls = { signal: events.signal };
  const theme = getComputedStyle(canvas);
  const selectionColor = theme.getPropertyValue('--color-map-selected').trim() || '#254cd8';
  const forcedColors = matchMedia('(forced-colors: active)');
  let shoreline: Path2D | undefined;
  let harbor: ReturnType<typeof harborPaths>;
  let detail: ReturnType<typeof streetAndParkPaths>;
  let zoneFallback: Path2D | undefined;
  let selectedPath: Path2D | undefined;
  let selectedId: number | null = null;
  let station: StationMarker | null = null;
  let view = opening;
  let areaOrigin: View | undefined;
  let overviewOrigin: View | undefined;
  let frame = 0;
  let disposed = false;

  function invalidate() {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; paint(); });
  }

  function paint() {
    if (!ctx) return;
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelsWide = Math.round(width * ratio), pixelsHigh = Math.round(height * ratio);
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
    const camera = fitView(view, width, height);
    const { center, scale } = camera;
    const halfWidth = (width / 2 + 2) / scale, halfHeight = (height / 2 + 2) / scale;
    const visible = {
      left: center.x - halfWidth, top: center.y - halfHeight,
      right: center.x + halfWidth, bottom: center.y + halfHeight,
    };
    const system = forcedColors.matches;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = system ? 'Canvas' : palette.water;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-center.x, -center.y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (!system) {
      paintWater(ctx, visible, scale, ripples);
      if (shoreline) {
        ctx.strokeStyle = palette.waterEdge;
        ctx.lineWidth = (scale < .023 ? 4 : 5) / scale;
        ctx.stroke(shoreline);
        ctx.lineWidth = (scale < .023 ? 2.25 : 2.75) / scale;
        ctx.stroke(shoreline);
      }
    }
    if (harbor) paintHarbor(ctx, harbor, visible, scale, system, harborBuffer);
    const land = shoreline ?? zoneFallback;
    if (land) {
      ctx.fillStyle = system ? 'Canvas' : palette.land;
      ctx.fill(land, 'evenodd');
      if (shoreline) {
        ctx.strokeStyle = system ? 'CanvasText' : palette.coast;
        ctx.lineWidth = 1.05 / scale;
        ctx.stroke(shoreline);
      }
    }
    if (detail) {
      paintParks(ctx, detail.parks, visible, scale, system);
      paintRoads(ctx, detail.roads, visible, scale, system);
    }
    if (selectedPath) {
      ctx.fillStyle = system ? 'Highlight' : selectionColor;
      ctx.globalAlpha = .4;
      ctx.fill(selectedPath, 'evenodd');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = system ? 'Highlight' : palette.highlightEdge;
      ctx.lineWidth = 2 / scale;
      ctx.stroke(selectedPath);
    }
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const occupied: Bounds[] = [];
    function label(text: string, position: Point, size: number, color: string) {
      if (!ctx) return;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      const half = ctx.measureText(text).width / 2 + 5;
      const box = { left: position.x - half, top: position.y - size, right: position.x + half, bottom: position.y + size };
      if (box.left < 0 || box.top < 0 || box.right > width || box.bottom > height
        || occupied.some(item => item.left < box.right && item.right > box.left && item.top < box.bottom && item.bottom > box.top)) return;
      occupied.push(box);
      ctx.strokeStyle = system ? 'Canvas' : palette.water;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, position.x, position.y);
      ctx.fillStyle = system ? 'CanvasText' : color;
      ctx.fillText(text, position.x, position.y);
    }
    if (station) {
      const point = screen(project(station.longitude, station.latitude), camera, width, height);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = system ? 'Highlight' : palette.station;
      ctx.fill();
      ctx.strokeStyle = system ? 'CanvasText' : palette.water;
      ctx.lineWidth = 2;
      ctx.stroke();
      label(station.name, { x: point.x, y: point.y - 16 }, 12, palette.label);
    }
    for (const place of labels) {
      if (scale < place.minimum || (place.layer === 'detail' && !detail) || (place.layer === 'harbor' && !harbor)) continue;
      label(place.name, screen(place.point, camera, width, height), place.size, place.color);
    }
  }

  async function loadAsset(file: string): Promise<unknown> {
    const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`, {
      mode: 'same-origin', redirect: 'error', signal: layers.signal,
    });
    if (!response.ok) throw new Error('Map layer unavailable');
    return response.json();
  }

  function useZoneFallback() {
    if (disposed) return;
    zoneFallback = polygonPath(zones.features.flatMap(zonePolygons));
    invalidate();
  }

  void loadAsset('city-land.json').then(value => {
    if (disposed) return;
    const land = parseLandFootprint(value);
    if (!land) { useZoneFallback(); return; }
    shoreline = polygonPath(land.polygons.map(polygon => [polygon.ring, ...(polygon.holes ?? [])]));
    invalidate();
  }).catch(useZoneFallback);
  void loadAsset('harbor-context.json').then(value => {
    if (disposed) return;
    harbor = harborPaths(value);
    invalidate();
  }).catch(() => { /* The NYC shoreline remains available. */ });
  void loadAsset('manhattan-streets-parks.json').then(value => {
    if (disposed) return;
    detail = streetAndParkPaths(value);
    invalidate();
  }).catch(() => { /* Shorelines and areas remain available. */ });

  function clamp(value: number, low: number, high: number) {
    return Math.max(low, Math.min(high, value));
  }

  function navigate(before: Point, after: Point, zoom = 1) {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    const camera = fitView(view, width, height);
    const around = world(before, camera, width, height);
    const scale = clamp(camera.scale * zoom, minimumScale, maximumScale);
    view = {
      center: {
        x: clamp(around.x - (after.x - width / 2) / scale, panBounds.left, panBounds.right),
        y: clamp(around.y - (after.y - height / 2) / scale, panBounds.top, panBounds.bottom),
      },
      scale,
    };
    invalidate();
  }

  function local(event: MouseEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pick(position: Point) {
    const { clientWidth: width, clientHeight: height } = canvas;
    const point = world(position, fitView(view, width, height), width, height);
    const id = picker.pick(point.x / metresPerLongitude - 74, 40.75 - point.y / metresPerDegree)?.id ?? null;
    onPick(id);
  }

  const pointers = new Map<number, Point>();
  let press: Point | undefined;
  let moved = false;
  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointers.size >= 2) return;
    const point = local(event);
    if (!pointers.size) { press = point; moved = false; }
    else moved = true;
    pointers.set(event.pointerId, point);
    canvas.setPointerCapture(event.pointerId);
  }, controls);
  canvas.addEventListener('pointermove', event => {
    const before = pointers.get(event.pointerId);
    if (!before) return;
    const after = local(event);
    if (!moved && press && distance(press, after) < 5) return;
    moved = true;
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const separation = distance(before, other);
      navigate(midpoint(before, other), midpoint(after, other), separation >= 4 ? distance(after, other) / separation : 1);
    } else navigate(before, after);
    pointers.set(event.pointerId, after);
  }, controls);
  canvas.addEventListener('pointerup', event => {
    if (!pointers.delete(event.pointerId)) return;
    if (!pointers.size && !moved && press) {
      const point = local(event);
      if (distance(press, point) < 5) pick(point);
    }
  }, controls);
  for (const type of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => { pointers.delete((event as PointerEvent).pointerId); }, controls);
  }
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const point = local(event);
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    navigate(point, point, Math.exp(clamp(-event.deltaY * units * .002, -.75, .75)));
  }, { ...controls, passive: false });
  canvas.addEventListener('dblclick', event => {
    const point = local(event);
    navigate(point, point, event.shiftKey ? 1 / 1.6 : 1.6);
  }, controls);
  canvas.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const anchor = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const step = 48;
    const offsets: Record<string, Point> = {
      ArrowLeft: { x: step, y: 0 }, ArrowRight: { x: -step, y: 0 },
      ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step },
    };
    const offset = offsets[event.key];
    if (offset) navigate(anchor, { x: anchor.x + offset.x, y: anchor.y + offset.y });
    else if (event.key === '+' || event.key === '=') navigate(anchor, anchor, 1.28);
    else if (event.key === '-' || event.key === '_') navigate(anchor, anchor, 1 / 1.28);
    else return;
    event.preventDefault();
  }, controls);
  forcedColors.addEventListener('change', invalidate, controls);
  const resize = new ResizeObserver(invalidate);
  resize.observe(canvas);
  invalidate();

  return {
    select(id: number | null) {
      const zone = id === null ? undefined : zonesById.get(id);
      const next = zone?.id ?? null;
      if (selectedId === next) return;
      selectedId = next;
      selectedPath = zone ? polygonPath(zonePolygons(zone)) : undefined;
      areaOrigin = undefined;
      invalidate();
    },
    selectStation(next: StationMarker | null) {
      if (station?.id === next?.id && station?.name === next?.name
        && station?.longitude === next?.longitude && station?.latitude === next?.latitude) return;
      station = next && Number.isFinite(next.longitude) && Number.isFinite(next.latitude) ? next : null;
      invalidate();
    },
    focus(id: number) {
      const target = areaTarget(zones, id);
      if (!target || disposed) return false;
      areaOrigin ??= view;
      overviewOrigin = undefined;
      const extent = boundsFromExtent(target);
      const padding = Math.max(220, Math.max(extent.right - extent.left, extent.bottom - extent.top) * .45);
      view = { bounds: { left: extent.left - padding, top: extent.top - padding,
        right: extent.right + padding, bottom: extent.bottom + padding } };
      invalidate();
      return true;
    },
    canReturnToView() { return areaOrigin !== undefined; },
    returnToView() {
      if (!areaOrigin || disposed) return false;
      view = areaOrigin;
      areaOrigin = undefined;
      invalidate();
      return true;
    },
    overview() {
      if (disposed) return false;
      const previous = overviewOrigin;
      overviewOrigin = previous ? undefined : view;
      if (!previous) areaOrigin = undefined;
      view = previous ?? city;
      invalidate();
      return true;
    },
    hasOverviewReturn() { return overviewOrigin !== undefined; },
    dispose() {
      if (disposed) return;
      disposed = true;
      layers.abort();
      events.abort();
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
      for (const id of pointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      pointers.clear();
    },
  };
}
