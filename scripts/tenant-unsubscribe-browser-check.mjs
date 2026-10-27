// Rendered fixture acceptance. Every request is intercepted; no hosted service or provider is contacted.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../platform/ripe-piper-platform/package.json',import.meta.url));
const {chromium}=require('playwright'),root=new URL('../',import.meta.url),token='a'.repeat(64),tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lead='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})}),errors=[],unexpected=[],calls=[];
let mode='confirmed';
await mkdir(new URL('.preview/tenant-unsubscribe/',root),{recursive:true});
async function pageFor(width=1280){
 const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!=='https://fixture.example.invalid'){unexpected.push(request.url());return route.abort();}
  if(url.pathname==='/api/tenant-unsubscribe/confirm'){
   calls.push({method:request.method(),body:request.postDataJSON(),headers:request.headers()});
   if(mode==='network')return route.abort('failed');
   if(mode==='malformed')return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,status:'confirmed',tenantId:tenant})});
   return route.fulfill({contentType:'application/json',headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'},body:JSON.stringify({version:1,status:mode})});
  }
  const files={'/unsubscribe.html':['site/unsubscribe.html','text/html'],'/assets/tenant-unsubscribe.js':['site/assets/tenant-unsubscribe.js','application/javascript'],'/assets/tenant-unsubscribe.css':['site/assets/tenant-unsubscribe.css','text/css'],'/assets/site.css':['site/assets/site.css','text/css']};
  if(files[url.pathname]){const [file,contentType]=files[url.pathname];return route.fulfill({contentType,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'},body:await readFile(new URL(file,root),'utf8')});}
  if(url.pathname==='/staff.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Tenant stop fixture</title><link rel="stylesheet" href="/assets/site.css"></head><body><main style="max-width:720px;margin:24px auto;padding:20px" id="fixture"></main></body></html>'});
  if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
  unexpected.push(request.url());return route.abort();
 });return page;
}
try{
 for(const width of [1280,375]){
  const page=await pageFor(width),before=calls.length;await page.goto('https://fixture.example.invalid/unsubscribe.html#token='+token);await page.waitForFunction(()=>!document.getElementById('confirmStop').disabled);
  assert.equal(new URL(page.url()).hash,'');assert.equal(calls.length,before);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL('.preview/tenant-unsubscribe/public-'+width+'.png',root)),fullPage:true});
  await page.getByRole('button',{name:'Confirm contact stop'}).click();await page.waitForFunction(()=>document.getElementById('stopStatus').textContent.startsWith('Confirmed.'));
  assert.equal(calls.length,before+1);assert.equal(calls.at(-1).method,'POST');assert.deepEqual(calls.at(-1).body,{token});assert.equal(calls.at(-1).headers.referer,undefined);assert.equal(await page.locator('#confirmStop').isDisabled(),true);await page.close();
 }
 for(const failure of ['malformed','network']){
  mode=failure;const page=await pageFor(),before=calls.length;await page.goto('https://fixture.example.invalid/unsubscribe.html#token='+token);await page.getByRole('button',{name:'Confirm contact stop'}).click();await page.waitForFunction(()=>document.getElementById('stopStatus').textContent.includes('could not confirm'));
  assert.equal(calls.length,before+1);assert.equal(await page.locator('#confirmStop').isEnabled(),true);assert.match(await page.locator('#stopStatus').textContent(),/will not retry automatically/);
  mode='confirmed';await page.getByRole('button',{name:'Confirm contact stop'}).click();await page.waitForFunction(()=>document.getElementById('stopStatus').textContent.startsWith('Confirmed.'));assert.equal(calls.length,before+2);await page.close();
 }
 mode='invalid';const invalid=await pageFor();await invalid.goto('https://fixture.example.invalid/unsubscribe.html#token='+token);await invalid.getByRole('button',{name:'Confirm contact stop'}).click();await invalid.waitForFunction(()=>document.getElementById('stopStatus').textContent.includes('invalid or has expired'));assert.equal(await invalid.locator('#confirmStop').isDisabled(),true);await invalid.close();
 const page=await pageFor();await page.goto('https://fixture.example.invalid/staff.html');
 await page.evaluate(({tenant,lead,token})=>{
  window.fixtureCalls=[];window.fixtureCurrent=true;window.fixtureStopped=0;window.fixtureMode='error';
  window.RP={api:async(path,body)=>{window.fixtureCalls.push({path,body});if(window.fixtureMode==='error')throw Error('uncertain');if(window.fixtureMode==='pending')return new Promise(resolve=>window.fixtureResolve=resolve);if(body.operation==='record')return {version:1,status:'stopped',tenantId:tenant,leadId:lead,alreadyStopped:false};return {version:1,status:'issued',url:'https://fixture.example.invalid/unsubscribe.html#token='+token,expiresAt:'2027-01-01T00:00:00Z',delivery:'not_sent'};}};
 },{tenant,lead,token});
 await page.addScriptTag({content:await readFile(new URL('site/assets/tenant-stops-admin.js',root),'utf8')});
 await page.evaluate(({tenant,lead})=>{document.getElementById('fixture').innerHTML=window.RP.tenantStopMarkup({id:lead});window.RP.wireTenantStop(tenant,{id:lead},()=>window.fixtureCurrent,()=>window.fixtureStopped++);},{tenant,lead});
 assert.equal(await page.evaluate(()=>window.fixtureCalls.length),0);await page.fill('#tenantStopReference','Verified fixture objection');await page.getByRole('button',{name:'Record verified contact stop'}).click();await page.waitForFunction(()=>document.getElementById('tenantStopStatus').textContent.includes('unavailable'));
 assert.equal(await page.inputValue('#tenantStopReference'),'Verified fixture objection');assert.equal(await page.evaluate(()=>window.fixtureStopped),0);
 await page.evaluate(()=>window.fixtureMode='success');await page.getByRole('button',{name:'Create confirmation link'}).click();await page.waitForFunction(()=>document.getElementById('tenantStopStatus').textContent.includes('not sent'));assert.match(await page.inputValue('#tenantStopLink'),/#token=[0-9a-f]{64}$/);
 await page.screenshot({path:fileURLToPath(new URL('.preview/tenant-unsubscribe/staff.png',root)),fullPage:true});
 await page.evaluate(()=>window.fixtureMode='pending');await page.getByRole('button',{name:'Record verified contact stop'}).click();await page.waitForFunction(()=>typeof window.fixtureResolve==='function');
 await page.evaluate(({tenant,lead})=>{window.fixtureCurrent=false;window.fixtureResolve({version:1,status:'stopped',tenantId:tenant,leadId:lead,alreadyStopped:false});},{tenant,lead});await page.waitForFunction(()=>window.fixtureCalls.length===3);assert.equal(await page.evaluate(()=>window.fixtureStopped),0);assert.doesNotMatch(await page.locator('#tenantStopStatus').textContent(),/is recorded/);
 await page.evaluate(()=>{window.fixtureCurrent=true;window.fixtureMode='success';document.getElementById('tenantStopRecord').disabled=false;});await page.getByRole('button',{name:'Record verified contact stop'}).click();await page.waitForFunction(()=>window.fixtureStopped===1);
 assert.deepEqual(await page.evaluate(()=>window.fixtureCalls[0]),{path:`/api/admin/tenants/${tenant}/leads/${lead}/unsubscribe`,body:{operation:'record',reference:'Verified fixture objection'}});
 await page.close();assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log('Tenant unsubscribe browser acceptance passed: responsive public page, GET/no-write, fragment removal, explicit POST, invalid/error/manual retry, staff preserved input and stale-selection fencing.');
}finally{await browser.close();}

