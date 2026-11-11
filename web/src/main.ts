import { SceneFailure, SessionController } from './session.ts';
import type { Failure, SceneAdapter, SessionState } from './session.ts';
import { parseZones, zonePath } from './zones.ts';
import type { ZoneCollection } from './zones.ts';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const picker = element<HTMLSelectElement>('zone-picker'), load = element<HTMLButtonElement>('load'), stop = element<HTMLButtonElement>('stop');
const svg = document.getElementById('zone-map') as unknown as SVGSVGElement;
const query = new URLSearchParams(location.search), mock = query.get('mode') === 'mock';
const configured = mock || Boolean(import.meta.env.VITE_CESIUM_ION_TOKEN);
let geographyReady = false;
let zones: ZoneCollection = {type:'FeatureCollection',features:[]}, selected: number | null = null;
const messages: Record<Failure, string> = {
 auth: 'Access denied. Check the token asset access and allowed localhost URL, then retry once.',
 rate: 'Request limit reached. Stop here and check your Cesium ion usage before another session.',
 timeout: '3D loading timed out. The scene was unloaded. Check your connection, then retry once.',
 webgl: 'This browser could not start WebGL 3D. Use the local map and zone list, or try a WebGL-capable browser.',
 network: '3D could not load. Check your connection and ion asset access, then retry once.',
};
function render(state: SessionState) {
 const active = ['loading','ready','partial'].includes(state.phase);
 const stateMessages = {
  setup: 'Local map ready. 3D needs a public Cesium ion token.', idle: mock ? 'Mock mode. No imagery or external requests.' : '3D is off. Local zone boundaries only.',
  loading: mock ? 'Loading mock scene…' : 'Loading NYC 3D… You can stop at any time.',
  ready: mock ? 'Mock scene ready. No imagery loaded.' : '3D scene opened. Tiles may still stream as you move.',
  partial: 'Some 3D tiles failed to stream. Stop / unload to prevent further requests.',
  error: state.failure ? messages[state.failure] : messages.network, stopped: '3D unloaded. Local zone boundaries only.',
 };
 element('status').textContent = stateMessages[state.phase] + (state.draining && !active ? ' Waiting for previous requests to finish before retry.' : '');
 load.textContent = state.attempts > 0 && !active ? 'Retry once' : mock ? 'Load mock scene' : 'Load 3D';
 load.disabled = !geographyReady || !configured || state.draining || active || state.attempts >= 2 || state.failure === 'rate' || state.failure === 'webgl';
 load.setAttribute('aria-busy', String(state.phase === 'loading')); stop.disabled = !active;
 element('setup').hidden = configured; element('session-limit').hidden = state.attempts < 2 || active;
 const liveActive = active && !mock;
 element('cesium-view').hidden = !liveActive; svg.toggleAttribute('hidden', liveActive);
 element('credits-placeholder').hidden = liveActive;
 element('map-mode').textContent = mock ? 'Mock mode, local geography' : liveActive ? 'Photorealistic 3D via ion' : 'Local zone boundaries';
}
function mockAdapter(): SceneAdapter {
 let disposed = false;
 return { async load(change) {
  await new Promise(resolve => setTimeout(resolve, 150));
  if (disposed) return;
  const scenario = query.get('scenario');
  if (['auth','rate','webgl','network','timeout'].includes(scenario ?? '')) throw new SceneFailure(scenario as Failure);
  if (scenario === 'partial') change('partial');
 }, select() {}, dispose() { disposed = true; }, whenSettled() { return Promise.resolve(); } };
}
function liveAdapter(): SceneAdapter {
 let disposed = false, delegate: SceneAdapter | undefined;
 return { async load(change) {
   const { createCesiumAdapter } = await import('./cesium-adapter.ts');
   if (disposed) return;
   delegate = createCesiumAdapter(element('cesium-view'), element('credits'), import.meta.env.VITE_CESIUM_ION_TOKEN, zones, selectZone);
   await delegate.load(change);
   if (!disposed) delegate.select(selected);
 }, select(id) { delegate?.select(id); }, dispose() { disposed = true; delegate?.dispose(); }, whenSettled() { return delegate?.whenSettled() ?? Promise.resolve(); } };
}
const controller = new SessionController(configured, mock ? mockAdapter : liveAdapter, render);
render(controller.state);
if (mock) element('cost-note').textContent = 'Mock mode uses local geography only. Loading the mock scene never requests imagery or uses ion quota.';
function selectZone(id: number | null) {
 const feature = zones.features.find(zone => zone.id === id); selected = feature?.id ?? null;
 picker.value = selected === null ? '' : String(selected);
 element('selection-title').textContent = feature?.properties.zone ?? 'Select a zone';
 element('selection-hint').hidden = Boolean(feature); element('zone-details').hidden = !feature;
 element('zone-id').textContent = feature ? String(feature.properties.location_id) : '';
 element('zone-borough').textContent = feature?.properties.borough ?? '';
 for (const path of svg.querySelectorAll('path')) path.classList.toggle('selected', Number(path.dataset.id) === selected);
 controller.select(selected);
 const url = new URL(location.href); selected ? url.searchParams.set('zone', String(selected)) : url.searchParams.delete('zone'); history.replaceState(null, '', url);
}
picker.addEventListener('change', () => selectZone(picker.value ? Number(picker.value) : null));
load.addEventListener('click', () => { if (geographyReady) void controller.load(); }); stop.addEventListener('click', () => controller.stop());
window.addEventListener('pagehide', () => controller.stop(), {once:true});
async function loadZones() {
 try {
  const response = await fetch('/data/taxi-zones.geojson'); if (!response.ok) throw new Error('Local geography unavailable');
  zones = parseZones(await response.json()); if (!zones.features.length) throw new Error('No local zones');
  const empty = new Option('Choose a TLC zone', ''); picker.replaceChildren(empty);
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const zone of [...zones.features].sort((a,b) => a.properties.borough.localeCompare(b.properties.borough) || a.properties.zone.localeCompare(b.properties.zone) || a.id-b.id)) {
   let group = groups.get(zone.properties.borough);
   if (!group) { group=document.createElement('optgroup');group.label=zone.properties.borough;groups.set(group.label,group);picker.append(group); }
   group.append(new Option(`${zone.properties.zone} (${zone.id})`, String(zone.id)));
   const path = document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d',zonePath(zone));path.dataset.id=String(zone.id);
   const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=`${zone.properties.zone}, ${zone.properties.borough}, TLC ${zone.id}`;path.append(title);
   path.addEventListener('click',()=>selectZone(zone.id));svg.append(path);
  }
  geographyReady=true;picker.disabled=false;element('map-empty').hidden=true;render(controller.state);
  const requested=Number(query.get('zone'));if(requested) selectZone(requested);
 } catch {
  picker.replaceChildren(new Option('Local zone file unavailable',''));picker.disabled=true;
  element('map-empty').textContent='Local boundaries could not load. Restore the generated TLC geography file and reload.';
  load.disabled=true;
 }
}
void loadZones();
