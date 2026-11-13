import { septemberRangePicker } from './september-range-picker.ts';
import { parseTaxiData, taxiDateRange, taxiHourLabel, taxiSeries, TAXI_MONTH } from './taxi-data.ts';
import type { TaxiData } from './taxi-data.ts';
import { nearbyStations, parseSubwayData } from './subway-data.ts';
import type { SubwayData, SubwayStation } from './subway-data.ts';

const requestTimeout = 10_000;
const number = new Intl.NumberFormat('en-US');
const hoursPerDay = 24;
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

function dateLabel(value: string) {
  return date.format(new Date(`${value}T12:00:00Z`));
}

interface TaxiArea {
  id: number;
  name: string;
  center?: { longitude: number; latitude: number };
}

interface Dataset<T> {
  data?: T;
  pending: boolean;
  failed: boolean;
}

async function fetchDataset<T>(name: string, parse: (value: unknown) => T): Promise<T> {
  const request = new AbortController();
  const timer = setTimeout(() => request.abort(), requestTimeout);
  try {
    const response = await fetch(`/data/${name}-${TAXI_MONTH}.json`, {
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

function drawChart(chart: HTMLCanvasElement, counts: readonly (number | null)[], scale: number) {
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
  const dateRange = septemberRangePicker(panel, render);
  const results = find('#taxi-results'), total = find('#taxi-total'), chart = find<HTMLCanvasElement>('#taxi-chart');
  const scaleTop = find('#taxi-y-top'), scaleMiddle = find('#taxi-y-middle');
  const subwayStatus = find('#subway-status'), subwayRetry = find<HTMLButtonElement>('#subway-retry');
  const station = find<HTMLSelectElement>('#subway-station');
  const subwayTotal = find('#subway-total'), subwayCoverage = find('#subway-coverage');
  const taxiMetric = find('#taxi-metric'), subwayMetric = find('#subway-metric');
  const taxiFigure = find('#taxi-figure'), subwayFigure = find('#subway-figure');
  const subwayChart = find<HTMLCanvasElement>('#subway-chart');
  const subwayScaleTop = find('#subway-y-top'), subwayScaleMiddle = find('#subway-y-middle');
  const subwaySummary = find('#subway-chart-summary');
  const taxiColumn = find('#taxi-hour-column'), subwayColumn = find('#subway-hour-column');
  const day = find<HTMLSelectElement>('#taxi-chart-day');
  const summary = find('#taxi-chart-summary');
  const hours = find<HTMLDetailsElement>('#taxi-hours'), table = find('#taxi-hour-rows');
  function addDateOptions(select: HTMLSelectElement, first: string, last: string) {
    for (let index = Number(first.slice(-2)); index <= Number(last.slice(-2)); index++) {
      const value = `${TAXI_MONTH}-${String(index).padStart(2, '0')}`;
      select.add(new Option(dateLabel(value), value));
    }
  }

  let selection: TaxiArea | null = null;
  const taxi: Dataset<TaxiData> = { pending: false, failed: false };
  const subway: Dataset<SubwayData> = { pending: false, failed: false };
  const stations = new Map<number, SubwayStation>();
  function updateStations(data: SubwayData | undefined) {
    const previous = station.value;
    stations.clear();
    const nearby = data && selection?.center ? nearbyStations(data.stations, selection.center) : [];
    station.replaceChildren(new Option(data && !nearby.length ? 'No nearby stations' : 'Choose a nearby station', ''));
    for (const { station: item, distance } of nearby) {
      stations.set(item.id, item);
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
    station.value = stations.has(Number(previous)) ? previous : '';
  }
  let chartDateRange = '';
  let shown: {
    firstHour: number;
    taxi?: { counts: readonly number[]; scale: number };
    subway?: { counts: readonly (number | null)[]; scale: number };
  } | undefined;

  function paint() {
    if (panel.hidden || !shown) return;
    if (shown.taxi) drawChart(chart, shown.taxi.counts, shown.taxi.scale);
    if (shown.subway) drawChart(subwayChart, shown.subway.counts, shown.subway.scale);
  }

  function renderHours() {
    if (!shown || !hours.open) {
      table.replaceChildren();
      return;
    }
    const { firstHour } = shown;
    const rows = document.createDocumentFragment();
    for (let index = 0; index < hoursPerDay; index++) {
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = taxiHourLabel(firstHour + index);
      row.append(label);
      if (shown.taxi) {
        const count = document.createElement('td');
        count.textContent = number.format(shown.taxi.counts[index]);
        row.append(count);
      }
      if (shown.subway) {
        const value = shown.subway.counts[index];
        const count = document.createElement('td');
        count.textContent = value === null ? 'Missing or flagged' : number.format(value);
        row.append(count);
      }
      rows.append(row);
    }
    table.replaceChildren(rows);
  }

  function render() {
    if (panel.hidden || !selection) return;
    area.textContent = `${selection.name} · TLC ID ${selection.id}`;
    retry.hidden = !taxi.failed;
    const mismatchedRun = taxi.data && subway.data && taxi.data.runId !== subway.data.runId;
    station.disabled = !stations.size || taxi.pending || Boolean(mismatchedRun);
    subwayRetry.hidden = !subway.failed;
    subwayStatus.textContent = subway.pending ? 'Loading subway stations…'
      : mismatchedRun ? 'Subway data is unavailable for this September run.'
      : subway.data && taxi.pending ? 'Checking that both datasets are from the same September run…'
      : subway.failed ? 'Subway data could not load. Retry to try again.' : '';
    const { start, end } = dateRange.value;
    const range = taxiDateRange(start, end);
    const series = taxi.data && range ? taxiSeries(taxi.data, selection.id, range) : null;
    const selectedStation = station.disabled ? undefined : stations.get(Number(station.value));
    highlightStation(selectedStation ?? null);
    status.textContent = taxi.pending ? 'Loading taxi dropoffs…'
      : taxi.failed ? 'Taxi data could not load. Retry to try again.'
      : !series ? 'Taxi data is unavailable for this area.' : '';
    if (!range || (!series && !selectedStation)) {
      shown = undefined;
      results.hidden = true;
      total.textContent = '';
      subwayTotal.textContent = '';
      subwayCoverage.textContent = '';
      renderHours();
      return;
    }
    const nextChartDateRange = `${start}/${end}`;
    if (chartDateRange !== nextChartDateRange) {
      const previous = day.value;
      day.replaceChildren();
      addDateOptions(day, start, end);
      day.value = previous >= start && previous <= end ? previous : start;
      chartDateRange = nextChartDateRange;
    }
    const firstHour = (Number(day.value.slice(-2)) - 1) * hoursPerDay;
    shown = { firstHour };
    taxiMetric.hidden = taxiFigure.hidden = taxiColumn.hidden = !series;
    subwayMetric.hidden = subwayFigure.hidden = subwayColumn.hidden = !selectedStation;
    if (series) {
      const offset = firstHour - range.firstHour;
      const counts = series.counts.slice(offset, offset + hoursPerDay);
      const peak = Math.max(...counts);
      const scale = chartScale(peak);
      shown.taxi = { counts, scale };
      total.textContent = number.format(series.total);
      scaleTop.textContent = number.format(scale);
      scaleMiddle.textContent = number.format(scale / 2);
      summary.textContent = `${dateLabel(day.value)} · Peak ${number.format(peak)}/hour`;
    } else total.textContent = '';
    if (selectedStation) {
      const rangeCounts = selectedStation.counts.slice(range.firstHour, range.endHour);
      const comparable = rangeCounts.filter((count): count is number => count !== null);
      subwayTotal.textContent = comparable.length ? number.format(comparable.reduce((sum, value) => sum + value, 0)) : 'Unavailable';
      subwayCoverage.textContent = `${number.format(comparable.length)} of ${number.format(rangeCounts.length)} comparable hours`;
      const counts = selectedStation.counts.slice(firstHour, firstHour + hoursPerDay);
      const scale = chartScale(Math.max(0, ...counts.map(count => count ?? 0)));
      shown.subway = { counts, scale };
      subwayScaleTop.textContent = number.format(scale);
      subwayScaleMiddle.textContent = number.format(scale / 2);
      const gaps = counts.filter(count => count === null).length;
      subwaySummary.textContent = gaps
        ? `${dateLabel(day.value)} · ${gaps} of 24 hours missing or flagged. Gaps are blank.`
        : `${dateLabel(day.value)} · All 24 hours comparable.`;
    } else {
      subwayTotal.textContent = '';
      subwayCoverage.textContent = '';
    }
    results.hidden = false;
    renderHours();
    paint();
  }

  async function load<T>(dataset: Dataset<T>, request: () => Promise<T>, retryButton: HTMLElement, message: HTMLElement) {
    if (dataset.pending || dataset.data) return;
    dataset.pending = true;
    dataset.failed = false;
    const active = document.activeElement;
    const restoreStation = retryButton === retry && active === station;
    render();
    if (active === retryButton || restoreStation) message.focus({ preventScroll: true });
    try {
      dataset.data = await request();
    } catch {
      dataset.failed = true;
    } finally {
      dataset.pending = false;
      render();
      if (document.activeElement === message && !panel.hidden) {
        const next = restoreStation && !station.disabled ? station : dataset.failed ? retryButton : heading;
        next.focus({ preventScroll: true });
      }
    }
  }

  function loadTaxi() {
    return load(taxi, () => fetchDataset('yellow-taxi', parseTaxiData), retry, status);
  }

  function loadSubway() {
    return load(subway, async () => {
      const result = await fetchDataset('subway', parseSubwayData);
      updateStations(result);
      return result;
    }, subwayRetry, subwayStatus);
  }

  function close(restoreFocus: boolean) {
    if (panel.hidden) return;
    dateRange.close();
    panel.hidden = true;
    highlightStation(null);
    opener.setAttribute('aria-expanded', 'false');
    hours.open = false;
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
    if (!taxi.failed) void loadTaxi();
    if (!subway.failed) void loadSubway();
    render();
    heading.focus();
  });
  closer.addEventListener('click', () => close(true));
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    if (panel.querySelector('select:is(:open), dialog[open]')) return;
    event.preventDefault();
    close(true);
  });
  retry.addEventListener('click', () => { void loadTaxi(); });
  subwayRetry.addEventListener('click', () => { void loadSubway(); });
  for (const field of [day, station]) field.addEventListener('change', render);
  hours.addEventListener('toggle', renderHours);
  const resize = new ResizeObserver(paint);
  for (const canvas of [chart, subwayChart]) resize.observe(canvas);
  const forcedColors = window.matchMedia('(forced-colors: active)');
  forcedColors.addEventListener('change', paint);

  return {
    select(next: TaxiArea | null) {
      if (selection?.id === next?.id) return;
      selection = next;
      if (next) {
        updateStations(subway.data);
        render();
      }
      else close(panel.contains(document.activeElement));
    },
  };
}
