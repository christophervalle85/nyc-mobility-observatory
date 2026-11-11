# Official TLC zone overlay

The local overlay contains 263 official TLC zones with 263 unique `LocationID`
values. It is independent of Cesium/Google imagery. No image-derived boundaries,
heights or statistics are used.

The derived GeoJSON and provenance sidecar are intentionally versioned; raw trip and subway data remain ignored. The frontend reads `public/data/taxi-zones.geojson`. It is a WGS84 FeatureCollection:
integer `feature.id`, integer `properties.location_id`, and string `properties.zone`
and `properties.borough`. Geometry is Polygon or MultiPolygon with longitude,
latitude pairs. IDs come from source `LocationID`, never `OBJECTID`. Labels are
checked against the archived official lookup, ignoring case and whitespace only.

## Reproduce from the frozen M1 archive

Run from the repository root. The snapshot selects the ZIP and lookup through their
content-addressed paths; the converter does not discover credentials or read env files.

```sh
uv run --locked --script web/scripts/export_taxi_zones.py \
  --data-dir .data \
  --snapshot .data/snapshots/99fe7db5f3a0e717bee4ef2d2042a1021464f298a77adee25b5a917d2358a101.json \
  --output-dir web/public/data
uv run --locked --script web/scripts/test_export_taxi_zones.py
```

Each script has its own PEP 723 dependency declarations and `.py.lock` file.
Dependencies are pyshp 2.3.1 and pyproj 3.7.2; the core Python package and uv lockfile
are unchanged. Initial dependency setup may download pinned packages from PyPI.
Conversion itself is offline, with PROJ network access explicitly disabled. No
Cesium token or tile request is needed.

The 12 converter tests cover multipart polygons and holes, axis order, unexpected
CRS/bounds, duplicate IDs, lookup identity/coverage, checksums, unsafe ZIP members,
resource ceilings and two identical exports of the actual frozen source. The live
source test is skipped if that archived snapshot is unavailable.

## Conversion and provenance

The source PRJ is EPSG:2263, NAD83 / New York Long Island in US survey feet.
Projection uses `always_xy=True` into EPSG:4326, exported as longitude then latitude.
The current isolated environment uses PROJ 9.5.1 and EPSG database v11.022. Its
selected NAD83-to-WGS84 operation reports 4 metre accuracy; full numeric output
precision does not imply survey accuracy.

The real source has 98,192 vertices: 240 Polygon and 23 MultiPolygon features. It
contains no interior holes; synthetic tests exercise hole preservation. All source
vertices and full projected precision are retained. Only ring winding is reversed
to GeoJSON's right-hand convention. There is no simplification or coordinate rounding.
The resulting GeoJSON is 3,871,294 bytes, deliberately larger than a simplified map.

`public/data/taxi-zones.provenance.json` records input hashes, official source and
policy links, TLC credit, output hash, source/converter identity, parser/projection
versions, operation accuracy and a portable reproduction command. Neither generated
file contains a private absolute home path. Byte-for-byte reproducibility was
verified in the current environment; cross-platform floating-point identity is not
claimed.

Source references:
- [TLC trip-record and taxi-zone downloads](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page)
- [NYC terms of use](https://www.nyc.gov/home/terms-of-use.page)
- [NYC Open Data public policies](https://cityofnewyork.github.io/opendatatsm/publicpolicies.html)

These are source/policy references, not a new license grant or legal clearance.

## Validation limits

Before conversion, the snapshot and both input checksums are verified. The ZIP must
match the approved official SHA-256. Only the five expected SHP/SHX/DBF/PRJ/CPG
members are read in memory; there is no extraction. Unsafe names, duplicate or
unexpected members, encryption, unsupported compression and symbolic links fail.
Limits are 10 MiB per ZIP, 4 MiB per member, 8 MiB total expanded bytes, 1,000
features, 200,000 total vertices and 100,000 vertices per ring.

Checks cover ring closure, nonzero area, hole containment, finite coordinates,
ordinary lookup coverage and a bounded TLC/NYC extent including Newark Airport.
This is structural validation, not a complete independent topology/survey audit or
geometry repair. Validation finishes before output writes; each generated file is
replaced atomically, with provenance written last. Treat the output hash in the
sidecar as the consistency check for the pair.

Actual overlay clamping, occlusion and picking against live 3D tiles remain separate
live acceptance checks. This exporter supplies no heights, station-to-zone join or
mobility statistics.
