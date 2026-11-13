import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const datasetPath = '/data/yellow-taxi-2026-09.json';

async function openTaxiDashboard(page: Page) {
  await page.getByRole('button', { name: 'Taxi dropoffs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Yellow taxi dropoffs' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Yellow taxi dropoffs' })).toBeHidden();
  expect(dataRequests).toEqual([]);
  await openTaxiDashboard(page);
  await expect(page.getByLabel('Start date')).toHaveValue('2026-09-01');
  await expect(page.getByLabel('End date')).toHaveValue('2026-09-07');
  // Golden values come from the archived M1 taxi/zone_hour.csv for run 0566a3a0.
  await expect(page.locator('#taxi-total')).toHaveText('9,919');
  await expect(page.getByRole('heading', { name: 'Yellow taxi dropoffs' })).toBeFocused();
  const panel = page.locator('#taxi-dashboard');
  await expect(panel).toHaveCSS('width', '416px');
  const chart = page.locator('#taxi-dashboard canvas');
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
  const start = page.getByLabel('Start date');
  const end = page.getByLabel('End date');
  await end.selectOption('2026-09-08');
  await start.selectOption('2026-09-07');
  await expect(page.locator('#taxi-total')).toHaveText('2,848');

  await page.getByText('Hourly counts', { exact: true }).press('Enter');
  const table = page.getByRole('table', { name: 'Hourly yellow taxi dropoffs' });
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
  await expect(page.getByRole('heading', { name: 'Yellow taxi dropoffs' })).toBeVisible();
  await expect(start).toHaveValue('2026-09-07');
  await expect(end).toHaveValue('2026-09-08');
  await expect(page.locator('#taxi-total')).toHaveText('4,175');
  await expect(rows.first().getByRole('cell').last()).toHaveText('164');
  await expect(rows.last().getByRole('cell').last()).toHaveText('90');

  await selectArea(page, '110', /Great Kills Park/);
  await expect(page.locator('#taxi-total')).toHaveText('0');
  await expect(rows).toHaveCount(24);
  await expect(rows.first().getByRole('cell').last()).toHaveText('0');
  await expect(rows.last().getByRole('cell').last()).toHaveText('0');

  await page.getByRole('button', { name: 'Close area details' }).click();
  await expect(page.getByRole('heading', { name: 'Yellow taxi dropoffs' })).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Search areas' })).toBeFocused();
});

test('invalid date ranges hide the total until both dates are valid', async ({ page }) => {
  await page.goto('/?mode=mock&zone=90');
  await openTaxiDashboard(page);
  const start = page.getByLabel('Start date');
  const end = page.getByLabel('End date');
  const status = page.locator('#taxi-status');
  const total = page.locator('#taxi-total');
  await expect(total).toHaveText('9,919');

  await expect(start.locator('option')).toHaveCount(30);
  await expect(start.locator('option').first()).toHaveText('Sep 1');
  await expect(start.locator('option').last()).toHaveText('Sep 30');
  await start.selectOption('2026-09-08');
  await expect(status).toBeVisible();
  await expect(status).toHaveText(/start on or before the end/);
  await expect(total).not.toHaveText(/\d/);

  await end.selectOption('2026-09-30');
  await start.selectOption('2026-09-30');
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
    await expect(page.getByRole('heading', { name: 'Yellow taxi dropoffs' })).toBeVisible();
    await page.getByRole('button', { name: 'Show all NYC' }).click();
    await page.getByRole('button', { name: 'Close taxi dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Yellow taxi dropoffs' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Taxi dropoffs', exact: true })).toBeFocused();
  });
}

for (const [width, height] of [[320, 568], [390, 844], [1280, 720]]) {
  test(`the taxi dashboard keeps credits and map controls visible at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/?mode=mock&zone=90');
    await openTaxiDashboard(page);
    await expect(page.locator('#taxi-total')).toHaveText('9,919');
    await expect(page.locator('#credits')).toBeInViewport();
    await expect(page.getByLabel('Start date')).toBeInViewport();
    await expect(page.getByLabel('End date')).toBeInViewport();
    const overview = page.getByRole('button', { name: 'Show all NYC' });
    await expect(overview).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Close taxi dashboard' }).click({ trial: true });
    await overview.click({ trial: true });
    await page.getByRole('button', { name: 'Stop 3D' }).click();
    await expect(page.locator('#status')).toContainText('unloaded');
    await expect(page.locator('#taxi-total')).toHaveText('9,919');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
