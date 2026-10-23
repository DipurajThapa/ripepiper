// Rendered-browser acceptance using the pinned development Playwright dependency,
// real admin markup/styles/script, and an explicitly synthetic API fixture. No network.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../platform/ripe-piper-platform/package.json',import.meta.url)),{chromium}=require('playwright');
const root=new URL('../',import.meta.url);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const failures=[];page.on('pageerror',e=>failures.push(e.message));
await page.route('**/*',route=>route.abort());
try {
 let html=await readFile(new URL('site/admin/index.html',root),'utf8');
 html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.route('https://fixture.example.invalid/',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.goto('https://fixture.example.invalid/');
 await page.addStyleTag({content:await readFile(new URL('site/assets/site.css',root),'utf8')});
 await page.evaluate(()=>{
  document.querySelectorAll('[hidden]').forEach(n=>n.removeAttribute('hidden'));
  const panel=document.getElementById('prospectingPanel'),plans=document.getElementById('campaignPlansPanel');document.body.replaceChildren(panel,plans);panel.style.display='block';plans.style.display='block';
  window.fixtureCalls=[];window.fixtureCampaigns=[];window.fixtureAssets=[];
  window.RP={esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api:async(path,body)=>{
   window.fixtureCalls.push({path,body});
   if(path.endsWith('/connection')){
    if(body.operation==='check')return {state:'identity_verified',mailbox:'staff@example.invalid',calendarId:'calendar@example.invalid'};
    if(body.operation==='list')return {messages:{items:[{id:'message1',subject:'Fixture question',observedAt:'2026-10-22T12:00:00Z'}],moreAvailable:false,excluded:0}};
    if(body.operation==='preview')return {message:{excerpt:'<script>untrusted message</script>',digest:'reviewed-source',truncated:false}};
    return {ok:true,delivery:'not_sent'};
   }
   if(path.endsWith('/campaigns')){
    if(body.operation==='list')return {campaigns:window.fixtureCampaigns,assets:window.fixtureAssets,actions:[]};
    if(body.operation==='save'){
     window.fixtureCampaigns=[{id:body.campaign_id,capability:body.body.product,purpose:body.body.purpose,market:body.body.market,timezone:body.body.timezone,asset_version:1,status:'draft'}];
     window.fixtureAssets=[{campaign_id:body.campaign_id,version:1,steps:body.body.steps}];
    }
    return {ok:true,id:body.campaign_id};
   }
   if(path.endsWith('/shortlist'))return {brief:null,leads:[{id:'lead-fixture',email:'fixture@example.invalid',company:'Synthetic company'},{id:'business-fixture',email:'contact@business.example',company:'Business fixture'}],results:[],synthetic:true};
   return {ok:true,results:[{row:1,state:'created'}]};
  }};
 });
 await page.addScriptTag({content:await readFile(new URL('site/assets/prospecting-admin.js',root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('site/assets/campaigns-admin.js',root),'utf8')});
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rp:tenant-selected',{detail:{id:'tenant-fixture',name:'Synthetic Ripe Piper'}})));
 await page.getByText('Product history and outcomes',{exact:true}).click();
 for(const product of ['revive','signal','response','events']) {
  await page.selectOption('#productChoice',product);
  await page.fill('#productReference','source-'+product);await page.fill('#productRights','fixture-only');await page.fill('#productObserved','2026-10-22T12:00');await page.fill('#productExcerpt','Staff-reviewed synthetic source');
  if(product==='revive'){await page.fill('#lastContact','2026-08-01T12:00');await page.fill('#stalledReason','Unknown');}
  if(product==='signal'){await page.fill('#signalRelevance','Fixture business need');await page.fill('#signalExpiry','2026-11-22T12:00');}
  if(product==='response'){await page.fill('#threadRef','fixture-thread');await page.selectOption('#disposition','interested');}
  if(product==='events'){await page.fill('#eventRef','fixture-event');await page.fill('#eventEnd','2026-10-21T12:00');await page.fill('#eventTimezone','UTC');}
  await page.getByRole('button',{name:'Record reviewed event',exact:true}).click();
  await page.waitForFunction(p=>window.fixtureCalls.some(c=>c.path.endsWith('/product-event')&&c.body.context.product===p),product);
 }
 await page.getByText('Import permitted contacts',{exact:true}).click();
 await page.fill('#prospectImportRows','fixture@example.invalid\tFixture\tsource-import\tfixture-only\t2026-10-22');
 await page.getByRole('button',{name:'Validate and import',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('prospectImportReport').textContent.includes('created'));
 const contexts=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.path.endsWith('/product-event')).map(c=>c.body.context));
 assert.equal(contexts.length,4);assert.equal(contexts[2].authority,'');assert.equal(contexts[3].attendance,'unknown');
 for(const product of ['response','events']){
  await page.selectOption('#productChoice',product);await page.selectOption('#productKind','outcome');
  await page.fill('#productReference','outcome-'+product);await page.fill('#productRights','fixture-only');await page.fill('#productObserved','2026-10-22T12:00');await page.fill('#productExcerpt','Owner verified meeting');
  await page.fill('#productReason','Verified by owner');await page.selectOption('#productOutcome','meeting_held');
  await page.fill(product==='response'?'#outcomeThread':'#outcomeEvent','fixture-'+product);
  await page.getByRole('button',{name:'Record reviewed event',exact:true}).click();
  await page.waitForFunction(p=>window.fixtureCalls.some(c=>c.path.endsWith('/product-event')&&c.body.context.product===p&&c.body.context.kind==='outcome'),product);
 }
 const scoped=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.body?.context?.kind==='outcome').map(c=>c.body.context));
 assert.equal(scoped[0].threadRef,'fixture-response');assert.equal(scoped[1].eventRef,'fixture-events');

 await page.fill('#campaignPurpose','Fixture reactivation');await page.fill('#campaignMarket','AE');
 await page.fill('#messageSubject0','Fixture subject');await page.fill('#messageBody0','Is this still a priority?');await page.fill('#messageEvidence0','fixture-evidence');
 await page.getByRole('button',{name:'Save draft version',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('campaignState').textContent.includes('Version 1'));
 await page.getByText('Record approval and limits',{exact:true}).click();
 await page.fill('#campaignClientAuthority','fixture-client');await page.fill('#campaignOwnerAuthority','fixture-owner');await page.fill('#campaignCTS','fixture-cts');await page.fill('#campaignCap','3');await page.fill('#campaignExpiry','2026-11-01T12:00');
 await page.fill('#messageBody0','Unsaved changed message');
 await page.getByRole('button',{name:'Approve loaded message version',exact:true}).click();
 assert.match(await page.locator('#campaignError').textContent(),/Save your message changes/);
 assert.equal(await page.evaluate(()=>window.fixtureCalls.some(c=>c.body.operation==='approve')),false);
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Horizontal overflow at ${width}`);}

 // Review and import selected inbox evidence through the existing prospect workspace.
 await page.selectOption('#prospectMode','business');
 await page.waitForFunction(()=>document.getElementById('inboxLead').value==='business-fixture');
 await page.getByText('Read selected inbox messages',{exact:true}).click();
 await page.getByRole('button',{name:'Check inbox and calendar connection',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('inboxStatus').textContent.includes('Account identity verified'));
 await page.getByRole('button',{name:'Find recent messages for this contact',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('inboxMessage').value==='message1');
 await page.getByRole('button',{name:'Import for human review',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.fixtureCalls.some(c=>c.body.operation==='import')),false);
 await page.getByRole('button',{name:'Preview selected message',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('inboxExcerpt').textContent.includes('untrusted message'));
 assert.equal(await page.locator('#inboxExcerpt script').count(),0);
 await page.check('#inboxReviewed');
 await page.getByRole('button',{name:'Import for human review',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('inboxStatus').textContent.includes('no reply was sent'));
 assert.equal(await page.evaluate(()=>window.fixtureCalls.find(c=>c.body.operation==='import').body.digest),'reviewed-source');
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Inbox overflow at ${width}`);}
 // Exercise the real meeting admin UI and shared helpers with a synthetic database/provider boundary.
 await page.goto('https://fixture.example.invalid/');
 await page.addStyleTag({content:await readFile(new URL('site/assets/site.css',root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('site/assets/app-common.js',root),'utf8')});
 await page.evaluate(()=>{
  window.reconcileCalls=[];window.calendarReady=false;
  window.fixtureMeeting={id:'11111111-1111-4111-8111-111111111111',start_at:'2026-11-01T08:00:00Z',end_at:'2026-11-01T08:15:00Z',attendee_email:'fixture@example.invalid',status:'booked',meet_url:null};
  RP.demo=false;RP.auth=ready=>{document.getElementById('app').hidden=false;ready({id:'fixture',email:'staff@example.invalid'});};
  RP.sb={from:table=>{
   const result=()=>({data:table==='profiles'?{is_admin:true}:table==='meetings'?[{...window.fixtureMeeting}]:[]});
   const q={select:()=>q,is:()=>q,order:()=>q,limit:()=>q,eq:()=>q,single:()=>q,then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject)};return q;
  }};
  RP.api=async(path,body)=>{
   window.reconcileCalls.push({path,body});
   if(!window.calendarReady)throw Error('Calendar confirmation is still unavailable.');
   window.fixtureMeeting.meet_url='https://meet.google.com/abc-defg-hij';return {ok:true,delivery:'not_sent'};
  };
 });
 await page.addScriptTag({content:await readFile(new URL('site/assets/admin.js',root),'utf8')});
 await page.locator('[data-tab="meetings"]').click();
 await page.locator('#meetingsTable tr.click').click();
 assert.match(await page.locator('#meetingDetail').textContent(),/time remains reserved/);
 await page.evaluate(()=>RP.demo=true);
 await page.getByRole('button',{name:'Check calendar confirmation',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.reconcileCalls.length),0);
 await page.evaluate(()=>RP.demo=false);
 await page.getByRole('button',{name:'Check calendar confirmation',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('calendarReview').textContent.includes('still unavailable'));
 await page.evaluate(()=>window.calendarReady=true);
 await page.getByRole('button',{name:'Check calendar confirmation',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#meetingDetail a')?.href==='https://meet.google.com/abc-defg-hij');
 assert.equal(await page.evaluate(()=>window.reconcileCalls.length),2);
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Meeting overflow at ${width}`);}
 assert.deepEqual(failures,[]);
 console.log('PASS: four rendered product forms, import/report, campaign draft and dirty-approval guard, desktop/mobile overflow, inbox preview/review/import, meeting reconciliation/sample/error/recovery, no page errors; synthetic API only.');
}finally{await browser.close();}
