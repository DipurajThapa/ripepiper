// Actual Signal card markup, styles and script with a synthetic in-memory API only.
import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const require=createRequire(new URL('../platform/ripe-piper-platform/package.json',import.meta.url)),{chromium}=require('playwright');
const root=new URL('../',import.meta.url),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
try{
 let html=await readFile(new URL('site/admin/index.html',root),'utf8');html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.route('https://fixture.example.invalid/',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://fixture.example.invalid/');await page.addStyleTag({content:await readFile(new URL('site/assets/site.css',root),'utf8')});
 await page.evaluate(()=>{
  const panel=document.getElementById('signalSourcesPanel');document.body.replaceChildren(panel);panel.style.display='block';window.signalCalls=[];
  window.RP={esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api:async(path,body)=>{
   window.signalCalls.push({path,body});if(body.operation==='status')return {ok:true,state:'configured_unverified',sourceId:'66666666-6666-4666-8666-666666666666',synthetic:true,contactAllowed:false};
   if(body.operation==='preview')return {ok:true,sourceId:'66666666-6666-4666-8666-666666666666',synthetic:true,contactAllowed:false,items:[{id:'change-1',company:'FixtureSource'.repeat(16),email:'fixture@example.invalid',sourceUrl:'https://company.example.com/'+('long-source-reference'.repeat(18)),observedAt:'2026-10-22T00:00:00Z',expiresAt:'2026-11-15T00:00:00Z',summary:'<script>window.untrustedExecuted=true</script>',relevance:'Possible enquiry routing need; unverified',digest:'a'.repeat(64)}],excluded:1};
   return {tenantId:'tenant-fixture',sourceId:'66666666-6666-4666-8666-666666666666',itemId:'change-1',digest:'a'.repeat(64),synthetic:true,ok:true,lead_id:'33333333-3333-4333-8333-333333333333',observation_id:'55555555-5555-4555-8555-555555555555',state:'created',delivery:'not_sent',contactAllowed:false};
  }};
 });
 await page.addScriptTag({content:await readFile(new URL('site/assets/signal-admin.js',root),'utf8')});await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rp:tenant-selected',{detail:{id:'tenant-fixture',name:'Synthetic Ripe Piper'}})));
 await page.waitForFunction(()=>document.getElementById('signalSourceStatus').textContent.includes('configured'));
 await page.getByRole('button',{name:'Preview approved source',exact:true}).click();await page.waitForFunction(()=>document.getElementById('signalSourceExcerpt').textContent.includes('<script>'));
 assert.equal(await page.locator('#signalSourceExcerpt script').count(),0);assert.equal(await page.evaluate(()=>window.untrustedExecuted),undefined);
 await page.getByRole('button',{name:'Import reviewed Signal',exact:true}).click();assert.equal(await page.evaluate(()=>window.signalCalls.some(c=>c.body.operation==='import')),false);
 await page.locator('#signalSourceReviewed').check();await page.getByRole('button',{name:'Import reviewed Signal',exact:true}).click();await page.waitForFunction(()=>document.getElementById('signalSourceStatus').textContent.includes('No contact permission'));
 const request=await page.evaluate(()=>window.signalCalls.find(c=>c.body.operation==='import'));assert.equal(request.path,'/api/admin/tenants/tenant-fixture/signal-source');assert.equal(request.body.digest,'a'.repeat(64));assert.equal(request.body.reviewed,true);
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Signal card overflow at ${width}`);}
 assert.deepEqual(errors,[]);console.log('PASS: approved Signal source preview, inert excerpt, required human review, digest-bound import, desktop/mobile; synthetic API only.');
}finally{await browser.close();}

// Continue the existing CI stage with the real CRM Signal-to-outcome journey.
await import('./qa-signal-workflow-browser.mjs');
