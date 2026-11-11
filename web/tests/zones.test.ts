import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZones, zonePath } from '../src/zones.ts';
const feature = { type: 'Feature', id: 7, properties: { location_id: 7, zone: 'Local source zone', borough: 'Queens' }, geometry: { type: 'Polygon', coordinates: [[[-73.9,40.7],[-73.8,40.7],[-73.8,40.8],[-73.9,40.7]], [[-73.88,40.72],[-73.86,40.72],[-73.86,40.74],[-73.88,40.72]]] } };
test('local metadata remains keyed by source location_id and includes holes', () => {
 const zones = parseZones({ type:'FeatureCollection', features:[feature] });
 assert.equal(zones.features[0]?.properties.location_id, 7);
 assert.equal(zonePath(zones.features[0]).split('Z').length-1, 2);
});
test('rejects out of bounds coordinates and malformed metadata', () => {
 assert.throws(() => parseZones({ type:'FeatureCollection',features:[{...feature,id:999}] }));
 assert.throws(() => parseZones({ type:'FeatureCollection',features:[{...feature,geometry:{type:'Polygon',coordinates:[[[2263,2263]]]}}] }));
});
test('retains multipart geometry and never injects source strings into markup', () => {
 const input = {...feature, geometry:{type:'MultiPolygon',coordinates:[feature.geometry.coordinates,feature.geometry.coordinates]}};
 const zone = parseZones({type:'FeatureCollection',features:[input]}).features[0];
 assert.equal(zonePath(zone).split('Z').length-1, 4); assert.match(zonePath(zone), /^M/);
});
