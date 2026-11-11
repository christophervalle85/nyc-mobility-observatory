import {
  Viewer, Ion, Cesium3DTileset, GeoJsonDataSource, Cartesian3, Math as CesiumMath,
  Color, ColorMaterialProperty, ConstantProperty, ScreenSpaceEventHandler,
  ScreenSpaceEventType, Entity, SceneMode, Cartesian2,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { managedAdapter } from './managed-adapter.ts';
import type { OwnedResource, SceneRuntime } from './managed-adapter.ts';
import { SceneFailure } from './session.ts';
import type { ZoneCollection } from './zones.ts';
class Resource<T> implements OwnedResource {
  value: T;
  private release: () => void;
  constructor(value: T, release: () => void) { this.value = value; this.release = release; }
  destroy() { this.release(); }
}
export function createCesiumAdapter(container: HTMLElement, credits: HTMLElement, token: string, geography: ZoneCollection, choose: (id: number | null) => void) {
  return managedAdapter((): SceneRuntime => {
    Ion.defaultAccessToken = token;
    let viewer: Viewer;
    try {
      viewer = new Viewer(container, {
        baseLayer: false, globe: false, skyBox: false, skyAtmosphere: false,
        baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
        animation: false, timeline: false, fullscreenButton: false, navigationHelpButton: false,
        selectionIndicator: false, infoBox: false, projectionPicker: false,
        scene3DOnly: true, sceneMode: SceneMode.SCENE3D, shouldAnimate: false,
        requestRenderMode: true, maximumRenderTimeChange: Infinity, targetFrameRate: 30,
        showRenderLoopErrors: false, creditContainer: credits, msaaSamples: 1,
      });
    } catch { Ion.defaultAccessToken = ''; throw new SceneFailure('webgl'); }
    viewer.resolutionScale = Math.min(1, 1 / (window.devicePixelRatio || 1));
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 200;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 20_000;
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(-74.008, 40.682, 6500),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 },
    });
    const canvas = viewer.scene.canvas; canvas.setAttribute('aria-label', 'NYC 3D map. Use the zone list to select a zone.');
    canvas.setAttribute('tabindex', '-1');
    const style = getComputedStyle(document.documentElement);
    const boundary = Color.fromCssColorString(style.getPropertyValue('--color-map-line').trim());
    const selection = Color.fromCssColorString(style.getPropertyValue('--color-map-selected').trim());
    let entities: GeoJsonDataSource | undefined, selected: number | null = null, tileset: Cesium3DTileset | undefined;
    let partial: (() => void) | undefined;
    const cleanup: (() => void)[] = [];
    const handler = new ScreenSpaceEventHandler(canvas);
    handler.setInputAction((event: {position: Cartesian2}) => {
      const result = viewer.scene.pick(event.position);
      if (result?.id instanceof Entity) {
        const id = result.id.properties?.location_id?.getValue(viewer.clock.currentTime);
        if (Number.isInteger(id)) choose(id);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
    cleanup.push(viewer.scene.renderError.addEventListener(() => partial?.()));
    function colorSelection() {
      if (!entities || viewer.isDestroyed()) return;
      for (const entity of entities.entities.values) if (entity.polygon) {
        const id = entity.properties?.location_id?.getValue(viewer.clock.currentTime);
        entity.polygon.material = new ColorMaterialProperty((id === selected ? selection : boundary).withAlpha(id === selected ? 0.42 : 0.08));
        entity.polygon.outline = new ConstantProperty(true);
        entity.polygon.outlineColor = new ConstantProperty(id === selected ? selection : boundary);
      }
      viewer.scene.requestRender();
    }
    return {
      async tiles() {
        const value = await Cesium3DTileset.fromIonAssetId(2275207, {
          showCreditsOnScreen: true, maximumScreenSpaceError: 32,
          cacheBytes: 128 * 1024 * 1024, maximumCacheOverflowBytes: 64 * 1024 * 1024,
          cullRequestsWhileMoving: true, dynamicScreenSpaceError: true, enableCollision: true,
        });
        return new Resource(value, () => { if (!value.isDestroyed()) value.destroy(); });
      },
      async zones() { const value = await GeoJsonDataSource.load(geography, {clampToGround:true}); return new Resource(value, () => value.entities.removeAll()); },
      attachTiles(resource) {
        tileset = (resource as Resource<Cesium3DTileset>).value;
        // A registered listener suppresses Cesium's default raw-URL console logging.
        cleanup.push(tileset.tileFailed.addEventListener(() => partial?.()));
        viewer.scene.primitives.add(tileset); viewer.scene.requestRender();
      },
      attachZones(resource) {
        entities = (resource as Resource<GeoJsonDataSource>).value;
        void viewer.dataSources.add(entities); colorSelection();
      },
      watchPartial(change) { partial=change; return () => {partial=undefined;}; },
      select(id) { selected=id; colorSelection(); },
      destroy() {
        for (const remove of cleanup) remove(); handler.destroy();
        if (!viewer.isDestroyed()) viewer.destroy();
        Ion.defaultAccessToken = ''; entities=undefined;tileset=undefined;
      },
    };
  });
}
