import { buildMobilityRange } from './mobility-range.ts';
import { dailyTrend } from './daily-trend.ts';
import { monthRangePicker } from './month-range-picker.ts';
import { dateLabel, hoursPerDay, monthLabel, parseMobilityMonths } from './mobility-months.ts';
import type { MobilityMonth } from './mobility-months.ts';
import { hourLabel, parseTaxiData, taxiHourLabel } from './taxi-data.ts';
import type { TaxiData } from './taxi-data.ts';
import { nearbyStations, parseSubwayData } from './subway-data.ts';
import type { SubwayData, SubwayStation } from './subway-data.ts';

const requestTimeout = 10_000;
const number = new Intl.NumberFormat('en-US');
const hourlyNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });

interface TaxiArea {
  id: number;
  name: string;
  center?: { longitude: number; latitude: number };
}

interface Dataset<T> {
  data?: T;
  request?: AbortController;
  failed: boolean;
}

async function fetchDataset<T>(path: string, parse: (value: unknown) => T, request: AbortController): Promise<T> {
  const timer = setTimeout(() => request.abort(), requestTimeout);
  try {
    const response = await fetch(path, {
      signal: request.signal, mode: 'same-origin', redirect: 'error',
    });
    if (!response.ok) throw new Error('Transportation data unavailable');
    return parse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function chartScale(peak: number) {
  const increment = Math.max(1, 10 ** Math.floor(Math.log10(peak || 1)) / 2);
  return Math.max(2, Math.ceil(peak / (increment * 2)) * increment * 2);
}

function busiestHour(counts: readonly (number | null)[], peak: number): string {
  if (peak === 0) return counts.some(value => value !== null) ? 'No activity' : 'Unavailable';
  return `${hourLabel(counts.indexOf(peak))} · ${hourlyNumber.format(peak)}`;
}

function drawChart(chart: HTMLCanvasElement, counts: readonly (number | null)[], scale: number, activeHour: number) {
  const ctx = chart.getContext('2d');
  const { clientWidth: width, clientHeight: height } = chart;
  if (!ctx || !width || !height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  chart.width = Math.round(width * dpr);
  chart.height = Math.round(height * dpr);
  ctx.scale(dpr, dpr);
  const chartColor = getComputedStyle(chart).color;
  ctx.strokeStyle = chartColor;
  ctx.globalAlpha = .24;
  ctx.beginPath();
  for (const y of [1, height / 2, height - 1]) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = chartColor;
  const slot = width / hoursPerDay;
  ctx.globalAlpha = .18;
  ctx.fillRect(activeHour * slot, 0, slot, height);
  ctx.globalAlpha = 1;
  counts.forEach((value, index) => {
    if (value === null) return;
    // Observed zero stays on the baseline, while missing or flagged hours are blank.
    const barHeight = Math.max(1, value / scale * (height - 2));
    ctx.fillRect(index * slot + 1, height - barHeight, Math.max(1, slot - 2), barHeight);
  });
}

export function taxiDashboard(panel: HTMLElement, opener: HTMLButtonElement, fallback: HTMLElement, highlightStation: (station: SubwayStation | null) => void) {
  const find = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const heading = find('#taxi-heading'), area = find('#taxi-area'), status = find('#taxi-status');
  const closer = find<HTMLButtonElement>('#taxi-close'), retry = find<HTMLButtonElement>('#taxi-retry');
  const dateRange = monthRangePicker(panel, loadRange);
  const trend = dailyTrend(find('#mobility-trend'), date => {
    day.value = date;
    selectedHour = 0;
    render();
  });
  const dayUnavailable = find('#mobility-day-unavailable');
  const statistics = find('.mobility-statistics');
  const trendTaxiLegend = find('#trend-taxi-legend'), trendSubwayLegend = find('#trend-subway-legend');
  const taxiCoverage = find('#taxi-range-coverage');
  const monthStatus = find('#mobility-month-status'), coverage = find('#mobility-coverage');
  const monthRetry = find<HTMLButtonElement>('#mobility-month-retry');
  const results = find('#taxi-results'), total = find('#taxi-total'), chart = find<HTMLCanvasElement>('#taxi-chart');
  const scaleTop = find('#taxi-y-top'), scaleMiddle = find('#taxi-y-middle');
  const subwayStatus = find('#subway-status'), subwayRetry = find<HTMLButtonElement>('#subway-retry');
  const station = find<HTMLSelectElement>('#subway-station');
  const subwayTotal = find('#subway-total'), subwayCoverage = find('#subway-coverage');
  const taxiMetric = find('#taxi-metric'), subwayMetric = find('#subway-metric');
  const taxiFigure = find('#taxi-figure'), subwayFigure = find('#subway-figure');
  const subwayChart = find<HTMLCanvasElement>('#subway-chart');
  const subwayScaleTop = find('#subway-y-top'), subwayScaleMiddle = find('#subway-y-middle');
  const subwayDataNote = find('#subway-data-note'), subwayGaps = find('#subway-chart-gaps');
  const statisticsDate = find('#mobility-statistics-date');
  const taxiDayStat = find('#taxi-day-stat'), taxiPeakStat = find('#taxi-peak-stat');
  const subwayDayStat = find('#subway-day-stat'), subwayPeakStat = find('#subway-peak-stat');
  const taxiDayTotal = find('#taxi-day-total'), taxiPeakHour = find('#taxi-peak-hour');
  const subwayDayTotal = find('#subway-day-total'), subwayPeakHour = find('#subway-peak-hour');
  const day = find<HTMLSelectElement>('#taxi-chart-day');
  const currentHourLabel = find('#chart-hour-label');
  const hourTaxi = find('#chart-hour-taxi'), hourSubway = find('#chart-hour-subway');
  let selection: TaxiArea | null = null;
  const catalog: Dataset<MobilityMonth[]> = { failed: false };
  const taxi = new Map<string, Dataset<TaxiData>>();
  const subway = new Map<string, Dataset<SubwayData>>();
  let activeMonths: MobilityMonth[] = [];
  let selectedStationId = '';
  let stationOptionsKey = '';
  const stations = new Map<number, SubwayStation>();

  function updateStations(roster: SubwayStation[], incomplete: boolean) {
    const center = selection?.center;
    const nearby = center ? nearbyStations(roster, center) : [];
    if (center && selectedStationId && !nearby.some(({ station: item }) => String(item.id) === selectedStationId)) {
      const [retained] = nearbyStations(roster.filter(item => String(item.id) === selectedStationId), center);
      if (retained) nearby.splice(5, 1, retained);
    }
    const key = JSON.stringify([roster.length > 0, nearby.map(({ station, distance }) =>
      [station.id, station.name, station.borough, station.latitude, station.longitude, distance])]);
    stations.clear();
    for (const { station: item } of nearby) stations.set(item.id, item);
    if (!incomplete && roster.length && !stations.has(Number(selectedStationId))) selectedStationId = '';
    if (key === stationOptionsKey) return;
    stationOptionsKey = key;
    station.replaceChildren(new Option(roster.length && !nearby.length ? 'No nearby stations' : 'Choose a nearby station', ''));
    for (const { station: item, distance } of nearby) {
      const option = new Option('', String(item.id));
      const label = document.createElement('span');
      label.className = 'station-option-name';
      label.textContent = `${item.name} · ${item.borough}`;
      const detail = document.createElement('span');
      detail.className = 'station-option-distance';
      detail.textContent = distance < 1_000 ? `${Math.round(distance)} m` : `${(distance / 1_000).toFixed(2)} km`;
      option.append(label, ' ', detail);
      station.add(option);
    }
    station.value = stations.has(Number(selectedStationId)) ? selectedStationId : '';
  }
  let chartDateRange = '';
  let selectedHour = 0;
  let shown: {
    date: string;
    taxi?: { counts: readonly (number | null)[]; scale: number };
    subway?: { counts: readonly (number | null)[]; scale: number };
  } | undefined;

  function paint() {
    if (panel.hidden || !shown) return;
    if (shown.taxi) drawChart(chart, shown.taxi.counts, shown.taxi.scale, selectedHour);
    if (shown.subway) drawChart(subwayChart, shown.subway.counts, shown.subway.scale, selectedHour);
  }

  function renderHour() {
    if (!shown) return;
    const firstHour = (Number(shown.date.slice(-2)) - 1) * hoursPerDay;
    const time = taxiHourLabel(shown.date.slice(0, 7), firstHour + selectedHour);
    const dropoffs = shown.taxi?.counts[selectedHour];
    const entries = shown.subway?.counts[selectedHour];
    currentHourLabel.textContent = `${hourLabel(selectedHour)} ET`;
    hourTaxi.textContent = dropoffs == null ? '' : hourlyNumber.format(dropoffs);
    hourSubway.textContent = entries === undefined ? '' : entries === null ? 'Unavailable' : hourlyNumber.format(entries);
    hourSubway.toggleAttribute('data-unavailable', entries === null);
    const details = [`${time} ET`];
    if (dropoffs != null) details.push(`Taxi dropoffs ${hourTaxi.textContent}`);
    if (entries !== undefined) details.push(entries === null
      ? 'Subway entries missing or flagged' : `Estimated subway entries ${hourSubway.textContent}`);
    const value = details.join('. ');
    for (const canvas of [chart, subwayChart]) {
      canvas.setAttribute('aria-valuenow', String(selectedHour));
      canvas.setAttribute('aria-valuetext', value);
    }
    paint();
  }

  function selectHour(hour: number) {
    const next = Math.min(hoursPerDay - 1, Math.max(0, hour));
    if (next === selectedHour) return;
    selectedHour = next;
    renderHour();
  }

  function selectPointerHour(event: MouseEvent, canvas: HTMLCanvasElement) {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width) selectHour(Math.floor((event.clientX - bounds.left) * hoursPerDay / bounds.width));
  }

  function render() {
    if (panel.hidden || !selection) return;
    area.textContent = `${selection.name} · TLC ID ${selection.id}`;
    monthRetry.hidden = !catalog.failed;
    monthStatus.textContent = catalog.failed ? 'Available months could not load. Retry to try again.'
      : catalog.request ? 'Loading available months…' : '';
    if (!catalog.data) return;
    const { start, end } = dateRange.value;
    const monthData = new Map<string, { taxi?: TaxiData; subway?: SubwayData }>();
    const roster = new Map<number, SubwayStation>();
    let taxiPending = false, subwayPending = false, taxiFailed = false, subwayFailed = false;
    let mismatch: string | undefined;
    for (const { month, taxi: hasTaxi, subway: hasSubway } of activeMonths) {
      const taxiMonth = taxi.get(month);
      const subwayMonth = subway.get(month);
      const waitingForTaxi = hasTaxi && !taxiMonth?.data && !taxiMonth?.failed;
      taxiPending ||= waitingForTaxi;
      subwayPending ||= hasSubway && !subwayMonth?.data && !subwayMonth?.failed;
      taxiFailed ||= Boolean(taxiMonth?.failed);
      subwayFailed ||= Boolean(subwayMonth?.failed);
      const taxiData = taxiMonth?.data;
      let subwayData = subwayMonth?.data;
      if (taxiData && subwayData && taxiData.runId !== subwayData.runId) {
        mismatch = month;
        subwayData = undefined;
      } else if (waitingForTaxi) subwayData = undefined;
      // Prefer the newest validated record for each station in the picker.
      for (const item of subwayData?.stations ?? []) if (!roster.has(item.id)) roster.set(item.id, item);
      monthData.set(month, { taxi: taxiData, subway: subwayData });
    }
    updateStations([...roster.values()], subwayPending || taxiPending || subwayFailed || Boolean(mismatch));
    station.disabled = !stations.size;
    retry.hidden = !taxiFailed;
    subwayRetry.hidden = !subwayFailed && !mismatch;
    status.textContent = taxiPending ? 'Loading taxi dropoffs…'
      : taxiFailed ? 'Some taxi data could not load. Retry to try again.'
      : !activeMonths.some(entry => entry.taxi) ? 'Taxi data is unavailable for this range.' : '';
    subwayStatus.textContent = subwayPending ? 'Loading subway stations…'
      : mismatch ? `Subway data is unavailable for this ${monthLabel(mismatch, false)} run.`
      : subwayFailed ? 'Some subway data could not load. Retry to try again.'
      : !activeMonths.some(entry => entry.subway) ? 'Subway data is unavailable for this range.' : '';
    const selectedStation = stations.get(Number(selectedStationId));
    const range = buildMobilityRange({ start, end, zoneId: selection.id, stationId: selectedStation?.id ?? null, months: monthData });
    if (!range || (range.taxi.total === null && !selectedStation && ![...monthData.values()].some(value => value.subway))) {
      shown = undefined;
      results.hidden = true;
      for (const field of [total, subwayTotal, taxiCoverage, subwayCoverage]) field.textContent = '';
      highlightStation(null);
      return;
    }
    const nextChartDateRange = `${start}/${end}`;
    if (chartDateRange !== nextChartDateRange) {
      const previous = day.value;
      day.replaceChildren(...range.days.map(({ date }) => new Option(dateLabel(date, 'full'), date)));
      day.value = previous >= start && previous <= end ? previous : start;
      if (day.value !== previous) selectedHour = 0;
      chartDateRange = nextChartDateRange;
    }
    const current = range.days.find(item => item.date === day.value)!;
    const taxiDay = current.taxi;
    const subwayDay = current.subway;
    const taxiShown = taxiDay.total !== null;
    const subwayShown = subwayDay.total !== null;
    highlightStation(monthData.get(day.value.slice(0, 7))?.subway?.stations.find(item => item.id === selectedStation?.id) ?? null);
    trend.render(range.days.map(item => ({
      date: item.date, taxi: item.taxi.total, subway: item.subway.total, subwayPartial: item.subway.partial,
    })), day.value);
    trendTaxiLegend.hidden = !activeMonths.some(entry => entry.taxi);
    trendSubwayLegend.hidden = !selectedStation;
    shown = { date: day.value };
    statisticsDate.textContent = `${dateLabel(day.value)} · ET`;
    statistics.hidden = !taxiShown && !subwayShown;
    currentHourLabel.hidden = !taxiShown && !subwayShown;
    taxiDayStat.hidden = taxiPeakStat.hidden = taxiFigure.hidden = !taxiShown;
    subwayDayStat.hidden = subwayPeakStat.hidden = subwayFigure.hidden = !subwayShown;
    taxiMetric.hidden = range.taxi.total === null;
    subwayMetric.hidden = !selectedStation;
    total.textContent = range.taxi.total === null ? '' : number.format(range.taxi.total);
    taxiCoverage.textContent = `${range.taxi.availableDays} of ${range.days.length} days covered`;
    subwayTotal.textContent = range.subway.total === null ? 'Unavailable' : number.format(range.subway.total);
    subwayCoverage.textContent = `${number.format(range.subway.observedHours)} of ${number.format(range.subway.expectedHours)} comparable hours`;
    if (taxiShown) {
      const peak = Math.max(0, ...taxiDay.counts.map(value => value ?? 0));
      const scale = chartScale(peak);
      shown.taxi = { counts: taxiDay.counts, scale };
      scaleTop.textContent = number.format(scale);
      scaleMiddle.textContent = number.format(scale / 2);
      taxiDayTotal.textContent = number.format(taxiDay.total!);
      taxiPeakHour.textContent = busiestHour(taxiDay.counts, peak);
    }
    if (subwayShown) {
      const peak = Math.max(0, ...subwayDay.counts.map(value => value ?? 0));
      const scale = chartScale(peak);
      shown.subway = { counts: subwayDay.counts, scale };
      subwayScaleTop.textContent = number.format(scale);
      subwayScaleMiddle.textContent = number.format(scale / 2);
      const gaps = subwayDay.expectedHours - subwayDay.observedHours;
      subwayGaps.hidden = gaps === 0;
      subwayGaps.textContent = gaps === 1 ? '1 hour missing or flagged.' : `${gaps} hours missing or flagged.`;
      subwayDayTotal.textContent = hourlyNumber.format(subwayDay.total!);
      subwayPeakHour.textContent = busiestHour(subwayDay.counts, peak);
    }
    const unavailable = !taxiShown && !subwayShown ? 'No hourly data for this day.'
      : !subwayShown && selectedStation ? 'Subway data is unavailable for this day.'
      : !taxiShown && activeMonths.some(entry => entry.taxi) ? 'Taxi data is unavailable for this day.' : '';
    dayUnavailable.hidden = !unavailable;
    dayUnavailable.textContent = unavailable;
    results.hidden = false;
    renderHour();
  }

  async function load<T>(
    dataset: Dataset<T>, fetchData: (request: AbortController) => Promise<T>,
    retryButton: HTMLElement, message: HTMLElement, isCurrent: () => boolean,
    ready?: (data: T) => void,
  ) {
    if (dataset.request || dataset.data) return;
    const request = new AbortController();
    dataset.request = request;
    dataset.failed = false;
    const active = document.activeElement;
    const restoreStation = retryButton === retry && active === station;
    render();
    if (active === retryButton || restoreStation) message.focus({ preventScroll: true });
    const data = await fetchData(request).catch(() => undefined);
    dataset.request = undefined;
    if (!isCurrent()) return;
    dataset.data = data;
    dataset.failed = data === undefined;
    if (data !== undefined) ready?.(data);
    render();
    if (document.activeElement === message && !panel.hidden && (dataset === catalog || !activeMonths.some(({ month }) =>
      (retryButton === retry ? taxi.get(month) : subway.get(month))?.request))) {
      const next = restoreStation && !station.disabled ? station : dataset.failed ? retryButton : heading;
      next.focus({ preventScroll: true });
    }
  }

  function loadMonthly<T>(
    cache: Map<string, Dataset<T>>, mode: 'taxi' | 'subway', file: string,
    parser: (value: unknown, month: string) => T, retryButton: HTMLElement, message: HTMLElement,
  ) {
    for (const entry of activeMonths) {
      if (!entry[mode]) continue;
      const { month } = entry;
      const dataset = cache.get(month) ?? { failed: false };
      cache.set(month, dataset);
      void load(dataset, request => fetchDataset(`/data/${file}-${month}.json`, value => parser(value, month), request),
        retryButton, message, () => cache.get(month) === dataset);
    }
  }

  function loadTaxi() {
    loadMonthly(taxi, 'taxi', 'yellow-taxi', parseTaxiData, retry, status);
  }

  function loadSubway() {
    loadMonthly(subway, 'subway', 'subway', parseSubwayData, subwayRetry, subwayStatus);
  }

  function loadRange() {
    if (!catalog.data) return;
    const { start, end } = dateRange.value;
    activeMonths = catalog.data.filter(entry => entry.month >= start.slice(0, 7) && entry.month <= end.slice(0, 7));
    const needed = new Set(activeMonths.map(entry => entry.month));
    for (const cache of [taxi, subway]) {
      for (const [month, value] of cache) {
        if (needed.has(month) || !value.request) continue;
        value.request.abort();
        cache.delete(month);
      }
    }
    const taxiMonths = activeMonths.filter(entry => entry.taxi);
    coverage.hidden = !taxiMonths.length;
    const files = taxiMonths.length === 1 ? `the ${monthLabel(taxiMonths[0].month)} pickup file` : 'each month’s pickup file';
    coverage.textContent = `Taxi data uses ${files}. Dropoffs from trips in adjacent pickup files are excluded.`;
    subwayDataNote.hidden = !activeMonths.some(entry => entry.subway);
    loadTaxi();
    loadSubway();
    render();
  }

  function loadMonths() {
    void load(catalog, request => fetchDataset('/data/mobility-months.json', parseMobilityMonths, request),
      monthRetry, monthStatus, () => true, months => {
        dateRange.setMonths(months.map(entry => entry.month));
        loadRange();
      });
  }

  function close(restoreFocus: boolean) {
    if (panel.hidden) return;
    dateRange.close();
    panel.hidden = true;
    highlightStation(null);
    opener.setAttribute('aria-expanded', 'false');
    selectedHour = 0;
    if (restoreFocus) (selection ? opener : fallback).focus();
  }

  opener.addEventListener('click', () => {
    if (!selection) return;
    if (!panel.hidden) {
      close(true);
      return;
    }
    panel.hidden = false;
    panel.scrollTop = 0;
    opener.setAttribute('aria-expanded', 'true');
    if (!catalog.data && !catalog.failed) loadMonths();
    render();
    heading.focus();
  });
  closer.addEventListener('click', () => close(true));
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    if (panel.querySelector('select:is(:open), #taxi-calendar:is(:popover-open)')) return;
    event.preventDefault();
    close(true);
  });
  retry.addEventListener('click', () => { void loadTaxi(); });
  subwayRetry.addEventListener('click', () => {
    for (const { month } of activeMonths) {
      const taxiData = taxi.get(month)?.data;
      const subwayData = subway.get(month)?.data;
      if (!taxiData || !subwayData || taxiData.runId === subwayData.runId) continue;
      taxi.delete(month);
      subway.delete(month);
    }
    loadTaxi();
    loadSubway();
  });
  monthRetry.addEventListener('click', loadMonths);
  day.addEventListener('change', () => {
    selectedHour = 0;
    render();
  });
  station.addEventListener('change', () => { selectedStationId = station.value; render(); });
  for (const canvas of [chart, subwayChart]) {
    canvas.addEventListener('pointermove', event => {
      if (event.pointerType !== 'touch') selectPointerHour(event, canvas);
    });
    canvas.addEventListener('click', event => selectPointerHour(event, canvas));
    canvas.addEventListener('keydown', event => {
      const offsets: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
      const offset = offsets[event.key];
      if (offset === undefined && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      selectHour(event.key === 'Home' ? 0 : event.key === 'End' ? hoursPerDay - 1 : selectedHour + offset);
    });
  }
  const resize = new ResizeObserver(paint);
  for (const canvas of [chart, subwayChart]) resize.observe(canvas);
  const forcedColors = window.matchMedia('(forced-colors: active)');
  forcedColors.addEventListener('change', paint);

  return {
    select(next: TaxiArea | null) {
      if (selection?.id === next?.id) return;
      selection = next;
      if (next) render();
      else close(panel.contains(document.activeElement));
    },
  };
}
