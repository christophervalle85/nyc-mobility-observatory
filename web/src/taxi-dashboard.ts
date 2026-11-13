import { monthRangePicker } from './month-range-picker.ts';
import { dateLabel, hoursPerDay, monthDate, monthLabel, parseMobilityMonths } from './mobility-months.ts';
import type { MobilityMonth } from './mobility-months.ts';
import { hourLabel, parseTaxiData, taxiDateRange, taxiHourLabel, taxiSeries } from './taxi-data.ts';
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
  const dateRange = monthRangePicker(panel, month => {
    const next = catalog.data?.find(entry => entry.month === month);
    if (next && next !== activeMonth) switchMonth(next);
    else render();
  });
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
  function addDateOptions(select: HTMLSelectElement, first: string, last: string) {
    for (let index = Number(first.slice(-2)); index <= Number(last.slice(-2)); index++) {
      const value = monthDate(first.slice(0, 7), index);
      select.add(new Option(dateLabel(value), value));
    }
  }

  let selection: TaxiArea | null = null;
  const catalog: Dataset<MobilityMonth[]> = { failed: false };
  let activeMonth: MobilityMonth | undefined;
  let taxi: Dataset<TaxiData> = { failed: false };
  let subway: Dataset<SubwayData> = { failed: false };
  let selectedStationId = '';
  const stations = new Map<number, SubwayStation>();
  function updateStations(data: SubwayData | undefined) {
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
    if (data && !stations.has(Number(selectedStationId))) selectedStationId = '';
    station.value = stations.has(Number(selectedStationId)) ? selectedStationId : '';
  }
  let chartDateRange = '';
  let selectedHour = 0;
  let shown: {
    firstHour: number;
    taxi?: { counts: readonly number[]; scale: number };
    subway?: { counts: readonly (number | null)[]; scale: number };
  } | undefined;

  function paint() {
    if (panel.hidden || !shown) return;
    if (shown.taxi) drawChart(chart, shown.taxi.counts, shown.taxi.scale, selectedHour);
    if (shown.subway) drawChart(subwayChart, shown.subway.counts, shown.subway.scale, selectedHour);
  }

  function renderHour() {
    if (!shown || !activeMonth) return;
    const time = taxiHourLabel(activeMonth.month, shown.firstHour + selectedHour);
    const dropoffs = shown.taxi?.counts[selectedHour];
    const entries = shown.subway?.counts[selectedHour];
    currentHourLabel.textContent = `${hourLabel(selectedHour)} ET`;
    hourTaxi.textContent = dropoffs === undefined ? '' : hourlyNumber.format(dropoffs);
    hourSubway.textContent = entries === undefined ? '' : entries === null ? 'Unavailable' : hourlyNumber.format(entries);
    hourSubway.toggleAttribute('data-unavailable', entries === null);
    const details = [`${time} ET`];
    if (dropoffs !== undefined) details.push(`Taxi dropoffs ${hourTaxi.textContent}`);
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
    if (!activeMonth) return;
    const label = monthLabel(activeMonth.month);
    retry.hidden = !taxi.failed;
    const mismatchedRun = taxi.data && subway.data && taxi.data.runId !== subway.data.runId;
    station.disabled = !stations.size || Boolean(taxi.request || mismatchedRun);
    subwayRetry.hidden = !subway.failed;
    const monthName = monthLabel(activeMonth.month, false);
    subwayStatus.textContent = !activeMonth.subway ? `Subway data is unavailable for ${label}.`
      : subway.request ? 'Loading subway stations…'
      : mismatchedRun ? `Subway data is unavailable for this ${monthName} run.`
      : subway.data && taxi.request ? `Checking that both datasets are from the same ${monthName} run…`
      : subway.failed ? 'Subway data could not load. Retry to try again.' : '';
    const { start, end } = dateRange.value;
    const range = taxiDateRange(start, end);
    const series = taxi.data && range ? taxiSeries(taxi.data, selection.id, range) : null;
    const selectedStation = station.disabled ? undefined : stations.get(Number(station.value));
    highlightStation(selectedStation ?? null);
    status.textContent = !activeMonth.taxi ? `Taxi data is unavailable for ${label}.`
      : taxi.request ? 'Loading taxi dropoffs…'
      : taxi.failed ? 'Taxi data could not load. Retry to try again.'
      : !series ? 'Taxi data is unavailable for this area.' : '';
    if (!range || (!series && !selectedStation)) {
      shown = undefined;
      results.hidden = true;
      total.textContent = '';
      subwayTotal.textContent = '';
      subwayCoverage.textContent = '';
      return;
    }
    const nextChartDateRange = `${start}/${end}`;
    if (chartDateRange !== nextChartDateRange) {
      const previous = day.value;
      day.replaceChildren();
      addDateOptions(day, start, end);
      day.value = previous >= start && previous <= end ? previous : start;
      if (day.value !== previous) selectedHour = 0;
      chartDateRange = nextChartDateRange;
    }
    const firstHour = (Number(day.value.slice(-2)) - 1) * hoursPerDay;
    shown = { firstHour };
    statisticsDate.textContent = `${dateLabel(day.value)} · ET`;
    taxiDayStat.hidden = taxiPeakStat.hidden = !series;
    subwayDayStat.hidden = subwayPeakStat.hidden = !selectedStation;
    taxiMetric.hidden = taxiFigure.hidden = !series;
    subwayMetric.hidden = subwayFigure.hidden = !selectedStation;
    if (series) {
      const offset = firstHour - range.firstHour;
      const counts = series.counts.slice(offset, offset + hoursPerDay);
      const peak = Math.max(...counts);
      const scale = chartScale(peak);
      shown.taxi = { counts, scale };
      total.textContent = number.format(series.total);
      scaleTop.textContent = number.format(scale);
      scaleMiddle.textContent = number.format(scale / 2);
      taxiDayTotal.textContent = number.format(counts.reduce((sum, count) => sum + count, 0));
      taxiPeakHour.textContent = busiestHour(counts, peak);
    } else total.textContent = '';
    if (selectedStation) {
      const rangeCounts = selectedStation.counts.slice(range.firstHour, range.endHour);
      const comparable = rangeCounts.filter((count): count is number => count !== null);
      subwayTotal.textContent = comparable.length ? number.format(comparable.reduce((sum, value) => sum + value, 0)) : 'Unavailable';
      subwayCoverage.textContent = `${number.format(comparable.length)} of ${number.format(rangeCounts.length)} comparable hours`;
      const counts = selectedStation.counts.slice(firstHour, firstHour + hoursPerDay);
      const dayCounts = counts.filter((count): count is number => count !== null);
      const peak = Math.max(0, ...dayCounts);
      const scale = chartScale(peak);
      shown.subway = { counts, scale };
      subwayScaleTop.textContent = number.format(scale);
      subwayScaleMiddle.textContent = number.format(scale / 2);
      const gaps = counts.length - dayCounts.length;
      subwayGaps.hidden = gaps === 0;
      subwayGaps.textContent = gaps === 1 ? '1 hour missing or flagged.' : `${gaps} hours missing or flagged.`;
      subwayDayTotal.textContent = dayCounts.length
        ? hourlyNumber.format(dayCounts.reduce((sum, count) => sum + count, 0)) : 'Unavailable';
      subwayPeakHour.textContent = busiestHour(counts, peak);
    } else {
      subwayTotal.textContent = '';
      subwayCoverage.textContent = '';
    }
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
    if (document.activeElement === message && !panel.hidden) {
      const next = restoreStation && !station.disabled ? station : dataset.failed ? retryButton : heading;
      next.focus({ preventScroll: true });
    }
  }

  function loadTaxi() {
    if (!activeMonth?.taxi) return;
    const dataset = taxi, { month } = activeMonth;
    return load(dataset, request => fetchDataset(`/data/yellow-taxi-${month}.json`, value => parseTaxiData(value, month), request),
      retry, status, () => dataset === taxi);
  }

  function loadSubway() {
    if (!activeMonth?.subway) return;
    const dataset = subway, { month } = activeMonth;
    return load(dataset, request => fetchDataset(`/data/subway-${month}.json`, value => parseSubwayData(value, month), request),
      subwayRetry, subwayStatus, () => dataset === subway, updateStations);
  }

  function switchMonth(month: MobilityMonth) {
    if (activeMonth === month) return;
    taxi.request?.abort();
    subway.request?.abort();
    taxi = { failed: false };
    subway = { failed: false };
    activeMonth = month;
    selectedHour = 0;
    day.replaceChildren();
    chartDateRange = '';
    updateStations(undefined);
    highlightStation(null);
    coverage.hidden = !month.taxi;
    coverage.textContent = `Taxi dropoffs come from the ${monthLabel(month.month)} yellow taxi file. Trips from adjacent pickup-month files are excluded.`;
    subwayDataNote.hidden = !month.subway;
    void loadTaxi();
    void loadSubway();
    render();
  }

  function loadMonths() {
    void load(catalog, request => fetchDataset('/data/mobility-months.json', parseMobilityMonths, request),
      monthRetry, monthStatus, () => true, months => {
        dateRange.setMonths(months.map(entry => entry.month));
        switchMonth(months[0]);
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
  subwayRetry.addEventListener('click', () => { void loadSubway(); });
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
      if (next) {
        updateStations(subway.data);
        render();
      }
      else close(panel.contains(document.activeElement));
    },
  };
}
