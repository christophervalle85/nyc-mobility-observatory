import{test,expect}from'@playwright/test';
// Verification mode blocks provider requests; live visual checks are separate.
const fixture={type:'FeatureCollection',features:[{type:'Feature',id:161,properties:{location_id:161,zone:'Synthetic test area',borough:'Manhattan'},geometry:{type:'Polygon',coordinates:[[[-74,40.7],[-73.99,40.7],[-73.99,40.71],[-74,40.7]]]}}]};
test.beforeEach(async({context})=>{await context.route('**/*',route=>{if(route.request().url().endsWith('/data/taxi-zones.geojson'))return route.fulfill({json:fixture});return new URL(route.request().url()).origin==='http://127.0.0.1:5175'?route.continue():route.abort('blockedbyclient')})});
test('area search is visible without opening a menu', async ({ page }) => {
  await page.goto('/?mode=mock');
  await expect(page.locator('#area-search')).toBeVisible();
  await expect(page.locator('#area-search')).toBeEnabled();
});
test('verification startup cannot open live imagery and retains a truthful full-window stage',async({page})=>{const external:string[]=[];page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1')external.push('external')});await page.goto('/');await expect(page.locator('#city-viewport')).toHaveCount(1);await expect(page.locator('svg,#zone-map')).toHaveCount(0);await expect(page.getByText('Add your public Cesium ion token')).toBeVisible();await expect(page.locator('#load')).toBeDisabled();expect(external).toEqual([])});
test('mock stage starts automatically once, Stop stays stopped until deliberate Resume',async({page})=>{await page.goto('/?mode=mock');await expect(page.locator('#status')).toContainText('Mock stage ready');await expect(page.locator('#load')).toBeHidden();await page.locator('#stop').click();await expect(page.locator('#status')).toContainText('unloaded');await expect(page.locator('#load')).toBeVisible();await page.locator('#load').click();await expect(page.locator('#status')).toContainText('Mock stage ready');await page.locator('#stop').click();await expect(page.locator('#load')).toBeDisabled()});
test('Stop before delayed geography prevents automatic startup',async({context,page})=>{let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve});await context.route('**/data/taxi-zones.geojson',async route=>{await wait;await route.fulfill({json:fixture})});await page.goto('/?mode=mock');await page.locator('#stop').click();release();await expect(page.locator('#zone-picker')).toBeEnabled();await expect(page.locator('#status')).toContainText('unloaded');await expect(page.locator('#load')).toBeEnabled()});
test('local filtering preserves selection and never causes a camera focus',async({page})=>{await page.goto('/?mode=mock&zone=161');await expect(page.locator('#zone-id')).toHaveText('161');await page.locator('#area-search').fill('no match');await expect(page.locator('#search-count')).toContainText('No matching');await expect(page.locator('#zone-id')).toHaveText('161');await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');await page.locator('#clear-search').click();await expect(page.locator('#zone-picker')).toHaveValue('161')});
test('keyboard search selects an area before the user explicitly flies there', async ({ context, page }) => {
  await context.route('**/data/taxi-zones.geojson', route => route.continue());
  await page.goto('/?mode=mock');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  const search = page.getByRole('searchbox', { name: 'Search areas' });
  const picker = page.getByRole('combobox', { name: 'Area results' });
  await expect(picker.locator('option')).toHaveCount(264);
  await search.pressSequentially('161');
  await expect(picker.locator('option')).toHaveCount(2);
  await page.keyboard.press('Tab');
  await expect(page.locator('#clear-search')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(picker).toBeFocused();
  await page.keyboard.press('m');
  await expect(picker).toHaveValue('161');
  await expect(page.locator('#selection-title')).toHaveText('Midtown Center');
  const fly = page.getByRole('button', { name: 'Fly to area' });
  await expect(fly).toHaveAttribute('aria-busy', 'false');
  await fly.press('Enter');
  await expect(fly).toHaveAttribute('aria-busy', 'true');
  await page.locator('#city-overview').click();
  await expect(fly).toHaveAttribute('aria-busy', 'false');
});
test('zoom and camera controls are operable in the mock stage', async ({ page }) => {
  await page.goto('/?mode=mock');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  for (const action of ['in', 'out']) await page.locator(`[data-view="${action}"]`).click();
  await page.locator('#view-controls>summary').click();
  for (const action of ['left', 'right', 'up', 'down']) await page.locator(`[data-view="${action}"]`).click();
});
test('automatic failure does not auto-retry and shares the two-attempt budget',async({page})=>{await page.goto('/?mode=mock&scenario=auth');await expect(page.locator('#status')).toContainText('Access denied');await expect(page.locator('#load')).toHaveText('Retry once');await page.locator('#load').click();await expect(page.locator('#session-limit')).toBeVisible();await expect(page.locator('#load')).toBeDisabled()});
for(const width of[320,1280,1920])test(`credits/Stop/status remain accessible at${width}px`,async({page})=>{await page.setViewportSize({width,height:900});await page.goto('/?mode=mock');await expect(page.locator('#credits')).toBeVisible();await expect(page.locator('#stop')).toBeVisible();await expect(page.locator('#status')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)});
for(const scenario of['rate','timeout','network','webgl','partial'])test(`mock${scenario} has an honest stage state`,async({page})=>{await page.goto(`/?mode=mock&scenario=${scenario}`);await expect(page.locator('#status')).not.toContainText('Preparing');await expect(page.locator('#status')).not.toContainText('Loading');await expect(page.locator('#focus-area')).toBeHidden();if(scenario==='rate'||scenario==='webgl')await expect(page.locator('#load')).toBeDisabled()});
test('all 263 official areas remain selectable without a second map',async({context,page})=>{await context.route('**/data/taxi-zones.geojson',route=>route.continue());await page.goto('/?mode=mock');await expect(page.locator('#zone-picker option')).toHaveCount(264);await page.locator('#zone-picker').selectOption('161');await expect(page.locator('#selection-title')).toHaveText('Midtown Center');await expect(page.locator('svg,#zone-map')).toHaveCount(0)});
test('reduced motion, RTL and200percent text keep stage controls available',async({page})=>{await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?mode=mock&zone=161');await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.documentElement.dir='rtl'});await page.setViewportSize({width:640,height:900});await expect(page.locator('#status')).toContainText('Mock stage ready');await page.locator('#focus-area').click();await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');await expect(page.locator('#stop')).toBeVisible();await expect(page.locator('#credits')).toBeVisible()});

for (const width of [320, 640, 1440]) test(`map controls and selected area stay in view at ${width}px`, async ({ page }) => {
  const height = 900;
  await page.setViewportSize({ width, height });
  await page.goto('/?mode=mock&zone=161');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  for (const selector of ['#area-search', '#zone-picker', '#focus-area', '#city-overview', '#stop', '#credits']) {
    await expect(page.locator(selector)).toBeInViewport();
  }
  if (width === 320) {
    const inspector = await page.locator('#inspector').boundingBox();
    expect(inspector?.y).toBeGreaterThan(height / 2);
  }
  await page.locator('#focus-area').click({ trial: true });
  await page.locator('#view-controls>summary').click();
  await expect(page.locator('[data-view="left"]')).toBeInViewport();
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
  await expect(page.locator('#zone-picker')).toHaveValue('');
  await expect(page.locator('#area-search')).toBeFocused();
  await expect(page.locator('#area-search')).toBeInViewport();
});

test('320px camera labels stay inside their controls with 200 percent text',async({page})=>{
 await page.setViewportSize({width:320,height:900});
 await page.goto('/?mode=mock');
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%'});
 await expect(page.locator('#status')).toContainText('Mock stage ready');
 for(const selector of ['#city-overview','#view-controls>summary']){
  const geometry=await page.locator(selector).evaluate(control=>{
   const range=document.createRange();range.selectNodeContents(control);
   const label=range.getBoundingClientRect(),bounds=control.getBoundingClientRect();
   return {labelLeft:label.left,labelRight:label.right,left:bounds.left,right:bounds.right};
  });
  expect(geometry.labelLeft,`${selector} text must fit its left edge`).toBeGreaterThanOrEqual(geometry.left-1);
  expect(geometry.labelRight,`${selector} text must fit its right edge`).toBeLessThanOrEqual(geometry.right+1);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for (const [height, textSize] of [[568, '100%'], [900, '200%']] as const) {
  test(`credits stay in view with camera controls at 320×${height} and ${textSize} text`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height });
    await page.goto('/?mode=mock&zone=161');
    await page.evaluate(size => { document.documentElement.style.fontSize = size; }, textSize);
    await expect(page.locator('#status')).toContainText('Mock stage ready');
    const credits = page.locator('#credits');
    await expect(credits).toBeInViewport({ ratio: 1 });
    await page.locator('#city-overview').click({ trial: true });
    await page.getByRole('button', { name: 'Zoom in' }).click({ trial: true });
    await page.locator('#view-controls>summary').click();
    await page.getByRole('button', { name: 'Orbit left' }).click({ trial: true });
    await expect(credits).toBeInViewport({ ratio: 1 });
  });
}

for(const menu of ['view-controls','sources'])test(`${menu} keeps internal keyboard navigation and dismisses on Escape or focus exit`,async({page})=>{
 await page.setViewportSize({width:640,height:900});
 await page.goto('/?mode=mock');
 await expect(page.locator('#status')).toContainText('Mock stage ready');
 const details=page.locator(`#${menu}`),summary=page.locator(`#${menu}>summary`);
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

test('selection changes retain the existing native area options when the search is unchanged',async({context,page})=>{
 await context.route('**/data/taxi-zones.geojson',route=>route.continue());
 await page.goto('/?mode=mock');
 const picker=page.locator('#zone-picker');
 await expect(picker.locator('option')).toHaveCount(264);
 const originalOptions=await picker.evaluateHandle(select=>Array.from((select as HTMLSelectElement).options));
 try{
  for(const [id,title] of [['161','Midtown Center'],['162','Midtown East']]){
   await picker.selectOption(id);
   await expect(picker).toHaveValue(id);
   await expect(page.locator('#selection-title')).toHaveText(title);
   const retained=await picker.evaluate((select,previous)=>{
    const current=Array.from((select as HTMLSelectElement).options);
    return current.length===previous.length&&current.every((option,index)=>option===previous[index]);
   },originalOptions);
   expect(retained,'Selecting an area without changing the search must preserve the existing native options').toBe(true);
  }
 }finally{await originalOptions.dispose();}
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
 await page.locator('#zone-picker').selectOption('161');
 await expect(page.locator('#selection-title')).toHaveText('Synthetic test area');
 await expect(page.locator('#zone-picker')).toBeEnabled();
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
  await page.locator('#zone-picker').selectOption('161');
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
