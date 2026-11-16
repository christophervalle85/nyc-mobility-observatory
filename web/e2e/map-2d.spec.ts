import { expect, test } from '@playwright/test';

test('Manhattan map loads local geography and keeps dashboard selections across mode changes', async ({ page }) => {
  const imageryRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || url.pathname.includes('cesium-adapter')) imageryRequests.push(request.url());
  });
  const basemapRequest = page.waitForResponse(response => response.url().endsWith('/data/manhattan-streets-parks.json'));
  const harborRequest = page.waitForResponse(response => response.url().endsWith('/data/harbor-context.json'));
  await page.goto('/?mode=map-preview&zone=142');
  const [basemap, harbor] = await Promise.all([basemapRequest, harborRequest]);
  const details = await basemap.json();
  expect(details).toMatchObject({ version: 1, totalVertices: expect.any(Number) });
  expect(details.parks.flat().every((ring: number[][]) => ring.length >= 4)).toBe(true);
  const harborDetails = await harbor.json();
  expect(harborDetails).toMatchObject({ version: 1, polygons: expect.any(Array) });
  expect(harborDetails.streets.length).toBeGreaterThan(0);
  expect(harborDetails.majorStreets.length).toBeGreaterThan(0);
  expect(harborDetails.parks.length).toBeGreaterThan(0);
  const canvas = page.locator('#map-2d');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate(element => {
    const map = element as HTMLCanvasElement;
    const pixels = map.getContext('2d')!.getImageData(0, 0, map.width, map.height).data;
    let jersey = false, jerseyPark = false, park = false;
    for (let i = 0; i < pixels.length && !(jersey && jerseyPark && park); i += 4) {
      jersey ||= pixels[i] === 34 && pixels[i + 1] === 49 && pixels[i + 2] === 59;
      jerseyPark ||= pixels[i] === 41 && pixels[i + 1] === 63 && pixels[i + 2] === 54;
      park ||= pixels[i] === 45 && pixels[i + 1] === 75 && pixels[i + 2] === 62;
    }
    return { jersey, jerseyPark, park };
  })).toEqual({ jersey: true, jerseyPark: true, park: true });
  await expect(page.getByRole('button', { name: 'Show all NYC' })).toBeEnabled();
  await page.getByText('Sources & usage', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'U.S. Census Bureau TIGER/Line® 2025' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'streets and parks' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Zoom to area' }).click();
  await expect(page.getByRole('button', { name: 'Return to previous view', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show all NYC' }).click();
  await page.getByRole('button', { name: 'Return to previous map view' }).click();
  await page.getByRole('button', { name: 'Mobility data', exact: true }).click();
  const station = page.getByRole('combobox', { name: 'Subway station complex' });
  await expect(station).toBeEnabled();
  await station.selectOption('314');
  await expect(page.getByRole('slider', { name: 'Hourly subway entries' })).toBeVisible();
  expect(imageryRequests).toEqual([]);

  const open3D = page.getByRole('button', { name: 'Open 3D map' });
  const open2D = page.getByRole('button', { name: 'Return to 2D map' });
  for (let switchCount = 0; switchCount < 3; switchCount += 1) {
    await open3D.click();
    await expect(page.locator('#status')).toHaveText('3D controls preview. Live imagery is off.');
    await expect(canvas).toBeHidden();
    await open2D.click();
    await expect(canvas).toBeVisible();
  }
  await expect(station).toHaveValue('314');
  await expect(page.locator('#zone-id')).toHaveText('142');
  await expect(page.getByRole('region', { name: 'Daily trend' }).getByRole('button')).toHaveCount(31);
});

test('a failed 3D attempt keeps the 2D map usable on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mode=map-preview&scenario=network');
  const mapMode = page.getByRole('button', { name: 'Open 3D map' });
  const overview = page.getByRole('button', { name: 'Show all NYC' });
  await expect(mapMode).toBeInViewport();
  await expect(overview).toBeInViewport();
  await mapMode.click();
  await expect(page.locator('#status')).toContainText('3D could not load');
  await expect(page.locator('#map-2d')).toBeVisible();
  await overview.click();
  await expect(page.getByRole('button', { name: 'Return to previous map view' })).toBeEnabled();
});
