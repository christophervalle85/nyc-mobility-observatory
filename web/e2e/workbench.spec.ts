import{test,expect}from'@playwright/test';
// Verification mode blocks provider requests; live visual checks are separate.
const fixture={type:'FeatureCollection',features:[{type:'Feature',id:161,properties:{location_id:161,zone:'Synthetic test area',borough:'Manhattan'},geometry:{type:'Polygon',coordinates:[[[-74,40.7],[-73.99,40.7],[-73.99,40.71],[-74,40.7]]]}}]};
test.beforeEach(async({context})=>{await context.route('**/*',route=>{if(route.request().url().endsWith('/data/taxi-zones.geojson'))return route.fulfill({json:fixture});return new URL(route.request().url()).origin==='http://127.0.0.1:5175'?route.continue():route.abort('blockedbyclient')})});
test('area search is visible without opening a menu', async ({ page }) => {
  await page.goto('/?mode=mock');
  await expect(page.locator('#area-search')).toBeVisible();
  await expect(page.locator('#area-search')).toBeEnabled();
});
test('the map omits the visible title and stacks named symbol controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?mode=mock');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  const titleDisplayed = await page.getByText('NYC Mobility Observatory', { exact: true }).evaluateAll(elements =>
    elements.some(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 1 && bounds.height > 1 && getComputedStyle(element).visibility === 'visible';
    }),
  );
  expect.soft(titleDisplayed, 'The app name should not occupy visible map space').toBe(false);

  const overview = page.locator('#city-overview');
  const camera = page.locator('#view-controls>summary');
  await expect(overview).toHaveAccessibleName('Show all NYC');
  await expect(camera).toHaveAccessibleName('Camera controls');
  await expect(overview).toHaveText('');
  await expect(camera).toHaveText('');
  await expect(overview).toHaveAttribute('title', 'Show all NYC');
  await expect(camera).toHaveAttribute('title', 'Camera controls');
  const overviewBox = (await overview.boundingBox())!;
  const cameraBox = (await camera.boundingBox())!;
  for (const target of [overviewBox, cameraBox]) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  expect.soft(cameraBox.y, 'Camera controls should sit below Show all NYC').toBeGreaterThanOrEqual(overviewBox.y + overviewBox.height);
  expect.soft(Math.abs(cameraBox.x + cameraBox.width - overviewBox.x - overviewBox.width)).toBeLessThanOrEqual(2);
  expect(cameraBox.x).toBeGreaterThan(1280 / 2);
  expect(cameraBox.y).toBeGreaterThan(900 / 2);
  await camera.press('Enter');
  const panel = page.locator('#view-controls .tool-content');
  await expect(panel).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.x + panelBox.width, 'The camera menu should open to the left of its control').toBeLessThanOrEqual(cameraBox.x + 2);
});
test('verification startup cannot open live imagery and retains a truthful full-window stage',async({page})=>{const external:string[]=[];page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1')external.push('external')});await page.goto('/');await expect(page.locator('#city-viewport')).toHaveCount(1);await expect(page.locator('svg:not(button svg, summary svg),#zone-map')).toHaveCount(0);await expect(page.getByText('Add your public Cesium ion token')).toBeVisible();await expect(page.locator('#load')).toBeDisabled();expect(external).toEqual([])});
test('mock stage starts automatically once, Stop stays stopped until deliberate Resume',async({page})=>{await page.goto('/?mode=mock');await expect(page.locator('#status')).toContainText('Mock stage ready');await expect(page.locator('#load')).toBeHidden();await page.locator('#stop').click();await expect(page.locator('#status')).toContainText('unloaded');await expect(page.locator('#load')).toBeVisible();await page.locator('#load').click();await expect(page.locator('#status')).toContainText('Mock stage ready');await page.locator('#stop').click();await expect(page.locator('#load')).toBeDisabled()});
test('Stop before delayed geography prevents automatic startup',async({context,page})=>{let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve});await context.route('**/data/taxi-zones.geojson',async route=>{await wait;await route.fulfill({json:fixture})});await page.goto('/?mode=mock');await page.locator('#stop').click();release();await expect(page.locator('#zone-picker')).toBeEnabled();await expect(page.locator('#status')).toContainText('unloaded');await expect(page.locator('#load')).toBeEnabled()});
test('local filtering preserves selection and never causes a camera focus',async({page})=>{await page.goto('/?mode=mock&zone=161');await expect(page.locator('#zone-id')).toHaveText('161');await page.locator('#area-search').fill('no match');await expect(page.locator('#search-count')).toContainText('No matching');await expect(page.locator('#zone-id')).toHaveText('161');await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');await page.locator('#clear-search').click();await expect(page.locator('#zone-picker')).toHaveValue('161')});
test('keyboard search selects an area before the user explicitly focuses it', async ({ context, page }) => {
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
  const focus = page.getByRole('button', { name: 'Focus', exact: true });
  await expect(focus).toHaveAttribute('aria-busy', 'false');
  await focus.press('Enter');
  await expect(focus).toHaveAttribute('aria-busy', 'true');
  await page.locator('#city-overview').click();
  await expect(focus).toHaveAttribute('aria-busy', 'false');
});
test('zoom and camera controls are operable in the mock stage', async ({ page }) => {
  await page.goto('/?mode=mock');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeHidden();
  await page.locator('#view-controls>summary').click();
  for (const action of ['left', 'right', 'up', 'down', 'in', 'out']) await page.locator(`#view-controls [data-view="${action}"]`).click();
});
test('automatic failure does not auto-retry and shares the two-attempt budget',async({page})=>{await page.goto('/?mode=mock&scenario=auth');await expect(page.locator('#status')).toContainText('Access denied');await expect(page.locator('#load')).toHaveText('Retry once');await page.locator('#load').click();await expect(page.locator('#session-limit')).toBeVisible();await expect(page.locator('#load')).toBeDisabled()});
for(const width of[320,1280,1920])test(`credits/Stop/status remain accessible at${width}px`,async({page})=>{await page.setViewportSize({width,height:900});await page.goto('/?mode=mock');await expect(page.locator('#credits')).toBeVisible();await expect(page.locator('#stop')).toBeVisible();await expect(page.locator('#status')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)});
for(const scenario of['rate','timeout','network','webgl','partial'])test(`mock${scenario} has an honest stage state`,async({page})=>{await page.goto(`/?mode=mock&scenario=${scenario}`);await expect(page.locator('#status')).not.toContainText('Preparing');await expect(page.locator('#status')).not.toContainText('Loading');await expect(page.locator('#focus-area')).toBeHidden();if(scenario==='rate'||scenario==='webgl')await expect(page.locator('#load')).toBeDisabled()});
test('all 263 official areas remain selectable without a second map',async({context,page})=>{await context.route('**/data/taxi-zones.geojson',route=>route.continue());await page.goto('/?mode=mock');await expect(page.locator('#zone-picker option')).toHaveCount(264);await page.locator('#zone-picker').selectOption('161');await expect(page.locator('#selection-title')).toHaveText('Midtown Center');await expect(page.locator('svg:not(button svg, summary svg),#zone-map')).toHaveCount(0)});
test('reduced motion, RTL and200percent text keep stage controls available',async({page})=>{await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?mode=mock&zone=161');await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.documentElement.dir='rtl'});await page.setViewportSize({width:640,height:900});await expect(page.locator('#status')).toContainText('Mock stage ready');await page.locator('#focus-area').click();await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');await expect(page.locator('#stop')).toBeVisible();await expect(page.locator('#credits')).toBeVisible()});

test('desktop area details stay compact and usable', async ({ context, page }) => {
  await context.route('**/data/taxi-zones.geojson', route => route.continue());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?mode=mock&zone=161');
  await expect(page.locator('#status')).toContainText('Mock stage ready');
  const card = page.locator('#inspector');
  await expect(card.getByRole('heading', { name: 'Midtown Center' })).toBeInViewport();
  await expect(card.locator('#zone-borough')).toHaveText('Manhattan');
  await expect(card.locator('#zone-id')).toHaveText('161');
  await expect(card.locator('#zone-borough')).toBeInViewport();
  await expect(card.locator('#zone-id')).toBeInViewport();

  const bounds = (await card.boundingBox())!;
  expect.soft(bounds.width, 'The normal desktop card should leave room for the map').toBeLessThanOrEqual(208);
  expect.soft(bounds.height, 'A short area title should fit in the compact card').toBeLessThanOrEqual(103);
  await card.getByRole('button', { name: 'Focus', exact: true }).click({ trial: true });
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
  for (const selector of ['#area-search', '#zone-picker', '#focus-area', '#city-overview', '#stop', '#credits']) {
    await expect(page.locator(selector)).toBeInViewport();
  }
  const searchPanel = (await page.locator('#area-controls').boundingBox())!;
  const inspector = (await page.locator('#inspector').boundingBox())!;
  const gap = inspector.y - (searchPanel.y + searchPanel.height);
  expect(gap, 'Mock selection details should appear under search').toBeGreaterThanOrEqual(0);
  expect(gap, 'Mock selection details should stay close to search').toBeLessThanOrEqual(12);
  expect(inspector.x).toBeLessThan(searchPanel.x + searchPanel.width);
  expect(inspector.x + inspector.width).toBeGreaterThan(searchPanel.x);
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
 await page.locator('#view-controls>summary').click();
 for(const label of ['Orbit left','Orbit right','Tilt up','Tilt down','Zoom in','Zoom out']){
  const geometry=await page.getByRole('button',{name:label}).evaluate(control=>{
   const range=document.createRange();range.selectNodeContents(control);
   const label=range.getBoundingClientRect(),bounds=control.getBoundingClientRect();
   return {labelLeft:label.left,labelRight:label.right,left:bounds.left,right:bounds.right};
  });
  expect(geometry.labelLeft,`${label} text must fit its left edge`).toBeGreaterThanOrEqual(geometry.left-1);
  expect(geometry.labelRight,`${label} text must fit its right edge`).toBeLessThanOrEqual(geometry.right+1);
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
    await page.locator('#view-controls>summary').click();
    await page.getByRole('button', { name: 'Zoom in' }).click({ trial: true });
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
