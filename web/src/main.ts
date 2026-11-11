import { SceneFailure, SessionController } from './session.ts';
import type { Failure, SceneAdapter, SessionState } from './session.ts';
import { areaTarget, filterZones, parseZones, resolveZone } from './zones.ts';
import type { ZoneCollection } from './zones.ts';
import { areaFocus } from './area-focus.ts';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const picker = element<HTMLSelectElement>('zone-picker'), search = element<HTMLInputElement>('area-search');
const load = element<HTMLButtonElement>('load'), stop = element<HTMLButtonElement>('stop'), focusButton = element<HTMLButtonElement>('focus-area');
const clearSearch = element<HTMLButtonElement>('clear-search'), clearSelection = element<HTMLButtonElement>('clear-selection');
const query = new URLSearchParams(location.search), mock = query.get('mode') === 'mock';
const configured = mock || Boolean(import.meta.env.VITE_CESIUM_ION_TOKEN);
let geographyReady = false, geographyFailed = false;
let zones: ZoneCollection = { type: 'FeatureCollection', features: [] }, selected: number | null = null;
const messages: Record<Failure, string> = {
  auth: 'Access denied. Check the token asset access and allowed localhost URL, then retry once.',
  rate: 'Request limit reached. Stop here and check your Cesium ion usage before another session.',
  timeout: '3D loading timed out. The scene was unloaded. Check your connection, then retry once.',
  webgl: 'This browser could not start WebGL 3D. The area list still works. Try a WebGL-capable browser.',
  network: '3D could not load. Check your connection and ion asset access, then retry once.',
};
function render(state: SessionState) {
  const active = ['loading', 'ready', 'partial'].includes(state.phase);
  const stateMessages = {
    setup: '3D needs a public Cesium ion token.',
    idle: mock ? 'Mock mode. No imagery or external requests.' : '3D is not loaded.',
    loading: mock ? 'Loading mock scene…' : 'Loading NYC 3D… You can stop at any time.',
    ready: mock ? 'Mock scene ready. No imagery loaded.' : '3D scene opened. Tiles may still stream.',
    partial: 'Some tiles failed to stream. Stop / unload to prevent further requests.',
    error: state.failure ? messages[state.failure] : messages.network,
    stopped: '3D unloaded. No city imagery is displayed.',
  };
  element('status').textContent = stateMessages[state.phase] + (state.draining && !active ? ' Waiting for previous requests to finish before retry.' : '');
  load.textContent = state.attempts > 0 && !active ? 'Retry once' : mock ? 'Load mock scene' : 'Load 3D';
  load.disabled = !geographyReady || !configured || state.draining || active || state.attempts >= 2 || state.failure === 'rate' || state.failure === 'webgl';
  load.setAttribute('aria-busy', String(state.phase === 'loading')); stop.disabled = !active;
  element('session-limit').hidden = state.attempts < 2 || active;
  const liveActive = active && !mock;
  element('cesium-view').hidden = !liveActive;
  element('viewport-state').hidden = liveActive && state.phase !== 'loading';
  element('credits-placeholder').hidden = liveActive;
  element('setup').hidden = configured || geographyFailed;
  element('map-mode').textContent = mock ? 'Mock mode, no imagery' : liveActive ? 'Photorealistic 3D via ion' : '3D not loaded';
  element('city-viewport').setAttribute('aria-busy', String(state.phase === 'loading'));
  element('viewport-title').textContent = geographyFailed ? 'TLC areas are unavailable' : state.phase === 'loading' ? 'Opening the city…' : state.phase === 'error' ? 'The city could not load' : mock ? 'Mock workspace' : 'Open the city in 3D';
  element('viewport-message').textContent = geographyFailed ? 'Restore the local TLC geography file, then reload this workspace.' : state.phase === 'error' ? stateMessages.error : mock ? 'Controls and focus are simulated locally. No city imagery is loaded.' : state.phase === 'loading' ? 'The first view is loading. Stop / unload is available above.' : 'Select Load 3D to inspect the realistic city. No imagery is displayed while 3D is off.';
  const known = resolveZone(zones, selected);
  focusButton.disabled = !known || !areaTarget(zones, selected) || state.phase !== 'ready' || state.draining || state.focusing;
  focusButton.setAttribute('aria-busy', String(state.focusing));
  clearSelection.disabled = !known;
  element('focus-status').textContent = state.focusing ? 'Focusing the selected area…' : !known ? 'Select an area, then use Focus area to move the camera.' : state.phase !== 'ready' ? 'Load 3D to enable Focus area. Selection alone never moves the camera.' : 'Focus area moves the camera and may request more tiles.';
}
function mockAdapter(): SceneAdapter {
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
  const movement = areaFocus(zones, {
    move(_target, options) { if (options.duration === 0) options.complete(); else timer = setTimeout(options.complete, options.duration * 1000); },
    cancel() { clearTimeout(timer); },
  });
  return {
    async load(change) {
      await new Promise(resolve => setTimeout(resolve, 150));
      if (disposed) return;
      const scenario = query.get('scenario');
      if (['auth', 'rate', 'webgl', 'network', 'timeout'].includes(scenario ?? '')) throw new SceneFailure(scenario as Failure);
      if (scenario === 'partial') change('partial');
    },
    select() {}, focus(id, reducedMotion) { return movement.focus(id, reducedMotion); }, cancelFocus() { movement.cancel(); },
    dispose() { disposed = true; movement.dispose(); }, whenSettled() { return Promise.resolve(); },
  };
}
function liveAdapter(): SceneAdapter {
  let disposed = false, delegate: SceneAdapter | undefined;
  return {
    async load(change) {
      const { createCesiumAdapter } = await import('./cesium-adapter.ts');
      if (disposed) return;
      delegate = createCesiumAdapter(element('cesium-view'), element('credits'), import.meta.env.VITE_CESIUM_ION_TOKEN, zones, selectZone);
      await delegate.load(change);
    },
    select(id) { delegate?.select(id); },
    focus(id, reducedMotion) { return delegate?.focus(id, reducedMotion) ?? Promise.resolve(false); },
    cancelFocus() { delegate?.cancelFocus(); },
    dispose() { disposed = true; delegate?.dispose(); }, whenSettled() { return delegate?.whenSettled() ?? Promise.resolve(); },
  };
}
const controller = new SessionController(configured, mock ? mockAdapter : liveAdapter, render, 30_000, id => Boolean(resolveZone(zones, id)));
render(controller.state);
if (mock) element('cost-note').textContent = 'Mock mode runs locally. Loading or focusing the mock scene never requests imagery or uses ion quota.';
function renderResults() {
  if (!geographyReady) return;
  const results = filterZones(zones, search.value), current = resolveZone(zones, selected);
  picker.replaceChildren(new Option('Choose a TLC area', ''));
  if (current && !results.some(zone => zone.id === current.id)) {
    const group = document.createElement('optgroup'); group.label = 'Selected area (outside search results)';
    group.append(new Option(`${current.properties.zone} (${current.id})`, String(current.id))); picker.append(group);
  }
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const zone of results) {
    let group = groups.get(zone.properties.borough);
    if (!group) { group = document.createElement('optgroup'); group.label = zone.properties.borough; groups.set(group.label, group); picker.append(group); }
    group.append(new Option(`${zone.properties.zone} (${zone.id})`, String(zone.id)));
  }
  picker.value = current ? String(current.id) : ''; picker.disabled = results.length === 0 && !current;
  element('search-count').textContent = results.length === 0 ? 'No matching TLC areas. Clear search to show all areas.' : new Intl.PluralRules('en').select(results.length) === 'one' ? '1 matching TLC area.' : `${new Intl.NumberFormat('en').format(results.length)} matching TLC areas.`;
  clearSearch.disabled = search.value.length === 0;
}
function selectZone(id: number | null) {
  const zone = resolveZone(zones, id); selected = zone?.id ?? null;
  element('selection-title').textContent = zone?.properties.zone ?? 'Inspect a TLC area';
  element('selection-hint').hidden = Boolean(zone); element('zone-details').hidden = !zone;
  element('zone-id').textContent = zone ? String(zone.properties.location_id) : '';
  element('zone-borough').textContent = zone?.properties.borough ?? '';
  controller.select(selected); renderResults(); render(controller.state);
  const url = new URL(location.href);
  selected === null ? url.searchParams.delete('zone') : url.searchParams.set('zone', String(selected)); history.replaceState(null, '', url);
}
search.addEventListener('input', renderResults);
clearSearch.addEventListener('click', () => { search.value = ''; renderResults(); search.focus(); });
picker.addEventListener('change', () => selectZone(resolveZone(zones, picker.value)?.id ?? null));
clearSelection.addEventListener('click', () => selectZone(null));
load.addEventListener('click', () => { if (geographyReady) void controller.load(); });
stop.addEventListener('click', () => controller.stop());
focusButton.addEventListener('click', () => { void controller.focus(window.matchMedia('(prefers-reduced-motion: reduce)').matches); });
window.addEventListener('pagehide', () => controller.stop(), { once: true });
window.addEventListener('popstate', () => { if (geographyReady) selectZone(resolveZone(zones, new URLSearchParams(location.search).get('zone'))?.id ?? null); });
async function loadZones() {
  try {
    const response = await fetch('/data/taxi-zones.geojson'); if (!response.ok) throw new Error('Local geography unavailable');
    zones = parseZones(await response.json()); if (!zones.features.length) throw new Error('No local zones');
    geographyReady = true; search.disabled = false;
    selectZone(resolveZone(zones, query.get('zone'))?.id ?? null);
  } catch {
    geographyFailed = true;
    picker.replaceChildren(new Option('Local TLC areas unavailable', '')); picker.disabled = true; search.disabled = true;
    element('search-count').textContent = 'The local area list could not load. Restore the TLC geography file and reload.';
    render(controller.state);
  }
}
void loadZones();
