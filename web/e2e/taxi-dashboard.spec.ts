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
  await expect(page.getByRole('button', { name: 'Date range Sep 1–7, 2026' })).toBeVisible();
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

test('the hourly table follows the chart date and selected area', async ({ page }) => {
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  await page.getByRole('button', { name: /Date range/ }).click();
  const calendar = page.getByRole('dialog', { name: 'September 2026' });
  await calendar.getByRole('button', { name: 'September 7', exact: true }).click();
  await calendar.getByRole('button', { name: 'September 8', exact: true }).click();
  await calendar.getByRole('button', { name: 'Apply dates' }).click();
  await expect(page.locator('#taxi-total')).toHaveText('2,848');

  await page.getByText('Hourly counts', { exact: true }).press('Enter');
  const table = page.getByRole('table', { name: 'Hourly transportation counts' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Hour (ET)' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Dropoffs' })).toBeVisible();
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(24);
  await expect(rows.first().getByText('Sep 7, 00:00', { exact: true })).toBeVisible();
  await expect(rows.last().getByText('Sep 7, 23:00', { exact: true })).toBeVisible();
  await expect(rows.first().getByRole('cell').last()).toHaveText('72');
  const chartDate = page.getByLabel('Chart date');
  await expect(chartDate.locator('option')).toHaveCount(2);
  await chartDate.selectOption('2026-09-08');
  await expect(rows.last().getByText('Sep 8, 23:00', { exact: true })).toBeVisible();
  await expect(rows.last().getByRole('cell').last()).toHaveText('45');
  await expect(page.locator('#taxi-total')).toHaveText('2,848');
  await chartDate.selectOption('2026-09-07');

  await selectArea(page, '79', /East Village/);
  await expect(page.getByRole('heading', { name: 'Transportation data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Date range Sep 7–8, 2026' })).toBeVisible();
  await expect(page.locator('#taxi-total')).toHaveText('4,175');
  await expect(rows.first().getByRole('cell').last()).toHaveText('164');
  await expect(rows.last().getByRole('cell').last()).toHaveText('90');

  await selectArea(page, '110', /Great Kills Park/);
  await expect(page.locator('#taxi-total')).toHaveText('0');
  await expect(rows).toHaveCount(24);
  await expect(rows.first().getByRole('cell').last()).toHaveText('0');
  await expect(rows.last().getByRole('cell').last()).toHaveText('0');

  await page.getByRole('button', { name: 'Close area details' }).click();
  await expect(page.getByRole('heading', { name: 'Transportation data' })).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Search areas' })).toBeFocused();
});

test('the date menu opens below the chart field and Escape closes only the menu', async ({ page }) => {
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
  expect(rowBounds.y).toBeGreaterThan(fieldBounds.y + fieldBounds.height);
  expect(Math.abs(rowBounds.x + rowBounds.width - fieldBounds.x - fieldBounds.width)).toBeLessThan(7);
  await page.keyboard.press('Escape');
  await expect(page.locator('#taxi-chart-day:open')).toHaveCount(0);
  await expect(page.locator('#taxi-dashboard')).toBeVisible();
});

test('calendar previews ranges, Escape cancels, and keyboard can apply a one-day range', async ({ page }) => {
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  const trigger = page.getByRole('button', { name: /Date range/ });
  const calendar = page.getByRole('dialog', { name: 'September 2026' });
  const total = page.locator('#taxi-total');
  await trigger.press('Enter');
  await expect(calendar.getByRole('button', { name: 'September 1', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(calendar.getByRole('button', { name: 'Apply dates' })).toBeDisabled();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(calendar.getByRole('button', { pressed: true })).toHaveCount(8);
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(total).toHaveText('9,919');
  await trigger.press('Enter');
  const lastDay = calendar.getByRole('button', { name: 'September 30', exact: true });
  await lastDay.click();
  await lastDay.press('Space');
  await calendar.getByRole('button', { name: 'Apply dates' }).press('Enter');
  await expect(trigger).toHaveText('Sep 30, 2026');
  await expect(total).toHaveText('1,696');
  await expect(page.getByLabel('Chart date')).toHaveValue('2026-09-30');
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
    await expect(page.getByRole('button', { name: /Date range/ })).toBeInViewport();
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
  await page.getByLabel('Chart date').selectOption('2026-09-02');
  await expect(page.locator('#subway-total')).toHaveText('33,037');
  await page.getByText('Hourly counts', { exact: true }).press('Enter');
  const rows = page.locator('#taxi-hour-rows tr');
  await expect(rows).toHaveCount(24);
  await expect(rows.first()).toContainText('Sep 2, 00:00');
  await expect(rows.first().getByRole('cell')).toHaveCount(2);
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
  await page.getByText('Hourly counts', { exact: true }).press('Enter');
  const flagged = page.locator('#taxi-hour-rows tr').filter({ hasText: 'Sep 1, 03:00' });
  await expect(flagged.getByRole('cell').last()).toHaveText(/missing|flagged|unavailable/i);
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
    await expect(station.locator('option[value="1"]')).toHaveCount(1);
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
