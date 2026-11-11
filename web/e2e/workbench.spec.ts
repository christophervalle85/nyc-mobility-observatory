import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    if (route.request().url().endsWith('/data/taxi-zones.geojson')) return route.fulfill({json:{type:'FeatureCollection',features:[{type:'Feature',id:161,properties:{location_id:161,zone:'Synthetic test zone',borough:'Manhattan'},geometry:{type:'Polygon',coordinates:[[[-74,40.7],[-73.99,40.7],[-73.99,40.71],[-74,40.7]]]}}]}});
    const url = new URL(route.request().url());
    return url.origin === 'http://127.0.0.1:5175' ? route.continue() : route.abort('blockedbyclient');
  });
});
test('no-token startup stays local, shows setup and supports keyboard zone selection', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') external.push('external request'); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'NYC Mobility Observatory' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load 3D', exact: true })).toBeDisabled();
  await expect(page.getByText('Add your public Cesium ion token')).toBeVisible();
  const picker = page.getByLabel('Select a TLC zone'); await expect(picker).toBeEnabled();
  await picker.selectOption('161'); await expect(page.locator('#zone-id')).toHaveText('161');
  await picker.focus(); await expect(picker).toBeFocused();
  expect(await picker.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  expect(external).toEqual([]);
});
test('mock mode is labeled, loads once and unloads without external requests', async ({ page }) => {
  await page.goto('/?mode=mock');
  await page.getByRole('button', { name: 'Load mock scene' }).click();
  await expect(page.getByRole('status')).toContainText('Mock scene ready');
  await expect(page.getByRole('button', { name: 'Load mock scene' })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop / unload' }).click();
  await expect(page.getByRole('status')).toContainText('3D unloaded');
});
test('mock failures are sanitized, with one manual retry only', async ({ page }) => {
  await page.goto('/?mode=mock&scenario=auth');
  await page.getByRole('button', { name: 'Load mock scene' }).click();
  await expect(page.getByRole('status')).toContainText('Access denied');
  await page.getByRole('button', { name: 'Retry once' }).click();
  await expect(page.getByText('Session limit reached')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry once' })).toBeDisabled();
});
for (const width of [320, 1280, 1920]) test(`reflows at ${width}px with visible source and credits`, async ({ page }) => {
  await page.setViewportSize({width,height:900}); await page.goto('/?mode=mock');
  await expect(page.getByText('NYC TLC taxi zones', {exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/workbench-${width}.png`,fullPage:true});
});

for (const scenario of ['rate','timeout','network','webgl','partial']) test(`mock ${scenario} has a usable safe state`, async ({page}) => {
 await page.goto(`/?mode=mock&scenario=${scenario}`);
 await page.getByRole('button',{name:'Load mock scene'}).click();
 await expect(page.getByRole('status')).not.toContainText('Loading');
 if(scenario==='partial') {await expect(page.getByRole('button',{name:'Stop / unload'})).toBeEnabled();}
 if(scenario==='rate'||scenario==='webgl') await expect(page.locator('#load')).toBeDisabled();
});
for (const width of [320,1280,1920]) test(`official geometry works at ${width}px`, async ({context,page}) => {
 await context.route('**/data/taxi-zones.geojson',route=>route.continue());
 await page.setViewportSize({width,height:900});await page.goto('/?mode=mock');
 await expect(page.locator('#zone-map path')).toHaveCount(263);
 await page.getByLabel('Select a TLC zone').selectOption('161');
 await expect(page.locator('#selection-title')).toHaveText('Midtown Center');
 await expect(page.locator('#zone-borough')).toHaveText('Manhattan');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/official-map-${width}.png`,fullPage:true});
});
test('200 percent text, reduced motion and RTL retain usable controls', async ({page}) => {
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?mode=mock');
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.documentElement.dir='rtl';});
 await page.setViewportSize({width:640,height:900});
 await expect(page.getByLabel('Select a TLC zone')).toBeVisible();
 await page.getByRole('button',{name:'Load mock scene'}).click();
 await expect(page.getByRole('button',{name:'Stop / unload'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Stop disables Retry while the mock load drains, then enables the deliberate retry', async ({page}) => {
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
 await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
 await page.goto('/?mode=mock');
 await expect(page.getByLabel('Select a TLC zone')).toBeEnabled();
 await page.locator('#load').dispatchEvent('click');
 await expect(page.locator('#stop')).toBeEnabled();
 await page.locator('#stop').dispatchEvent('click');
 await expect(page.getByRole('status')).toContainText('Waiting for previous requests');
 await expect(page.getByRole('button',{name:'Retry once'})).toBeDisabled();
 await page.clock.runFor(150);
 await expect(page.getByRole('button',{name:'Retry once'})).toBeEnabled();
});
