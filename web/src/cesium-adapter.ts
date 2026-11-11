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
import { displayPolicy, tilePolicy } from './rendering-policy.ts';
import { zoneHighlight } from './zone-highlight.ts';
import { selectedBoundary } from './selected-boundary.ts';
import { cityOverview, skylineOpening, footprintMask, visibleStudySelection } from './study-footprint.ts';
import { stageNavigation } from './stage-navigation.ts';
import { zonePicker } from './zone-picker.ts';
import { detailReadiness } from './detail-readiness.ts';
import { dragOrbit } from './drag-orbit.ts';
class Resource<T> implements OwnedResource {
  constructor(public value: T, private release: () => void) {}
  destroy() { this.release(); }
}
export function createCesiumAdapter(container: HTMLElement, credits: HTMLElement, token: string, geography: ZoneCollection, choose: (id: number | null) => void) {
  return managedAdapter((): SceneRuntime => {
    Ion.defaultAccessToken = token;
    let viewer: Viewer;
    const display = displayPolicy(window.devicePixelRatio || 1);
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
    viewer.resolutionScale = display.resolutionScale;
    const style = getComputedStyle(document.documentElement);
    viewer.scene.backgroundColor = Color.fromCssColorString(style.getPropertyValue('--color-scene-background').trim()) ?? new Color(.07,.09,.12,1);
    const cameraController = viewer.scene.screenSpaceCameraController;
    cameraController.minimumZoomDistance = 200; cameraController.maximumZoomDistance = 180_000;
    cameraController.enableRotate = false; cameraController.enableTranslate = false;
    cameraController.enableTilt = false; cameraController.enableLook = false; cameraController.enableZoom = true;
    const overviewTarget = () => cityOverview(geography, container.clientWidth / Math.max(1, container.clientHeight), 'fovy' in viewer.camera.frustum ? viewer.camera.frustum.fovy ?? Math.PI/3 : Math.PI/3);
    const initial = overviewTarget();
    if (!initial) { viewer.destroy(); Ion.defaultAccessToken = ''; throw new SceneFailure('network'); }
    const navigation = stageNavigation(initial, {
      lookAt(pose) { viewer.camera.lookAt(Cartesian3.fromDegrees(pose.pivot.longitude, pose.pivot.latitude), new HeadingPitchRange(pose.heading, pose.pitch, pose.range)); },
      reset() { if (!viewer.isDestroyed()) viewer.camera.lookAtTransform(Matrix4.IDENTITY); },
      range(pivot) { return Cartesian3.distance(viewer.camera.positionWC, Cartesian3.fromDegrees(pivot.longitude, pivot.latitude)); },
    });
    const opening = skylineOpening(geography, container.clientWidth / Math.max(1, container.clientHeight), 'fovy' in viewer.camera.frustum ? viewer.camera.frustum.fovy ?? Math.PI/3 : Math.PI/3);
    if (opening) navigation.opening(opening); else navigation.overview(); // One immediate fit; overview remains a deliberate action.
    let disposed = false, selected: number | null = null, imageryReady = false, cameraMoving = false, focusMoving = false;
    let tilesAttached = false, zonesAttached = false, partialSeen = false;
    let entities: GeoJsonDataSource | undefined, tileset: Cesium3DTileset | undefined;
    let mask: ReturnType<typeof footprintMask> | undefined, collection: ClippingPolygonCollection | undefined;
    let highlight: ReturnType<typeof zoneHighlight<Entity>> | undefined;
    let partial: (() => void) | undefined;
    const cleanup: (() => void)[] = [];
    const boundary = Color.fromCssColorString(style.getPropertyValue('--color-map-line').trim());
    const selection = Color.fromCssColorString(style.getPropertyValue('--color-map-selected').trim());
    const normalFill = new ColorMaterialProperty(boundary.withAlpha(.025)), selectedFill = new ColorMaterialProperty(selection.withAlpha(.14));
    let boundaryId = 0;
    const selectedLines = selectedBoundary(geography, (ring, locationId) => viewer.entities.add({
      id: `tlc-selected-boundary-${++boundaryId}`, properties: { location_id: locationId },
      polyline: { positions: Cartesian3.fromDegreesArray(ring.flatMap(([lon,lat]) => [lon,lat])), clampToGround: true, width: 2, material: selection },
    }), entity => { viewer.entities.remove(entity); });
    function colorSelection() {
      if (!entities || disposed) return;
      const includesNewark = mask?.state().includesNewark ?? false;
      const visibleId = selected === 1 && !includesNewark ? null : selected;
      const changed = highlight?.select(visibleId);
      entities.show = imageryReady;
      selectedLines.select(visibleStudySelection(visibleId, includesNewark, imageryReady) ? visibleId : null);
      if (changed) viewer.scene.requestRender();
    }
    const detail = detailReadiness(
      check => viewer.scene.postRender.addEventListener(check),
      () => ({tilesLoaded: !disposed && Boolean(tileset?.tilesLoaded), cameraMoving, focusMoving}),
      () => { imageryReady=true; colorSelection(); viewer.scene.requestRender(); },
    );
    function waitForDetail() { detail.wait(); imageryReady = false; if (entities) entities.show = false; selectedLines.select(null); }
    const focus = areaFocus(geography, {
      move(target, options) {
        focusMoving = true; waitForDetail();
        viewer.camera.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(target.longitude, target.latitude), target.radius), {
          duration: options.duration, maximumHeight: 20_000,
          offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), target.range),
          complete() { focusMoving = false; navigation.area(target); viewer.scene.requestRender(); options.complete(); },
          cancel() { focusMoving = false; options.cancel(); },
        });
        viewer.scene.requestRender();
      },
      cancel() { focusMoving = false; if (!viewer.isDestroyed()) viewer.camera.cancelFlight(); },
    });
    function reportPartial() { partialSeen = true; focus.cancel(); partial?.(); }
    function canInteract() { return !disposed && tilesAttached && zonesAttached && !partialSeen; }
    function moveView(horizontal: number, vertical = 0) { if (!canInteract()) return false; focus.cancel(); waitForDetail(); return navigation.orbit(horizontal, vertical); }
    const canvas = viewer.scene.canvas;
    canvas.setAttribute('aria-label', 'Interactive NYC city stage. Use View controls for keyboard orbit, tilt and zoom.'); canvas.setAttribute('tabindex', '-1');
    const handler = new ScreenSpaceEventHandler(canvas);
    const picker = zonePicker(geography);
    let activePointer: number | undefined;
    const pointers = new Set<number>();
    const dragTracker = dragOrbit((horizontal,vertical) => { moveView(horizontal,vertical); });
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointers.add(event.pointerId);
      if (pointers.size !== 1) { activePointer=undefined; dragTracker.cancel(); return; }
      activePointer=event.pointerId; dragTracker.start(event.clientX,event.clientY);
      try { canvas.setPointerCapture(event.pointerId); } catch { activePointer=undefined; dragTracker.end(); }
    };
    const drag = (event: PointerEvent) => {
      if(activePointer!==event.pointerId||pointers.size!==1||!canInteract())return;
      dragTracker.move(event.clientX,event.clientY);
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if(activePointer===event.pointerId){activePointer=undefined;dragTracker.end();}
      try{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}catch{/* Pointer may already be released. */}
    };
    for(const [name,listener] of [['pointerdown',down],['pointermove',drag],['pointerup',up],['pointercancel',up],['lostpointercapture',up]] as const){canvas.addEventListener(name,listener);cleanup.push(()=>canvas.removeEventListener(name,listener));}
    handler.setInputAction((event: {position: Cartesian2}) => {
      if(dragTracker.consumeClick())return;
      const ground=viewer.camera.pickEllipsoid(event.position,viewer.scene.ellipsoid);
      if(!ground)return;
      const point=viewer.scene.ellipsoid.cartesianToCartographic(ground);
      choose(picker.pick(CesiumMath.toDegrees(point.longitude),CesiumMath.toDegrees(point.latitude))?.id??null);
    },ScreenSpaceEventType.LEFT_CLICK);
    cleanup.push(viewer.scene.renderError.addEventListener(reportPartial));
    cleanup.push(viewer.camera.moveStart.addEventListener(()=>{cameraMoving=true;waitForDetail();}));
    cleanup.push(viewer.camera.moveEnd.addEventListener(()=>{cameraMoving=false;viewer.scene.requestRender();}));
    return {
      async tiles() { const value=await Cesium3DTileset.fromIonAssetId(2275207,{showCreditsOnScreen:true,...tilePolicy(),cullRequestsWhileMoving:true,dynamicScreenSpaceError:true,enableCollision:true});return new Resource(value,()=>{if(!value.isDestroyed())value.destroy();}); },
      async zones() { const value=await GeoJsonDataSource.load(geography,{clampToGround:true,fill:boundary.withAlpha(.025),stroke:boundary});return new Resource(value,()=>value.entities.removeAll()); },
      attachTiles(resource) {
        tileset=(resource as Resource<Cesium3DTileset>).value;
        mask=footprintMask(geography,ClippingPolygonCollection.isSupported(viewer.scene),polygons=>{
          try{
            if(!collection){collection=new ClippingPolygonCollection({inverse:true});tileset!.clippingPolygons=collection;}
            collection.removeAll();for(const polygon of polygons)collection.add(new ClippingPolygon({positions:Cartesian3.fromDegreesArray(polygon.ring.flatMap(([lon,lat])=>[lon,lat]))}));
          }catch{if(tileset!.clippingPolygons)tileset!.clippingPolygons.enabled=false;collection=undefined;throw new Error('City cutout unavailable');}
        },()=>{if(collection)collection.enabled=false;});
        cleanup.push(tileset.tileFailed.addEventListener(reportPartial));
        cleanup.push(tileset.allTilesLoaded.addEventListener(detail.check));
        viewer.scene.primitives.add(tileset);tilesAttached=true;viewer.scene.requestRender();
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
      orbit:moveView,
      zoom(factor){if(!canInteract())return false;focus.cancel();waitForDetail();return navigation.zoom(factor);},
      footprint(){return mask?.state();},
      select(id){const next=resolveZone(geography,id)?.id??null;if(next!==selected)focus.cancel();selected=next;colorSelection();},
      destroy(){disposed=true;detail.dispose();for(const remove of cleanup)remove();handler.destroy();focus.dispose();navigation.dispose();selectedLines.dispose();highlight=undefined;pointers.clear();activePointer=undefined;dragTracker.end();if(!viewer.isDestroyed())viewer.destroy();Ion.defaultAccessToken='';entities=undefined;tileset=undefined;collection=undefined;},
    };
  });
}
