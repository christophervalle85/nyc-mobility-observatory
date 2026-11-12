import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Cartesian2, Cartesian3 } from 'cesium';
import { selectionAnchorPosition, selectionAnchorProjection, selectionAnchorPublisher } from '../src/selection-anchor.ts';
import type { SelectionAnchor } from '../src/selection-anchor.ts';
import { parseZones } from '../src/zones.ts';
import { zonePicker } from '../src/zone-picker.ts';

function fixture(projectPosition?: (position: Cartesian3) => Cartesian2) {
  let screenPoint: Cartesian2 | undefined = new Cartesian2(49.8, 74.2);
  let calls = 0;
  const canvas = { clientWidth: 100, clientHeight: 150 };
  const project = selectionAnchorProjection({
    canvas,
    camera: {
      positionWC: new Cartesian3(0, 0, 100),
      directionWC: new Cartesian3(0, 0, -1),
      frustum: { near: 1, far: 200 },
    },
    cartesianToCanvasCoordinates(position) { calls++; return projectPosition ? projectPosition(position) : screenPoint; },
  });
  return { project, canvas, calls: () => calls, setPoint(point?: Cartesian2) { screenPoint = point; } };
}

test('anchor uses canvas CSS pixels and tracks the viewport size', () => {
  const { project, canvas } = fixture();
  assert.deepEqual(project(Cartesian3.ZERO), { x: 49, y: 74 });
  canvas.clientWidth = 40;
  assert.equal(project(Cartesian3.ZERO), null);
  canvas.clientWidth = 60;
  assert.deepEqual(project(Cartesian3.ZERO), { x: 49, y: 74 });
});

test('anchor rejects a hidden canvas and points outside the camera depth range', () => {
  const { project, canvas, calls } = fixture();
  for (const z of [101, 99.5, -101]) assert.equal(project(new Cartesian3(0, 0, z)), null);
  canvas.clientHeight = 0;
  assert.equal(project(Cartesian3.ZERO), null);
  assert.equal(calls(), 0);
});

test('anchor rejects undefined, nonfinite and off-screen projected points', () => {
  const { project, setPoint } = fixture();
  for (const point of [undefined, new Cartesian2(NaN, 20), new Cartesian2(100, 20), new Cartesian2(10, -0.01)]) {
    setPoint(point);
    assert.equal(project(Cartesian3.ZERO), null);
  }
});

test('outline top interpolates the upper edge near the card pointer', () => {
  const { project, canvas } = fixture(position => new Cartesian2(position.x, position.y));
  canvas.clientWidth = 800;
  canvas.clientHeight = 500;
  const outline = [
    new Cartesian3(100, 100, 0), new Cartesian3(700, 280, 0),
    new Cartesian3(700, 340, 0), new Cartesian3(100, 340, 0),
  ];
  assert.deepEqual(project(new Cartesian3(400, 300, 0), outline), { x: 400, y: 300, outlineTop: 175 });
});

test('outline top includes a crossing edge from outside the visible viewport', () => {
  const { project, canvas } = fixture(position => new Cartesian2(position.x, position.y));
  canvas.clientWidth = 800;
  canvas.clientHeight = 500;
  const outline = [
    new Cartesian3(100, -200, 0), new Cartesian3(700, 100, 0),
    new Cartesian3(700, 340, 0), new Cartesian3(100, 340, 0),
  ];
  assert.deepEqual(project(new Cartesian3(400, 300, 0), outline), { x: 400, y: 300, outlineTop: -74 });
});

test('a distant apex does not lift a card pointing to a lower part of the area', () => {
  const { project, canvas } = fixture(position => new Cartesian2(position.x, position.y));
  canvas.clientWidth = 320;
  canvas.clientHeight = 568;
  const outline = [
    new Cartesian3(20, 380, 0), new Cartesian3(152, 350, 0), new Cartesian3(260, 280, 0),
    new Cartesian3(280, 470, 0), new Cartesian3(20, 470, 0),
  ];
  assert.deepEqual(project(new Cartesian3(40, 410, 0), outline), { x: 40, y: 410, outlineTop: 364 });
});

test('anchor stays within each official TLC area, including concave and multipart areas', () => {
  const geography = parseZones(JSON.parse(readFileSync(new URL('../public/data/taxi-zones.geojson', import.meta.url), 'utf8')));
  const picker = zonePicker(geography);
  assert.equal(geography.features.length, 263);
  for (const zone of geography.features) {
    const position = selectionAnchorPosition(zone.geometry);
    assert.ok(position, `TLC area ${zone.id} should have an anchor`);
    assert.equal(picker.pick(position.longitude, position.latitude)?.id, zone.id, `TLC area ${zone.id}`);
  }
});

test('anchor avoids a horizontal hole boundary at the center latitude', () => {
  const position = selectionAnchorPosition({
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 2], [4, 5], [6, 5], [6, 2], [4, 2]],
    ],
  });
  assert.ok(position);
  assert.notEqual(position.latitude, 5);
});

test('anchor republishes identical coordinates for a different selected area', () => {
  const changes: (SelectionAnchor | null)[] = [];
  const publish = selectionAnchorPublisher(point => changes.push(point));
  const point = { x: 40, y: 60 };
  publish(1, point);
  publish(1, { ...point });
  publish(2, point);
  publish(null, null);
  publish(null, null);
  assert.deepEqual(changes, [point, point, null]);
});

test('anchor republishes a changed outline at the same center', () => {
  const changes: (SelectionAnchor | null)[] = [];
  const publish = selectionAnchorPublisher(point => changes.push(point));
  const point = { x: 40, y: 100, outlineTop: 60 };
  const moved = { ...point, outlineTop: 50 };
  publish(1, point);
  publish(1, { ...point });
  publish(1, moved);
  assert.deepEqual(changes, [point, moved]);
});
