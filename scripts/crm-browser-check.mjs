// Independent whole-CRM rendered acceptance. Real shell, styles, app-common,
// admin and product modules; synthetic Supabase SDK/API only. No network exits.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../platform/ripe-piper-platform/package.json',import.meta.url));
const {chromium}=require('playwright'),root=new URL('../',import.meta.url),origin='https://crm.example.invalid';
const marked=await readFile(new URL('../marked.min.js',pathToFileURL(require.resolve('marked'))),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
const tenant='21111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
function rows(){const now=Date.now();return {
 leads:[{id:'l1',tenant_id:null,name:'Alice Inquirer',email:'alice@example.invalid',company:'Alpha Construction',status:'new',created_at:new Date(now-3600000).toISOString(),package_interest:'revive',deal_band:1},{id:'l2',tenant_id:null,name:'Beatrice Buyer',email:'beatrice@example.invalid',company:'Beta Systems',status:'qualified',created_at:new Date(now-86400000).toISOString(),package_interest:'signal',deal_band:2},{id:'l3',tenant_id:null,name:'Carma Contact',email:'carma@example.invalid',company:'Gamma Studio',status:'not_fit',created_at:new Date(now-172800000).toISOString(),package_interest:'unsure',deal_band:0},{id:'private-prospect',tenant_id:tenant,name:'TENANT PROSPECT MUST NOT APPEAR',email:'private@example.invalid',company:'Tenant prospect',status:'new',created_at:new Date(now).toISOString()}],
 meetings:[{id:'m1',tenant_id:null,lead_id:'l1',attendee_name:'Alice Inquirer',attendee_email:'alice@example.invalid',status:'booked',start_at:new Date(now+86400000).toISOString(),end_at:new Date(now+86400000+900000).toISOString(),meet_url:null}],
 proposals:[{id:'p1',client_email:'beatrice@example.invalid',status:'draft',plan:'engine',package:'revive',currency:'AED',fixed_amount:1000,advance_pct:10,advance_amount:100,created_at:new Date(now-86400000).toISOString(),content_md:'Reviewed synthetic proposal'}],
 tenants:[{id:tenant,name:'Alpha Client',slug:'alpha-client',status:'onboarding',package:'revive',plan:'engine',currency:'AED',country:'AE',execution_version:0},{id:'23333333-3333-4333-8333-333333333333',name:'Beta Client',slug:'beta-client',status:'active',package:'signal',plan:'engine',currency:'AED',country:'AE',execution_version:0}],posts:[],business_briefs:[]};}
function fixture(mode){const data=rows();if(mode==='empty')for(const key of Object.keys(data))data[key]=[];if(mode==='partial')data.leads=Array.from({length:301},(_,i)=>({...data.leads[0],id:'bounded-'+i,name:'Bounded inquiry '+i,email:'bounded'+i+'@example.invalid'}));return {mode,data};}
async function open(mode='connected',hash='',width=1280){
 const context=await browser.newContext({viewport:{width,height:900},locale:'en-GB'}),page=await context.newPage(),errors=[],blocked=[];
 page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({fixture,actor})=>{
  window.__crmTest={...fixture,queries:[],api:[],writes:[],rejections:[],pending:[],release:false};
  addEventListener('unhandledrejection',e=>window.__crmTest.rejections.push(String(e.reason)));
  function query(table){const state=window.__crmTest,q={filters:[],max:null,singleRow:false,options:null,sorting:null};const chain={
   select(_fields,options){q.options=options;return chain;},eq(key,value){q.filters.push({key,value,operator:'eq'});return chain;},is(key,value){q.filters.push({key,value,operator:'is'});return chain;},order(key,options){q.sorting={key,ascending:options?.ascending!==false};return chain;},limit(max){q.max=max;return chain;},single(){q.singleRow=true;return chain;},maybeSingle(){q.singleRow=true;return chain;},range(from,to){q.max=to-from+1;return chain;},
   insert(){state.writes.push(table);throw Error('Fixture forbids database writes');},update(){state.writes.push(table);throw Error('Fixture forbids database writes');},upsert(){state.writes.push(table);throw Error('Fixture forbids database writes');},delete(){state.writes.push(table);throw Error('Fixture forbids database writes');},
   then(resolve,reject){state.queries.push({table,filters:q.filters,options:q.options,max:q.max});const execute=()=>{
    if(table==='profiles')return {data:state.mode==='profile-error'?{is_admin:true}:{id:actor,is_admin:state.mode!=='denied'},error:state.mode==='profile-error'?{message:'Synthetic profile permission error'}:null};
    if(state.fail||state.mode==='error'){if(table==='leads')return {data:null,error:{message:'Synthetic database read error'},count:null};}
    if(state.mode==='reject'&&table==='meetings')throw Error('Synthetic rejected read');
    let data=(state.data[table]||[]).filter(row=>q.filters.every(f=>(row[f.key]??null)===f.value));if(q.sorting)data=data.toSorted((a,b)=>String(a[q.sorting.key]??'').localeCompare(String(b[q.sorting.key]??''))*(q.sorting.ascending?1:-1));const count=data.length;if(q.max!==null)data=data.slice(0,q.max);return {data:q.singleRow?(data[0]??null):data,error:null,count};
   };const task=state.mode==='loading'&&table!=='profiles'&&!state.release?new Promise((done,fail)=>state.pending.push(()=>{try{done(execute());}catch(e){fail(e);}})):Promise.resolve().then(execute);return task.then(resolve,reject);}
  };return chain;}
  window.supabase={createClient:()=>({from:query,auth:{getSession:()=>Promise.resolve({data:{session:window.__crmTest.mode==='signed-out'?null:{access_token:'synthetic-token',user:{id:actor,email:'qa-staff@example.invalid'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithOAuth:()=>{throw Error('Auth mutation forbidden');},signInWithOtp:()=>{throw Error('Auth mutation forbidden');},signOut:()=>{throw Error('Auth mutation forbidden');}}})};
 },{fixture:fixture(mode),actor});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname==='cdn.jsdelivr.net'){
   if(url.pathname.includes('supabase'))return route.fulfill({contentType:'text/javascript',body:'/* Synthetic Supabase supplied before actual app-common loads. */'});
   if(url.pathname.includes('marked'))return route.fulfill({contentType:'text/javascript',body:marked});
  }
  if(url.origin!==origin){blocked.push(url.href);return route.abort();}
  if(url.pathname.startsWith('/api/')){
   const body=request.postDataJSON()||{};await page.evaluate(({path,body})=>window.__crmTest.api.push({path,body}),{path:url.pathname,body});
   const id=url.pathname.split('/')[4],setupContext={tenantId:id,setup:null,currentBriefVersion:null,ready:false,missing:['setup_required'],owners:[{id:actor,label:'Synthetic staff'}],brief:null};let result;
   if(url.pathname.endsWith('/revive-setup')&&body.operation==='get')result={ok:true,context:setupContext,delivery:'not_sent'};
   else if(url.pathname.endsWith('/campaigns')&&body.operation==='list')result={ok:true,campaigns:[],assets:[],actions:[],leads:[],sources:[],draftLeads:[],draftSources:[],audienceCandidates:[],setupContext,delivery:'synthetic_only'};
   else if(url.pathname.endsWith('/shortlist'))result={ok:true,brief:null,leads:[],results:[],synthetic:true};
   else if(url.pathname.endsWith('/signal-source')&&body.operation==='status')result={ok:true,state:'disabled'};
   else if(url.pathname.endsWith('/events')&&body.operation==='list')result={ok:true,campaigns:[],registrations:[],registrationEnabled:false};
   else {await page.evaluate(path=>window.__crmTest.writes.push(path),url.pathname);return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'Fixture blocks this operation'})});}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  }
  if(url.pathname==='/assets/config.js')return route.fulfill({contentType:'text/javascript',body:'window.RP_CONFIG='+JSON.stringify(mode==='sample'?{live:false,supabaseUrl:'',supabaseAnonKey:'',apiBase:''}:{live:false,supabaseUrl:'https://crm-db.example.invalid',supabaseAnonKey:'synthetic-public',apiBase:origin})+';'});
  if(!['GET','HEAD'].includes(request.method()))throw Error('Unexpected fixture method');
  const path=url.pathname==='/admin/'?'site/admin/index.html':'site'+decodeURIComponent(url.pathname);if(path.includes('..'))return route.abort();
  try{const contentType=path.endsWith('.html')?'text/html':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'image/svg+xml';return route.fulfill({contentType,body:await readFile(new URL(path,root))});}catch{return route.fulfill({status:404,body:'Fixture file unavailable'});}
 });
 await page.goto(origin+'/admin/'+hash);return {page,context,errors,blocked};
}
async function settled(page){await page.locator('#crmOverview [data-crm-source]').waitFor({state:'visible'});}
async function active(page,name){await page.locator(`[data-panel="${name}"]`).waitFor({state:'visible'});assert.equal(await page.locator('#crmNavigation [aria-current="page"]').getAttribute('data-tab'),name);assert.equal(await page.locator('[data-panel]:visible').count(),1);}
async function healthy(f){assert.ok(f.blocked.every(url=>['fonts.googleapis.com','fonts.gstatic.com'].includes(new URL(url).hostname)),'Unexpected external request attempted: '+f.blocked.join(', '));assert.deepEqual(f.errors,[]);assert.deepEqual(await f.page.evaluate(()=>window.__crmTest.rejections),[]);assert.deepEqual(await f.page.evaluate(()=>window.__crmTest.writes),[]);}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
try{
 // Sample mode uses the real app-common demo decision, not an overridden RP.
 {
  const f=await open('sample');await settled(f.page);await active(f.page,'overview');assert.match(await f.page.locator('#demoNote').textContent(),/sample|illustrative/i);assert.match(await f.page.locator('[data-crm-source]').textContent(),/sample/i);assert.equal(await f.page.evaluate(()=>window.RP.demo),true);
  assert.doesNotMatch(await f.page.locator('#crmOverview').textContent(),/\b\d+(?:\.\d+)?%\s*(?:conversion|uplift|win)/i);await noOverflow(f.page);await healthy(f);await f.context.close();
 }
 {
  const f=await open(),p=f.page;await settled(p);await active(p,'overview');assert.match(await p.locator('[data-crm-source]').textContent(),/connected/i);assert.equal(await p.locator('#demoNote').isVisible(),false);assert.match(await p.locator('[data-crm-kpi="inquiries"] .crm-kpi-value').textContent(),/\b3\b/);assert.doesNotMatch(await p.locator('#crmOverview').textContent(),/TENANT PROSPECT MUST NOT APPEAR/);
  await p.locator('[data-tab="leads"]').click();await active(p,'leads');await p.fill('#leadSearch','beta');assert.equal(await p.locator('#leadsTable tbody tr').count(),1);assert.match(await p.locator('#leadsTable').textContent(),/Beatrice/);await p.selectOption('#leadFilter','new');assert.equal(await p.locator('#leadsTable tbody tr').count(),0);await p.fill('#leadSearch','');assert.equal(await p.locator('#leadsTable tbody tr').count(),1);await p.selectOption('#leadFilter','');assert.equal(await p.locator('#leadsTable tbody tr').count(),3);assert.doesNotMatch(await p.locator('#leadsTable').textContent(),/TENANT PROSPECT/);
  await p.locator('[data-tab="clients"]').click();await active(p,'clients');await p.goBack();await active(p,'leads');await p.goForward();await active(p,'clients');await p.evaluate(()=>location.hash='meetings');await active(p,'meetings');await p.locator('[data-tab="proposals"]').focus();await p.keyboard.press('Enter');await active(p,'proposals');
  await p.locator('[data-tab="clients"]').click();const client=p.locator('#tenantsTable tbody tr').filter({hasText:'Alpha Client'});await client.focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.getElementById('crmClientName').textContent.includes('Alpha Client'));await p.waitForFunction(()=>document.getElementById('briefVersion')?.textContent.includes('No brief saved yet'));
  await p.locator('[data-workspace="brief"]').click();await p.locator('#prospectingPanel details').filter({has:p.locator('#briefForm')}).locator('summary').click();await p.fill('#briefOffer','UNSAVED QA OFFER');
  await p.locator('[data-workspace="setup"]').click();await p.waitForFunction(()=>document.getElementById('reviveSetupStatus')?.textContent.includes('No saved setup'));await p.fill('#setupSenderName','UNSAVED QA SENDER');await p.locator('[data-workspace="campaigns"]').click();await p.locator('#campaignPlansPanel').waitFor({state:'visible'});await p.locator('[data-workspace="brief"]').click();assert.equal(await p.inputValue('#briefOffer'),'UNSAVED QA OFFER');await p.locator('[data-workspace="setup"]').click();assert.equal(await p.inputValue('#setupSenderName'),'UNSAVED QA SENDER');
  await p.locator('[data-tab="overview"]').click();await p.locator('[data-tab="clients"]').click();assert.equal(await p.inputValue('#setupSenderName'),'UNSAVED QA SENDER');assert.equal(await p.locator('[data-workspace-panel]:visible').count(),1);
  await noOverflow(p);await p.setViewportSize({width:390,height:844});assert.deepEqual(await p.locator('#crmNavigation [data-tab]').evaluateAll(links=>links.filter(link=>link.scrollWidth>link.clientWidth+1).map(link=>({tab:link.dataset.tab,content:link.scrollWidth,available:link.clientWidth}))),[],'Mobile navigation labels must fit within their own link rather than overlap neighboring links');for(const tab of ['overview','leads','meetings','proposals','clients','blog']){await p.locator(`[data-tab="${tab}"]`).click();await active(p,tab);await noOverflow(p);}await p.locator('[data-tab="clients"]').click();for(const workspace of ['account','brief','setup','campaigns','signal','events']){await p.locator(`[data-workspace="${workspace}"]`).click();await p.locator(`[data-workspace-panel="${workspace}"]`).waitFor({state:'visible'});await noOverflow(p);}
  await p.setViewportSize({width:1280,height:900});await p.locator('[data-tab="overview"]').click();await p.evaluate(()=>window.__crmTest.fail=true);await p.locator('#crmRefresh').click();await p.waitForFunction(()=>/unavailable|failed|error|stale|could not/i.test(document.getElementById('crmDataStatus').textContent));assert.equal(await p.locator('#crmOverview [data-crm-kpi]:visible').count(),0);await p.locator('[data-tab="leads"]').click();assert.match(await p.locator('#leadsTable').textContent(),/Alice/);assert.match(await p.locator('#crmDataStatus').textContent(),/stale|previous|unavailable|failed/i);
  await p.evaluate(()=>window.__crmTest.fail=false);await p.locator('#crmRefresh').click();await p.locator('[data-tab="overview"]').click();await settled(p);
  const queries=await p.evaluate(()=>window.__crmTest.queries);for(const table of ['leads','meetings','proposals','tenants','posts'])assert.ok(queries.some(q=>q.table===table&&q.options?.count==='exact'),'exact count required for '+table);assert.ok(queries.filter(q=>['leads','meetings'].includes(q.table)).every(q=>q.filters.some(f=>f.key==='tenant_id'&&f.value===null)));
  await healthy(f);await f.context.close();
 }
 for(const mode of ['empty','partial']){
  const f=await open(mode);await settled(f.page);if(mode==='empty'){for(const key of ['inquiries','calls','drafts','active'])assert.match(await f.page.locator(`[data-crm-kpi="${key}"] .crm-kpi-value`).textContent(),/^0$/);assert.doesNotMatch(await f.page.locator('#crmOverview').textContent(),/NaN|Infinity|undefined/);}else assert.match((await f.page.locator('#crmDataStatus').textContent())+' '+await f.page.locator('#crmOverview').textContent(),/partial|limited|incomplete|first 300/i);await healthy(f);await f.context.close();
 }
 for(const mode of ['error','reject']){
  const f=await open(mode);await f.page.waitForFunction(()=>/unavailable|failed|error|could not/i.test(document.getElementById('crmDataStatus').textContent));assert.equal(await f.page.locator('#crmOverview [data-crm-kpi]:visible').count(),0);assert.doesNotMatch(await f.page.locator('#crmDataStatus').textContent(),/successfully|all records loaded/i);await healthy(f);await f.context.close();
 }
 for(const mode of ['denied','profile-error','signed-out']){
  const f=await open(mode);if(mode==='signed-out')await f.page.locator('#login').waitFor({state:'visible'});else await f.page.waitForFunction(()=>/not.*administrator|could not|unavailable|denied|verify|permission/i.test(document.getElementById('whoami').textContent+' '+document.getElementById('crmDataStatus').textContent));assert.equal(await f.page.locator('#crmNavigation').isVisible(),false);assert.equal(await f.page.locator('[data-panel]:visible').count(),0);assert.equal(await f.page.evaluate(()=>window.__crmTest.queries.some(q=>q.table!=='profiles')),false);await healthy(f);await f.context.close();
 }
 {
  const f=await open('loading');await f.page.waitForFunction(()=>window.__crmTest.pending.length>0);assert.equal(await f.page.locator('#crmOverview [data-crm-kpi]:visible').count(),0);await f.page.evaluate(()=>{window.__crmTest.release=true;window.__crmTest.pending.splice(0).forEach(resolve=>resolve());});await settled(f.page);await healthy(f);await f.context.close();
 }
 console.log('PASS: whole CRM shell with actual app-common/admin/modules; overview/source honesty, search/status filters, hash/back-forward and keyboard navigation, retained client workflow inputs, desktop/mobile overflow, exact-count truncation, loading/empty/error/stale/recovery, authenticated staff boundary; intercepted synthetic data only, no messages or provider requests.');
}finally{await browser.close();}
