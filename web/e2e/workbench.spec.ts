import { test, expect } from '@playwright/test';
// Source updated for the city dashboard. Execution awaits explicit browser approval.
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    if (route.request().url().endsWith('/data/taxi-zones.geojson')) return route.fulfill({json:{type:'FeatureCollection',features:[{type:'Feature',id:161,properties:{location_id:161,zone:'Synthetic test area',borough:'Manhattan'},geometry:{type:'Polygon',coordinates:[[[-74,40.7],[-73.99,40.7],[-73.99,40.71],[-74,40.7]]]}}]}});
    const url = new URL(route.request().url());
    return url.origin === 'http://127.0.0.1:5175' ? route.continue() : route.abort('blockedbyclient');
  });
});
test('normal no-token startup is honest, has one city viewport and no2D map', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') external.push('external request'); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'NYC Mobility Observatory' })).toBeVisible();
  await expect(page.locator('#city-viewport')).toHaveCount(1);
  await expect(page.locator('#zone-map, svg')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load 3D', exact: true })).toBeDisabled();
  await expect(page.getByText('Add your public Cesium ion token')).toBeVisible();
  const picker = page.getByLabel('Select a TLC area'); await expect(picker).toBeEnabled();
  await picker.selectOption('161'); await expect(page.locator('#zone-id')).toHaveText('161');
  await picker.focus(); await expect(picker).toBeFocused();
  expect(await picker.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await expect(page.getByRole('button',{name:'Focus area',exact:true})).toBeDisabled();
  expect(external).toEqual([]);
});
test('local search and clearing search preserve selection without loading or focusing',async({page})=>{
 await page.goto('/?mode=mock&zone=161');await expect(page.locator('#zone-id')).toHaveText('161');
 await page.getByRole('searchbox',{name:'TLC areas'}).fill('no matching area');
 await expect(page.locator('#search-count')).toContainText('No matching');await expect(page.locator('#zone-id')).toHaveText('161');
 await expect(page.locator('#zone-picker')).toHaveValue('161');
 await page.getByRole('button',{name:'Clear search'}).click();await expect(page.locator('#zone-picker')).toHaveValue('161');
 await expect(page.locator('#status')).toContainText('Mock mode');
 await expect(page.locator('#focus-area')).toBeDisabled();
 await page.getByRole('button',{name:'Clear area'}).click();await expect(page.locator('#zone-details')).toBeHidden();
 expect(new URL(page.url()).searchParams.has('zone')).toBe(false);
});
test('mock mode loads once, explicit focus is guarded, and unload stays honest', async ({ page }) => {
  await page.goto('/?mode=mock&zone=161');
  await expect(page.locator('#focus-area')).toBeDisabled();
  await page.getByRole('button', { name: 'Load mock scene' }).click();
  await expect(page.locator('#status')).toContainText('Mock scene ready');
  await expect(page.getByRole('button', { name: 'Load mock scene' })).toBeDisabled();
  await page.getByRole('button',{name:'Focus area',exact:true}).click();
  await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','true');
  await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');
  await page.getByRole('button', { name: 'Stop / unload' }).click();
  await expect(page.locator('#status')).toContainText('3D unloaded');
  await expect(page.locator('#zone-map')).toHaveCount(0);
});
test('mock failures are sanitized, with one manual retry only', async ({ page }) => {
  await page.goto('/?mode=mock&scenario=auth');
  await page.getByRole('button', { name: 'Load mock scene' }).click();
  await expect(page.locator('#status')).toContainText('Access denied');
  await page.getByRole('button', { name: 'Retry once' }).click();
  await expect(page.locator('#session-limit')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry once' })).toBeDisabled();
});
for (const width of [320, 1280, 1920]) test(`city controls/status/credits reflow at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width,height:900}); await page.goto('/?mode=mock');
  await expect(page.locator('#credits')).toBeVisible();await expect(page.locator('#stop')).toBeVisible();
  await expect(page.locator('#status')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const scenario of ['rate','timeout','network','webgl','partial']) test(`mock ${scenario} retains a usable city state`, async ({page}) => {
 await page.goto(`/?mode=mock&scenario=${scenario}`);
 await page.getByRole('button',{name:'Load mock scene'}).click();
 await expect(page.locator('#status')).not.toContainText('Loading');
 if(scenario==='partial') await expect(page.locator('#stop')).toBeEnabled();
 if(scenario==='rate'||scenario==='webgl') await expect(page.locator('#load')).toBeDisabled();
 await expect(page.locator('#focus-area')).toBeDisabled();await expect(page.locator('#zone-map')).toHaveCount(0);
});
for (const width of [320,1280,1920]) test(`all official TLC areas remain available at ${width}px`, async ({context,page}) => {
 await context.route('**/data/taxi-zones.geojson',route=>route.continue());
 await page.setViewportSize({width,height:900});await page.goto('/?mode=mock');
 await expect(page.locator('#zone-picker option')).toHaveCount(264);
 await page.getByLabel('Select a TLC area').selectOption('161');
 await expect(page.locator('#selection-title')).toHaveText('Midtown Center');
 await expect(page.locator('#zone-borough')).toHaveText('Manhattan');
 await expect(page.locator('#credits')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('200 percent text, reduced motion and RTL retain native controls', async ({page}) => {
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?mode=mock&zone=161');
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.documentElement.dir='rtl';});
 await page.setViewportSize({width:640,height:900});await expect(page.getByLabel('Select a TLC area')).toBeVisible();
 await page.getByRole('button',{name:'Load mock scene'}).click();await expect(page.locator('#focus-area')).toBeEnabled();
 await page.locator('#focus-area').click();await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');
 await expect(page.locator('#stop')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Stop disables Retry until unresolved mock load drains', async ({page}) => {
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
 await page.goto('/?mode=mock');await expect(page.getByLabel('Select a TLC area')).toBeEnabled();
 await page.locator('#load').dispatchEvent('click');await expect(page.locator('#stop')).toBeEnabled();await page.locator('#stop').dispatchEvent('click');
 await expect(page.locator('#status')).toContainText('Waiting for previous requests');await expect(page.getByRole('button',{name:'Retry once'})).toBeDisabled();
 await page.clock.runFor(150);await expect(page.getByRole('button',{name:'Retry once'})).toBeEnabled();
});
