import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Cartesian2, Cartesian3 } from 'cesium';
import { selectionAnchorPosition, selectionAnchorProjection, selectionAnchorPublisher } from '../src/selection-anchor.ts';
import type { SelectionAnchor } from '../src/selection-anchor.ts';
import { parseZones } from '../src/zones.ts';
import { zonePicker } from '../src/zone-picker.ts';

function fixture() {
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
    cartesianToCanvasCoordinates() { calls++; return screenPoint; },
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
