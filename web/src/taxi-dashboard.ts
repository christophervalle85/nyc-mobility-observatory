import { parseTaxiData, taxiDateRange, taxiHourLabel, taxiSeries, TAXI_END, TAXI_MONTH, TAXI_START } from './taxi-data.ts';
import type { TaxiData } from './taxi-data.ts';

const dataUrl = `/data/yellow-taxi-${TAXI_MONTH}.json`;
const requestTimeout = 10_000;
const number = new Intl.NumberFormat('en-US');
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

function dateLabel(value: string) {
  return date.format(new Date(`${value}T12:00:00Z`));
}

interface TaxiArea {
  id: number;
  name: string;
}

export function taxiDashboard(panel: HTMLElement, opener: HTMLButtonElement, fallback: HTMLElement) {
  const find = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const heading = find('#taxi-heading'), area = find('#taxi-area'), status = find('#taxi-status');
  const closer = find<HTMLButtonElement>('#taxi-close'), retry = find<HTMLButtonElement>('#taxi-retry');
  const start = find<HTMLInputElement>('#taxi-start'), end = find<HTMLInputElement>('#taxi-end');
  const results = find('#taxi-results'), total = find('#taxi-total'), chart = find<HTMLCanvasElement>('#taxi-chart');
  const scaleTop = find('#taxi-y-top'), scaleMiddle = find('#taxi-y-middle');
  const axisStart = find('#taxi-x-start'), axisEnd = find('#taxi-x-end'), summary = find('#taxi-chart-summary');
  const hours = find<HTMLDetailsElement>('#taxi-hours'), table = find('#taxi-hour-rows');
  const plot = chart.parentElement!;
  for (const field of [start, end]) {
    field.min = TAXI_START;
    field.max = TAXI_END;
    field.required = true;
  }
  start.value = TAXI_START;
  end.value = `${TAXI_MONTH}-07`;
  let selection: TaxiArea | null = null;
  let data: TaxiData | undefined;
  let pending = false, failed = false;
  let shown: { counts: readonly number[]; firstHour: number; scale: number } | undefined;

  function paint() {
    if (panel.hidden || !shown) return;
    const ctx = chart.getContext('2d');
    const { clientWidth: width, clientHeight: height } = chart;
    if (!ctx || !width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    chart.width = Math.round(width * dpr);
    chart.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    const { counts, scale } = shown;
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
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    counts.forEach((value, index) => {
      const x = 1 + index / (counts.length - 1) * (width - 2);
      const y = height - 1 - value / scale * (height - 2);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function renderHours() {
    if (!shown || !hours.open) {
      table.replaceChildren();
      return;
    }
    const { counts, firstHour } = shown;
    const rows = document.createDocumentFragment();
    for (const [index, value] of counts.entries()) {
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = taxiHourLabel(firstHour + index);
      const count = document.createElement('td');
      count.textContent = number.format(value);
      row.append(label, count);
      rows.append(row);
    }
    table.replaceChildren(rows);
  }

  function render() {
    if (panel.hidden || !selection) return;
    area.textContent = `${selection.name} · TLC ID ${selection.id}`;
    retry.hidden = !failed;
    const range = taxiDateRange(start.value, end.value);
    for (const field of [start, end]) {
      field.setAttribute('aria-invalid', String(!field.validity.valid || Boolean(start.value && end.value && start.value > end.value)));
    }
    const series = data && range ? taxiSeries(data, selection.id, range) : null;
    if (!series || !range) {
      shown = undefined;
      results.hidden = true;
      total.textContent = '';
      status.textContent = !range ? 'Choose a start and end date in September 2026, with the start on or before the end.'
        : pending ? 'Loading taxi dropoffs…'
        : failed ? 'Taxi data could not load. Retry to try again.'
        : 'Taxi data is unavailable for this area.';
      renderHours();
      return;
    }
    const peak = Math.max(...series.counts);
    const increment = Math.max(1, 10 ** Math.floor(Math.log10(peak || 1)) / 2);
    const scale = Math.max(2, Math.ceil(peak / (increment * 2)) * increment * 2);
    shown = { counts: series.counts, firstHour: range.firstHour, scale };
    status.textContent = '';
    results.hidden = false;
    total.textContent = number.format(series.total);
    scaleTop.textContent = number.format(scale);
    scaleMiddle.textContent = number.format(scale / 2);
    axisStart.textContent = dateLabel(start.value);
    axisEnd.textContent = dateLabel(end.value);
    const rangeLabel = start.value === end.value ? axisStart.textContent : `${axisStart.textContent}–${axisEnd.textContent}`;
    summary.textContent = `${rangeLabel} · ${number.format(series.counts.length)} hours · Peak ${number.format(peak)}/hour`;
    renderHours();
    paint();
  }

  async function load() {
    if (pending || data) return;
    pending = true;
    failed = false;
    const retryHadFocus = document.activeElement === retry;
    render();
    if (retryHadFocus) status.focus({ preventScroll: true });
    const request = new AbortController();
    const timer = setTimeout(() => request.abort(), requestTimeout);
    try {
      const response = await fetch(dataUrl, { signal: request.signal, mode: 'same-origin', redirect: 'error' });
      if (!response.ok) throw new Error('Taxi data unavailable');
      data = parseTaxiData(await response.json());
    } catch {
      failed = true;
    } finally {
      clearTimeout(timer);
      pending = false;
      render();
      if (document.activeElement === status && !panel.hidden) {
        (failed ? retry : heading).focus({ preventScroll: true });
      }
    }
  }

  function close(restoreFocus: boolean) {
    if (panel.hidden) return;
    panel.hidden = true;
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
    if (!data && !failed) void load();
    else render();
    heading.focus();
  });
  closer.addEventListener('click', () => close(true));
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    close(true);
  });
  retry.addEventListener('click', () => { void load(); });
  for (const field of [start, end]) field.addEventListener('input', render);
  hours.addEventListener('toggle', renderHours);
  new ResizeObserver(paint).observe(plot);
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
