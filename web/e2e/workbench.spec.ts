import{test,expect}from'@playwright/test';
// Verification mode blocks provider requests; live visual checks are separate.
const fixture={type:'FeatureCollection',features:[{type:'Feature',id:161,properties:{location_id:161,zone:'Synthetic test area',borough:'Manhattan'},geometry:{type:'Polygon',coordinates:[[[-74,40.7],[-73.99,40.7],[-73.99,40.71],[-74,40.7]]]}}]};
test.beforeEach(async({context})=>{await context.route('**/*',route=>{if(route.request().url().endsWith('/data/taxi-zones.geojson'))return route.fulfill({json:fixture});return new URL(route.request().url()).origin==='http://127.0.0.1:5175'?route.continue():route.abort('blockedbyclient')})});
async function areas(page:import('@playwright/test').Page){await page.locator('#area-controls>summary').click();}
test('verification startup cannot open live imagery and retains a truthful full-window stage',async({page})=>{const external:string[]=[];page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1')external.push('external')});await page.goto('/');await expect(page.locator('#city-viewport')).toHaveCount(1);await expect(page.locator('svg,#zone-map')).toHaveCount(0);await expect(page.getByText('Add your public Cesium ion token')).toBeVisible();await expect(page.locator('#load')).toBeDisabled();expect(external).toEqual([])});
test('mock stage starts automatically once, Stop stays stopped until deliberate Resume',async({page})=>{await page.goto('/?mode=mock');await expect(page.locator('#status')).toContainText('Mock stage ready');await expect(page.locator('#load')).toBeHidden();await page.locator('#stop').click();await expect(page.locator('#status')).toContainText('unloaded');await expect(page.locator('#load')).toBeVisible();await page.locator('#load').click();await expect(page.locator('#status')).toContainText('Mock stage ready');await page.locator('#stop').click();await expect(page.locator('#load')).toBeDisabled()});
test('Stop before delayed geography prevents automatic startup',async({context,page})=>{let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve});await context.route('**/data/taxi-zones.geojson',async route=>{await wait;await route.fulfill({json:fixture})});await page.goto('/?mode=mock');await page.locator('#stop').click();release();await areas(page);await expect(page.locator('#zone-picker')).toBeEnabled();await expect(page.locator('#status')).toContainText('unloaded');await expect(page.locator('#load')).toBeEnabled()});
test('local filtering preserves selection and never causes a camera focus',async({page})=>{await page.goto('/?mode=mock&zone=161');await expect(page.locator('#zone-id')).toHaveText('161');await areas(page);await page.getByRole('searchbox',{name:'Search TLC areas'}).fill('no match');await expect(page.locator('#search-count')).toContainText('No matching');await expect(page.locator('#zone-id')).toHaveText('161');await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');await page.locator('#clear-search').click();await expect(page.locator('#zone-picker')).toHaveValue('161');await page.locator('#clear-selection').click();await expect(page.locator('#inspector')).toBeHidden()});
test('native focus/overview/view controls have bounded mock behavior',async({page})=>{await page.goto('/?mode=mock&zone=161');await expect(page.locator('#status')).toContainText('Mock stage ready');await page.locator('#focus-area').click();await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','true');await page.locator('#city-overview').click();await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');await page.locator('#view-controls>summary').click();for(const action of ['left','right','up','down','in','out'])await page.locator(`[data-view="${action}"]`).click()});
test('automatic failure does not auto-retry and shares the two-attempt budget',async({page})=>{await page.goto('/?mode=mock&scenario=auth');await expect(page.locator('#status')).toContainText('Access denied');await expect(page.locator('#load')).toHaveText('Retry once');await page.locator('#load').click();await expect(page.locator('#session-limit')).toBeVisible();await expect(page.locator('#load')).toBeDisabled()});
for(const width of[320,1280,1920])test(`credits/Stop/status remain accessible at${width}px`,async({page})=>{await page.setViewportSize({width,height:900});await page.goto('/?mode=mock');await expect(page.locator('#credits')).toBeVisible();await expect(page.locator('#stop')).toBeVisible();await expect(page.locator('#status')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)});
for(const scenario of['rate','timeout','network','webgl','partial'])test(`mock${scenario} has an honest stage state`,async({page})=>{await page.goto(`/?mode=mock&scenario=${scenario}`);await expect(page.locator('#status')).not.toContainText('Preparing');await expect(page.locator('#status')).not.toContainText('Loading');await expect(page.locator('#focus-area')).toBeHidden();if(scenario==='rate'||scenario==='webgl')await expect(page.locator('#load')).toBeDisabled()});
test('all263 official areas remain selectable without a second map',async({context,page})=>{await context.route('**/data/taxi-zones.geojson',route=>route.continue());await page.goto('/?mode=mock');await areas(page);await expect(page.locator('#zone-picker option')).toHaveCount(264);await page.locator('#zone-picker').selectOption('161');await expect(page.locator('#selection-title')).toHaveText('Midtown Center');await expect(page.locator('svg,#zone-map')).toHaveCount(0)});
test('reduced motion, RTL and200percent text keep stage controls available',async({page})=>{await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?mode=mock&zone=161');await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.documentElement.dir='rtl'});await page.setViewportSize({width:640,height:900});await expect(page.locator('#status')).toContainText('Mock stage ready');await page.locator('#focus-area').click();await expect(page.locator('#focus-area')).toHaveAttribute('aria-busy','false');await expect(page.locator('#stop')).toBeVisible();await expect(page.locator('#credits')).toBeVisible()});

for(const width of [320,640,1440])test(`compact controls preserve city space and selection at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/?mode=mock&zone=161');
 await expect(page.locator('#status')).toContainText('Mock stage ready');
 const toolbar=await page.locator('.stage-tools').boundingBox();
 const inspector=await page.locator('#inspector').boundingBox();
 const credits=await page.locator('.attribution-strip').boundingBox();
 expect(toolbar&&inspector&&credits).toBeTruthy();expect(toolbar!.height).toBeLessThan(80);
 expect(toolbar!.y+toolbar!.height).toBeLessThanOrEqual(credits!.y);
 if(width<=640){expect(inspector!.height).toBeLessThanOrEqual(235);expect(inspector!.y+inspector!.height).toBeLessThanOrEqual(toolbar!.y);}
 await areas(page);await expect(page.locator('#area-search')).toBeVisible();
 await page.locator('#view-controls>summary').click();await expect(page.locator('#area-search')).toBeHidden();
 await expect(page.locator('[data-view="left"]')).toBeVisible();
});

for(const width of [320,640])test(`keyboard focus stays visible after leaving the area menu at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/?mode=mock&zone=161');
 if(width===640)await page.evaluate(()=>{document.documentElement.style.fontSize='200%'});
 await expect(page.locator('#status')).toContainText('Mock stage ready');
 await areas(page);
 await page.locator('#zone-picker').focus();
 // Native tab order exits the area menu through Overview and View to the inspector.
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Tab');
 const focus=page.locator('#focus-area');
 await expect(focus).toBeFocused();
 const unobscured=await focus.evaluate(button=>{
  const bounds=button.getBoundingClientRect();
  const hit=document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  return Boolean(hit&&(hit===button||button.contains(hit)));
 });
 expect(unobscured,'The focused inspector action must not remain underneath an open menu').toBe(true);
});

test('320px toolbar labels stay inside their controls with 200percent text',async({page})=>{
 await page.setViewportSize({width:320,height:900});
 await page.goto('/?mode=mock');
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%'});
 await expect(page.locator('#status')).toContainText('Mock stage ready');
 for(const selector of ['#area-controls>summary','#city-overview','#view-controls>summary']){
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

for(const menu of ['area-controls','sources'])test(`${menu} keeps internal keyboard navigation and dismisses on Escape or focus exit`,async({page})=>{
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
 await page.goto('/?mode=mock');await areas(page);
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

// These tests cover local asset loading and geography recovery, not live clipping.
test('default and differently cased cutout flags do not request the candidate land asset',async({page})=>{
 const assetRequests:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname==='/data/city-land.json')assetRequests.push('land')});
 for(const suffix of ['', '&cutout=LAND']){
  await page.goto(`/?mode=mock${suffix}`);
  await expect(page.locator('#status')).toContainText('Mock stage ready');
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
 await areas(page);await page.locator('#zone-picker').selectOption('161');
 await expect(page.locator('#selection-title')).toHaveText('Synthetic test area');
 await expect(page.locator('#zone-picker')).toBeEnabled();
 expect(assetRequests).toEqual(['land']);expect(external).toEqual([]);
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
  await page.goto('/?mode=mock&cutout=land');await areas(page);
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
