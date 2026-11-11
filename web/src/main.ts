import { SceneFailure, SessionController } from './session.ts';
import type { Failure, SceneAdapter, SessionState } from './session.ts';
import { areaTarget, filterZones, parseZones, resolveZone } from './zones.ts';
import type { ZoneCollection } from './zones.ts';
import { areaFocus } from './area-focus.ts';
import { startupGate } from './startup-gate.ts';
import { engineLoader } from './engine-loader.ts';
import { startupPresentation } from './imagery-progress.ts';
import type { ImageryStage } from './imagery-progress.ts';
import { createDiagnostics } from './diagnostics.ts';
import { parseLandFootprint } from './land-footprint.ts';
import type { LandFootprint } from './land-footprint.ts';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const picker = element<HTMLSelectElement>('zone-picker'), search = element<HTMLInputElement>('area-search');
const load = element<HTMLButtonElement>('load'), stop = element<HTMLButtonElement>('stop'), focusButton = element<HTMLButtonElement>('focus-area');
const clearSearch = element<HTMLButtonElement>('clear-search'), clearSelection = element<HTMLButtonElement>('clear-selection');
const query = new URLSearchParams(location.search), mock = query.get('mode') === 'mock';
const diagnostics = createDiagnostics(query.get('diagnostics') === '1');
const landCandidate = query.get('cutout') === 'land';
let land: LandFootprint | undefined;
element('hull-source').hidden = landCandidate;
element('land-source').hidden = !landCandidate;
element('land-provenance').hidden = !landCandidate;
const verification = import.meta.env.MODE === 'verify';
const configured = mock || (!verification && Boolean(import.meta.env.VITE_CESIUM_ION_TOKEN));
const engine = engineLoader(async () => {
  const imported = diagnostics.span('cesium.import');
  try { return await import('./cesium-adapter.ts'); } finally { imported(); }
});
let imageryStage: ImageryStage = 'waiting-first-frame', imageryAttempt = 0;
let startup: ReturnType<typeof startupGate> | undefined;
function warmEngine() {
  engine.warm({configured, visible: document.visibilityState === 'visible', live: !mock && !verification, pending: startup?.pending ?? false});
}
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
  if (!mock && imageryAttempt !== state.attempts) { imageryAttempt = state.attempts; imageryStage = 'waiting-first-frame'; }
  const presentation = startupPresentation(state.phase, imageryStage, mock, startup?.pending ?? false);
  const active = ['loading', 'ready', 'partial'].includes(state.phase);
  const stateMessages = {
    setup: '3D needs a public Cesium ion token.',
    idle: mock ? 'Preparing the mock stage…' : startup?.pending ? (document.visibilityState === 'visible' ? 'Opening NYC when the local footprint is ready…' : 'NYC will open when this page becomes visible.') : 'The city is stopped.',
    loading: mock ? 'Loading mock scene…' : 'Loading NYC 3D… You can stop at any time.',
    ready: mock ? 'Mock stage ready. No imagery loaded.' : 'Drag to orbit · Scroll to zoom',
    partial: 'Some tiles failed to stream. Stop / unload to prevent further requests.',
    error: state.failure ? messages[state.failure] : messages.network,
    stopped: '3D unloaded. No city imagery is displayed.',
  };
  element('opening-cue').hidden = !presentation.cue;
  element('status').textContent = (presentation.status ?? stateMessages[state.phase]) + (state.draining && !active ? ' Waiting for previous requests to finish before retry.' : '');
  load.textContent = state.phase === 'error' ? 'Retry once' : 'Resume 3D';
  load.hidden = active || Boolean(startup?.pending);
  load.disabled = !geographyReady || !configured || state.draining || active || state.attempts >= 2 || state.failure === 'rate' || state.failure === 'webgl';
  load.setAttribute('aria-busy', String(state.phase === 'loading')); stop.disabled = !active && !startup?.pending;
  element('session-limit').hidden = state.attempts < 2 || active;
  const liveActive = active && !mock;
  element('cesium-view').hidden = !liveActive;
  element('viewport-state').hidden = !mock && configured && !geographyFailed && state.phase !== 'error';
  element('credits-placeholder').hidden = liveActive;
  element('setup').hidden = configured || geographyFailed;
  element('map-mode').textContent = mock ? 'Mock stage, no imagery' : liveActive ? 'Explore New York in 3D' : 'City stage';
  element('city-viewport').setAttribute('aria-busy', String(state.phase === 'loading'));
  element('viewport-title').textContent = geographyFailed ? 'Local footprint unavailable' : state.phase === 'error' ? 'The city could not open' : mock ? 'Mock city stage' : 'City configuration needed';
  element('viewport-message').textContent = geographyFailed ? 'Restore the local TLC geography file and reload.' : state.phase === 'error' ? stateMessages.error : mock ? 'Controls run locally. No city imagery is requested.' : 'Add the public read-only token to open this city stage.';
  const footprint = controller.footprint();
  element('footprint-notice').textContent = landCandidate
    ? footprint?.kind === 'unavailable' ? 'DCP land cutout unavailable. Showing unclipped realistic 3D.' : footprint?.kind === 'newark' ? 'DCP generalized NYC land + Newark airport study area' : 'DCP generalized NYC land'
    : footprint?.kind === 'unavailable' ? 'City cutout unavailable. Showing unclipped realistic 3D.' : footprint?.kind === 'newark' ? 'NYC + Newark airport study area' : 'TLC-derived study footprint';
  element('outside-city').hidden = selected !== 1;
  element('outside-city').textContent = footprint?.includesNewark ? 'Newark airport is outside NYC. The study area now includes it.' : 'Newark airport is outside NYC. Focus area adds its study footprint.';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view], #city-overview')) button.disabled = state.phase !== 'ready' || state.draining;
  const known = resolveZone(zones, selected);
  focusButton.disabled = !known || !areaTarget(zones, selected) || state.phase !== 'ready' || state.draining || state.focusing;
  focusButton.setAttribute('aria-busy', String(state.focusing));
  clearSelection.disabled = !known;
  element('focus-status').textContent = state.focusing ? 'Focusing the selected area…' : !known ? 'Select an area, then use Focus area to move the camera.' : state.phase !== 'ready' ? 'Focus area is available when the city scene is ready.' : 'Focus area moves the camera and may request more tiles.';
}
function mockAdapter(): SceneAdapter {
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
  let expanded = false;
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
    select() {}, focus(id, reducedMotion) { if(id === 1) expanded=true; return movement.focus(id, reducedMotion); }, cancelFocus() { movement.cancel(); },
    overview() { movement.cancel(); expanded=false; return true; }, orbit() { movement.cancel(); return true; }, zoom() { movement.cancel(); return true; }, footprint() { return {kind: expanded ? 'newark' : 'city', includesNewark: expanded}; },
    dispose() { disposed = true; movement.dispose(); }, whenSettled() { return Promise.resolve(); },
  };
}
function liveAdapter(): SceneAdapter {
  let disposed = false, delegate: SceneAdapter | undefined;
  return {
    async load(change) {
      const { createCesiumAdapter } = await engine.load();
      if (disposed) return;
      delegate = createCesiumAdapter(element('cesium-view'), element('credits'), import.meta.env.VITE_CESIUM_ION_TOKEN, zones, selectZone, diagnostics, land, landCandidate, stage => {
        if (disposed) return;
        imageryStage = stage; render(controller.state);
      });
      await delegate.load(change);
      if (!disposed) diagnostics.event('scene.resourcesAttached');
    },
    select(id) { delegate?.select(id); },
    overview() { return delegate?.overview?.() ?? false; }, orbit(horizontal, vertical) { return delegate?.orbit?.(horizontal, vertical) ?? false; }, zoom(factor) { return delegate?.zoom?.(factor) ?? false; }, footprint() { return delegate?.footprint?.(); },
    focus(id, reducedMotion) { return delegate?.focus(id, reducedMotion) ?? Promise.resolve(false); },
    cancelFocus() { delegate?.cancelFocus(); },
    dispose() { disposed = true; delegate?.dispose(); }, whenSettled() { return delegate?.whenSettled() ?? Promise.resolve(); },
  };
}
const controller = new SessionController(configured, mock ? mockAdapter : liveAdapter, render, 30_000, id => Boolean(resolveZone(zones, id)));
startup = startupGate({configured, visible: document.visibilityState === 'visible', enabled: mock || !verification, start() { void controller.load(); }});
warmEngine();
render(controller.state);
if (mock) element('cost-note').textContent = 'Mock mode runs locally. No imagery requests or ion quota use.';
let resultQuery: string | undefined, pinnedResultId: number | null = null;
let matchedResultIds = new Set<number>();
function renderResults() {
  if (!geographyReady) return;
  const measured = diagnostics.span('selection.options');
  const current = resolveZone(zones, selected);
  if (resultQuery === search.value && pinnedResultId === null && (!current || matchedResultIds.has(current.id))) {
    picker.value = current ? String(current.id) : '';
    clearSearch.disabled = search.value.length === 0;
    measured(); return;
  }
  const results = filterZones(zones, search.value);
  resultQuery = search.value; matchedResultIds = new Set(results.map(zone => zone.id));
  pinnedResultId = current && !matchedResultIds.has(current.id) ? current.id : null;
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
  measured();
}
function selectZone(id: number | null, interaction = true) {
  if (interaction) diagnostics.interaction();
  const measured = diagnostics.span('selection.handler');
  const zone = resolveZone(zones, id); selected = zone?.id ?? null;
  element('inspector').hidden = !zone;
  element('selection-title').textContent = zone?.properties.zone ?? 'Inspect a TLC area';
  element('selection-hint').hidden = Boolean(zone); element('zone-details').hidden = !zone;
  element('zone-id').textContent = zone ? String(zone.properties.location_id) : '';
  element('zone-borough').textContent = zone?.properties.borough ?? '';
  controller.select(selected); renderResults(); render(controller.state);
  const url = new URL(location.href);
  selected === null ? url.searchParams.delete('zone') : url.searchParams.set('zone', String(selected)); history.replaceState(null, '', url);
  measured();
}
search.addEventListener('input', () => { diagnostics.interaction(); renderResults(); });
for (const menu of document.querySelectorAll<HTMLDetailsElement>('.stage-tools details, #sources')) {
  menu.addEventListener('focusout', event => {
    if (!menu.contains(event.relatedTarget as Node | null)) menu.open = false;
  });
  menu.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !menu.open) return;
    event.preventDefault();
    menu.open = false;
    menu.querySelector<HTMLElement>('summary')?.focus();
  });
}
clearSearch.addEventListener('click', () => { search.value = ''; renderResults(); search.focus(); });
picker.addEventListener('change', () => selectZone(resolveZone(zones, picker.value)?.id ?? null));
clearSelection.addEventListener('click', () => selectZone(null));
load.addEventListener('click', () => { startup?.stop(); if (geographyReady) { engine.retry(); void controller.load(); } });
stop.addEventListener('click', () => { startup?.stop(); controller.stop(); });
focusButton.addEventListener('click', async () => {
  diagnostics.interaction();
  const focused = diagnostics.span('focus.duration');
  const moved = await controller.focus(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (moved) focused();
});
element('city-overview').addEventListener('click', () => { diagnostics.interaction(); controller.overview(); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.addEventListener('click', () => { diagnostics.interaction(); controller.view(button.dataset.view as 'left'|'right'|'up'|'down'|'in'|'out'); });
document.addEventListener('visibilitychange', () => { warmEngine(); startup?.visibility(document.visibilityState === 'visible'); render(controller.state); });
window.addEventListener('pagehide', () => { startup?.stop(); controller.stop(); diagnostics.dispose(); }, { once: true });
window.addEventListener('popstate', () => { if (geographyReady) selectZone(resolveZone(zones, new URLSearchParams(location.search).get('zone'))?.id ?? null); });
async function loadZones() {
  try {
    const landAsset = landCandidate ? (async () => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 3000);
      try {
        const fetched = diagnostics.span('land.fetch');
        const response = await fetch('/data/city-land.json', {signal: abort.signal}).finally(fetched);
        if (!response.ok) return undefined;
        const decoded = diagnostics.span('land.json');
        const input = await response.json().finally(decoded);
        const validated = diagnostics.span('land.validate');
        try { return parseLandFootprint(input); } finally { validated(); }
      } catch { return undefined; } finally { clearTimeout(timeout); }
    })() : undefined;
    const fetched = diagnostics.span('geography.fetch');
    const response = await fetch('/data/taxi-zones.geojson').finally(fetched); if (!response.ok) throw new Error('Local geography unavailable');
    const decoded = diagnostics.span('geography.json');
    const input = await response.json().finally(decoded);
    const validated = diagnostics.span('geography.validate');
    try { zones = parseZones(input); } finally { validated(); }
    if (!zones.features.length) throw new Error('No local zones');
    geographyReady = true; search.disabled = false;
    selectZone(resolveZone(zones, query.get('zone'))?.id ?? null, false);
    if (landAsset) land = await landAsset;
    startup?.ready();
  } catch {
    geographyFailed = true; startup?.stop();
    picker.replaceChildren(new Option('Local TLC areas unavailable', '')); picker.disabled = true; search.disabled = true;
    element('search-count').textContent = 'The local area list could not load. Restore the TLC geography file and reload.';
    render(controller.state);
  }
}
void loadZones();
