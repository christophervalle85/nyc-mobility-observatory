import { buildMobilityRange } from './mobility-range.ts';
import type { MobilityMonthData } from './mobility-range.ts';
import { dailyTrend } from './daily-trend.ts';
import { monthRangePicker } from './month-range-picker.ts';
import { dateLabel, hoursPerDay, mobilityRunMatches, monthLabel, parseMobilityMonths, publishedClockChange } from './mobility-months.ts';
import type { ClockChange, MobilityMonth } from './mobility-months.ts';
import { hourLabel, parseTaxiData, taxiHourLabel } from './taxi-data.ts';
import type { TaxiData } from './taxi-data.ts';
import { nearbyStations, parseSubwayData } from './subway-data.ts';
import type { SubwayData, SubwayStation } from './subway-data.ts';
import { buildTypicalDay, typicalDayDates, typicalDayMinimum, typicalDayWeeks } from './typical-day.ts';
import type { TypicalDay } from './typical-day.ts';

const requestTimeout = 10_000;
const number = new Intl.NumberFormat('en-US');
const hourlyNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
const dateList = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' });
const typicalNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
function formatTypicalCount(count: number) {
  return count > 0 && count < 0.005 ? 'less than 0.01' : typicalNumber.format(count);
}

const weekdayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });

type Mode = 'taxi' | 'subway';
type HourlyBaseline = TypicalDay[Mode];

interface ChartSeries {
  counts: readonly (number | null)[];
  scale: number;
  typical?: HourlyBaseline;
}

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
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`, {
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

function drawChart(chart: HTMLCanvasElement, series: ChartSeries, activeHour: number) {
  const ctx = chart.getContext('2d');
  const { clientWidth: width, clientHeight: height } = chart;
  if (!ctx || !width || !height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  chart.width = Math.round(width * dpr);
  chart.height = Math.round(height * dpr);
  ctx.scale(dpr, dpr);
  const { counts, scale, typical } = series;
  const style = getComputedStyle(chart);
  const chartColor = style.color;
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
  if (!typical) return;
  ctx.beginPath();
  typical.counts.forEach((value, index) => {
    if (value === null) return;
    const x = (index + .5) * slot;
    const y = height - 1 - value / scale * (height - 2);
    if (typical.counts[index - 1] == null) ctx.moveTo(x - slot / 4, y);
    ctx.lineTo(x, y);
    if (typical.counts[index + 1] == null) ctx.lineTo(x + slot / 4, y);
  });
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = style.getPropertyValue('--color-city-idle');
  ctx.stroke();
  ctx.lineWidth = 1.75;
  ctx.strokeStyle = style.getPropertyValue('--color-city-ink');
  ctx.stroke();
}

export function taxiDashboard(panel: HTMLElement, opener: HTMLButtonElement, fallback: HTMLElement, highlightStation: (station: SubwayStation | null) => void) {
  const find = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const heading = find('#taxi-heading'), area = find('#taxi-area'), status = find('#taxi-status');
  const closer = find<HTMLButtonElement>('#taxi-close'), retry = find<HTMLButtonElement>('#taxi-retry');
  const dateRange = monthRangePicker(panel, loadRange);
  const trendSection = find('#mobility-trend');
  const clockExclusions = document.createElement('p');
  clockExclusions.id = 'mobility-clock-exclusions';
  clockExclusions.className = 'chart-coverage-note';
  clockExclusions.hidden = true;
  trendSection.before(clockExclusions);
  const trend = dailyTrend(trendSection, date => {
    day.value = date;
    selectedHour = 0;
    render();
  });
  const dayUnavailable = find('#mobility-day-unavailable');
  const statistics = find('.mobility-statistics');
  const trendTaxiLegend = find('#trend-taxi-legend'), trendSubwayLegend = find('#trend-subway-legend');
  const trendNote = find('.mobility-trend-note'), metrics = find('.transportation-totals');
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
  const taxiPeakLabel = find('#taxi-peak-stat dt'), subwayPeakLabel = find('#subway-peak-stat dt');
  const taxiDayTotal = find('#taxi-day-total'), taxiPeakHour = find('#taxi-peak-hour');
  const subwayDayTotal = find('#subway-day-total'), subwayPeakHour = find('#subway-peak-hour');
  const day = find<HTMLSelectElement>('#taxi-chart-day');
  const chartControls = find('.taxi-chart-controls'), chartHeading = find('.taxi-chart-controls h3');
  const typicalToggle = find<HTMLInputElement>('#typical-day');
  const typicalDetails = find('#typical-day-details'), typicalLegend = find('.typical-day-legend');
  const typicalStatus = find('#typical-day-status'), typicalRetry = find<HTMLButtonElement>('#typical-day-retry');
  const taxiTypicalValues = find('#taxi-typical-values'), subwayTypicalValues = find('#subway-typical-values');
  const currentHourLabel = find('#chart-hour-label');
  const hourTaxi = find('#chart-hour-taxi'), hourSubway = find('#chart-hour-subway');
  let selection: TaxiArea | null = null;
  const catalog: Dataset<MobilityMonth[]> = { failed: false };
  const taxi = new Map<string, Dataset<TaxiData>>();
  const subway = new Map<string, Dataset<SubwayData>>();
  let activeMonths: MobilityMonth[] = [];
  let typicalMonths: Record<Mode, MobilityMonth[]> = { taxi: [], subway: [] };
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
    clockChange?: ClockChange;
    taxi?: ChartSeries;
    subway?: ChartSeries;
  } | undefined;

  function paint() {
    if (panel.hidden || !shown) return;
    if (shown.taxi) drawChart(chart, shown.taxi, selectedHour);
    if (shown.subway) drawChart(subwayChart, shown.subway, selectedHour);
  }

  function renderTypicalHour(field: HTMLElement, series?: ChartSeries) {
    const baseline = series?.typical;
    field.hidden = !baseline;
    if (!series || !baseline) {
      field.textContent = '';
      return '';
    }
    const typical = baseline.counts[selectedHour];
    const actual = series.counts[selectedHour];
    const samples = baseline.samples[selectedHour];
    if (typical === null) {
      field.textContent = 'Typical count unavailable';
      return field.textContent;
    }
    const typicalText = formatTypicalCount(typical);
    const difference = actual === null ? null : actual - typical;
    let differenceText = `${typicalText} typical`;
    if (difference === 0) {
      differenceText = `Matches typical (${typicalText})`;
    } else if (difference !== null) {
      const amount = formatTypicalCount(Math.abs(difference));
      differenceText = `${amount} ${difference > 0 ? 'above' : 'below'} typical (${typicalText})`;
    }
    field.textContent = differenceText;
    return `${differenceText}, based on ${samples} matching days`;
  }

  function renderHour() {
    if (!shown) return;
    const firstHour = (Number(shown.date.slice(-2)) - 1) * hoursPerDay;
    const time = taxiHourLabel(shown.date.slice(0, 7), firstHour + selectedHour);
    const dropoffs = shown.taxi?.counts[selectedHour];
    const entries = shown.subway?.counts[selectedHour];
    const change = shown.clockChange?.hour === selectedHour ? shown.clockChange : undefined;
    const clockNote = change?.kind === 'nonexistent' ? 'Hour did not occur'
      : change?.kind === 'repeated' ? 'Repeated hour · source reports one count' : '';
    currentHourLabel.textContent = clockNote ? `${hourLabel(selectedHour)} ET · ${clockNote}` : `${hourLabel(selectedHour)} ET`;
    hourTaxi.textContent = dropoffs == null ? '' : hourlyNumber.format(dropoffs);
    hourSubway.textContent = entries === undefined || change?.kind === 'nonexistent' ? ''
      : entries === null ? 'Unavailable' : hourlyNumber.format(entries);
    hourSubway.toggleAttribute('data-unavailable', entries === null && change?.kind !== 'nonexistent');
    const details = [`${time} ET`];
    if (clockNote) details.push(clockNote);
    if (dropoffs != null) details.push(`Taxi dropoffs ${hourTaxi.textContent}`);
    if (entries !== undefined && change?.kind !== 'nonexistent') details.push(entries === null
      ? 'Subway entries missing or flagged' : `Estimated subway entries ${hourSubway.textContent}`);
    const taxiComparison = renderTypicalHour(taxiTypicalValues, shown.taxi);
    const subwayComparison = renderTypicalHour(subwayTypicalValues, shown.subway);
    if (taxiComparison) details.push(`Taxi ${taxiComparison}`);
    if (subwayComparison) details.push(`Subway ${subwayComparison}`);
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

  function resolvedMonth(entry: MobilityMonth) {
    const { month, taxiRunId, subwayRunId } = entry;
    const taxiMonth = taxi.get(month), subwayMonth = subway.get(month);
    const waitingForTaxi = entry.taxi && !taxiMonth?.data && !taxiMonth?.failed;
    const taxiData = taxiMonth?.data;
    const subwayData = subwayMonth?.data;
    const mismatch = Boolean(subwayData && !mobilityRunMatches(entry, 'subway', subwayData.runId, taxiData?.runId));
    const data = {
      taxi: taxiData, subway: mismatch || (waitingForTaxi && !subwayRunId) ? undefined : subwayData,
      taxiRunId, subwayRunId,
    };
    return { data, waitingForTaxi, mismatch };
  }

  function cancelUnusedRequests() {
    const active = new Set(activeMonths.map(entry => entry.month));
    for (const mode of ['taxi', 'subway'] as const) {
      const extra = new Set(typicalMonths[mode].map(entry => entry.month));
      const cache = mode === 'taxi' ? taxi : subway;
      for (const [month, dataset] of cache) {
        if (!dataset.request || active.has(month) || extra.has(month)) continue;
        dataset.request.abort();
        cache.delete(month);
      }
    }
  }

  function syncTypical(
    date: string, zoneId: number, stationId: number | null, hasTaxiPlot: boolean, hasSubwayPlot: boolean,
    dayIsTransition: boolean, monthData: ReadonlyMap<string, MobilityMonthData>,
  ): Partial<TypicalDay> | undefined {
    const enabled = typicalToggle.checked;
    const canCompare = enabled && !dayIsTransition && (hasTaxiPlot || hasSubwayPlot);
    const candidateMonths = canCompare ? new Set(typicalDayDates(date).map(candidate => candidate.slice(0, 7))) : new Set();
    const entries = catalog.data?.filter(entry => candidateMonths.has(entry.month)) ?? [];
    typicalMonths = {
      // Unbound subway needs the legacy same-run taxi check where both files are published.
      taxi: entries.filter(entry => entry.taxi && (hasTaxiPlot || (hasSubwayPlot && entry.subway && !entry.subwayRunId))),
      subway: entries.filter(entry => entry.subway && hasSubwayPlot),
    };
    cancelUnusedRequests();
    typicalDetails.toggleAttribute('data-inactive', !enabled);
    typicalLegend.hidden = !canCompare;
    if (!canCompare) {
      typicalRetry.hidden = true;
      typicalStatus.textContent = !enabled ? '' : dayIsTransition
        ? 'Typical day is unavailable on dates when the clock changes.'
        : 'No hourly plot is available for this comparison.';
      return;
    }

    const weekday = weekdayName.format(new Date(`${date}T00:00:00Z`));
    typicalLegend.textContent = `Median of up to ${typicalDayWeeks} prior ${weekday}s`;
    typicalLegend.title = `Each hour needs data from at least ${typicalDayMinimum} of those days.`;

    loadTaxi(typicalMonths.taxi.filter(entry => !monthData.has(entry.month) && !taxi.get(entry.month)?.failed), true);
    loadSubway(typicalMonths.subway.filter(entry => !monthData.has(entry.month) && !subway.get(entry.month)?.failed), true);
    const taxiFailures = typicalMonths.taxi.filter(entry => taxi.get(entry.month)?.failed);
    const subwayFailures = typicalMonths.subway.filter(entry => subway.get(entry.month)?.failed);
    const hasFailure = taxiFailures.length > 0 || subwayFailures.length > 0;
    typicalRetry.hidden = ![...taxiFailures, ...subwayFailures].some(entry => !monthData.has(entry.month));
    const taxiPending = hasTaxiPlot && typicalMonths.taxi.some(entry => !taxi.get(entry.month)?.data && !taxi.get(entry.month)?.failed);
    const subwayPending = typicalMonths.subway.some(entry => {
      const dataset = subway.get(entry.month);
      return (!dataset?.data && !dataset?.failed) || (!entry.subwayRunId && resolvedMonth(entry).waitingForTaxi);
    });
    const hasPending = taxiPending || subwayPending;
    const history = new Map<string, MobilityMonthData>();
    const targetMonth = date.slice(0, 7);
    const target = monthData.get(targetMonth);
    if (target) history.set(targetMonth, target);
    let hasMismatch = false;
    for (const entry of entries) {
      const { data, mismatch } = resolvedMonth(entry);
      const needsLegacyPair = entry.taxi && entry.subway && !entry.subwayRunId;
      if (needsLegacyPair && !data.taxi) data.subway = undefined;
      hasMismatch ||= hasSubwayPlot && mismatch;
      history.set(entry.month, data);
    }
    const baseline = buildTypicalDay({ date, zoneId, stationId, months: history });
    const hasHistory = (hasTaxiPlot && baseline.taxi.counts.some(value => value !== null))
      || (hasSubwayPlot && baseline.subway.counts.some(value => value !== null));
    typicalStatus.textContent = hasPending ? 'Loading typical day data…' : hasFailure ? 'Some typical day data could not load.'
      : hasMismatch ? 'Some typical day data could not be verified.'
      : hasHistory ? '' : `Typical day needs at least ${typicalDayMinimum} matching days per hour.`;
    return { taxi: taxiPending ? undefined : baseline.taxi, subway: subwayPending ? undefined : baseline.subway };
  }

  function render() {
    if (panel.hidden || !selection) return;
    area.textContent = `${selection.name} · TLC ID ${selection.id}`;
    monthRetry.hidden = !catalog.failed;
    monthStatus.textContent = catalog.failed ? 'Available months could not load. Retry to try again.'
      : catalog.request ? 'Loading available months…' : '';
    if (!catalog.data) return;
    const { start, end } = dateRange.value;
    const monthData = new Map<string, MobilityMonthData>();
    const roster = new Map<number, SubwayStation>();
    let taxiPending = false, subwayPending = false, taxiFailed = false, subwayFailed = false;
    let mismatch: string | undefined;
    for (const entry of activeMonths) {
      const { month, subway: hasSubway } = entry;
      const taxiMonth = taxi.get(month);
      const subwayMonth = subway.get(month);
      const monthly = resolvedMonth(entry);
      const { data, waitingForTaxi } = monthly;
      taxiPending ||= waitingForTaxi;
      subwayPending ||= hasSubway && !subwayMonth?.data && !subwayMonth?.failed;
      taxiFailed ||= Boolean(taxiMonth?.failed);
      subwayFailed ||= Boolean(subwayMonth?.failed);
      if (monthly.mismatch) mismatch = month;
      // Prefer the newest validated record for each station in the picker.
      for (const item of data.subway?.stations ?? []) if (!roster.has(item.id)) roster.set(item.id, item);
      monthData.set(month, data);
    }
    updateStations([...roster.values()], subwayPending || taxiPending || subwayFailed || Boolean(mismatch));
    station.disabled = !stations.size;
    retry.hidden = !taxiFailed;
    subwayRetry.hidden = !subwayFailed && !mismatch;
    status.textContent = taxiPending ? 'Loading taxi dropoffs…'
      : taxiFailed ? 'Some taxi data could not load. Retry to try again.'
      : !activeMonths.some(entry => entry.taxi) ? 'Taxi data unavailable' : '';
    subwayStatus.textContent = subwayPending ? 'Loading subway stations…'
      : mismatch ? `Subway data is unavailable for this ${monthLabel(mismatch, false)} run.`
      : subwayFailed ? 'Some subway data could not load. Retry to try again.'
      : !activeMonths.some(entry => entry.subway) ? 'Subway data is unavailable for this range.' : '';
    const selectedStation = stations.get(Number(selectedStationId));
    const range = buildMobilityRange({ start, end, zoneId: selection.id, stationId: selectedStation?.id ?? null, months: monthData });
    const excluded = range?.days.filter(item => item.clockChange).map(item => dateLabel(item.date, 'full')) ?? [];
    if (!range || (range.taxi.total === null && !excluded.length && !selectedStation
      && ![...monthData.values()].some(value => value.subway))) {
      typicalMonths = { taxi: [], subway: [] };
      cancelUnusedRequests();
      shown = undefined;
      results.hidden = true;
      for (const field of [total, subwayTotal, taxiCoverage, subwayCoverage]) field.textContent = '';
      highlightStation(null);
      return;
    }
    const nextChartDateRange = `${start}/${end}`;
    if (chartDateRange !== nextChartDateRange) {
      day.replaceChildren(...range.days.map(({ date }) => new Option(dateLabel(date, 'full'), date)));
      day.value = start;
      selectedHour = 0;
      chartDateRange = nextChartDateRange;
    }
    const current = range.days.find(item => item.date === day.value)!;
    const { clockChange } = current;
    const taxiDay = current.recorded?.taxi ?? current.taxi;
    const subwayDay = current.recorded?.subway ?? current.subway;
    const taxiShown = taxiDay.total !== null;
    const subwayShown = subwayDay.total !== null;
    const typical = syncTypical(day.value, selection.id, selectedStation?.id ?? null, taxiShown, subwayShown,
      Boolean(clockChange), monthData);
    chartHeading.textContent = clockChange ? 'Recorded hourly counts' : 'Hourly comparison';
    taxiPeakLabel.textContent = clockChange ? 'Peak recorded taxi slot' : 'Busiest taxi hour';
    subwayPeakLabel.textContent = clockChange ? 'Peak recorded subway slot' : 'Busiest subway hour';
    for (const canvas of [chart, subwayChart]) {
      if (clockChange) canvas.setAttribute('aria-describedby', dayUnavailable.id);
      else canvas.removeAttribute('aria-describedby');
    }
    highlightStation(monthData.get(day.value.slice(0, 7))?.subway?.stations.find(item => item.id === selectedStation?.id) ?? null);
    const hasTaxiTrend = range.taxi.total !== null;
    const hasSubwayTrend = range.subway.total !== null;
    const hasTrend = hasTaxiTrend || hasSubwayTrend;
    const hasHourlyData = hasTrend || range.days.some(({ recorded }) =>
      recorded?.taxi.total != null || recorded?.subway.total != null);
    trendSection.hidden = !hasTrend;
    if (hasTrend) {
      trendTaxiLegend.hidden = !hasTaxiTrend;
      trendSubwayLegend.hidden = !hasSubwayTrend;
      trendNote.textContent = [
        'Select a day for hourly detail.',
        hasTaxiTrend && hasSubwayTrend ? 'The two series have separate scales.' : '',
        range.days.some(item => item.subway.total !== null && item.subway.partial) ? 'Dashed bars indicate partial data.' : '',
      ].filter(Boolean).join(' ');
      trend.render(range.days.map(item => ({
        date: item.date, taxi: item.taxi.total, subway: item.subway.total, subwayPartial: item.subway.partial,
        excluded: Boolean(item.clockChange),
      })), day.value);
    }
    chartControls.hidden = !hasHourlyData;
    shown = { date: day.value, clockChange };
    statisticsDate.textContent = `${dateLabel(day.value)} · ET`;
    statistics.hidden = !taxiShown && !subwayShown;
    currentHourLabel.hidden = !taxiShown && !subwayShown;
    taxiDayStat.hidden = taxiPeakStat.hidden = taxiFigure.hidden = !taxiShown;
    subwayDayStat.hidden = subwayPeakStat.hidden = subwayFigure.hidden = !subwayShown;
    taxiMetric.hidden = range.taxi.total === null && !(excluded.length && activeMonths.some(entry => entry.taxi));
    subwayMetric.hidden = !selectedStation;
    metrics.hidden = taxiMetric.hidden && subwayMetric.hidden;
    total.textContent = range.taxi.total === null
      ? taxiMetric.hidden ? '' : 'Unavailable' : number.format(range.taxi.total);
    taxiCoverage.textContent = `${range.taxi.availableDays} of ${range.days.length - excluded.length} days covered`;
    subwayTotal.textContent = range.subway.total === null ? 'Unavailable' : number.format(range.subway.total);
    const subwayCoverageUnit = excluded.length ? 'comparable clock slots' : 'comparable hours';
    subwayCoverage.textContent = `${number.format(range.subway.observedHours)} of ${number.format(range.subway.expectedHours)} ${subwayCoverageUnit}`;
    clockExclusions.hidden = !excluded.length;
    clockExclusions.textContent = excluded.length
      ? `${dateList.format(excluded)} ${excluded.length === 1 ? 'is' : 'are'} excluded from comparison totals and coverage.`
      : '';
    if (taxiShown) {
      const peak = Math.max(0, ...taxiDay.counts.map(value => value ?? 0));
      const baseline = typical?.taxi;
      const scale = chartScale(Math.max(peak, ...(baseline?.counts.map(value => value ?? 0) ?? [])));
      shown.taxi = { counts: taxiDay.counts, scale, typical: baseline };
      scaleTop.textContent = number.format(scale);
      scaleMiddle.textContent = number.format(scale / 2);
      taxiDayTotal.textContent = number.format(taxiDay.total!);
      taxiPeakHour.textContent = busiestHour(taxiDay.counts, peak);
    }
    if (subwayShown) {
      const peak = Math.max(0, ...subwayDay.counts.map(value => value ?? 0));
      const baseline = typical?.subway;
      const scale = chartScale(Math.max(peak, ...(baseline?.counts.map(value => value ?? 0) ?? [])));
      shown.subway = { counts: subwayDay.counts, scale, typical: baseline };
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
    const clockContext = clockChange?.kind === 'nonexistent' ? 'The 2 AM hour did not occur.'
      : clockChange?.kind === 'repeated' ? 'The sources report one count per mode for the repeated 1 AM hour.' : '';
    const recordedContext = clockChange && (taxiShown || subwayShown) ? 'Recorded counts for this day.' : '';
    dayUnavailable.hidden = !clockContext && (!hasHourlyData || !unavailable);
    dayUnavailable.textContent = [recordedContext, clockContext, unavailable].filter(Boolean).join(' ');
    results.hidden = !hasHourlyData && metrics.hidden && clockExclusions.hidden;
    renderHour();
  }

  async function load<T>(
    dataset: Dataset<T>, fetchData: (request: AbortController) => Promise<T>,
    retryButton: HTMLElement, message: HTMLElement, isCurrent: () => boolean,
    ready?: (data: T) => void,
    background = false,
  ) {
    if (dataset.request || dataset.data) return;
    const request = new AbortController();
    dataset.request = request;
    dataset.failed = false;
    const active = document.activeElement;
    const restoreStation = retryButton === retry && active === station;
    if (!background) {
      render();
      if (active === retryButton || restoreStation) message.focus({ preventScroll: true });
    }
    const data = await fetchData(request).catch(() => undefined);
    dataset.request = undefined;
    if (!isCurrent()) return;
    dataset.data = data;
    dataset.failed = data === undefined;
    if (data !== undefined) ready?.(data);
    render();
    if (!background && document.activeElement === message && !panel.hidden && (dataset === catalog || !activeMonths.some(({ month }) =>
      (retryButton === retry ? taxi.get(month) : subway.get(month))?.request))) {
      const next = restoreStation && !station.disabled ? station : dataset.failed ? retryButton : heading;
      next.focus({ preventScroll: true });
    }
  }

  function loadMonthly<T extends { runId: string; clockChange?: ClockChange }>(
    cache: Map<string, Dataset<T>>, mode: Mode, file: string,
    parser: (value: unknown, month: string) => T, retryButton: HTMLElement, message: HTMLElement,
    entries: readonly MobilityMonth[], background: boolean,
  ) {
    for (const entry of entries) {
      if (!entry[mode]) continue;
      const { month } = entry;
      const dataset = cache.get(month) ?? { failed: false };
      cache.set(month, dataset);
      void load(dataset, request => fetchDataset(`data/${file}-${month}.json`, value => {
        const data = parser(value, month);
        if (!mobilityRunMatches(entry, mode, data.runId)) throw new Error('Unexpected monthly run');
        if (publishedClockChange(month, entry) && !data.clockChange) throw new Error('Missing monthly clock change');
        return data;
      }, request),
        retryButton, message, () => cache.get(month) === dataset, undefined, background);
    }
  }

  function loadTaxi(entries = activeMonths, background = false) {
    loadMonthly(taxi, 'taxi', 'yellow-taxi', parseTaxiData, retry, status, entries, background);
  }

  function loadSubway(entries = activeMonths, background = false) {
    loadMonthly(subway, 'subway', 'subway', parseSubwayData, subwayRetry, subwayStatus, entries, background);
  }

  function loadRange() {
    if (!catalog.data) return;
    const { start, end } = dateRange.value;
    activeMonths = catalog.data.filter(entry => entry.month >= start.slice(0, 7) && entry.month <= end.slice(0, 7));
    const taxiMonths = activeMonths.filter(entry => entry.taxi);
    coverage.hidden = !taxiMonths.length;
    const files = taxiMonths.length === 1 ? `the ${monthLabel(taxiMonths[0].month)} pickup file` : 'each month’s pickup file';
    coverage.textContent = `Taxi data uses ${files}. Dropoffs from trips in adjacent pickup files are excluded.`;
    subwayDataNote.hidden = !activeMonths.some(entry => entry.subway);
    loadTaxi();
    loadSubway();
    render();
    cancelUnusedRequests();
  }

  function loadMonths() {
    void load(catalog, request => fetchDataset('data/mobility-months.json', parseMobilityMonths, request),
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
    typicalToggle.checked = false;
    typicalMonths = { taxi: [], subway: [] };
    cancelUnusedRequests();
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
    for (const entry of activeMonths) {
      const { month } = entry;
      const taxiData = taxi.get(month)?.data;
      const subwayData = subway.get(month)?.data;
      if (!taxiData || !subwayData || mobilityRunMatches(entry, 'subway', subwayData.runId, taxiData.runId)) continue;
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
  typicalToggle.addEventListener('change', render);
  typicalRetry.addEventListener('click', () => {
    const active = new Set(activeMonths.map(entry => entry.month));
    for (const mode of ['taxi', 'subway'] as const) {
      const cache = mode === 'taxi' ? taxi : subway;
      for (const { month } of typicalMonths[mode]) {
        if (!active.has(month) && cache.get(month)?.failed) cache.delete(month);
      }
    }
    typicalToggle.focus({ preventScroll: true });
    render();
  });
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
