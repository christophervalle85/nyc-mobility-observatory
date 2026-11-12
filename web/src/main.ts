import { SceneFailure, SessionController } from './session.ts';
import type { Failure, SceneAdapter, SessionState } from './session.ts';
import { areaTarget, filterZones, parseZones, resolveZone } from './zones.ts';
import type { ZoneCollection } from './zones.ts';
import { areaFocus } from './area-focus.ts';
import { startupGate } from './startup-gate.ts';
import { engineLoader } from './engine-loader.ts';
import { startupStatus } from './imagery-progress.ts';
import type { ImageryStage } from './imagery-progress.ts';
import { createDiagnostics } from './diagnostics.ts';
import { parseLandFootprint } from './land-footprint.ts';
import type { LandFootprint } from './land-footprint.ts';
import { cutoutMode } from './cutout-mode.ts';
import { areaCardPosition } from './area-card-position.ts';
import type { SelectionAnchor } from './selection-anchor.ts';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const picker = element<HTMLSelectElement>('zone-picker'), search = element<HTMLInputElement>('area-search');
const areaControls = element('area-controls'), searchCount = element('search-count');
const load = element<HTMLButtonElement>('load'), stop = element<HTMLButtonElement>('stop'), focusButton = element<HTMLButtonElement>('focus-area');
const clearSearch = element<HTMLButtonElement>('clear-search'), clearSelection = element<HTMLButtonElement>('clear-selection');
const query = new URLSearchParams(location.search), mock = query.get('mode') === 'mock';
const diagnostics = createDiagnostics(query.get('diagnostics') === '1');
const inspector = element('inspector');
const cityViewport = element('city-viewport');
const cardObstacles = [areaControls, document.querySelector<HTMLElement>('.session-info')!, document.querySelector<HTMLElement>('.stage-tools')!];
const attribution = document.querySelector<HTMLElement>('.attribution-strip')!;
const cardDisclosures = [element<HTMLDetailsElement>('view-controls'), element<HTMLDetailsElement>('sources')];
let selectionAnchor: SelectionAnchor | null = null;

function positionAreaCard() {
  if (!selectionAnchor || inspector.hidden) {
    inspector.removeAttribute('data-anchored');
    return;
  }
  const map = cityViewport.getBoundingClientRect();
  const openPanels = cardDisclosures.filter(menu => menu.open).map(menu => menu.querySelector('.tool-content')!);
  const position = areaCardPosition(
    { x: map.left + selectionAnchor.x, y: map.top + selectionAnchor.y,
      outlineTop: selectionAnchor.outlineTop === undefined ? undefined : map.top + selectionAnchor.outlineTop },
    { width: inspector.offsetWidth, height: inspector.offsetHeight },
    { left: Math.max(0, map.left), top: Math.max(0, map.top), right: Math.min(innerWidth, map.right),
      bottom: Math.min(innerHeight, map.bottom, attribution.getBoundingClientRect().top) },
    [...cardObstacles, ...openPanels].map(control => control.getBoundingClientRect()),
  );
  inspector.toggleAttribute('data-anchored', Boolean(position));
  if (!position) return;
  inspector.style.setProperty('--card-left', `${position.left - map.left}px`);
  inspector.style.setProperty('--card-top', `${position.top - map.top}px`);
  inspector.style.setProperty('--card-pointer', `${position.pointer}px`);
}

function setSelectionAnchor(point: typeof selectionAnchor) {
  selectionAnchor = point;
  positionAreaCard();
}

if (!mock) {
  const resize = new ResizeObserver(positionAreaCard);
  for (const node of [cityViewport, inspector, attribution, ...cardObstacles]) resize.observe(node);
  window.addEventListener('scroll', positionAreaCard, { passive: true });
  for (const menu of cardDisclosures) menu.addEventListener('toggle', positionAreaCard);
}

if (CSS.supports('backdrop-filter', 'url("#area-search-lens")')) {
  const searchRow = search.parentElement!;
  const resizeLenses = new ResizeObserver(entries => {
    for (const { target, borderBoxSize } of entries) {
      const size = borderBoxSize[0];
      const [width, height] = target === searchRow ? [272, 48] : [224, 104];
      target.toggleAttribute('data-lens', size?.inlineSize === width && size.blockSize === height);
    }
  });
  for (const target of [searchRow, inspector]) resizeLenses.observe(target, { box: 'border-box' });
}

const mode = cutoutMode(query.get('cutout'));
let land: LandFootprint | undefined;
let landChecked = false;
element('hull-source').hidden = mode !== 'boroughs';
element('land-source').hidden = mode !== 'land';
element('land-provenance').hidden = mode !== 'land';
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
  const imageryStatus = startupStatus(state.phase, imageryStage, mock);
  const active = ['loading', 'ready', 'partial'].includes(state.phase);
  const stateMessages = {
    setup: '3D needs a public Cesium ion token.',
    idle: mock ? 'Preparing the mock stage…' : startup?.pending ? (document.visibilityState === 'visible' ? 'Opening NYC when the local footprint is ready…' : 'NYC will open when this page becomes visible.') : 'The city is stopped.',
    loading: mock ? 'Loading mock scene…' : 'Loading NYC 3D… You can stop at any time.',
    ready: mock ? 'Mock stage ready. No imagery loaded.' : '',
    partial: 'Some tiles failed to stream. Use Stop 3D to prevent new requests.',
    error: state.failure ? messages[state.failure] : messages.network,
    stopped: '3D unloaded. No city imagery is displayed.',
  };
  const status = element('status');
  const cutoutPending = mode === 'land' && !landChecked;
  const waiting = state.draining && !active ? ' Waiting for previous requests to finish before retry.'
    : state.phase === 'stopped' && cutoutPending && geographyReady ? ' Waiting for the land cutout file.' : '';
  const statusText = (imageryStatus ?? stateMessages[state.phase]) + waiting;
  status.classList.toggle('visually-hidden', !statusText);
  if (status.textContent !== statusText) status.textContent = statusText;
  const focusedAction = document.activeElement;
  load.textContent = state.phase === 'error' ? 'Retry once' : 'Resume 3D';
  load.hidden = active || Boolean(startup?.pending);
  load.disabled = !geographyReady || !configured || cutoutPending || state.draining || active || state.attempts >= 2 || state.failure === 'rate' || state.failure === 'webgl';
  load.setAttribute('aria-busy', String(state.phase === 'loading')); stop.disabled = !active && !startup?.pending;
  if (focusedAction === load && load.hidden) (stop.disabled ? status : stop).focus();
  if (focusedAction === stop && stop.disabled) (load.hidden || load.disabled ? status : load).focus();
  element('session-limit').hidden = state.attempts < 2 || active;
  const liveActive = active && !mock;
  element('cesium-view').hidden = !liveActive;
  element('viewport-state').hidden = !mock && configured && !geographyFailed && state.phase !== 'error';
  element('credits-placeholder').hidden = liveActive;
  element('setup').hidden = configured || geographyFailed;
  element('cesium-view').setAttribute('aria-busy', String(state.phase === 'loading'));
  element('viewport-title').textContent = geographyFailed ? 'Local footprint unavailable' : state.phase === 'error' ? 'The city could not open' : mock ? 'Mock city stage' : 'City configuration needed';
  element('viewport-message').textContent = geographyFailed ? 'Restore the local TLC geography file and reload.' : state.phase === 'error' ? stateMessages.error : mock ? 'Controls run locally. No city imagery is requested.' : 'Add the public read-only token to open this city stage.';
  const footprint = controller.footprint();
  if (mode === 'none') {
    element('footprint-notice').textContent = 'Continuous imagery';
  } else {
    const cutout = mode === 'land' ? 'DCP land cutout' : 'TLC borough cutout';
    const unavailable = footprint?.kind === 'unavailable' || (mode === 'land' && landChecked && !land);
    element('footprint-notice').textContent = unavailable
      ? `${cutout} unavailable. The live scene uses continuous imagery.`
      : footprint?.kind === 'newark' ? `${cutout} with the Newark Airport study area` : `${cutout} selected`;
  }
  element('outside-city').hidden = selected !== 1;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view], #city-overview')) button.disabled = state.phase !== 'ready' || state.draining;
  const known = resolveZone(zones, selected);
  const target = known && areaTarget(zones, selected);
  focusButton.disabled = !target || state.phase !== 'ready' || state.draining;
  focusButton.setAttribute('aria-busy', String(state.focusing));
  clearSelection.disabled = !known;
  const focusStatus = element('focus-status');
  const focusText = state.focusing ? 'Flying to area…'
    : known && !target ? 'Camera target unavailable.'
    : known && focusButton.disabled ? 'Available when 3D is ready.' : '';
  if (focusStatus.textContent !== focusText) focusStatus.textContent = focusText;
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
    select() {}, focus(id, reducedMotion) { if (id === 1 && mode !== 'none') expanded = true; return movement.focus(id, reducedMotion); }, cancelFocus() { movement.cancel(); },
    overview() { movement.cancel(); expanded = false; return true; }, orbit() { movement.cancel(); return true; }, zoom() { movement.cancel(); return true; },
    footprint() {
      if (mode === 'none') return undefined;
      if (mode === 'land' && !land) return {kind: 'unavailable', includesNewark: false};
      return {kind: expanded ? 'newark' : 'city', includesNewark: expanded};
    },
    dispose() { disposed = true; movement.dispose(); }, whenSettled() { return Promise.resolve(); },
  };
}
function liveAdapter(): SceneAdapter {
  let disposed = false, delegate: SceneAdapter | undefined;
  return {
    async load(change) {
      const { createCesiumAdapter } = await engine.load();
      if (disposed) return;
      delegate = createCesiumAdapter(element('cesium-view'), element('credits'), import.meta.env.VITE_CESIUM_ION_TOKEN, zones, selectZone, diagnostics, land, mode, stage => {
        if (disposed) return;
        imageryStage = stage; render(controller.state);
      }, point => {
        if (!disposed) setSelectionAnchor(point);
      });
      await delegate.load(change);
      if (!disposed) diagnostics.event('scene.resourcesAttached');
    },
    select(id) { delegate?.select(id); },
    overview() { return delegate?.overview?.() ?? false; }, orbit(horizontal, vertical) { return delegate?.orbit?.(horizontal, vertical) ?? false; }, zoom(factor) { return delegate?.zoom?.(factor) ?? false; }, footprint() { return delegate?.footprint?.(); },
    focus(id, reducedMotion) { return delegate?.focus(id, reducedMotion) ?? Promise.resolve(false); },
    cancelFocus() { delegate?.cancelFocus(); },
    dispose() { disposed = true; delegate?.dispose(); setSelectionAnchor(null); }, whenSettled() { return delegate?.whenSettled() ?? Promise.resolve(); },
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
  clearSearch.hidden = search.value.length === 0;
  const measured = diagnostics.span('selection.options');
  const current = resolveZone(zones, selected);
  const pinnedCurrent = current && !matchedResultIds.has(current.id) ? current.id : null;
  if (resultQuery === search.value && pinnedResultId === pinnedCurrent) {
    picker.value = current ? String(current.id) : '';
    measured(); return;
  }
  const results = filterZones(zones, search.value);
  resultQuery = search.value; matchedResultIds = new Set(results.map(zone => zone.id));
  pinnedResultId = current && !matchedResultIds.has(current.id) ? current.id : null;
  picker.replaceChildren(new Option('Choose a TLC area', ''));
  if (current && pinnedResultId !== null) {
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
  searchCount.textContent = results.length === 0 ? 'No matching TLC areas. Clear search to show all areas.' : new Intl.PluralRules('en').select(results.length) === 'one' ? '1 matching TLC area.' : `${new Intl.NumberFormat('en').format(results.length)} matching TLC areas.`;
  measured();
}
function selectZone(id: number | null, interaction = true) {
  if (interaction) diagnostics.interaction();
  const measured = diagnostics.span('selection.handler');
  const zone = resolveZone(zones, id);
  const next = zone?.id ?? null;
  if (next !== selected) setSelectionAnchor(null);
  selected = next;
  inspector.hidden = !zone;
  element('selection-title').textContent = zone?.properties.zone ?? 'TLC area';
  element('zone-id').textContent = zone ? String(zone.properties.location_id) : '';
  element('zone-borough').textContent = zone?.properties.borough ?? '';
  controller.select(selected); renderResults(); render(controller.state);
  const url = new URL(location.href);
  selected === null ? url.searchParams.delete('zone') : url.searchParams.set('zone', String(selected)); history.replaceState(null, '', url);
  measured();
}
function showAreaResults(open: boolean) {
  if (picker.hidden === !open || (open && !geographyReady)) return;
  areaControls.toggleAttribute('data-expanded', open);
  picker.hidden = !open;
  searchCount.classList.toggle('visually-hidden', !open);
}
search.addEventListener('focus', () => showAreaResults(true));
search.addEventListener('click', () => showAreaResults(true));
search.addEventListener('input', () => { diagnostics.interaction(); showAreaResults(true); renderResults(); });
search.addEventListener('keydown', event => {
  if (event.isComposing || (event.key !== 'ArrowDown' && (event.key !== 'Enter' || !picker.hidden))) return;
  event.preventDefault();
  showAreaResults(true);
  if (event.key === 'ArrowDown' && !picker.disabled) picker.focus();
});
areaControls.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing) return;
  event.preventDefault();
  search.focus();
  showAreaResults(false);
});
// Wait for the outside click to land before collapsing the in-flow panel.
let outsidePointer: number | undefined;
document.addEventListener('pointerdown', event => {
  if (!picker.hidden && !areaControls.contains(event.target as Node)) outsidePointer = event.pointerId;
}, true);
for (const type of ['pointerup', 'pointercancel'] as const) {
  document.addEventListener(type, event => {
    if (event.pointerId === outsidePointer) outsidePointer = undefined;
  }, true);
}
areaControls.addEventListener('focusout', event => {
  if (outsidePointer === undefined && event.relatedTarget instanceof Node && !areaControls.contains(event.relatedTarget)) {
    showAreaResults(false);
  }
});
document.addEventListener('click', event => {
  if (!areaControls.contains(event.target as Node)) showAreaResults(false);
}, true);
for (const menu of document.querySelectorAll<HTMLDetailsElement>('#view-controls, #sources')) {
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
clearSearch.addEventListener('click', () => {
  search.value = '';
  search.focus();
  showAreaResults(true);
  renderResults();
});
picker.addEventListener('change', () => selectZone(resolveZone(zones, picker.value)?.id ?? null));
clearSelection.addEventListener('click', () => { selectZone(null); search.focus(); });
load.addEventListener('click', () => {
  if (load.disabled) return;
  startup?.stop();
  engine.retry();
  void controller.load();
});
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
    const landAsset = mode === 'land' ? (async () => {
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
    geographyReady = true; search.disabled = false; search.placeholder = 'Search areas';
    selectZone(resolveZone(zones, query.get('zone'))?.id ?? null, false);
    if (landAsset) {
      land = await landAsset;
      landChecked = true;
      render(controller.state);
    }
    startup?.ready();
  } catch {
    geographyFailed = true; startup?.stop();
    picker.replaceChildren(new Option('Local TLC areas unavailable', '')); picker.disabled = true; search.disabled = true;
    search.placeholder = 'Area search unavailable';
    searchCount.textContent = 'The local area list could not load. Restore the TLC geography file and reload.';
    render(controller.state);
  }
}
void loadZones();
