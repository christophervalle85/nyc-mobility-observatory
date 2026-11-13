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
import { taxiDashboard } from './taxi-dashboard.ts';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const picker = element('zone-picker'), search = element<HTMLInputElement>('area-search');
const areaControls = element('area-controls'), resultsPanel = element('area-results'), searchCount = element('search-count');
const searchAnnouncement = element('search-announcement');
const load = element<HTMLButtonElement>('load'), focusButton = element<HTMLButtonElement>('focus-area');
const focusLabel = focusButton.querySelector('span')!;
const clearSearch = element<HTMLButtonElement>('clear-search'), clearSelection = element<HTMLButtonElement>('clear-selection');
const query = new URLSearchParams(location.search), mock = query.get('mode') === 'mock';
const diagnostics = createDiagnostics(query.get('diagnostics') === '1');
const inspector = element('inspector');
const taxiPanel = element('taxi-dashboard');
const dashboard = taxiDashboard(taxiPanel, element<HTMLButtonElement>('taxi-open'), search, station => controller.selectStation(station));
const cityViewport = element('city-viewport');
const cardObstacles = [areaControls, document.querySelector<HTMLElement>('.session-info')!, document.querySelector<HTMLElement>('.stage-tools')!];
const attribution = document.querySelector<HTMLElement>('.map-attribution')!;
const cardDisclosures = [element<HTMLDetailsElement>('sources')];
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
      bottom: Math.min(innerHeight, map.bottom) },
    [...cardObstacles, attribution, taxiPanel, ...openPanels].map(control => control.getBoundingClientRect()),
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
  for (const node of [cityViewport, inspector, attribution, taxiPanel, ...cardObstacles]) resize.observe(node);
  window.addEventListener('scroll', positionAreaCard, { passive: true });
  for (const menu of cardDisclosures) menu.addEventListener('toggle', positionAreaCard);
}

if (CSS.supports('backdrop-filter', 'url("#area-search-lens")')) {
  const searchRow = search.parentElement!;
  const resizeLenses = new ResizeObserver(entries => {
    for (const { target, borderBoxSize } of entries) {
      const size = borderBoxSize[0];
      const [width, height] = target === searchRow ? [272, 48] : [272, 104];
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
let pendingSearchFocus = false;
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
    loading: mock ? 'Loading mock scene…' : 'Loading NYC 3D…',
    ready: mock ? 'Mock stage ready. No imagery loaded.' : '',
    partial: 'Some tiles failed to stream.',
    error: state.failure ? messages[state.failure] : messages.network,
    stopped: '3D unloaded. No city imagery is displayed.',
  };
  const status = element('status');
  const cutoutPending = mode === 'land' && !landChecked;
  const waiting = state.draining && !active ? ' Waiting for previous requests to finish before retry.'
    : state.phase === 'stopped' && cutoutPending && geographyReady ? ' Waiting for the land cutout file.' : '';
  const statusText = (imageryStatus ?? stateMessages[state.phase]) + waiting;
  status.classList.toggle('visually-hidden', state.phase !== 'partial' && state.phase !== 'error');
  if (status.textContent !== statusText) status.textContent = statusText;
  const focusedAction = document.activeElement;
  load.textContent = state.phase === 'error' ? 'Retry once' : 'Open 3D';
  load.hidden = active || !configured || Boolean(startup?.pending);
  load.disabled = !geographyReady || !configured || cutoutPending || state.draining || active || state.attempts >= 2 || state.failure === 'rate' || state.failure === 'webgl';
  load.setAttribute('aria-busy', String(state.phase === 'loading'));
  const fallbackFocus = geographyReady ? search : element('main');
  if (focusedAction === load && load.hidden) fallbackFocus.focus();
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
  const overview = element<HTMLButtonElement>('city-overview');
  overview.disabled = state.phase !== 'ready' || state.draining;
  const overviewReturning = !overview.disabled && controller.hasOverviewReturn();
  const overviewLabel = overviewReturning ? 'Return to previous map view' : 'Show all NYC';
  overview.title = overviewLabel;
  overview.setAttribute('aria-label', overviewLabel);
  overview.toggleAttribute('data-return', overviewReturning);
  const known = resolveZone(zones, selected);
  const target = known && areaTarget(zones, selected);
  focusButton.disabled = !target || state.phase !== 'ready' || state.draining;
  focusButton.setAttribute('aria-busy', String(state.focusing));
  const returning = controller.canReturnToView();
  focusButton.toggleAttribute('data-return', returning);
  const label = returning ? 'Return to previous view' : 'Zoom to area';
  if (focusLabel.textContent !== label) focusLabel.textContent = label;
  clearSelection.disabled = !known;
  const focusStatus = element('focus-status');
  const focusText = known && !target ? 'Camera target unavailable.'
    : known && focusButton.disabled ? 'Available when 3D is ready.' : '';
  if (focusStatus.textContent !== focusText) focusStatus.textContent = focusText;
  if (state.phase === 'stopped' || state.phase === 'partial' || state.phase === 'error') pendingSearchFocus = false;
  if (pendingSearchFocus && !focusButton.disabled) {
    pendingSearchFocus = false;
    void focusSelectedArea();
  }
}
function mockAdapter(): SceneAdapter {
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
  let expanded = false, previousView: { expanded: boolean } | undefined;
  let overviewOrigin: { expanded: boolean } | undefined;
  const movement = areaFocus(zones, {
    move(_target, options) {
      overviewOrigin = undefined;
      const before = { expanded };
      if (selected === 1 && mode !== 'none') expanded = true;
      const finish = () => { if (options.complete()) previousView = before; };
      if (options.duration === 0) finish();
      else timer = setTimeout(finish, options.duration * 1000);
    },
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
    select() { previousView = undefined; },
    focus(id, reducedMotion) { return movement.focus(id, reducedMotion); },
    cancelFocus() { movement.cancel(); },
    canReturnToView() { return previousView !== undefined; },
    returnToView() {
      if (!previousView) return false;
      expanded = previousView.expanded;
      previousView = undefined;
      return true;
    },
    hasOverviewReturn() { return overviewOrigin !== undefined; },
    overview() {
      movement.cancel();
      if (overviewOrigin) {
        expanded = overviewOrigin.expanded;
        overviewOrigin = undefined;
      } else {
        overviewOrigin = { expanded };
        previousView = undefined;
        expanded = false;
      }
      return true;
    },
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
    selectStation(station) { delegate?.selectStation?.(station); },
    hasOverviewReturn() { return delegate?.hasOverviewReturn?.() ?? false; },
    overview() { return delegate?.overview?.() ?? false; }, footprint() { return delegate?.footprint?.(); },
    canReturnToView() { return delegate?.canReturnToView?.() ?? false; },
    returnToView() { return delegate?.returnToView?.() ?? false; },
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
let resultQuery: string | undefined;
let resultRows: HTMLLIElement[] = [];
let selectedRow: HTMLElement | null = null;
let activeResult = -1;
const numberFormat = new Intl.NumberFormat('en');
const pluralRules = new Intl.PluralRules('en');

function updateSelectedResult() {
  const row = selected === null ? null : document.getElementById(`area-result-${selected}`);
  if (row === selectedRow) return;
  selectedRow?.setAttribute('aria-selected', 'false');
  row?.setAttribute('aria-selected', 'true');
  selectedRow = row;
}

function setActiveResult(index: number) {
  resultRows[activeResult]?.removeAttribute('data-active');
  activeResult = index;
  const row = resultRows[index];
  if (!row) {
    search.removeAttribute('aria-activedescendant');
    return;
  }
  row.setAttribute('data-active', '');
  search.setAttribute('aria-activedescendant', row.id);
  const rowBounds = row.getBoundingClientRect(), listBounds = picker.getBoundingClientRect();
  if (rowBounds.top < listBounds.top) picker.scrollTop += rowBounds.top - listBounds.top;
  else if (rowBounds.bottom > listBounds.bottom) picker.scrollTop += rowBounds.bottom - listBounds.bottom;
}

function renderResults() {
  if (!geographyReady) return;
  clearSearch.hidden = search.value.length === 0;
  if (resultQuery === search.value) return;
  const measured = diagnostics.span('selection.options');
  setActiveResult(-1);
  const results = filterZones(zones, search.value);
  resultQuery = search.value;
  resultRows = results.map(zone => {
    const row = document.createElement('li');
    row.id = `area-result-${zone.id}`;
    row.dataset.zone = String(zone.id);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    const name = document.createElement('span'), metadata = document.createElement('span');
    name.textContent = zone.properties.zone;
    metadata.textContent = `${zone.properties.borough} · TLC ID ${zone.id}`;
    row.append(name, metadata);
    return row;
  });
  picker.replaceChildren(...resultRows);
  picker.scrollTop = 0;
  selectedRow = null;
  updateSelectedResult();
  searchCount.textContent = results.length === 0 ? 'No matching TLC areas.'
    : pluralRules.select(results.length) === 'one' ? '1 matching TLC area.' : `${numberFormat.format(results.length)} matching TLC areas.`;
  measured();
}
function selectZone(id: number | null, interaction = true) {
  pendingSearchFocus = false;
  if (interaction) diagnostics.interaction();
  const measured = diagnostics.span('selection.handler');
  const zone = resolveZone(zones, id);
  const next = zone?.id ?? null;
  if (next !== selected) setSelectionAnchor(null);
  selected = next;
  showAreaResults(false);
  inspector.hidden = !zone;
  element('selection-title').textContent = zone?.properties.zone ?? 'TLC area';
  element('zone-id').textContent = zone ? String(zone.properties.location_id) : '';
  element('zone-borough').textContent = zone?.properties.borough ?? '';
  controller.select(selected); updateSelectedResult(); render(controller.state);
  const url = new URL(location.href);
  selected === null ? url.searchParams.delete('zone') : url.searchParams.set('zone', String(selected)); history.replaceState(null, '', url);
  const center = zone && areaTarget(zones, zone.id);
  dashboard.select(zone ? { id: zone.id, name: zone.properties.zone, center } : null);
  measured();
}
function showAreaResults(open: boolean) {
  open = open && geographyReady && search.value.trim().length > 0;
  if (resultsPanel.hidden === !open) return;
  resultsPanel.hidden = !open;
  search.setAttribute('aria-expanded', String(open));
  inspector.hidden = open || selected === null;
  if (open) {
    searchAnnouncement.textContent = '';
    renderResults();
  } else setActiveResult(-1);
}

function chooseResult(row: HTMLElement | undefined) {
  if (resultsPanel.hidden || !row) return;
  const zone = resolveZone(zones, row.dataset.zone);
  if (!zone) return;
  selectZone(zone.id);
  search.focus({ preventScroll: true });
  searchAnnouncement.textContent = `Selected ${zone.properties.zone}.`;
  if (controller.canReturnToView()) return;
  const { phase, draining } = controller.state;
  if (!focusButton.disabled) void focusSelectedArea();
  else pendingSearchFocus = phase === 'loading' || (phase === 'ready' && draining) || Boolean(startup?.pending);
}
// Text inputs match :focus-visible after pointer focus as well as keyboard focus.
search.parentElement!.addEventListener('pointerdown', () => search.setAttribute('data-pointer-focus', ''));
search.addEventListener('blur', () => search.removeAttribute('data-pointer-focus'));
search.addEventListener('click', () => showAreaResults(true));
search.addEventListener('input', () => {
  diagnostics.interaction();
  clearSearch.hidden = search.value.length === 0;
  showAreaResults(true);
  if (!resultsPanel.hidden) renderResults();
});
search.addEventListener('keydown', event => {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!search.value.trim()) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    showAreaResults(true);
    if (!resultRows.length) return;
    const last = resultRows.length - 1;
    const next = event.key === 'ArrowDown' ? Math.min(last, activeResult + 1)
      : activeResult === -1 ? last : Math.max(0, activeResult - 1);
    setActiveResult(next);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (resultsPanel.hidden) showAreaResults(true);
    else chooseResult(resultRows[Math.max(0, activeResult)]);
  } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    setActiveResult(-1);
  }
});
areaControls.addEventListener('keydown', event => {
  if (event.isComposing || resultsPanel.hidden) return;
  if (event.key === 'Tab' && event.target === clearSearch && !event.shiftKey) showAreaResults(false);
  if (event.key !== 'Escape') return;
  event.preventDefault();
  search.focus({ preventScroll: true });
  showAreaResults(false);
});
picker.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse' && event.button === 0 && (event.target as Element).closest('[role="option"]')) event.preventDefault();
});
picker.addEventListener('focus', () => search.focus({ preventScroll: true }));
picker.addEventListener('click', event => {
  chooseResult((event.target as Element).closest<HTMLElement>('[role="option"]') ?? undefined);
});
// Keep the in-flow panel in place until the current pointer gesture can deliver its click.
let pointer: number | undefined;
let backgroundPress: { id: number; x: number; y: number } | undefined;
let pointerRelease: ReturnType<typeof setTimeout> | undefined;
document.addEventListener('pointerdown', event => {
  clearTimeout(pointerRelease);
  if (!resultsPanel.hidden) pointer = event.pointerId;
  backgroundPress = event.target === cityViewport
    ? { id: event.pointerId, x: event.clientX, y: event.clientY } : undefined;
}, true);
document.addEventListener('pointermove', event => {
  if (backgroundPress?.id === event.pointerId &&
      Math.hypot(event.clientX - backgroundPress.x, event.clientY - backgroundPress.y) > 5) backgroundPress = undefined;
}, true);
document.addEventListener('pointerup', event => {
  if (event.pointerId !== pointer) return;
  pointerRelease = setTimeout(() => {
    pointer = undefined;
    if (!areaControls.contains(document.activeElement)) showAreaResults(false);
  }, 0);
}, true);
document.addEventListener('pointercancel', event => {
  if (event.pointerId === pointer) pointer = undefined;
  if (event.pointerId === backgroundPress?.id) backgroundPress = undefined;
}, true);
areaControls.addEventListener('focusout', event => {
  if (pointer === undefined && !areaControls.contains(event.relatedTarget as Node | null)) {
    showAreaResults(false);
  }
});
document.addEventListener('click', event => {
  clearTimeout(pointerRelease);
  pointer = undefined;
  const target = event.target as Element;
  const dismissSelection = target === cityViewport && backgroundPress !== undefined;
  backgroundPress = undefined;
  if (areaControls.contains(target)) return;
  if (dismissSelection) selectZone(null);
  else showAreaResults(false);
}, true);
for (const menu of document.querySelectorAll<HTMLDetailsElement>('#sources')) {
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
clearSearch.addEventListener('click', event => {
  search.toggleAttribute('data-pointer-focus', event.detail > 0);
  search.value = '';
  search.focus();
  clearSearch.hidden = true;
  showAreaResults(false);
});
clearSelection.addEventListener('click', () => { selectZone(null); search.focus(); });
load.addEventListener('click', () => {
  if (load.disabled) return;
  startup?.stop();
  engine.retry();
  void controller.load();
});
async function focusSelectedArea() {
  const focused = diagnostics.span('focus.duration');
  const moved = await controller.focus(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (moved) focused();
}
focusButton.addEventListener('click', () => {
  diagnostics.interaction();
  if (controller.canReturnToView()) controller.returnToView();
  else void focusSelectedArea();
});
element('city-overview').addEventListener('click', () => { diagnostics.interaction(); controller.overview(); });
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
    geographyReady = true;
    search.disabled = false;
    // A thin space separates the empty-field caret from the placeholder.
    search.placeholder = '\u2009Search areas';
    selectZone(resolveZone(zones, query.get('zone'))?.id ?? null, false);
    if (landAsset) {
      land = await landAsset;
      landChecked = true;
      render(controller.state);
    }
    startup?.ready();
  } catch {
    geographyFailed = true; startup?.stop();
    search.disabled = true;
    search.placeholder = 'Area search unavailable';
    searchAnnouncement.textContent = 'The local area list could not load. Restore the TLC geography file and reload.';
    render(controller.state);
  }
}
void loadZones();
