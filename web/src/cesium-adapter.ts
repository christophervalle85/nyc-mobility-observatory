import {
  Viewer, Ion, Cesium3DTileset, GeoJsonDataSource, Cartesian3, Math as CesiumMath,
  Color, ColorMaterialProperty, ScreenSpaceEventHandler, ScreenSpaceEventType,
  Entity, SceneMode, Cartesian2, BoundingSphere, HeadingPitchRange, Matrix4,
  ClippingPolygon, ClippingPolygonCollection,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { managedAdapter } from './managed-adapter.ts';
import type { OwnedResource, SceneRuntime } from './managed-adapter.ts';
import { SceneFailure } from './session.ts';
import { resolveZone } from './zones.ts';
import type { ZoneCollection } from './zones.ts';
import { areaFocus } from './area-focus.ts';
import { focusView } from './focus-view.ts';
import { displayPolicy, tilePolicy } from './rendering-policy.ts';
import { zoneHighlight } from './zone-highlight.ts';
import { selectedBoundary } from './selected-boundary.ts';
import { selectionPresentation } from './selection-presentation.ts';
import { selectionAnchorPosition, selectionAnchorProjection, selectionAnchorPublisher } from './selection-anchor.ts';
import type { SelectionAnchor } from './selection-anchor.ts';
import { cityOverview, skylineOpening, footprintMask } from './study-footprint.ts';
import { stageNavigation } from './stage-navigation.ts';
import { zonePicker } from './zone-picker.ts';
import { detailReadiness } from './detail-readiness.ts';
import { imageryProgress } from './imagery-progress.ts';
import type { ImageryStage } from './imagery-progress.ts';
import type { Diagnostics } from './diagnostics.ts';
import { landFootprintMask } from './land-footprint.ts';
import type { LandFootprint, LandPolygon } from './land-footprint.ts';
import type { CutoutMode } from './cutout-mode.ts';
class Resource<T> implements OwnedResource {
  constructor(public value: T, private release: () => void) {}
  destroy() { this.release(); }
}
export function createCesiumAdapter(container: HTMLElement, credits: HTMLElement, token: string, geography: ZoneCollection, choose: (id: number | null) => void, diagnostics?: Diagnostics, land?: LandFootprint, cutout: CutoutMode = 'none', onImagery?: (stage: ImageryStage) => void, onSelectionAnchor?: (point: SelectionAnchor | null) => void) {
  const profile = diagnostics?.enabled ? diagnostics : undefined;
  return managedAdapter((): SceneRuntime => {
    const constructed = profile?.span('scene.construct');
    Ion.defaultAccessToken = token;
    let viewer: Viewer;
    const display = displayPolicy(window.devicePixelRatio || 1);
    const viewerConstructed = profile?.span('viewer.construct');
    try {
      viewer = new Viewer(container, {
        baseLayer: false, globe: false, skyBox: false, skyAtmosphere: false,
        baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
        animation: false, timeline: false, fullscreenButton: false, navigationHelpButton: false,
        selectionIndicator: false, infoBox: false, projectionPicker: false,
        scene3DOnly: true, sceneMode: SceneMode.SCENE3D, shouldAnimate: false,
        requestRenderMode: true, maximumRenderTimeChange: Infinity,
        useBrowserRecommendedResolution: display.useBrowserRecommendedResolution, targetFrameRate: display.targetFrameRate,
        showRenderLoopErrors: false, creditContainer: credits, msaaSamples: 1,
      });
    } catch { Ion.defaultAccessToken = ''; throw new SceneFailure('webgl'); }
    finally { viewerConstructed?.(); }
    viewer.resolutionScale = display.resolutionScale;
    const style = getComputedStyle(document.documentElement);
    viewer.scene.backgroundColor = Color.fromCssColorString(style.getPropertyValue('--color-scene-background').trim()) ?? new Color(.07,.09,.12,1);
    const cameraController = viewer.scene.screenSpaceCameraController;
    cameraController.minimumZoomDistance = 200; cameraController.maximumZoomDistance = 180_000;
    cameraController.enableLook = false;
    cameraController.maximumTiltAngle = Math.PI * 70 / 180;
    const overviewTarget = () => cityOverview(geography, container.clientWidth / Math.max(1, container.clientHeight), 'fovy' in viewer.camera.frustum ? viewer.camera.frustum.fovy ?? Math.PI/3 : Math.PI/3);
    const initial = overviewTarget();
    if (!initial) { viewer.destroy(); Ion.defaultAccessToken = ''; throw new SceneFailure('network'); }
    const navigation = stageNavigation({
      lookAt(pose) { viewer.camera.lookAt(Cartesian3.fromDegrees(pose.pivot.longitude, pose.pivot.latitude), new HeadingPitchRange(pose.heading, pose.pitch, pose.range)); },
      reset() { if (!viewer.isDestroyed()) viewer.camera.lookAtTransform(Matrix4.IDENTITY); },
    });
    const opening = skylineOpening(geography, container.clientWidth / Math.max(1, container.clientHeight), 'fovy' in viewer.camera.frustum ? viewer.camera.frustum.fovy ?? Math.PI/3 : Math.PI/3);
    if (opening) navigation.opening(opening); else navigation.overview(initial); // One immediate fit; overview remains a deliberate action.
    let disposed = false, selected: number | null = null, imageryReady = false, cameraMoving = false, focusMoving = false;
    let tilesAttached = false, zonesAttached = false, partialSeen = false;
    let entities: GeoJsonDataSource | undefined, tileset: Cesium3DTileset | undefined;
    let mask: ReturnType<typeof footprintMask> | undefined, collection: ClippingPolygonCollection | undefined;
    let highlight: ReturnType<typeof zoneHighlight<Entity>> | undefined;
    let imagery: ReturnType<typeof imageryProgress> | undefined;
    let partial: (() => void) | undefined;
    const cleanup: (() => void)[] = [];
    if (profile) cleanup.push(profile.watchFrames((before,after) => {
      const removeBefore=viewer.scene.preRender.addEventListener(before),removeAfter=viewer.scene.postRender.addEventListener(after);
      return()=>{removeBefore();removeAfter();};
    }));
    const boundary = Color.fromCssColorString(style.getPropertyValue('--color-map-line').trim());
    const selection = Color.fromCssColorString(style.getPropertyValue('--color-map-selected').trim());
    const normalFill = new ColorMaterialProperty(boundary.withAlpha(.025)), selectedFill = new ColorMaterialProperty(selection.withAlpha(.14));
    let boundaryId = 0, outlined: number | null = null;
    const selectedLines = selectedBoundary(geography, (ring, locationId) => viewer.entities.add({
      id: `tlc-selected-boundary-${++boundaryId}`, properties: { location_id: locationId },
      polyline: { positions: Cartesian3.fromDegreesArray(ring.flatMap(([lon,lat]) => [lon,lat])), clampToGround: true, width: 2, material: selection },
    }), entity => { viewer.entities.remove(entity); });
    function colorSelection() {
      if (disposed) return;
      const includesNewark = cutout === 'none' || Boolean(mask?.state().includesNewark);
      const presentation = selectionPresentation(selected, includesNewark, imageryReady);
      const changed = highlight?.select(presentation.fillId);
      if (entities) entities.show = imageryReady;
      const outlineChanged = outlined !== presentation.outlineId;
      selectedLines.select(presentation.outlineId); outlined = presentation.outlineId;
      if (changed || outlineChanged) viewer.scene.requestRender();
    }
    let finishDetailWait = profile?.span('detail.wait');
    const detail = detailReadiness(
      check => viewer.scene.postRender.addEventListener(check),
      () => ({tilesLoaded: !disposed && Boolean(tileset?.tilesLoaded), cameraMoving, focusMoving}),
      () => { imageryReady=true; finishDetailWait?.(); finishDetailWait=undefined; profile?.event('tiles.detailSettled'); imagery?.settled(); colorSelection(); viewer.scene.requestRender(); },
    );
    function waitForDetail() { finishDetailWait ??= profile?.span('detail.wait'); detail.wait(); imageryReady = false; imagery?.wait(); colorSelection(); }
    const focus = areaFocus(geography, {
      move(target, options) {
        focusMoving = true; waitForDetail();
        const view = focusView(target, {heading:viewer.camera.heading,pitch:viewer.camera.pitch}, options.duration);
        viewer.camera.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(target.longitude, target.latitude), target.radius), {
          duration: view.duration,
          offset: new HeadingPitchRange(view.heading, view.pitch, view.range),
          complete() {
            if (!options.complete()) return;
            focusMoving = false;
            viewer.scene.requestRender();
          },
          cancel() { if (options.cancel()) focusMoving = false; },
        });
        viewer.scene.requestRender();
      },
      cancel() { focusMoving = false; if (!viewer.isDestroyed()) viewer.camera.cancelFlight(); },
    });
    function reportPartial() { partialSeen = true; focus.cancel(); anchor?.publish(null, null); partial?.(); }
    function canInteract() { return !disposed && tilesAttached && zonesAttached && !partialSeen; }
    const canvas = viewer.scene.canvas;
    canvas.setAttribute('aria-label', 'Interactive NYC map. Use arrow keys to move and plus or minus to zoom.');
    canvas.tabIndex = 0;
    const anchor = onSelectionAnchor && {
      project: selectionAnchorProjection(viewer.scene),
      publish: selectionAnchorPublisher(onSelectionAnchor),
    };
    let anchorId: number | null = null;
    let anchorPosition: Cartesian3 | undefined;
    let anchorOutline: Cartesian3[] = [];
    function updateSelectionAnchor() {
      if (!anchor) return;
      if (!canInteract() || container.hidden || outlined === null) {
        anchor.publish(null, null);
        return;
      }
      if (anchorId !== outlined) {
        anchorId = outlined;
        const zone = resolveZone(geography, anchorId);
        const point = zone && selectionAnchorPosition(zone.geometry);
        anchorPosition = point && Cartesian3.fromDegrees(point.longitude, point.latitude, 0, viewer.scene.ellipsoid);
        anchorOutline = [];
        if (point) {
          const ring = point.outerRing;
          const samples = Math.min(ring.length, 96);
          const degrees = Array.from({ length: samples }, (_, index) => ring[Math.floor(index * ring.length / samples)].slice(0, 2)).flat();
          anchorOutline = Cartesian3.fromDegreesArray(degrees, viewer.scene.ellipsoid);
        }
      }
      anchor.publish(outlined, anchorPosition ? anchor.project(anchorPosition, anchorOutline) : null);
    }
    if (anchor) {
      cleanup.push(viewer.scene.postRender.addEventListener(updateSelectionAnchor));
      const resize = new ResizeObserver(() => {
        if (!canvas.clientWidth || !canvas.clientHeight) anchor.publish(null, null);
        else if (canInteract() && outlined !== null) viewer.scene.requestRender();
      });
      resize.observe(canvas);
      cleanup.push(() => resize.disconnect());
    }
    const handler = new ScreenSpaceEventHandler(canvas);
    const indexed=profile?.span('zones.index');
    const picker = zonePicker(geography);
    indexed?.();
    function startManualNavigation() {
      profile?.interaction();
      focus.cancel();
    }
    const onMapKey = (event: KeyboardEvent) => {
      if (!tilesAttached || event.altKey || event.ctrlKey || event.metaKey) return;
      const camera = viewer.camera;
      const height = camera.positionCartographic.height;
      const amount = Math.max(25, height * .12);
      const angle = amount / viewer.scene.ellipsoid.maximumRadius;
      const zoomIn = Math.max(0, Math.min(amount, height - cameraController.minimumZoomDistance));
      const zoomOut = Math.max(0, Math.min(amount, cameraController.maximumZoomDistance - height));
      switch (event.key) {
        case 'ArrowLeft': startManualNavigation(); camera.rotateLeft(angle); break;
        case 'ArrowRight': startManualNavigation(); camera.rotateRight(angle); break;
        case 'ArrowUp': startManualNavigation(); camera.rotateUp(angle); break;
        case 'ArrowDown': startManualNavigation(); camera.rotateDown(angle); break;
        case '+':
        case '=': startManualNavigation(); camera.zoomIn(zoomIn); break;
        case '-': startManualNavigation(); camera.zoomOut(zoomOut); break;
        default: return;
      }
      event.preventDefault();
      viewer.scene.requestRender();
    };
    canvas.addEventListener('pointerdown', startManualNavigation, true);
    canvas.addEventListener('wheel', startManualNavigation, { capture: true, passive: true });
    canvas.addEventListener('keydown', onMapKey);
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', startManualNavigation, true);
      canvas.removeEventListener('wheel', startManualNavigation, true);
      canvas.removeEventListener('keydown', onMapKey);
    });
    handler.setInputAction((event: {position: Cartesian2}) => {
      const picked=profile?.span('selection.pick');
      let id:number|null;
      try {
        const ground=viewer.camera.pickEllipsoid(event.position,viewer.scene.ellipsoid);
        if(!ground)return;
        const point=viewer.scene.ellipsoid.cartesianToCartographic(ground);
        id=picker.pick(CesiumMath.toDegrees(point.longitude),CesiumMath.toDegrees(point.latitude))?.id??null;
      } finally { picked?.(); }
      choose(id);
    },ScreenSpaceEventType.LEFT_CLICK);
    cleanup.push(viewer.scene.renderError.addEventListener(reportPartial));
    cleanup.push(viewer.camera.moveStart.addEventListener(()=>{cameraMoving=true;waitForDetail();}));
    cleanup.push(viewer.camera.moveEnd.addEventListener(()=>{cameraMoving=false;viewer.scene.requestRender();}));
    constructed?.();
    function applyCutout(tiles: Cesium3DTileset) {
      if (cutout === 'none') return;
      const clipped = profile?.span('footprint.prepare');
      const supported = ClippingPolygonCollection.isSupported(viewer.scene);
      const replace = (polygons: LandPolygon[]) => {
        try {
          if (cutout === 'land') {
            const values = polygons.map(polygon => new ClippingPolygon({
              positions: Cartesian3.fromDegreesArray(polygon.ring.flatMap(([lon, lat]) => [lon, lat])),
              holes: polygon.holes?.map(ring => Cartesian3.fromDegreesArray(ring.flatMap(([lon, lat]) => [lon, lat]))),
            }));
            collection = new ClippingPolygonCollection({ polygons: values, inverse: true });
            tiles.clippingPolygons = collection;
          } else {
            if (!collection) {
              collection = new ClippingPolygonCollection({ inverse: true });
              tiles.clippingPolygons = collection;
            }
            collection.removeAll();
            for (const polygon of polygons) {
              const positions = Cartesian3.fromDegreesArray(polygon.ring.flatMap(([lon, lat]) => [lon, lat]));
              collection.add(new ClippingPolygon({ positions }));
            }
          }
        } catch {
          if (tiles.clippingPolygons) tiles.clippingPolygons.enabled = false;
          collection = undefined;
          throw new Error('City cutout unavailable');
        }
      };
      const disable = () => { if (collection) collection.enabled = false; };
      mask = cutout === 'land'
        ? landFootprintMask(geography, land, supported, replace, disable)
        : footprintMask(geography, supported, replace, disable);
      clipped?.();
    }
    return {
      async tiles() { const value=await Cesium3DTileset.fromIonAssetId(2275207,{showCreditsOnScreen:true,...tilePolicy(),cullRequestsWhileMoving:true,dynamicScreenSpaceError:true,enableCollision:true});if(!disposed)profile?.event('tiles.rootReady');return new Resource(value,()=>{if(!value.isDestroyed())value.destroy();}); },
      async zones() { const converted=profile?.span('zones.convert');try { const value=await GeoJsonDataSource.load(geography,{clampToGround:true,fill:boundary.withAlpha(.025),stroke:boundary});return new Resource(value,()=>value.entities.removeAll()); } finally { if(!disposed)converted?.(); } },
      attachTiles(resource) {
        tileset=(resource as Resource<Cesium3DTileset>).value;
        applyCutout(tileset);
        let firstFrame = true;
        imagery = imageryProgress(
          callback => tileset!.tileVisible.addEventListener(callback),
          callback => viewer.scene.postRender.addEventListener(callback),
          stage => {
            if (disposed) return;
            if (firstFrame) { firstFrame = false; profile?.event('tiles.firstFrame'); }
            onImagery?.(stage);
          },
        );
        cleanup.push(() => imagery?.dispose());
        cleanup.push(tileset.tileFailed.addEventListener(reportPartial));
        cleanup.push(tileset.allTilesLoaded.addEventListener(detail.check));
        viewer.scene.primitives.add(tileset);tilesAttached=true;profile?.event('tiles.attached');viewer.scene.requestRender();
      },
      attachZones(resource) {
        entities=(resource as Resource<GeoJsonDataSource>).value;
        const parts=entities.entities.values.filter(entity=>entity.polygon).map(value=>({locationId:value.properties?.location_id?.getValue(viewer.clock.currentTime) as number,value}));
        for(const{value}of parts){value.polygon!.material=normalFill;value.show=false;}
        highlight=zoneHighlight(parts,(entity,isSelected)=>{entity.polygon!.material=isSelected?selectedFill:normalFill;entity.show=isSelected;});
        void viewer.dataSources.add(entities);zonesAttached=true;colorSelection();viewer.scene.requestRender();
      },
      watchPartial(change){partial=change;return()=>{partial=undefined;};},
      focus(id,reducedMotion){if(!canInteract()||id!==selected)return Promise.resolve(false);if(id===1)mask?.newark();return focus.focus(id,reducedMotion);},
      cancelFocus(){focus.cancel();},
      overview(){if(!canInteract())return false;focus.cancel();mask?.city();waitForDetail();colorSelection();const target=overviewTarget();return target?navigation.overview(target):false;},
      footprint(){return mask?.state();},
      select(id){const next=resolveZone(geography,id)?.id??null;if(next!==selected){profile?.nextFrame(check=>viewer.scene.postRender.addEventListener(check));focus.cancel();}selected=next;colorSelection();updateSelectionAnchor();},
      destroy(){disposed=true;finishDetailWait=undefined;detail.dispose();for(const remove of cleanup)remove();anchor?.publish(null,null);handler.destroy();focus.dispose();selectedLines.dispose();highlight=undefined;if(!viewer.isDestroyed())viewer.destroy();Ion.defaultAccessToken='';entities=undefined;tileset=undefined;collection=undefined;},
    };
  });
}
