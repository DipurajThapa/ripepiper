/** Anvukta Revive journey: fictional .invalid contacts, actual migrations and Worker handlers.
 * PostgREST is bridged to PGlite (real SQL, RPCs and triggers); the synthetic sink is the only "delivery".
 */
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import worker from '../src/index';
import type {Env} from '../src/env';
import {setupBody,strategyBody} from './helpers/revive-setup';
import {asOperator} from './helpers/access';

const staff='00000000-0000-4000-8000-0000000000a1',member='00000000-0000-4000-8000-0000000000a2',outsider='00000000-0000-4000-8000-0000000000a3';
const env={SUPABASE_URL:'https://anvukta-journey-db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',SYNTHETIC_SINK_ENABLED:'true',REVIVE_AUTOMATION_ENABLED:'true'} as Env;
const reference='anvukta-interview',need='lead follow-up',sender='Anvukta reviewer';
const brief={offer:'Recover reviewed Anvukta construction enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:[need],excludedIndustries:[],maxAgeDays:90,source:{reference,excerpt:'Synthetic Anvukta interview: reviewed construction offer for AE owners.',observedAt:new Date(Date.now()-3600000).toISOString()}};
const facts={industry:'construction',market:'AE',role:'owner',need};
const excerpt='The construction company in AE has an owner who confirmed a lead follow-up need.';
const ago=(ms:number)=>new Date(Date.now()-ms).toISOString(),day=86400000;
let db:PGlite,tenant='',other='';
const failNext=new Set<string>(),rpcCalls:string[]=[];
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
async function service<T>(fn:()=>Promise<T>){await db.exec('set role service_role');try{return await fn();}finally{await db.exec('reset role');}}
async function as(user:string,sql:string){await db.exec(`set role authenticated;select set_config('request.jwt.sub','${user}',false);`);try{return await q(sql);}finally{await db.exec('reset role');}}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));

/** PostgREST bridge: real SQL predicates and RPCs, never canned results. Anything else fails the test. */
async function bridge(input:string,init:RequestInit={}){
 const u=new URL(input),method=init.method??'GET';
 if(u.origin!==env.SUPABASE_URL)throw Error('External network forbidden in the Anvukta journey');
 if(u.pathname==='/auth/v1/user')return Response.json({id:staff,email:'anvukta-staff@example.invalid'});
 const path=u.pathname.replace('/rest/v1/','');
 try{
  if(path.startsWith('rpc/')){
   const name=path.slice(4),b=JSON.parse(String(init.body)),keys=Object.keys(b);
   if(!/^[a-z_]+$/.test(name)||keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Unexpected RPC');
   rpcCalls.push(name);
   // Simulated integration outage: the call never reaches the database.
   if(failNext.delete(name))return new Response('synthetic upstream outage',{status:502});
   return Response.json((await service(()=>q(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) value`,Object.values(b))))[0].value);
  }
  if(!/^[a-z_]+$/.test(path))throw Error('Unexpected table');
  if(method==='POST'){
   const body=JSON.parse(String(init.body)),keys=Object.keys(body);if(keys.some(k=>!/^[a-z_]+$/.test(k)))throw Error('Unexpected column');
   return Response.json(await service(()=>q(`insert into ${path}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(body))),{status:201});
  }
  if(method!=='GET')throw Error('Unexpected table mutation');
  const where:string[]=[],values:any[]=[];
  for(const [key,value] of u.searchParams){
   if(['select','limit','order'].includes(key))continue;
   const m=/^([a-z_]+)(?:->>([a-zA-Z]+))?$/.exec(key);if(!m)throw Error('Unexpected filter '+key);
   const field=m[2]?`${m[1]}->>'${m[2]}'`:m[1];
   if(value==='not.is.null'||value==='is.null'){where.push(`${field} ${value==='is.null'?'is':'is not'} null`);continue;}
   if(value.startsWith('in.(')){values.push(value.slice(4,-1).split(',').map(v=>v.replace(/^"|"$/g,'')));where.push(`${field}::text=any($${values.length}::text[])`);continue;}
   const dot=value.indexOf('.'),op=({eq:'=',neq:'<>',lt:'<',lte:'<=',gt:'>',gte:'>='} as Record<string,string>)[value.slice(0,dot)];if(!op)throw Error('Unexpected operator '+value);
   values.push(value.slice(dot+1));where.push(`${field}${op}$${values.length}`);
  }
  const order=(u.searchParams.get('order')||'').split(',').filter(Boolean).map(v=>{if(!/^[a-z_]+(?:\.(?:asc|desc))?$/.test(v))throw Error('Unexpected order');return v.replace('.',' ');});
  const limit=Number(u.searchParams.get('limit')||1001);if(!Number.isInteger(limit)||limit<1||limit>1001)throw Error('Unexpected limit');
  return Response.json(await service(()=>q(`select * from ${path}${where.length?' where '+where.join(' and '):''}${order.length?' order by '+order.join(','):''} limit ${limit}`,values)));
 }catch(e:any){
  if(!e?.code)throw e;
  return Response.json({code:e.code,message:e.message},{status:e.code==='23505'?409:400});
 }
}
async function http(path:string,body:any,status=200){
 const r=await worker.fetch(new Request('https://anvukta-journey.invalid'+path,{method:'POST',headers:{Authorization:'Bearer fixture-staff','Content-Type':'application/json'},body:JSON.stringify(body)}),env,{} as ExecutionContext);
 const value=await r.json() as any;expect(r.status,JSON.stringify(value)).toBe(status);return value;
}
const admin=(action:string,body:any,status=200)=>http(`/api/admin/tenants/${tenant}/${action}`,body,status);
const run=async()=>(await admin('revive-run',{}));
const action=async(id:string)=>(await q('select state,error_code,attempts,asset_version,provider_ref from outbound_actions where id=$1',[id]))[0];

/** Worker import, reviewed evidence, deferred history and an accepted Revive review for one contact. */
async function eligible(name:string){
 const email=`owner@${name}.anvukta.invalid`,row={email,company:`${name} Contracting (fictional)`,reference:`import-${name}`,rights_reference:'Anvukta synthetic import review only',observed_at:ago(3600000)};
 const lead=(await admin('prospect-import',{synthetic:true,rows:[row]})).results[0].lead_id;
 const source=(await admin('prospect-evidence',{lead_id:lead,source:reference,reference:`evidence-${name}`,rights_reference:'Anvukta synthetic interview review only',observed_at:ago(3600000),synthetic:true,facts,excerpt},201)).id;
 await admin('product-event',{lead_id:lead,reference:`history-${name}`,rights_reference:'Anvukta synthetic CRM history',excerpt:'Reviewed earlier enquiry deferred on budget.',observed_at:ago(3600000),synthetic:true,context:{product:'revive',kind:'history',lastContactAt:ago(80*day),previousInterest:'yes',stalledReason:'Budget deferred'}},201);
 const preview=await admin('revive-review',{operation:'preview',lead_id:lead});
 expect(preview.assessment,JSON.stringify(preview.assessment)).toMatchObject({eligible:true});
 await admin('revive-review',{operation:'accept',lead_id:lead,version:preview.version,snapshot:preview.snapshot,reason:'Reviewed current fit and deferred history'});
 return {lead,source,row};
}
const campaignBody=(leadIds:string[],steps:any[])=>({product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',audience:{leadIds,confirmed:true},strategy:strategyBody(1,need,reference),steps});
const authority=()=>({clientAuthority:'Anvukta client review',ownerAuthority:'Anvukta owner review',ctsProfile:'AE synthetic compliance review',maxActions:20,expiresAt:new Date(Date.now()+25*day).toISOString()});
/** Reviewed draft -> strategy/audience save -> approval -> synthetic contact rights. */
async function launch(contacts:{lead:string;source:string}[]){
 const id=crypto.randomUUID(),proposal=(await admin('campaigns',{operation:'draft',body:{leadId:contacts[0].lead,sourceId:contacts[0].source,messageCount:2,senderName:sender}})).proposal;
 expect(proposal.draftContext).toMatchObject({setupVersion:1,canonicalNeed:need});
 const steps=proposal.steps.map((s:any)=>({...s,body:s.body+'\nReviewed by the Anvukta operator.'}));
 expect(await admin('campaigns',{operation:'save',campaign_id:id,version:0,body:{...campaignBody(contacts.map(c=>c.lead),steps),draftContext:proposal.draftContext}})).toMatchObject({version:1,status:'draft',delivery:'not_sent'});
 expect(await admin('campaigns',{operation:'approve',campaign_id:id,version:1,body:authority()})).toMatchObject({status:'approved'});
 for(const c of contacts)await admin('campaigns',{operation:'rights',campaign_id:id,version:1,body:{leadId:c.lead,sourceId:c.source,noticeReference:'Anvukta synthetic notice'}});
 return {id,steps};
}
const queue=async(id:string,lead:string,startAt:string)=>(await admin('campaigns',{operation:'queue',campaign_id:id,version:1,body:{leadId:lead,startAt}})).actionIds as string[];

beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
 for(const [id,email] of [[staff,'anvukta-staff@example.invalid'],[member,'anvukta-member@example.invalid'],[outsider,'northstar-member@example.invalid']])await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);
 await q('update profiles set is_admin=true where id=$1',[staff]);
 tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('Anvukta (synthetic)','anvukta-journey','AE','AED','onboarding') returning id`))[0].id;
 other=(await q(`insert into tenants(name,slug,country,currency,status) values('Northstar (fictional)','northstar-journey','AE','AED','active') returning id`))[0].id;
 await asOperator(db,{tenantId:tenant,profileId:staff});
 await q(`insert into memberships(tenant_id,user_id,role) values($1,$2,'viewer'),($3,$4,'viewer')`,[tenant,member,other,outsider]);
},60000);
// The shared network guard re-stubs fetch before every test; route it to the bridge instead.
beforeEach(()=>{vi.stubGlobal('fetch',bridge);
});
afterAll(async()=>{vi.unstubAllGlobals();await db?.close();});

it('walks Anvukta from reviewed setup through import, review, approval, automation, replies, resume and outcomes',async()=>{
 // Tenant setup: reviewed brief, reviewed Revive setup, then activation.
 expect(await admin('brief',{expected_version:0,brief})).toMatchObject({ok:true,version:1});
 expect(await admin('revive-setup',{operation:'save',expectedVersion:0,briefVersion:1,state:'reviewed',body:setupBody(staff,reference,{senderName:sender})})).toMatchObject({version:1,ready:true,delivery:'not_sent'});
 await admin('activate',{expected_status:'onboarding',expected_version:0,brief_version:1,reason:'Reviewed Anvukta setup and offer'});

 // Contact import: duplicate, invalid email, missing company and a globally suppressed contact.
 await q(`insert into suppression(email,reason) values('owner@quiet.anvukta.invalid','earlier opt-out')`);
 const A=await eligible('alpha');
 const imported=await admin('prospect-import',{synthetic:true,rows:[
  A.row,{...A.row,email:A.row.email.toUpperCase(),reference:'import-alpha-crm-copy'},{...A.row,email:'not-an-email',reference:'import-bad'},
  {...A.row,email:'owner@nocompany.anvukta.invalid',company:'',reference:'import-nocompany'},{...A.row,email:'owner@quiet.anvukta.invalid',company:'Quiet Build (fictional)',reference:'import-quiet'}]});
 expect(imported.results.map((r:any)=>r.state)).toEqual(['duplicate','linked','rejected','rejected','created']);
 expect(imported.results[1].lead_id).toBe(A.lead);
 const quiet=imported.results[4].lead_id;
 expect(await q('select count(*)::int n from leads where tenant_id=$1',[tenant])).toEqual([{n:2}]);

 // Inaccurate enrichment: a fact absent from the reviewed excerpt is refused.
 await admin('prospect-evidence',{lead_id:A.lead,source:reference,reference:'evidence-alpha-enriched',rights_reference:'Vendor enrichment',observed_at:ago(3600000),synthetic:true,facts:{...facts,need:'budget approved'},excerpt},400);

 // Eligibility: suppressed and stale contacts are refused; a stale review snapshot is refused.
 const quietPreview=await admin('revive-review',{operation:'preview',lead_id:quiet});
 expect(quietPreview.assessment.eligible).toBe(false);
 await admin('revive-review',{operation:'accept',lead_id:quiet,version:0,snapshot:quietPreview.snapshot,reason:'Attempted acceptance of a suppressed contact'},409);
 const stale=(await admin('prospect-import',{synthetic:true,rows:[{...A.row,email:'owner@stale.anvukta.invalid',reference:'import-stale',observed_at:ago(150*day)}]})).results[0].lead_id;
 await admin('prospect-evidence',{lead_id:stale,source:reference,reference:'evidence-stale',rights_reference:'Old interview',observed_at:ago(120*day),synthetic:true,facts,excerpt},201);
 await admin('product-event',{lead_id:stale,reference:'history-stale',rights_reference:'Old CRM history',excerpt:'Old deferred enquiry.',observed_at:ago(120*day),synthetic:true,context:{product:'revive',kind:'history',lastContactAt:ago(200*day),previousInterest:'yes',stalledReason:'Budget deferred'}},201);
 const stalePreview=await admin('revive-review',{operation:'preview',lead_id:stale});
 expect(stalePreview.assessment.eligible).toBe(false);expect(stalePreview.assessment.reasons).toContain('fresh_history_review_required');
 await admin('revive-review',{operation:'accept',lead_id:stale,version:0,snapshot:stalePreview.snapshot,reason:'Attempted acceptance of stale evidence'},409);
 const B=await eligible('bravo'),E=await eligible('echo');
 const before=await admin('revive-review',{operation:'preview',lead_id:B.lead});
 await admin('prospect-evidence',{lead_id:B.lead,source:reference,reference:'evidence-bravo-second-call',rights_reference:'Anvukta synthetic interview review only',observed_at:ago(1800000),synthetic:true,facts,excerpt},201);
 await admin('revive-review',{operation:'accept',lead_id:B.lead,version:before.version,snapshot:before.snapshot,reason:'Accepting with an outdated snapshot'},409);
 const fresh=await admin('revive-review',{operation:'preview',lead_id:B.lead});
 expect(fresh.snapshot).not.toBe(before.snapshot);
 await admin('revive-review',{operation:'accept',lead_id:B.lead,version:fresh.version,snapshot:fresh.snapshot,reason:'Re-reviewed with the latest interview'});

 // Missing data: no accepted review means no draft.
 await admin('campaigns',{operation:'draft',body:{leadId:stale,sourceId:A.source,messageCount:2,senderName:sender}},409);

 // Reviewed draft -> strategy/audience -> approval -> queue -> automation on the synthetic sink.
 const plan=await launch([A,B,E]);
 const startAt=new Date(Date.now()+1500).toISOString(),a=await queue(plan.id,A.lead,startAt),b=await queue(plan.id,B.lead,startAt);
 expect(a).toHaveLength(2);expect(b).toHaveLength(2);
 await wait(1700);
 expect(await run()).toMatchObject({delivery:'not_sent',campaigns:1,enrolled:1,existing:2,tested:2,review:0,blocked:0});
 for(const id of [a[0],b[0]])expect(await action(id)).toMatchObject({state:'tested',attempts:1,provider_ref:'test-sink:'+id});
 const e=(await q('select id,state from outbound_actions where lead_id=$1 order by message_step',[E.lead]));
 expect(e.map(r=>r.state)).toEqual(['queued','queued']);
 expect(await run()).toMatchObject({enrolled:0,existing:3,tested:0}); // A replay never re-sends.

 // Replies: an ambiguous reply is held for human review; a clear reply stops follow-ups.
 const reply=(lead:string,ref:string,disposition:string,text:string)=>admin('product-event',{lead_id:lead,reference:ref,rights_reference:'Anvukta synthetic inbox review',excerpt:text,observed_at:new Date().toISOString(),synthetic:true,context:{product:'response',kind:'reply',threadRef:ref+'-thread',disposition,need:disposition==='interested'?need:'',authority:'',timing:''}},201);
 await reply(A.lead,'reply-alpha','uncertain','Fictional reply: maybe, depends who asks.');
 await reply(B.lead,'reply-bravo','interested','Fictional reply: yes, we still need lead follow-up help.');
 for(const id of [a[1],b[1]])expect(await action(id)).toMatchObject({state:'cancelled',error_code:'conversation_hold'});
 const shortlist=await admin('shortlist',{synthetic:true}),response=(lead:string)=>shortlist.results.find((r:any)=>r.leadId===lead).products.find((p:any)=>p.product==='response');
 expect(response(A.lead)).toMatchObject({state:'uncertain',nextAction:'Human review required. Follow-ups are held.'});
 expect(response(B.lead).state).toBe('interested');
 expect(e.length).toBe(2);for(const r of e)expect((await action(r.id)).state).toBe('queued');

 // Pause, edit, re-approve: only the contact cancelled by the pause resumes on the new version.
 expect(await admin('campaigns',{operation:'pause',campaign_id:plan.id,version:1})).toMatchObject({status:'paused'});
 for(const r of e)expect(await action(r.id)).toMatchObject({state:'cancelled',error_code:'campaign_paused'});
 const redraft=(await admin('campaigns',{operation:'draft',body:{leadId:E.lead,sourceId:E.source,messageCount:2,senderName:sender}})).proposal;
 const edited=redraft.steps.map((s:any)=>({...s,body:s.body+'\nEdited after pause by the Anvukta operator.'})),draftContext=redraft.draftContext;
 // Replied contacts cannot be carried into the new version's audience.
 await admin('campaigns',{operation:'save',campaign_id:plan.id,version:1,body:{...campaignBody([A.lead,B.lead,E.lead],edited),draftContext}},400);
 expect(await admin('campaigns',{operation:'save',campaign_id:plan.id,version:1,body:{...campaignBody([E.lead],edited),draftContext}})).toMatchObject({version:2,status:'draft'});
 expect(await admin('campaigns',{operation:'approve',campaign_id:plan.id,version:2,body:authority()})).toMatchObject({status:'approved'});
 expect(await run()).toMatchObject({enrolled:1,blocked:0,tested:0});
 // A replied contact outside the new audience cannot be queued by hand either.
 await admin('campaigns',{operation:'queue',campaign_id:plan.id,version:2,body:{leadId:B.lead,startAt:new Date(Date.now()+60000).toISOString()}},400);
 expect(await q('select distinct lead_id from outbound_actions where campaign_id=$1 and asset_version=2',[plan.id])).toEqual([{lead_id:E.lead}]);
 expect(await q("select count(*)::int n from outbound_actions where campaign_id=$1 and state in ('tested','delivered')",[plan.id])).toEqual([{n:2}]);

 // Outcome attributed to the exact acknowledged action; the client portal never shows synthetic evidence.
 await admin('product-event',{lead_id:B.lead,reference:'outcome-bravo',rights_reference:'Anvukta synthetic sales review',excerpt:'Operator confirmed a qualified conversation.',observed_at:new Date().toISOString(),synthetic:true,context:{product:'revive',kind:'outcome',outcome:'qualified_conversation',reason:'Reviewed reply and call notes.',campaignId:plan.id,actionId:b[0]}},201);
 expect(await q(`select count(*)::int n from lead_observations where tenant_id=$1 and product_context->>'kind'='outcome'`,[tenant])).toEqual([{n:1}]);
 expect(await as(member,'select * from v_tenant_outcomes_monthly')).toEqual([]);
 expect(await as(outsider,'select * from v_tenant_outcomes_monthly')).toEqual([]);
 expect(await q('select count(*)::int n from outbound_actions where tenant_id=$1',[other])).toEqual([{n:0}]);
},60000);

it('holds a failed integration for review and never retries it',async()=>{
 const F=await eligible('foxtrot'),plan=await launch([F]),[first]=await queue(plan.id,F.lead,new Date(Date.now()+1500).toISOString());
 await wait(1700);
 failNext.add('complete_fenced_synthetic_action');const completes=()=>rpcCalls.filter(n=>n==='complete_fenced_synthetic_action').length,before=completes();
 expect((await http(`/api/admin/actions/${first}/test`,{},503)).error).toContain('not retried');
 expect(completes()).toBe(before+1);
 expect(await action(first)).toMatchObject({state:'review',error_code:'uncertain_result',attempts:1});
 expect((await q('select status from campaigns where id=$1',[plan.id]))[0].status).toBe('paused');
 await run(); // Tenant-wide run: other campaigns may progress; this paused one must not.
 await http(`/api/admin/actions/${first}/test`,{},409);
 expect(await http(`/api/admin/tenants/${tenant}/actions/${first}/receipt`,{})).toMatchObject({state:'review',receipt:null,canRetry:false,requiresReview:true});
 expect(completes()).toBe(before+1);expect(await action(first)).toMatchObject({state:'review',attempts:1});
},30000);

it('moves an interrupted claim to review once its lease expires and never re-sends it',async()=>{
 const G=await eligible('golf'),plan=await launch([G]),[first]=await queue(plan.id,G.lead,new Date(Date.now()+1500).toISOString());
 await wait(1700);
 // A worker claimed the action and then died before completing it.
 expect(await service(()=>q('select public.claim_fenced_synthetic_action($1,$2,$3,$4) value',[tenant,first,crypto.randomUUID(),new Date().toISOString()]))).toHaveLength(1);
 expect((await action(first)).state).toBe('claimed');
 vi.useFakeTimers({toFake:['Date']});
 try{
  vi.setSystemTime(Date.now()+3*60000);
  expect(await run()).toMatchObject({review:1});
 }finally{vi.useRealTimers();}
 expect(await action(first)).toMatchObject({state:'review',error_code:'uncertain_result',attempts:1});
 expect((await q('select status from campaigns where id=$1',[plan.id]))[0].status).toBe('paused');
 await run();
 expect(await action(first)).toMatchObject({state:'review',attempts:1});
},30000);
