import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const datasetPath = '/data/yellow-taxi-2026-09.json';

async function openTaxiDashboard(page: Page) {
  await page.getByRole('button', { name: 'Mobility data', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transportation data' })).toBeVisible();
}

async function selectArea(page: Page, id: string, name: RegExp) {
  await page.getByRole('combobox', { name: 'Search areas' }).fill(id);
  await page.getByRole('option', { name }).click();
  await expect(page.locator('#zone-id')).toHaveText(id);
}

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5175'
    ? route.continue()
    : route.abort('blockedbyclient'));
});

test('Flatiron shows real September taxi dropoffs for the default range', async ({ page }) => {
  const dataRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === datasetPath) dataRequests.push(request.method());
  });
  await page.goto('/?mode=mock&zone=90');
  await expect(page.locator('#selection-title')).toHaveText('Flatiron');
  await expect(page.getByRole('heading', { name: 'Transportation data' })).toBeHidden();
  expect(dataRequests).toEqual([]);
  await openTaxiDashboard(page);
  await expect(page.getByRole('button', { name: 'Start date Sep 1, 2026' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End date Sep 7, 2026' })).toBeVisible();
  // Golden values come from the archived M1 taxi/zone_hour.csv for run 0566a3a0.
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
  await expect(page.getByRole('heading', { name: 'Transportation data' })).toBeFocused();
  const panel = page.locator('#taxi-dashboard');
  await expect(panel).toHaveCSS('width', '416px');
  const chart = page.locator('#taxi-chart');
  await expect(chart).toBeVisible();
  expect(await chart.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return false;
    for (let offset = 4; offset < pixels.length; offset += 4) {
      if (pixels[offset] !== pixels[0] || pixels[offset + 1] !== pixels[1]
        || pixels[offset + 2] !== pixels[2] || pixels[offset + 3] !== pixels[3]) return true;
    }
    return false;
  })).toBe(true);
  expect(dataRequests).toEqual(['GET']);
});

test('interactive hours follow the chart date and selected area', async ({ page }) => {
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  const calendar = page.getByRole('dialog', { name: 'September 2026' });
  await page.getByRole('button', { name: /End date/ }).click();
  await calendar.getByRole('button', { name: 'September 8', exact: true }).click();
  await page.getByRole('button', { name: /Start date/ }).click();
  await calendar.getByRole('button', { name: 'September 7', exact: true }).click();
  await expect(page.locator('#taxi-total')).toHaveText('2,848');

  const taxiChart = page.getByRole('slider', { name: 'Hourly taxi dropoffs' });
  const time = page.locator('#chart-hour-label');
  const taxiValue = page.locator('#taxi-figure figcaption #chart-hour-taxi');
  await expect(time).toHaveText('12:00 AM ET');
  await expect(taxiValue).toHaveText('72');
  const chartDate = page.getByLabel('Chart date');
  await expect(chartDate.locator('option')).toHaveCount(2);
  await chartDate.selectOption('2026-09-08');
  await taxiChart.press('End');
  await expect(time).toHaveText('11:00 PM ET');
  await expect(taxiValue).toHaveText('45');
  await expect(page.locator('#taxi-total')).toHaveText('2,848');
  await chartDate.selectOption('2026-09-07');

  await selectArea(page, '79', /East Village/);
  await expect(page.getByRole('heading', { name: 'Transportation data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start date Sep 7, 2026' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End date Sep 8, 2026' })).toBeVisible();
  await expect(page.locator('#taxi-total')).toHaveText('4,175');
  await expect(taxiValue).toHaveText('164');
  await taxiChart.press('End');
  await expect(taxiValue).toHaveText('90');

  await selectArea(page, '110', /Great Kills Park/);
  await expect(page.locator('#taxi-total')).toHaveText('0');
  await expect(taxiValue).toHaveText('0');
  await expect(page.getByText('Hourly counts', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Close area details' }).click();
  await expect(page.getByRole('heading', { name: 'Transportation data' })).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Search areas' })).toBeFocused();
});

test('the date menu stays anchored to its chart field and Escape closes only the menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
  const day = page.getByLabel('Chart date');
  test.skip(!await day.evaluate(() => CSS.supports('appearance: base-select') && CSS.supports('selector(::picker(select))')),
    'This browser uses the native menu');
  await day.click();
  const row = day.locator('option:checked');
  await expect(row).toBeVisible();
  const fieldBounds = (await day.boundingBox())!;
  const rowBounds = (await row.boundingBox())!;
  expect(rowBounds.y >= fieldBounds.y + fieldBounds.height || rowBounds.y + rowBounds.height <= fieldBounds.y).toBe(true);
  expect(Math.abs(rowBounds.x + rowBounds.width - fieldBounds.x - fieldBounds.width)).toBeLessThan(7);
  await page.keyboard.press('Escape');
  await expect(page.locator('#taxi-chart-day:open')).toHaveCount(0);
  await expect(page.locator('#taxi-dashboard')).toBeVisible();
});

test('separate calendars constrain endpoints, support keyboard, and update a one-day range', async ({ page }) => {
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  const start = page.getByRole('button', { name: /Start date/ });
  const end = page.getByRole('button', { name: /End date/ });
  const calendar = page.getByRole('dialog', { name: 'September 2026' });
  const total = page.locator('#taxi-total');
  await expect(start).toBeEnabled();
  await start.press('Enter');
  await expect(calendar.getByRole('button', { name: 'September 1', exact: true })).toBeFocused();
  await expect(calendar.getByRole('button', { name: 'September 8', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(start).toBeFocused();
  await expect(total).toHaveText('9,919');
  await end.click();
  const endBounds = (await end.boundingBox())!;
  const calendarBounds = (await calendar.boundingBox())!;
  expect(calendarBounds.y).toBeGreaterThanOrEqual(endBounds.y + endBounds.height);
  await calendar.getByRole('button', { name: 'September 30', exact: true }).click();
  await start.click();
  await calendar.getByRole('button', { name: 'September 30', exact: true }).press('Space');
  await expect(start).toHaveText('Sep 30, 2026');
  await expect(total).toHaveText('1,696');
  await expect(page.getByLabel('Chart date')).toHaveValue('2026-09-30');
  await end.click();
  await expect(calendar.getByRole('button', { name: 'September 29', exact: true })).toBeDisabled();
  await end.click();
  await expect(calendar).toBeHidden();
  await end.click();
  await page.keyboard.press('Tab');
  await expect(calendar).toBeHidden();
});

test('pending taxi data updates the current area after loading', async ({ context, page }) => {
  let releaseData!: () => void;
  const pendingData = new Promise<void>(resolve => { releaseData = resolve; });
  await context.route(`**${datasetPath}`, async route => {
    await pendingData;
    await route.continue();
  });
  try {
    await page.goto('/?mode=mock&zone=90');
    await openTaxiDashboard(page);
    await expect(page.locator('#taxi-status')).toHaveText(/loading/i);
    await expect(page.locator('#taxi-total')).not.toHaveText(/\d/);
    await selectArea(page, '79', /East Village/);
    releaseData();
    await expect(page.locator('#taxi-total')).toHaveText('17,090');
  } finally {
    releaseData();
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

for (const unavailable of ['missing', 'invalid']) {
  test(`${unavailable} taxi data leaves the map and area search usable`, async ({ context, page }) => {
    await context.route(`**${datasetPath}`, route => unavailable === 'missing'
      ? route.fulfill({ status: 404, body: 'Not found' })
      : route.fulfill({ json: { version: 1, month: '2026-09' } }));
    await page.goto('/?mode=mock&zone=90');
    await openTaxiDashboard(page);
    await expect(page.locator('#taxi-status')).toHaveText(/unavailable|could not load/i);
    await expect(page.locator('#taxi-total')).not.toHaveText(/\d/);
    await selectArea(page, '79', /East Village/);
    await expect(page.locator('#selection-title')).toHaveText('East Village');
    await expect(page.getByRole('heading', { name: 'Transportation data' })).toBeVisible();
    await page.getByRole('button', { name: 'Show all NYC' }).click();
    await page.getByRole('button', { name: 'Close transportation dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Transportation data' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Mobility data', exact: true })).toBeFocused();
  });
}

for (const [width, height] of [[320, 568], [390, 844], [1280, 720]]) {
  test(`the taxi dashboard keeps credits and map controls visible at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/?mode=mock&zone=90');
    await openTaxiDashboard(page);
    await expect(page.locator('#taxi-total')).toHaveText('9,919');
    await expect(page.locator('#credits')).toBeInViewport();
    await expect(page.getByRole('button', { name: /Start date/ })).toBeInViewport();
    await expect(page.getByRole('button', { name: /End date/ })).toBeInViewport();
    const overview = page.getByRole('button', { name: 'Show all NYC' });
    await expect(overview).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Close transportation dashboard' }).click({ trial: true });
    await overview.click({ trial: true });
    await expect(page.getByRole('button', { name: 'Stop 3D' })).toHaveCount(0);
    if (width === 1280) {
      const search = (await page.locator('.search-row').boundingBox())!;
      const panel = (await page.locator('#taxi-dashboard').boundingBox())!;
      expect(panel.y).toBe(search.y);
      const card = (await page.locator('#inspector').boundingBox())!;
      expect(card.y - search.y - search.height).toBeLessThanOrEqual(12);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('September subway and taxi share the range and day while keeping independent totals', async ({ page }) => {
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  const station = page.getByLabel('Subway station complex');
  await expect(station.locator('option')).toHaveCount(7);
  await expect(station.locator('option').nth(1)).toHaveText('18 St (1) · Manhattan 158 m');
  await station.selectOption('321');
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
  await expect(page.locator('#subway-total')).toHaveText('33,037');
  await expect(page.locator('#subway-coverage')).toContainText(/168 (of|\/) 168/);
  await expect(page.locator('#subway-chart')).toBeVisible();
  const taxiPlot = (await page.locator('#taxi-chart').boundingBox())!;
  const subwayPlot = (await page.locator('#subway-chart').boundingBox())!;
  expect(subwayPlot.x).toBe(taxiPlot.x);
  expect(subwayPlot.width).toBe(taxiPlot.width);
  const taxiColor = await page.locator('#taxi-chart').evaluate(element => getComputedStyle(element).color);
  await expect(page.locator('#subway-chart')).not.toHaveCSS('color', taxiColor);
  const statistics = page.getByRole('region', { name: 'Key statistics' });
  await expect(statistics.locator('#taxi-day-total')).toHaveText('1,423');
  await expect(statistics.locator('#taxi-peak-hour')).toHaveText('6:00 PM · 164');
  await expect(statistics.locator('#subway-day-total')).toHaveText('6,376');
  await expect(statistics.locator('#subway-peak-hour')).toHaveText('5:00 PM · 944');
  await expect(page.locator('#subway-chart-gaps')).toBeHidden();
  await expect(page.locator('#mobility-coverage')).toBeHidden();
  await page.getByText('Data coverage', { exact: true }).click();
  await expect(page.locator('#mobility-coverage')).toBeVisible();
  await expect(page.locator('#mobility-coverage')).toContainText('September 2026');
  await page.getByText('Data coverage', { exact: true }).click();
  await page.getByLabel('Chart date').selectOption('2026-09-02');
  await expect(page.locator('#subway-total')).toHaveText('33,037');
  await expect(statistics.locator('#mobility-statistics-date')).toHaveText('Sep 2 · ET');
  await expect(statistics.locator('#taxi-day-total')).toHaveText('1,381');
  await expect(statistics.locator('#subway-peak-hour')).toHaveText('5:00 PM · 771');
  const taxiChart = page.getByRole('slider', { name: 'Hourly taxi dropoffs' });
  const subwayChart = page.getByRole('slider', { name: 'Hourly subway entries' });
  const time = page.locator('#chart-hour-label');
  const taxiValue = page.locator('#taxi-figure figcaption #chart-hour-taxi');
  const subwayValue = page.locator('#subway-figure figcaption #chart-hour-subway');
  await expect(time).toHaveText('12:00 AM ET');
  await expect(taxiValue).toHaveText(/\d/);
  await expect(subwayValue).toHaveText(/\d/);
  await taxiChart.hover({ position: { x: taxiPlot.width * 12.5 / 24, y: 30 } });
  await expect(time).toHaveText('12:00 PM ET');
  await expect(subwayChart).toHaveAttribute('aria-valuenow', '12');
  await subwayChart.click({ position: { x: subwayPlot.width * 5.5 / 24, y: 30 } });
  await expect(taxiChart).toHaveAttribute('aria-valuenow', '5');
  await subwayChart.press('ArrowRight');
  await expect(time).toHaveText('6:00 AM ET');
  await selectArea(page, '79', /East Village/);
  await expect(station).toHaveValue('');
  await expect(station.locator('option[value="321"]')).toHaveCount(0);
  await expect(page.getByLabel('Chart date')).toHaveValue('2026-09-02');
  await expect(page.locator('#taxi-total')).toHaveText('17,090');
});

test('flagged subway hours are gaps, and a subway fetch failure leaves taxi usable', async ({ context, page }) => {
  await context.route('**/data/subway-2026-09.json', route => route.fulfill({ status: 503 }));
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  await expect(page.locator('#subway-status')).toContainText(/could not|unavailable/i);
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
  await context.unroute('**/data/subway-2026-09.json');
  await page.locator('#subway-retry').click();
  await page.getByLabel('Subway station complex').selectOption('601');
  await expect(page.locator('#subway-chart-gaps')).toHaveText('1 hour missing or flagged.');
  const chart = page.getByRole('slider', { name: 'Hourly subway entries' });
  await chart.press('Home');
  for (let hour = 0; hour < 3; hour++) await chart.press('ArrowRight');
  await expect(chart).toHaveAttribute('aria-valuetext', /Sep 1, 3:00 AM ET.*Subway entries missing or flagged/);
  await expect(page.locator('#subway-figure figcaption #chart-hour-subway')).toHaveText('Unavailable');
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
});


test('a subway export waits for taxi provenance and rejects a different run', async ({ context, page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await context.route(`**${datasetPath}`, async route => {
    await pending;
    await route.continue();
  });
  await context.route('**/data/subway-2026-09.json', route => route.fulfill({
    json: {
      version: 1, month: '2026-09', timezone: 'America/New_York',
      runId: 'a'.repeat(64), sourceSha256: 'b'.repeat(64),
      stations: [{ id: 1, name: 'Station', borough: 'Manhattan', latitude: 40.741, longitude: -73.993, counts: Array(720).fill(1) }],
    },
  }));
  try {
    await page.goto('/?mode=mock&zone=90');
    await openTaxiDashboard(page);
    const station = page.getByLabel('Subway station complex');
    await expect(station.locator('option[value="1"]')).toHaveCount(0);
    await expect(station).toBeDisabled();
    release();
    await expect(page.locator('#taxi-total')).toHaveText('9,919');
    await expect(page.locator('#subway-status')).toContainText('unavailable for this September run');
    await expect(station).toBeDisabled();
    await expect(page.locator('#subway-chart')).toBeHidden();
  } finally {
    release();
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('Lincoln Square East suggests nearby stations and distant areas keep taxi available', async ({ page }) => {
  await page.goto('/?mode=mock&zone=142');
  await openTaxiDashboard(page);
  const station = page.getByLabel('Subway station complex');
  await expect(station).toBeEnabled();
  await expect(station.locator('option').nth(1)).toHaveText('66 St-Lincoln Center (1) · Manhattan 62 m');
  await expect(station.locator('option[value="1"]')).toHaveCount(0);
  await selectArea(page, '110', /Great Kills Park/);
  await expect(station).toBeDisabled();
  await expect(station.locator('option')).toHaveText('No nearby stations');
  await expect(page.locator('#taxi-total')).toHaveText('0');
});

test('calendar spans August and September and the daily trend opens hourly detail', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  await expect(page.getByRole('combobox', { name: 'Month', exact: true })).toHaveCount(0);
  const start = page.getByRole('button', { name: /Start date/ });
  const end = page.getByRole('button', { name: /End date/ });
  const calendar = page.locator('#taxi-calendar');
  const station = page.locator('#subway-station');
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
  await station.selectOption('601');
  await start.click();
  await calendar.getByRole('button', { name: 'Previous month' }).click();
  await expect(calendar).toHaveAccessibleName('August 2026');
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
  expect(requests).not.toContain('/data/yellow-taxi-2026-08.json');
  await calendar.getByRole('button', { name: 'August 29', exact: true }).click();
  await expect(end).toHaveAccessibleName('End date Sep 7, 2026');
  await end.click();
  await calendar.getByRole('button', { name: 'September 4', exact: true }).click();
  await expect(start).toHaveAccessibleName('Start date Aug 29, 2026');
  await expect(page.locator('#taxi-total')).toHaveText('10,165');
  await expect(page.locator('#taxi-range-coverage')).toHaveText('7 of 7 days covered');
  await expect(page.locator('#subway-total')).toHaveText('222,844');
  await expect(page.locator('#subway-coverage')).toHaveText('166 of 168 comparable hours');
  await expect(station).toHaveValue('601');
  await expect(page.locator('#selection-title')).toHaveText('Flatiron');
  const trend = page.getByRole('region', { name: 'Daily trend' });
  await expect(trend.getByRole('button')).toHaveCount(7);
  await expect(trend.getByRole('button', { name: /Aug 29, 2026/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Chart date')).toHaveValue('2026-08-29');
  await expect(page.locator('#chart-hour-taxi')).toHaveText('131');
  const aug31 = trend.getByRole('button', { name: /Aug 31, 2026/ });
  const sep1 = trend.getByRole('button', { name: /Sep 1, 2026.*1,423 taxi dropoffs.*34,290 estimated subway entries.*partial/ });
  await aug31.click();
  await expect(page.getByLabel('Chart date')).toHaveValue('2026-08-31');
  await expect(page.locator('#chart-hour-taxi')).toHaveText('35');
  await aug31.press('ArrowRight');
  await expect(sep1).toBeFocused();
  await sep1.press('Enter');
  await expect(sep1).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Chart date')).toHaveValue('2026-09-01');
  await expect(page.locator('#chart-hour-taxi')).toHaveText('27');
  await expect(page.locator('#chart-hour-subway')).toHaveText('315');
  await expect(start).toHaveAccessibleName('Start date Aug 29, 2026');
  await expect(end).toHaveAccessibleName('End date Sep 4, 2026');
  await end.click();
  await calendar.getByRole('button', { name: 'September 5', exact: true }).click();
  await expect(page.getByLabel('Chart date')).toHaveValue('2026-08-29');
  await expect(trend.getByRole('button', { name: /Aug 29, 2026/ })).toHaveAttribute('aria-pressed', 'true');
  expect(requests.filter(path => path === datasetPath)).toHaveLength(1);
});

test('a delayed September request cannot replace an August-only range', async ({ context, page }) => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await context.route(`**${datasetPath}`, async route => {
    await delayed;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto('/?mode=mock&zone=90');
    await openTaxiDashboard(page);
    await expect(page.locator('#taxi-status')).toHaveText(/loading/i);
    await page.getByRole('button', { name: /Start date/ }).click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: 'August 1', exact: true }).click();
    await page.getByRole('button', { name: /End date/ }).click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: 'August 7', exact: true }).click();
    await expect(page.locator('#taxi-total')).toHaveText('11,005');
    release();
    await context.unrouteAll({ behavior: 'wait' });
    await expect(page.locator('#taxi-total')).toHaveText('11,005');
  } finally {
    release();
  }
});

test('a failed taxi month remains a gap and can be retried independently', async ({ context, page }) => {
  const august = '**/data/yellow-taxi-2026-08.json';
  await context.route(august, route => route.fulfill({ status: 503 }));
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
  await page.getByRole('button', { name: /Start date/ }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByRole('button', { name: 'August 31', exact: true }).click();
  const gap = page.getByRole('button', { name: /Aug 31, 2026.*taxi dropoffs unavailable/ });
  await expect(gap).toBeVisible();
  await expect(page.locator('#taxi-range-coverage')).toHaveText('7 of 8 days covered');
  await gap.click();
  await expect(page.locator('#mobility-day-unavailable')).toBeVisible();
  await expect(page.getByLabel('Chart date')).toHaveValue('2026-08-31');
  await context.unroute(august);
  await page.getByRole('button', { name: 'Retry taxi data' }).click();
  await expect(page.locator('#taxi-total')).toHaveText('10,987');
  await expect(page.locator('#taxi-range-coverage')).toHaveText('8 of 8 days covered');
  await expect(page.getByRole('slider', { name: 'Hourly taxi dropoffs' })).toBeVisible();
  await expect(page.locator('#chart-hour-taxi')).toHaveText('35');
});

test('a catalog entry enables another month with only taxi data', async ({ context, page }) => {
  const requested: string[] = [];
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  await context.route('**/data/mobility-months.json', route => route.fulfill({
    json: { version: 1, months: [{ month: '2026-07', taxi: true, subway: false }] },
  }));
  await context.route('**/data/yellow-taxi-2026-07.json', async route => {
    // July and August have the same number of hours. Reuse August only as test data.
    const source = await route.fetch({ url: new URL('/data/yellow-taxi-2026-08.json', route.request().url()).href });
    await route.fulfill({ json: { ...await source.json(), month: '2026-07' } });
  });
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  await expect(page.getByRole('button', { name: 'Start date Jul 1, 2026' })).toBeEnabled();
  await expect(page.locator('#taxi-total')).toHaveText('11,005');
  await expect(page.locator('#subway-status')).toHaveText(/unavailable/i);
  expect(requested).not.toContain('/data/subway-2026-07.json');
});

test('a failed month catalog can be retried without leaving the selected area', async ({ context, page }) => {
  const catalog = '**/data/mobility-months.json';
  await context.route(catalog, route => route.fulfill({ status: 503 }));
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  const retry = page.locator('#mobility-month-retry');
  await expect(retry).toBeVisible();
  await expect(page.getByRole('button', { name: /Start date/ })).toBeDisabled();
  await context.unroute(catalog);
  await retry.click();
  await expect(page.locator('#selection-title')).toHaveText('Flatiron');
  await expect(page.getByRole('button', { name: 'Start date Sep 1, 2026' })).toBeEnabled();
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
});
