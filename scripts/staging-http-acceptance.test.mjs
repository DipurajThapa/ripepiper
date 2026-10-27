import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {stagingHttpAcceptance,STAGING_WORKER} from './staging-http-acceptance.mjs';
const key=role=>'header.'+Buffer.from(JSON.stringify({role,ref:'wgomywhuzyboxlckopca'})).toString('base64url')+'.secret';
const env={RIPEPIPER_STAGING_SUPABASE_URL:'https://wgomywhuzyboxlckopca.supabase.co',RIPEPIPER_STAGING_SERVICE_ROLE_KEY:key('service_role'),RIPEPIPER_STAGING_ANON_KEY:key('anon'),CLOUDFLARE_API_TOKEN:'cloud-secret',CLOUDFLARE_ACCOUNT_ID:'e888301f7b7d01c16eb17c947ff57e5e'};
function fixture({nonempty=false,leak=false,lostAuth=false,cleanupFail=false,outboxFail=false,foreignOutbox=false,receiptMutation=value=>value,shortlistMutation=value=>value,allowClientRpc=false,allowClientShortlist=false}={}){
 const calls=[],users=[],rows={tenants:[],leads:[],profiles:[],memberships:[],campaigns:[],lead_observations:[],outbound_actions:[],sheet_outbox:[]};let lost=false;
 const fetcher=async(input,init={})=>{
  const url=new URL(input),method=init.method??'GET',body=init.body?JSON.parse(init.body):null;calls.push({url:url.href,method,body,headers:init.headers});const reply=(data,status=200)=>Response.json(data,{status});
  if(url.origin===STAGING_WORKER){
   if(url.pathname==='/api/health')return reply({ok:true,service:'ripe-piper-api',contract:1});
   const shortlist=url.pathname.endsWith('/shortlist'),token=init.headers.Authorization.split(' ')[1];
   if(token!=='session-'+users[2]?.id&&!(shortlist&&allowClientShortlist))return reply({ok:false},403);
   const tenant=url.pathname.split('/')[4];if(!rows.tenants.some(t=>t.id===tenant))return reply({ok:false},404);
   if(shortlist){const leads=rows.leads.filter(l=>l.tenant_id===tenant),at=new Date().toISOString();return reply(shortlistMutation({ok:true,synthetic:true,brief:null,rulesVersion:2,externalCalls:0,snapshotAt:at,assessedAt:at,leads,results:leads.map(l=>({leadId:l.id,state:'unknown',score:null,contactAllowed:false,reasons:['brief_required'],products:['revive','signal','response','events'].map(product=>({product,state:'needs_evidence',contactAllowed:false,bookingAvailable:false}))}))}));}
   return reply({ok:true,owners:[users[0],users[2]].map(u=>({id:u.id,label:u.email}))});
  }
  const auth=url.pathname.replace('/auth/v1/','');
  if(auth==='admin/users'&&method==='GET')return reply({users:nonempty?[{id:randomUUID(),email:'existing@fixture.invalid'}]:users});
  if(auth==='admin/users'&&method==='POST'){assert.equal(body.email_confirm,true);assert.match(body.email,/\.invalid$/);assert.equal(body.send_email,undefined);const u={id:randomUUID(),email:body.email,email_confirmed_at:'2026-01-01T00:00:00Z',password:body.password};users.push(u);if(lostAuth&&!lost){lost=true;throw Error('uncertain secret '+env.RIPEPIPER_STAGING_SERVICE_ROLE_KEY);}return reply(u,201);}
  if(auth.startsWith('admin/users/')){const id=auth.split('/').pop(),index=users.findIndex(u=>u.id===id);if(method==='DELETE'){if(cleanupFail)return reply({},500);users.splice(index,1);return reply({});}return reply({},404);}
  if(auth==='token'){const u=users.find(u=>u.email===body.email&&u.password===body.password);return reply({access_token:'session-'+u.id,user:{id:u.id}});}
  if(auth==='user'){return reply({id:init.headers.Authorization.slice('Bearer session-'.length)});}
  const table=url.pathname.replace('/rest/v1/','');
  if(table==='rpc/review_prospect_snapshot'){
   assert.equal(body.p_synthetic,true);assert.equal(body.p_actor,users[2].id);
   if(init.headers.Authorization!=='Bearer '+env.RIPEPIPER_STAGING_SERVICE_ROLE_KEY&&!allowClientRpc)return reply({code:'42501'},403);
   const tenantIndex=rows.tenants.findIndex(t=>t.id===body.p_tenant),leads=rows.leads.filter(l=>l.tenant_id===body.p_tenant);
   return reply(receiptMutation({version:1,status:'complete',tenantId:body.p_tenant,synthetic:true,snapshotAt:new Date().toISOString(),brief:null,leads,leadCount:leads.length,observations:[],observationCount:0,stoppedLeadIds:[],owners:[users[tenantIndex],users[2]].map(u=>({id:u.id,label:u.email})),ownerCount:2}));
  }
  if(table.startsWith('rpc/'))return reply({code:'42501'},403);
  if(method==='POST'){const list=Array.isArray(body)?body:[body];
   // Model the service-role boundary, not a database-owner fixture bypass.
   if(table==='tenants'&&list.some(row=>row.status==='active'))return reply({code:'23514',message:'Prepare onboarding before reviewed activation'},400);
   rows[table].push(...list);if(table==='leads'){rows.sheet_outbox.push(...list.map((r,i)=>({id:i+1,entity:'lead',entity_id:r.id})));if(foreignOutbox)rows.sheet_outbox.push({id:100,entity:'meeting',entity_id:list[0].id},{id:101,entity:'lead',entity_id:randomUUID()});}return reply(body,201);}
  if(method==='PATCH')return reply([]);
  if(method==='DELETE'&&table==='sheet_outbox'){assert.equal(url.searchParams.get('entity'),'eq.lead');assert.match(url.searchParams.get('entity_id'),/^in\.\([0-9a-f,-]+\)$/);if(outboxFail)return reply({},500);const ids=url.searchParams.get('entity_id').slice(4,-1).split(',');rows[table]=rows[table].filter(r=>r.entity!=='lead'||!ids.includes(r.entity_id));return reply([]);}
  if(method==='DELETE'){assert.match(url.searchParams.get('id'),/^in\.\([0-9a-f,-]+\)$/);const ids=url.searchParams.get('id').slice(4,-1).split(',');rows[table]=rows[table].filter(r=>!ids.includes(r.id));return reply([]);}
  const tenant=url.searchParams.get('tenant_id'),id=url.searchParams.get('id');let result=rows[table]??[];
  if(id)result=result.filter(r=>id.includes(r.id));if(table==='sheet_outbox'&&url.searchParams.has('entity_id')){const ids=url.searchParams.get('entity_id').slice(4,-1).split(',');result=result.filter(r=>r.entity==='lead'&&ids.includes(r.entity_id));}
  if(tenant){const owner=users.findIndex(u=>'Bearer session-'+u.id===init.headers.Authorization);result=result.filter(r=>r.tenant_id===tenant.slice(3)&&r.tenant_id===rows.tenants[owner]?.id);if(leak&&tenant==='is.null')result=[rows.leads[2]];}
  return reply(result);
 };return {fetcher,calls,users,rows};
}
test('dry validation is default and rejects database/Worker/key targets before network or writes',async()=>{
 const f=fixture();assert.equal((await stagingHttpAcceptance(env,{fetcher:f.fetcher})).status,'validated_only');assert.equal(f.calls.length,0);
 await assert.rejects(stagingHttpAcceptance(env,{apply:true,workerOrigin:'https://production.invalid',fetcher:f.fetcher}),/approved staging/);
 await assert.rejects(stagingHttpAcceptance({...env,RIPEPIPER_STAGING_SUPABASE_URL:'https://jtoafjjszqqrtwerxspw.supabase.co'},{apply:true,fetcher:f.fetcher}),/approved isolated/);assert.equal(f.calls.length,0);
});
test('nonempty staging rejects before fixture writes',async()=>{const f=fixture({nonempty:true});await assert.rejects(stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher}),e=>e.evidence?.failedPhase==='baseline'&&e.evidence.cleanup.status==='no_writes');assert(f.calls.every(c=>c.method==='GET'));});
test('real HTTP protocol slice validates both owner RLS boundaries and Worker staff route then exact cleanup',async()=>{const f=fixture();const evidence=await stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher});assert.equal(evidence.status,'passed');assert.equal(evidence.cleanup.status,'verified');assert.equal(evidence.checks.length,6);assert.equal(f.users.length,0);assert.equal(f.rows.leads.length,0);assert.equal(f.rows.tenants.length,0);assert.equal(f.rows.sheet_outbox.length,0);assert(f.calls.every(c=>['https://wgomywhuzyboxlckopca.supabase.co',STAGING_WORKER].includes(new URL(c.url).origin)));assert(!JSON.stringify(evidence).includes('secret'));});
test('activation-guarded HTTP acceptance uses onboarding fixtures without activating accounts or executing outreach',async()=>{
 const f=fixture(),evidence=await stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher});
 const inserts=f.calls.filter(c=>c.method==='POST'&&new URL(c.url).pathname==='/rest/v1/tenants');
 assert.equal(inserts.length,1);assert.deepEqual(inserts[0].body.map(row=>row.status),['onboarding','onboarding']);
 assert.equal(evidence.scope,'onboarding_auth_rls_owner_lookup_and_empty_evidence_prospect_routing_only');assert.deepEqual(evidence.notTested,['prospect_qualification_with_evidence','prospect_capacity_and_byte_limits','concurrent_snapshot_changes','tenant_activation','outbound_execution','provider_delivery']);
 assert.equal(f.calls.some(c=>/activate_tenant_execution|\/activate$|manage_campaign_plan|claim_.*action|complete_.*action|\/revive-run$/.test(new URL(c.url).pathname)),false);
 assert.equal(evidence.cleanup.status,'verified');assert.equal(f.rows.tenants.length,0);assert.equal(f.rows.leads.length,0);assert.equal(f.users.length,0);
});
test('RLS failure preserves redacted failure evidence and removes only created UUIDs',async()=>{const f=fixture({leak:true});await assert.rejects(stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher}),e=>{assert.equal(e.evidence.failedPhase,'postgrest_rls');assert.equal(e.evidence.cleanup.status,'verified');assert(!JSON.stringify(e.evidence).includes(env.RIPEPIPER_STAGING_SERVICE_ROLE_KEY));return true;});assert.equal(f.users.length,0);assert.equal(f.rows.tenants.length,0);});
test('lost Admin create acknowledgement recovers only exact run email and cleans it',async()=>{const f=fixture({lostAuth:true});await assert.rejects(stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher}),e=>e.evidence?.failedPhase==='auth_fixtures'&&e.evidence.cleanup.status==='verified'&&e.evidence.cleanup.userIds.length===1);assert.equal(f.users.length,0);});
test('cleanup failure fails acceptance and reports exact residual IDs without token/password',async()=>{const f=fixture({cleanupFail:true});await assert.rejects(stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher}),e=>{assert.equal(e.evidence.cleanup.status,'failed');assert.equal(e.evidence.status,'failed');assert.equal(e.evidence.cleanup.errors.length,3);assert(!JSON.stringify(e.evidence).includes('session-'));return true;});});

test('redacted recovery manifest is emitted before first write and includes every validated Auth UUID',async()=>{const f=fixture(),progress=[];const fetcher=async(input,init)=>{if(init?.method==='POST'&&new URL(input).pathname==='/auth/v1/admin/users')assert.equal(progress[0]?.event,'fixture_manifest');return f.fetcher(input,init);};const evidence=await stagingHttpAcceptance(env,{apply:true,fetcher,onProgress:value=>progress.push(value)});assert.equal(progress[0].run,evidence.run);assert.deepEqual(progress[0].tenantIds,evidence.cleanup.tenantIds);assert.equal(progress[0].emails.length,3);assert(progress[0].emails.every(e=>e.endsWith('.invalid')));assert.equal(progress.filter(p=>p.event==='auth_fixture_created').length,3);assert(!JSON.stringify(progress).includes('password'));assert(!JSON.stringify(progress).includes('secret'));});
test('overall execution deadline aborts work but reserves a separate cleanup window',async()=>{const f=fixture();let now=0;const fetcher=async(input,init)=>{const result=await f.fetcher(input,init);if(new URL(input).pathname==='/rest/v1/memberships'&&init.method==='POST')now=180001;return result;};await assert.rejects(stagingHttpAcceptance(env,{apply:true,fetcher,clock:()=>now}),e=>e.evidence?.failedPhase==='database_fixtures'&&e.evidence.cleanup.status==='verified');assert.equal(f.users.length,0);assert.equal(f.rows.tenants.length,0);assert.equal(f.calls.some(c=>c.url.includes('/auth/v1/token')),false);});

test('trigger-created sheet outbox rows are cleaned by exact entity and fixture IDs, and failure cannot pass',async()=>{const f=fixture({outboxFail:true});await assert.rejects(stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher}),e=>e.evidence?.cleanup.status==='failed'&&e.evidence.cleanup.errors.includes('sheet_outbox'));assert.equal(f.rows.leads.length,0);assert.equal(f.rows.sheet_outbox.length,3);});

test('cleanup preserves concurrently added foreign lead and same-ID different-entity outbox rows',async()=>{const f=fixture({foreignOutbox:true});const r=await stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher});assert.equal(r.cleanup.status,'verified');assert.deepEqual(f.rows.sheet_outbox.map(row=>row.id),[100,101]);});

test('prospect routing acceptance uses existing disposable leads and bounded reads without adding evidence',async()=>{
 const f=fixture(),evidence=await stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher});
 const rpc=f.calls.filter(c=>new URL(c.url).pathname==='/rest/v1/rpc/review_prospect_snapshot');
 assert.equal(rpc.length,4);assert.equal(new Set(rpc.map(c=>c.body.p_tenant)).size,2);
 assert.equal(rpc.filter(c=>c.headers.Authorization==='Bearer '+env.RIPEPIPER_STAGING_SERVICE_ROLE_KEY).length,2);
 const shortlist=f.calls.filter(c=>new URL(c.url).pathname.endsWith('/shortlist'));assert.equal(shortlist.length,5);
 assert(shortlist.every(c=>c.method==='POST'&&c.body.synthetic===true));
 assert(f.calls.filter(c=>c.method==='POST').every(c=>!['/rest/v1/lead_observations','/rest/v1/business_briefs'].includes(new URL(c.url).pathname)));
 assert.equal(f.rows.lead_observations.length,0);assert(evidence.requests<75);assert.equal(evidence.cleanup.status,'verified');
 assert(evidence.checks.includes('service_scalar_prospect_receipt_two_tenants_no_evidence_client_rpc_denied'));
 assert(evidence.checks.includes('worker_prospect_shortlist_tenant_scoped_unknown_no_brief_client_denied_missing_tenant'));
});

for(const [label,receiptMutation] of [
 ['table-shaped RPC reply',v=>[v]],
 ['foreign tenant',v=>({...v,tenantId:randomUUID()})],
 ['wrong mode',v=>({...v,synthetic:false})],
 ['partial count',v=>({...v,leadCount:2})],
 ['foreign contact',v=>({...v,leads:[{...v.leads[0],id:randomUUID()}]})],
 ['unexpected evidence',v=>({...v,observations:[{id:randomUUID()}],observationCount:1})],
 ['duplicate owner',v=>({...v,owners:[v.owners[0],v.owners[0]]})],
 ['missing snapshot',v=>({...v,snapshotAt:undefined})],
 ['stale snapshot',v=>({...v,snapshotAt:new Date(Date.now()-120000).toISOString()})],
 ['future snapshot',v=>({...v,snapshotAt:new Date(Date.now()+120000).toISOString()})],
 ['capacity receipt',()=>({version:1,status:'capacity'})],
])test('prospect RPC acceptance rejects '+label+' and verifies exact cleanup',async()=>{
 const f=fixture({receiptMutation});await assert.rejects(stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher}),e=>e.evidence?.failedPhase==='prospect_snapshot_rpc'&&e.evidence.cleanup.status==='verified');
 assert.equal(f.users.length,0);assert.equal(f.rows.leads.length,0);assert.equal(f.rows.tenants.length,0);assert.equal(f.rows.sheet_outbox.length,0);
});

for(const [label,shortlistMutation] of [
 ['foreign result',v=>({...v,results:[{...v.results[0],leadId:randomUUID()}]})],
 ['invented qualification',v=>({...v,results:[{...v.results[0],state:'candidate'}]})],
 ['contact permission',v=>({...v,results:[{...v.results[0],contactAllowed:true}]})],
 ['missing snapshot',v=>({...v,snapshotAt:undefined})],
 ['external call',v=>({...v,externalCalls:1})],
 ['invented product evidence',v=>({...v,results:[{...v.results[0],products:v.results[0].products.map(p=>({...p,state:'prioritise_review'}))}]})],
])test('prospect Worker acceptance rejects '+label+' and verifies exact cleanup',async()=>{
 const f=fixture({shortlistMutation});await assert.rejects(stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher}),e=>e.evidence?.failedPhase==='prospect_shortlist_worker'&&e.evidence.cleanup.status==='verified');
 assert.equal(f.users.length,0);assert.equal(f.rows.leads.length,0);assert.equal(f.rows.sheet_outbox.length,0);
});

for(const [option,phase] of [['allowClientRpc','prospect_snapshot_rpc'],['allowClientShortlist','prospect_shortlist_worker']])test('prospect acceptance fails if client access is granted: '+option,async()=>{
 const f=fixture({[option]:true});await assert.rejects(stagingHttpAcceptance(env,{apply:true,fetcher:f.fetcher}),e=>e.evidence?.failedPhase===phase&&e.evidence.cleanup.status==='verified');
 assert.equal(f.users.length,0);assert.equal(f.rows.leads.length,0);
});