import{test,expect}from'@playwright/test';
// Verification mode blocks provider requests; live visual checks are separate.
const fixture={type:'FeatureCollection',features:[{type:'Feature',id:161,properties:{location_id:161,zone:'Synthetic test area',borough:'Manhattan'},geometry:{type:'Polygon',coordinates:[[[-74,40.7],[-73.99,40.7],[-73.99,40.71],[-74,40.7]]]}}]};
test.beforeEach(async({context})=>{await context.route('**/*',route=>{if(route.request().url().endsWith('/data/taxi-zones.geojson'))return route.fulfill({json:fixture});return new URL(route.request().url()).origin==='http://127.0.0.1:5175'?route.continue():route.abort('blockedbyclient')})});
test('clicking a search result selects it and brings it into view', async ({ page }) => {
  await page.goto('/?mode=mock');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  const search = page.locator('#area-search');
  await expect.soft(page.getByRole('combobox', { name: 'Search areas' })).toBeVisible({ timeout: 1200 });
  await search.fill('161');
  await expect(page.locator('#area-controls select')).toHaveCount(0);
  const result = page.getByRole('listbox').getByRole('option', { name: /Synthetic test area.*Manhattan/ });
  await expect(result).toBeVisible({ timeout: 1200 });
  await result.click();
  await expect(page.locator('#selection-title')).toHaveText('Synthetic test area');
  await expect(page.locator('#zone-borough')).toHaveText('Manhattan');
  await expect(page.locator('#zone-id')).toHaveText('161');
  await expect(page.locator('#focus-status')).toHaveText('Flying to area…');
  await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy', 'false');
  await expect(search).toHaveValue('161');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page).toHaveURL(/zone=161/);
});
test('a search result chosen during startup comes into view once 3D is ready', async ({ context, page }) => {
  let releaseLand!: () => void;
  const landReady = new Promise<void>(resolve => { releaseLand = resolve; });
  await context.route('**/data/city-land.json', async route => {
    await landReady;
    await route.continue();
  });
  try {
    await page.goto('/?mode=mock&cutout=land');
    await page.getByRole('combobox', { name: 'Search areas' }).fill('161');
    await page.getByRole('option').click();
    await expect(page.locator('#zone-id')).toHaveText('161');
    await expect(page.locator('#focus-area')).toBeDisabled();
  } finally {
    releaseLand();
  }
  await expect(page.locator('#focus-status')).toHaveText('Flying to area…');
  await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy', 'false');
});
test('search pill browses on focus and Escape preserves the query and selection', async ({ page }) => {
  await page.goto('/?mode=mock&zone=161');
  const search = page.getByRole('combobox', { name: 'Search areas' });
  const picker = page.locator('#zone-picker');
  await expect(search).toBeVisible();
  await expect(search).toBeEnabled();
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await expect(picker).toBeHidden();
  await search.focus();
  await expect(picker).toBeVisible();
  await expect(search).toHaveAttribute('aria-controls', 'zone-picker');
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await search.fill('Manhattan');
  await search.press('Escape');
  await expect(picker).toBeHidden();
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await expect(search).toHaveValue('Manhattan');
  await expect(search).toBeFocused();
  await expect(page.locator('#selection-title')).toHaveText('Synthetic test area');
  await search.press('Enter');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await search.press('Escape');
  await expect(picker).toBeHidden();
  await search.press('ArrowDown');
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('aria-activedescendant', 'area-result-161');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(search).not.toHaveAttribute('aria-activedescendant');
  await expect(search).toBeFocused();
  await search.click();
  await expect(picker).toBeVisible();
  await page.getByRole('button', { name: 'Stop 3D' }).focus();
  await expect(picker).toBeHidden();
  await search.focus();
  await expect(picker).toBeVisible();
  const clear = page.getByRole('button', { name: 'Clear search' });
  await page.keyboard.press('Tab');
  await expect(clear).toBeFocused();
  await expect(picker).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close area details' })).toBeFocused();
  await expect(picker).toBeHidden();
  await expect(page.locator('#zone-id')).toHaveText('161');
});
test('the map keeps a named overview action and removes the camera menu', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?mode=mock');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  await expect(page.getByRole('heading', { name: 'NYC Mobility Observatory' })).toHaveClass('visually-hidden');
  const overview = page.getByRole('button', { name: 'Show all NYC' });
  await expect(overview).toHaveAttribute('title', 'Show all NYC');
  await expect(page.locator('#view-controls')).toHaveCount(0);
  const box = (await overview.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBe(box.height);
  await expect(overview).toHaveCSS('border-top-left-radius', '999px');
  expect(box.x).toBeGreaterThan(640);
  expect(box.y).toBeGreaterThan(450);
  await overview.press('Enter');
});
test('verification startup cannot open live imagery and retains a truthful full-window stage',async({page})=>{const external:string[]=[];page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1')external.push('external')});await page.goto('/');await expect(page.locator('#city-viewport')).toHaveCount(1);await expect(page.locator('svg:not(button svg, summary svg, #area-controls svg[aria-hidden="true"]),#zone-map')).toHaveCount(0);await expect(page.getByText('Add your public Cesium ion token')).toBeVisible();await expect(page.locator('#load')).toBeDisabled();expect(external).toEqual([])});
test('mock stage starts automatically once, Stop stays stopped until deliberate Resume',async({page})=>{await page.goto('/?mode=mock');await expect(page.locator('#status')).toContainText('Mock stage ready');await expect(page.locator('#load')).toBeHidden();await page.locator('#stop').click();await expect(page.locator('#status')).toContainText('unloaded');await expect(page.locator('#load')).toBeVisible();await page.locator('#load').click();await expect(page.locator('#status')).toContainText('Mock stage ready');await page.locator('#stop').click();await expect(page.locator('#load')).toBeDisabled()});
test('Stop before delayed geography prevents automatic startup',async({context,page})=>{let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve});await context.route('**/data/taxi-zones.geojson',async route=>{await wait;await route.fulfill({json:fixture})});await page.goto('/?mode=mock');await page.locator('#stop').click();release();await expect(page.locator('#area-search')).toBeEnabled();await page.locator('#area-search').focus();await expect(page.getByRole('option')).toHaveCount(1);await expect(page.locator('#status')).toContainText('unloaded');await expect(page.locator('#load')).toBeEnabled()});
test('local filtering preserves selection and never causes a camera focus', async ({ page }) => {
  await page.goto('/?mode=mock&zone=161');
  await expect(page.locator('#zone-id')).toHaveText('161');
  await page.locator('#area-search').fill('no match');
  await expect(page.locator('#search-count')).toContainText('No matching');
  await expect(page.locator('#zone-id')).toHaveText('161');
  await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.locator('#selection-title')).toHaveText('Synthetic test area');
  await page.locator('#area-search').press('Enter');
  await expect(page.locator('#zone-id')).toHaveText('161');
  await page.locator('#clear-search').click();
  await expect(page.locator('#area-search')).toBeFocused();
  await expect(page.locator('#area-search')).toHaveValue('');
  await expect(page.getByRole('option')).toHaveAttribute('aria-selected', 'true');
});
test('keyboard search focuses the area only after Enter commits the selection', async ({ context, page }) => {
  await context.route('**/data/taxi-zones.geojson', route => route.continue());
  await page.goto('/?mode=mock');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  const search = page.getByRole('combobox', { name: 'Search areas' });
  const picker = page.getByRole('listbox', { name: 'Area results' });
  await search.focus();
  await expect(picker.getByRole('option')).toHaveCount(263);
  await search.pressSequentially('Midtown');
  await expect(picker.getByRole('option').first()).toHaveAttribute('id', 'area-result-161');
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'area-result-161');
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'area-result-162');
  await search.press('ArrowUp');
  await expect(search).toHaveAttribute('aria-activedescendant', 'area-result-161');
  await expect(search).toBeFocused();
  await expect(page.locator('#inspector')).toBeHidden();
  await search.press('Enter');
  await expect(picker).toBeHidden();
  await expect(page.locator('#selection-title')).toHaveText('Midtown Center');
  const focus = page.getByRole('button', { name: 'Focus', exact: true });
  await expect(focus).toHaveAttribute('aria-busy', 'true');
  await page.locator('#city-overview').click();
  await expect(focus).toHaveAttribute('aria-busy', 'false');
});
test('automatic failure does not auto-retry and shares the two-attempt budget',async({page})=>{await page.goto('/?mode=mock&scenario=auth');await expect(page.locator('#status')).toContainText('Access denied');await expect(page.locator('#load')).toHaveText('Retry once');await page.locator('#load').click();await expect(page.locator('#session-limit')).toBeVisible();await expect(page.locator('#load')).toBeDisabled()});
for(const width of[320,1280,1920])test(`credits/Stop/status remain accessible at${width}px`,async({page})=>{await page.setViewportSize({width,height:900});await page.goto('/?mode=mock');await expect(page.locator('#credits')).toBeVisible();await expect(page.locator('#stop')).toBeVisible();await expect(page.locator('#status')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)});
for(const scenario of['rate','timeout','network','webgl','partial'])test(`mock${scenario} has an honest stage state`,async({page})=>{await page.goto(`/?mode=mock&scenario=${scenario}`);await expect(page.locator('#status')).not.toContainText('Preparing');await expect(page.locator('#status')).not.toContainText('Loading');await expect(page.locator('#focus-area')).toBeHidden();if(scenario==='rate'||scenario==='webgl')await expect(page.locator('#load')).toBeDisabled()});
test('all 263 official areas remain selectable without a second map', async ({ context, page }) => {
  await context.route('**/data/taxi-zones.geojson', route => route.continue());
  await page.goto('/?mode=mock');
  const search = page.getByRole('combobox', { name: 'Search areas' });
  await expect(search).toBeEnabled();
  await search.focus();
  const list = page.getByRole('listbox', { name: 'Area results' });
  await expect(list.getByRole('option')).toHaveCount(263);
  const dimensions = await list.evaluate(element => ({
    height: element.clientHeight, scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.height).toBeGreaterThan(0);
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.height);
  await search.press('ArrowUp');
  const lastResultId = await list.getByRole('option').last().getAttribute('id');
  await expect(search).toHaveAttribute('aria-activedescendant', lastResultId!);
  await expect(list.getByRole('option').last()).toBeInViewport({ ratio: 0.99 });
  await list.getByRole('option', { name: /Midtown Center.*Manhattan/ }).click();
  await expect(page.locator('#selection-title')).toHaveText('Midtown Center');
  await search.fill('Corona');
  await expect(list.getByRole('option', { name: /^Corona.*Queens.*TLC ID 56$/ })).toBeInViewport();
  await expect(list.getByRole('option', { name: /^Corona.*Queens.*TLC ID 57$/ })).toBeInViewport();
  await expect(page.locator('svg:not(button svg, summary svg, #area-controls svg[aria-hidden="true"]),#zone-map')).toHaveCount(0);
});
test('reduced motion, RTL and200percent text keep stage controls available',async({page})=>{await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?mode=mock&zone=161');await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.documentElement.dir='rtl'});await page.setViewportSize({width:640,height:900});await expect(page.locator('#status')).toContainText('Mock stage ready');await page.locator('#focus-area').click();await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');await expect(page.locator('#stop')).toBeVisible();await expect(page.locator('#credits')).toBeVisible()});

test('desktop area details stay compact and usable', async ({ context, page }) => {
  await context.route('**/data/taxi-zones.geojson', route => route.continue());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?mode=mock&zone=161');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  const card = page.locator('#inspector');
  const title = card.getByRole('heading', { name: 'Midtown Center' });
  const metadata = card.locator('#zone-details');
  const focus = card.getByRole('button', { name: 'Focus', exact: true });
  await expect(title).toBeInViewport();
  await expect(card.locator('#zone-borough')).toHaveText('Manhattan');
  await expect(card.locator('#zone-id')).toHaveText('161');
  await expect(card.locator('#zone-borough')).toBeInViewport();
  await expect(card.locator('#zone-id')).toBeInViewport();

  const bounds = (await card.boundingBox())!;
  expect.soft(bounds.width, 'The normal desktop card should leave room for the map').toBeLessThanOrEqual(230);
  expect.soft(bounds.height, 'A short area title should fit in the compact card').toBeLessThanOrEqual(118);
  const titleBox = (await title.boundingBox())!;
  const metadataBox = (await metadata.boundingBox())!;
  const focusBox = (await focus.boundingBox())!;
  expect(metadataBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  expect(focusBox.y, 'Focus should occupy a separate row below the area identity').toBeGreaterThanOrEqual(metadataBox.y + metadataBox.height);
  const idLabel = metadata.getByText('TLC ID', { exact: true });
  await expect(idLabel).toBeInViewport();
  expect((await idLabel.boundingBox())!.width).toBeGreaterThan(1);
  await focus.click({ trial: true });
  await card.getByRole('button', { name: 'Close area details' }).click({ trial: true });
});

test('a long area title fits the card at 320px with 200 percent text', async ({ context, page }) => {
  await context.route('**/data/taxi-zones.geojson', route => route.continue());
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/?mode=mock&zone=103');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.locator('#status')).toContainText('Mock stage ready');

  const card = page.locator('#inspector');
  const title = card.getByRole('heading', { name: "Governor's Island/Ellis Island/Liberty Island" });
  await expect(title).toBeInViewport({ ratio: 1 });
  await expect(card.locator('#zone-borough')).toBeInViewport();
  await expect(card.locator('#zone-id')).toBeInViewport();
  for (const content of [title, card]) {
    const fits = await content.evaluate(element =>
      element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
    );
    expect(fits, 'The long title and area details should fit without clipping').toBe(true);
  }
  await card.getByRole('button', { name: 'Focus', exact: true }).click({ trial: true });
  await card.getByRole('button', { name: 'Close area details' }).click({ trial: true });
});

for (const width of [320, 640, 1440]) test(`map controls and selected area stay in view at ${width}px`, async ({ page }) => {
  const height = 900;
  await page.setViewportSize({ width, height });
  await page.goto('/?mode=mock&zone=161');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  for (const selector of ['#area-search', '#focus-area', '#city-overview', '#stop', '#credits']) {
    await expect(page.locator(selector)).toBeInViewport();
  }
  const searchPanel = (await page.locator('#area-controls').boundingBox())!;
  const inspector = (await page.locator('#inspector').boundingBox())!;
  const gap = inspector.y - (searchPanel.y + searchPanel.height);
  expect(gap, 'Mock selection details should appear under search').toBeGreaterThanOrEqual(0);
  expect(gap, 'Mock selection details should stay close to search').toBeLessThanOrEqual(12);
  expect(inspector.x).toBeLessThan(searchPanel.x + searchPanel.width);
  expect(inspector.x + inspector.width).toBeGreaterThan(searchPanel.x);
  await page.locator('#area-search').focus();
  await expect(page.locator('#zone-picker')).toBeInViewport();
  await page.keyboard.press('Escape');
  await page.locator('#focus-area').click({ trial: true });
  await expect(page.getByRole('button', { name: 'Show all NYC' })).toBeInViewport();
  await page.locator('#area-search').click({ trial: true });
  await page.locator('#stop').click({ trial: true });
  await expect(page.locator('#credits')).toBeInViewport();
});

for (const width of [320, 640]) test(`closing area details returns keyboard focus to search at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/?mode=mock&zone=161');
  if (width === 640) await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  await page.getByRole('button', { name: 'Close area details' }).press('Enter');
  await expect(page.locator('#inspector')).toBeHidden();
  await expect(page.locator('#zone-picker')).toBeVisible();
  await expect(page.getByRole('option', { selected: true })).toHaveCount(0);
  await expect(page.locator('#area-search')).toBeFocused();
  await expect(page.locator('#area-search')).toBeInViewport();
});

for (const [height, textSize] of [[568, '100%'], [900, '200%']] as const) {
  test(`credits and Show all NYC stay in view at 320×${height} and ${textSize} text`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height });
    await page.goto('/?mode=mock&zone=161');
    await page.evaluate(size => { document.documentElement.style.fontSize = size; }, textSize);
    await expect(page.locator('#status')).toContainText('Mock stage ready');
    const credits = page.locator('#credits');
    await expect(credits).toBeInViewport({ ratio: 1 });
    await page.locator('#city-overview').click({ trial: true });
    await expect(credits).toBeInViewport({ ratio: 1 });
  });
}

test('Sources keeps internal keyboard navigation and dismisses on Escape or focus exit',async({page})=>{
 await page.setViewportSize({width:640,height:900});
 await page.goto('/?mode=mock');
 await expect(page.locator('#status')).toContainText('Mock stage ready');
 const details=page.locator('#sources'),summary=page.locator('#sources>summary');
 await summary.click();
 await page.keyboard.press('Tab');
 await expect(details.locator('.tool-content :focus')).toHaveCount(1);
 await expect(details).toHaveJSProperty('open',true);
 await page.keyboard.press('Shift+Tab');
 await expect(summary).toBeFocused();
 await expect(details).toHaveJSProperty('open',true);
 await page.keyboard.press('Tab');await page.keyboard.press('Escape');
 await expect(details).toHaveJSProperty('open',false);
 await expect(summary).toBeFocused();
 await summary.click();await page.locator('#stop').focus();
 await expect(details).toHaveJSProperty('open',false);
 await expect(page.locator('#stop')).toBeFocused();
});

test('selection changes retain matching area rows when the search is unchanged', async ({ context, page }) => {
  await context.route('**/data/taxi-zones.geojson', route => route.continue());
  await page.goto('/?mode=mock');
  const search = page.getByRole('combobox', { name: 'Search areas' });
  const list = page.getByRole('listbox', { name: 'Area results' });
  await search.fill('Midtown');
  const options = list.getByRole('option');
  await expect(options.first()).toHaveAttribute('id', 'area-result-161');
  const originalOptions = await list.evaluateHandle(element => Array.from(element.querySelectorAll('[role="option"]')));
  try {
    for (const [id, title] of [['161', 'Midtown Center'], ['162', 'Midtown East']]) {
      const result = list.locator(`#area-result-${id}`);
      await result.click();
      await expect(page.locator('#selection-title')).toHaveText(title);
      await expect(search).toHaveValue('Midtown');
      await expect(list).toBeHidden();
      await search.click();
      await expect(result).toHaveAttribute('aria-selected', 'true');
      const retained = await list.evaluate((element, previous) => {
        const current = Array.from(element.querySelectorAll('[role="option"]'));
        return current.length === previous.length && current.every((option, index) => option === previous[index]);
      }, originalOptions);
      expect(retained, 'Selecting an area with the same query should preserve matching rows').toBe(true);
    }
  } finally {
    await originalOptions.dispose();
  }
});

// These tests cover local asset loading, geography recovery and source notices.
test('Sources reports the default and opt-in borough modes without loading land data', async ({ page }) => {
  const assetRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/data/city-land.json') assetRequests.push('land');
  });
  for (const [suffix, notice] of [
    ['', /continuous imagery/i],
    ['&cutout=LAND', /continuous imagery/i],
    ['&cutout=boroughs', /TLC borough cutout/i],
  ] as const) {
    await page.goto(`/?mode=mock${suffix}`);
    await expect(page.locator('#status')).toContainText('Mock stage ready');
    await expect(page.locator('#footprint-notice')).toBeHidden();
    await page.locator('#sources>summary').click();
    await expect(page.locator('#footprint-notice')).toBeVisible();
    await expect(page.locator('#footprint-notice')).toHaveText(notice);
  }
  expect(assetRequests).toEqual([]);
});

test('exact land cutout flag requests its local asset once',async({page})=>{
 const assetRequests:string[]=[],external:string[]=[];
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/data/city-land.json')assetRequests.push('land');if(url.hostname!=='127.0.0.1')external.push('external')});
 await page.goto('/?mode=mock&cutout=land');
 await expect(page.locator('#status')).toContainText('Mock stage ready');
 expect(assetRequests).toEqual(['land']);expect(external).toEqual([]);
 await page.locator('#sources>summary').click();
 await expect(page.locator('#sources a[href="/data/city-land.provenance.json"]')).toBeVisible({timeout:1000});
 await expect(page.locator('#sources a[href*="gthc-hcne"]')).toBeVisible({timeout:1000});
});

for(const failure of ['missing','invalid'])test(`${failure} optional land asset preserves local area selection and isolated startup`,async({context,page})=>{
 await context.route('**/data/city-land.json',route=>failure==='missing'?route.fulfill({status:404,body:'Not found'}):route.fulfill({json:{type:'not-a-land-footprint'}}));
 const assetRequests:string[]=[],external:string[]=[];
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/data/city-land.json')assetRequests.push('land');if(url.hostname!=='127.0.0.1')external.push('external')});
 await page.goto('/?mode=mock&cutout=land');
 await expect(page.locator('#status')).toContainText('Mock stage ready');
 await page.locator('#area-search').focus();
 await page.getByRole('option', { name: /Synthetic test area.*Manhattan/ }).click();
 await expect(page.locator('#selection-title')).toHaveText('Synthetic test area');
 await expect(page.locator('#area-search')).toBeEnabled();
 await page.locator('#sources>summary').click();
 await expect(page.locator('#footprint-notice')).toContainText(/DCP land cutout unavailable.*continuous imagery/i);
 expect(assetRequests).toEqual(['land']);expect(external).toEqual([]);
});

test('Resume waits for the land cutout after stopping startup', async ({ context, page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await context.route('**/data/city-land.json', async route => {
    await held;
    await route.continue();
  });
  try {
    await page.goto('/?mode=mock&cutout=land');
    await expect(page.locator('#area-search')).toBeEnabled({ timeout: 1000 });
    await page.getByRole('button', { name: 'Stop 3D' }).click();
    const resume = page.getByRole('button', { name: 'Resume 3D' });
    await expect(resume).toBeVisible();
    await expect(resume).toBeDisabled({ timeout: 1000 });
    release();
    await expect(resume).toBeEnabled();
    await expect(page.locator('#status')).toContainText('unloaded');
  } finally {
    release();
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('stalled optional land asset leaves local controls usable and reaches isolated startup after its timeout',async({context,page})=>{
 let release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve});
 await context.route('**/data/city-land.json',async route=>{
  await held;
  await route.fulfill({json:{type:'not-a-land-footprint'}}).catch(()=>{});
 });
 const external:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1')external.push('external')});
 try{
  await page.goto('/?mode=mock&cutout=land');
  // Optional display geometry must not hold the already-fetched local area list.
  await expect(page.locator('#area-search')).toBeEnabled({timeout:1000});
  await page.locator('#area-search').focus();
  await page.getByRole('option', { name: /Synthetic test area.*Manhattan/ }).click();
  await expect(page.locator('#selection-title')).toHaveText('Synthetic test area');
  // The unresolved route stays held: startup must recover through the 3s timeout.
  await expect(page.locator('#status')).toContainText('Mock stage ready',{timeout:5500});
  expect(external).toEqual([]);
 }finally{
  release();
  // The asset request was aborted by the app; detach its deliberately held route
  // before fixture teardown so a late response cannot keep the test worker alive.
  await context.unrouteAll({behavior:'ignoreErrors'});
 }
});
