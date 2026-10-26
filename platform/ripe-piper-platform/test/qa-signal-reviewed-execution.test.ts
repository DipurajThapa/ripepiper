/** Independent QA: real Worker -> local SQL, no provider/network. */
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index';
import type {Env} from '../src/env';
const actor='8accc5b4-069a-4bb9-87f3-2c4bfaaf0244';
let db:PGlite;
const q=async(sql:string,args:any[]=[])=> (await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;}finally{await db.exec('reset role');}}
const env={SUPABASE_URL:'https://qa-signal-sql.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-only',SUPABASE_ANON_KEY:'qa-only',SYNTHETIC_SINK_ENABLED:'true'} as Env;
function bridge(){
 let serial=Promise.resolve();
 vi.stubGlobal('fetch',(input:string,init:RequestInit={})=>{
  const job=serial.then(async()=>{
   const u=new URL(input);if(u.origin!==env.SUPABASE_URL)throw Error('Independent QA denies external network');
   if(u.pathname==='/auth/v1/user')return Response.json({id:actor,email:'qa-reviewer@example.invalid'});
   if(u.pathname.startsWith('/rest/v1/rpc/')){const name=u.pathname.split('/').at(-1)!,b=JSON.parse(String(init.body));if(!/^[a-z_]+$/.test(name)||Object.keys(b).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Invalid adapter RPC');await db.exec('set role service_role');try{return Response.json((await q(`select public.${name}(${Object.keys(b).map((k,i)=>k+'=>$'+(i+1)).join(',')}) value`,Object.values(b)))[0].value);}catch(e:any){return Response.json({code:e.code,message:e.message},{status:400});}finally{await db.exec('reset role');}}
   const table=u.pathname.replace('/rest/v1/','');if(!['profiles','tenants','leads','business_briefs','lead_observations','lead_suppression','suppression','campaigns','campaign_assets','outbound_actions'].includes(table))throw Error('Unexpected table '+table);
   const where:string[]=[],values:any[]=[];
   for(const [key,value] of u.searchParams){if(['select','limit','order'].includes(key))continue;if(!/^[a-z_]+$/.test(key))throw Error('Invalid column');if(value==='not.is.null'){where.push(key+' is not null');continue;}if(!value.startsWith('eq.'))throw Error('Unexpected filter');values.push(key==='synthetic'?value.slice(3)==='true':value.slice(3));where.push(key+'=$'+values.length);}
   const order=(u.searchParams.get('order')||'').split(',').filter(Boolean).map(v=>{if(!/^[a-z_]+(?:\.(?:asc|desc))?$/.test(v))throw Error('Invalid order');return v.replace('.',' ');});
   return Response.json(await q(`select * from ${table}${where.length?' where '+where.join(' and '):''}${order.length?' order by '+order.join(','):''}`,values));
  });serial=job.then(()=>undefined,()=>undefined);return job;
 });
}
async function http(tenant:string,operation:string,body:any={},campaign?:string,version=0){const r=await worker.fetch(new Request(`https://qa-worker.invalid/api/admin/tenants/${tenant}/campaigns`,{method:'POST',headers:{Authorization:'Bearer qa','Content-Type':'application/json'},body:JSON.stringify({operation,body,campaign_id:campaign,version})}),env,{} as ExecutionContext);return {status:r.status,value:await r.json() as any};}
async function ok(tenant:string,operation:string,body:any={},campaign?:string,version=0){const r=await http(tenant,operation,body,campaign,version);expect(r.status,JSON.stringify(r.value)).toBe(200);return r.value;}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'qa-reviewer@example.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
},30000);
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});afterAll(async()=>db?.close());
async function fixture(label='Independent Signal QA'){
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status) values($1,$2,'AE','AED','active') returning id`,[label,crypto.randomUUID()]))[0].id;
 const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 const observedAt=new Date(Date.now()-3600000).toISOString(),expiry=new Date(Date.now()+86400000).toISOString();
 const brief={offer:'Map workflow ownership',industries:['construction'],markets:['AE'],roles:['COO'],needs:['workflow ownership'],excludedIndustries:[],maxAgeDays:30,source:{reference:'qa-client-interview',excerpt:'Reviewed construction workflow offer',observedAt}};
 await rpc('save_business_brief',[tenant,0,brief,actor]);
 const setup={website:null,supportedClaims:[],sourceInventory:[{type:'interview',reference:'qa-client-interview',rightsReference:'qa-only'}],relationshipSummary:{text:'Reviewed prior enquiry',reference:'qa-only'},senderName:'QA owner',senderEmail:'owner@example.invalid',ownerId:actor,market:'AE',language:'en',timezone:'UTC',salesCapacityPerWeek:5,outcomeWindowDays:30,workingDays:[1,2,3,4,5,6,7],startMinute:0,endMinute:1440,dailyContactCap:20};
 await rpc('save_revive_setup',[tenant,actor,0,1,'reviewed',setup]);
 const fact=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'interview','qa-fit',$3,'review','qa-only',true,$4,'construction AE COO workflow ownership',$5) returning id`,[tenant,lead,observedAt,{industry:'construction',market:'AE',role:'COO',need:'workflow ownership'},actor]))[0].id;
 const signal=await rpc('record_product_event',[tenant,lead,actor,'qa-trigger','qa-only','A new office opened',observedAt,true,{product:'signal',kind:'trigger',relevance:'Review possible workflow relevance',expiresAt:expiry}]);
 bridge();const proposal=(await ok(tenant,'signal-proposal',{leadId:lead,signalId:signal,synthetic:true})).proposal;
 const body={product:'signal',purpose:'appointment',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:proposal.message.subject,body:proposal.message.body,evidenceReference:'signal:'+signal}],signalStrategy:{leadId:lead,signalId:signal,synthetic:true,proposal,reviewed:true}};
 return {tenant,lead,fact,signal,brief,setup,proposal,body,campaign:crypto.randomUUID()};
}
async function save(f:any){return ok(f.tenant,'save',f.body,f.campaign,0);}
async function binding(f:any){return (await q('select signal_strategy from campaign_assets where campaign_id=$1 order by version desc limit 1',[f.campaign]))[0].signal_strategy;}
async function approve(f:any){const b=await binding(f);return ok(f.tenant,'approve',{clientAuthority:'qa-client',ownerAuthority:'qa-owner',ctsProfile:'qa-market',maxActions:2,expiresAt:new Date(Date.now()+3600000).toISOString(),signalReview:{digest:b.digest,messageReviewed:true,evidenceReviewed:true}},f.campaign,1);}
async function queued(f:any){await save(f);await approve(f);await ok(f.tenant,'rights',{leadId:f.lead,sourceId:f.fact,noticeReference:'qa-only'},f.campaign,1);const at=new Date(Date.now()+1000).toISOString();const result=await ok(f.tenant,'queue',{leadId:f.lead,startAt:at},f.campaign,1);return {id:result.actionIds[0],at};}
it('persists exact reviewed copy for two clients and fences synthetic acknowledgement',async()=>{
 for(const label of ['North fiction','South fiction']){const f=await fixture(label),a=await queued(f);const b=await binding(f);expect(b.digest).toMatch(/^[a-f0-9]{64}$/);const list=await ok(f.tenant,'list');expect(list.assets.find((x:any)=>x.campaign_id===f.campaign).signal_strategy).toEqual(b);const token=crypto.randomUUID();expect(await rpc('claim_fenced_synthetic_action',[f.tenant,a.id,token,a.at])).toMatchObject({token});expect(await rpc('claim_fenced_synthetic_action',[f.tenant,a.id,crypto.randomUUID(),a.at])).toBeNull();expect(await rpc('complete_fenced_synthetic_action',[f.tenant,a.id,token,1,1,a.at])).toBe(true);expect((await q('select state,provider_ref from outbound_actions where id=$1',[a.id]))[0]).toMatchObject({state:'tested',provider_ref:'test-sink:'+a.id});}
});
it('rejects forged proposal and missing semantic attestation without assets',async()=>{
 const f=await fixture();for(const patch of [{reviewed:false},{proposal:{...f.proposal,recipient:'forged@example.invalid'}},{proposal:{...f.proposal,strategy:{...f.proposal.strategy,offer:'Invented guarantee'}}}]){const r=await http(f.tenant,'save',{...f.body,signalStrategy:{...f.body.signalStrategy,...patch}},f.campaign,0);expect(r.status).toBeGreaterThanOrEqual(400);}expect(await q('select campaign_id from campaign_assets where campaign_id=$1',[f.campaign])).toHaveLength(0);
});
it('keeps identical saves idempotent but edited final copy makes a new immutable version',async()=>{
 const f=await fixture();await save(f);expect(await ok(f.tenant,'save',f.body,f.campaign,1)).toMatchObject({version:1});await approve(f);const changed={...f.body,steps:[{...f.body.steps[0],body:f.body.steps[0].body+'\nReviewed extra question.'}]};expect(await ok(f.tenant,'save',changed,f.campaign,1)).toMatchObject({version:2,status:'draft'});const history=await q('select version,steps,signal_strategy from campaign_assets where campaign_id=$1 order by version',[f.campaign]);expect(history).toHaveLength(2);expect(history[0].signal_strategy.digest).not.toBe(history[1].signal_strategy.digest);
});
it.each(['email','brief','setup','evidence','reply'])('invalidates approved work after %s changes',async kind=>{
 const f=await fixture(),a=await queued(f);
 if(kind==='email')await q("update leads set email='changed@example.invalid' where id=$1",[f.lead]);
 if(kind==='brief')await rpc('save_business_brief',[f.tenant,1,{...f.brief,offer:'Changed offer'},actor]);
 if(kind==='setup')await rpc('save_revive_setup',[f.tenant,actor,1,1,'reviewed',{...f.setup,senderName:'Changed sender'}]);
 if(kind==='evidence')await q("update lead_observations set assessment_excerpt=assessment_excerpt||' changed' where id=$1",[f.fact]);
 if(kind==='reviewer')await q('update profiles set is_admin=false where id=$1',[actor]);
 if(kind==='reply')await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_reviewed_by,product_context) values($1,$2,'reply','qa-live-mode-reply',now(),'review','qa-only',false,$3,'{"product":"response","kind":"reply"}')`,[f.tenant,f.lead,actor]);
 try{expect((await q('select status from campaigns where id=$1',[f.campaign]))[0].status).toBe('draft');expect((await q('select state from outbound_actions where id=$1',[a.id]))[0].state).toBe('cancelled');expect(await rpc('claim_fenced_synthetic_action',[f.tenant,a.id,crypto.randomUUID(),a.at])).toBeNull();}finally{if(kind==='reviewer')await q('update profiles set is_admin=true where id=$1',[actor]);}
});
async function rawBody(f:any){return {...f.body,signalStrategy:{...f.body.signalStrategy,reviewedBy:actor,sourceSnapshot:await rpc('signal_strategy_context',[f.tenant,f.lead,actor])}};}
it.each(['cta','message','expiry','canonicalNeed','evidence','reviewer','mode','lead','tenant'])('rejects raw SQL binding forgery: %s',async kind=>{
 const f=await fixture(),body=await rawBody(f),p=body.signalStrategy.proposal=structuredClone(f.proposal);
 if(kind==='cta')p.strategy.cta='Guaranteed returns';if(kind==='message')p.message.body='Unsupported fabricated original proposal';if(kind==='expiry')p.validUntil=new Date(Date.now()+60*86400000).toISOString();if(kind==='canonicalNeed')p.strategy.canonicalNeed='Unsupported need';if(kind==='evidence')p.evidence[0].excerpt='Invented';if(kind==='reviewer')body.signalStrategy.reviewedBy=crypto.randomUUID();if(kind==='mode')p.synthetic=false;if(kind==='lead')p.leadId=crypto.randomUUID();if(kind==='tenant')p.tenantId=crypto.randomUUID();
 await expect(rpc('manage_campaign_plan',[f.tenant,f.campaign,actor,'save',0,body])).rejects.toThrow();
});
it('denies generic manual Signal approval and prevents binding removal',async()=>{
 const f=await fixture(),manual={...f.body};delete (manual as any).signalStrategy;await ok(f.tenant,'save',manual,f.campaign,0);await expect(rpc('manage_campaign_plan',[f.tenant,f.campaign,actor,'approve',1,{clientAuthority:'qa',ownerAuthority:'qa',ctsProfile:'qa',maxActions:1,expiresAt:new Date(Date.now()+3600000).toISOString()}])).rejects.toThrow();
 const bound=await fixture();await save(bound);const stripped={...bound.body};delete (stripped as any).signalStrategy;await expect(rpc('manage_campaign_plan',[bound.tenant,bound.campaign,actor,'save',1,stripped])).rejects.toThrow();
});
it('rejects mismatched approval digest and incomplete explicit reviews',async()=>{
 const f=await fixture();await save(f);const b=await binding(f),base={clientAuthority:'qa',ownerAuthority:'qa',ctsProfile:'qa',maxActions:1,expiresAt:new Date(Date.now()+3600000).toISOString(),signalReview:{digest:b.digest,messageReviewed:true,evidenceReviewed:true}};
 for(const patch of [{digest:'0'.repeat(64)},{messageReviewed:false},{evidenceReviewed:false}])await expect(rpc('manage_campaign_plan',[f.tenant,f.campaign,actor,'approve',1,{...base,signalReview:{...base.signalReview,...patch}}])).rejects.toThrow();
 await expect(rpc('manage_campaign_plan',[f.tenant,f.campaign,actor,'approve',1,{...base,expiresAt:new Date(Date.now()+2*86400000).toISOString()}])).rejects.toThrow();
});
it('does not claim expired authority or suppressed/paused work',async()=>{
 for(const condition of ['expiry','suppression','pause']){const f=await fixture(),a=await queued(f);if(condition==='suppression')await q("insert into lead_suppression(tenant_id,lead_id,reason) values($1,$2,'qa stop')",[f.tenant,f.lead]);if(condition==='pause')await q("update tenants set status='paused' where id=$1",[f.tenant]);const at=condition==='expiry'?new Date(Date.now()+2*86400000).toISOString():a.at;expect(await rpc('claim_fenced_synthetic_action',[f.tenant,a.id,crypto.randomUUID(),at])).toBeNull();}
});
it('keeps uncertain effects in review and duplicate enrolment cannot revive them',async()=>{
 const f=await fixture(),a=await queued(f),token=crypto.randomUUID();expect(await rpc('claim_fenced_synthetic_action',[f.tenant,a.id,token,a.at])).toMatchObject({token});await q("update outbound_actions set state='review',error_code='qa_uncertain' where id=$1",[a.id]);const replay=await http(f.tenant,'queue',{leadId:f.lead,startAt:a.at},f.campaign,1);if(replay.status===200)expect(replay.value.actionIds).toEqual([a.id]);else expect(replay.status).toBeGreaterThanOrEqual(400);expect((await q('select state from outbound_actions where id=$1',[a.id]))[0].state).toBe('review');expect(await q('select id from outbound_actions where campaign_id=$1',[f.campaign])).toHaveLength(1);expect(await rpc('claim_fenced_synthetic_action',[f.tenant,a.id,crypto.randomUUID(),a.at])).toBeNull();
});
it('accepts valid authoritative raw context as a positive control for SQL forgery tests',async()=>{
 const f=await fixture();expect(await rpc('manage_campaign_plan',[f.tenant,f.campaign,actor,'save',0,await rawBody(f)])).toMatchObject({version:1,status:'draft'});
});
it('raw action updates cannot forge a tested or delivered receipt without fenced completion',async()=>{
 const f=await fixture(),a=await queued(f);await db.exec('set role service_role');try{
  await expect(q("update outbound_actions set state='tested',provider_ref='test-sink:'||id,acknowledged_at=now() where id=$1",[a.id])).rejects.toThrow();
  await expect(q("update outbound_actions set state='delivered' where id=$1",[a.id])).rejects.toThrow();
 }finally{await db.exec('reset role');}
 expect((await q('select state,acknowledged_at from outbound_actions where id=$1',[a.id]))[0]).toMatchObject({state:'queued',acknowledged_at:null});
});
it('reviewer revocation denies claim and denies completion of an existing fenced claim',async()=>{
 const first=await fixture(),a=await queued(first),second=await fixture(),b=await queued(second),token=crypto.randomUUID();expect(await rpc('claim_fenced_synthetic_action',[second.tenant,b.id,token,b.at])).toMatchObject({token});await q('update profiles set is_admin=false where id=$1',[actor]);
 try{expect(await rpc('claim_fenced_synthetic_action',[first.tenant,a.id,crypto.randomUUID(),a.at])).toBeNull();expect(await rpc('complete_fenced_synthetic_action',[second.tenant,b.id,token,1,1,b.at])).toBe(false);}finally{await q('update profiles set is_admin=true where id=$1',[actor]);}
});
it('changed evidence with unchanged copy requires a new binding digest and version',async()=>{
 const f=await fixture();await save(f);const before=await binding(f);await q("update lead_observations set assessment_excerpt=assessment_excerpt||' verified today' where id=$1",[f.fact]);expect((await http(f.tenant,'save',f.body,f.campaign,1)).status).toBeGreaterThanOrEqual(400);const proposal=(await ok(f.tenant,'signal-proposal',{leadId:f.lead,signalId:f.signal,synthetic:true})).proposal;expect(await ok(f.tenant,'save',{...f.body,signalStrategy:{...f.body.signalStrategy,proposal}},f.campaign,1)).toMatchObject({version:2});expect((await binding(f)).digest).not.toBe(before.digest);
});
it('raw SQL predicate rejects trigger expiry missing or null',async()=>{
 for(const missing of [true,false]){const f=await fixture(),context=await rpc('signal_strategy_context',[f.tenant,f.lead,actor]),trigger=context.observations.find((o:any)=>o.id===f.signal);if(missing)delete trigger.product_context.expiresAt;else trigger.product_context.expiresAt=null;expect(await rpc('signal_binding_valid',[f.tenant,actor,context,f.proposal,f.body.steps,new Date().toISOString()])).toBe(false);}
});

it('a source edit after claim moves work to review and cannot erase a tested receipt',async()=>{
 for(const complete of [false,true]){const f=await fixture(),a=await queued(f),token=crypto.randomUUID();expect(await rpc('claim_fenced_synthetic_action',[f.tenant,a.id,token,a.at])).toMatchObject({token});if(complete)expect(await rpc('complete_fenced_synthetic_action',[f.tenant,a.id,token,1,1,a.at])).toBe(true);await q("update leads set email='new-recipient@example.invalid' where id=$1",[f.lead]);expect((await q('select state from outbound_actions where id=$1',[a.id]))[0].state).toBe(complete?'tested':'review');if(!complete)expect(await rpc('complete_fenced_synthetic_action',[f.tenant,a.id,token,1,1,a.at])).toBe(false);}
});
it('an ambiguous save acknowledgement preserves same campaign identity for explicit reload',async()=>{
 const f=await fixture(),underlying=globalThis.fetch;vi.stubGlobal('fetch',async(input:any,init:any)=>{const r=await underlying(input,init);if(String(input).endsWith('/rpc/manage_campaign_plan')&&JSON.parse(init.body).p_operation==='save')return Response.json({unexpected:true});return r;});const r=await http(f.tenant,'save',f.body,f.campaign,0);expect(r.status).toBe(503);expect(await q('select id from campaigns where tenant_id=$1',[f.tenant])).toEqual([{id:f.campaign}]);bridge();const list=await ok(f.tenant,'list');expect(list.campaigns.find((x:any)=>x.id===f.campaign)).toMatchObject({asset_version:1,status:'draft'});expect(list.actions).toHaveLength(0);
});
it('expired contact rights deny claim even while evidence and approval remain current',async()=>{
 const f=await fixture(),a=await queued(f);await q('update contact_rights set expires_at=now()-interval \'1 second\' where tenant_id=$1 and lead_id=$2',[f.tenant,f.lead]);expect(await rpc('claim_fenced_synthetic_action',[f.tenant,a.id,crypto.randomUUID(),a.at])).toBeNull();
});
it('raw Signal action insertion rejects foreign bound lead and old manual asset',async()=>{
 const f=await fixture(),a=await queued(f),foreign=(await fixture()).lead;
 await db.exec('set role service_role');try{await expect(q(`insert into outbound_actions select (jsonb_populate_record(null::outbound_actions,to_jsonb(a)||jsonb_build_object('id',$2::uuid,'lead_id',$3::uuid))).* from outbound_actions a where id=$1`,[a.id,crypto.randomUUID(),foreign])).rejects.toThrow();}finally{await db.exec('reset role');}
});
it('raw tested completion cannot bypass revoked contact rights after a fenced claim',async()=>{
 const f=await fixture(),a=await queued(f),token=crypto.randomUUID();expect(await rpc('claim_fenced_synthetic_action',[f.tenant,a.id,token,a.at])).toMatchObject({token});await q('update contact_rights set expires_at=now()-interval \'1 second\' where tenant_id=$1 and lead_id=$2',[f.tenant,f.lead]);await db.exec('set role service_role');try{await expect(q("update outbound_actions set state='tested',provider_ref='test-sink:'||id,acknowledged_at=$2,lease_until=null where id=$1",[a.id,a.at])).rejects.toThrow();}finally{await db.exec('reset role');}
});
it('executes the actual Worker synthetic sink endpoint and replays its same receipt',async()=>{
 const f=await fixture(),a=await queued(f);vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.parse(a.at)+1);
 const execute=async()=>{const r=await worker.fetch(new Request(`https://qa-worker.invalid/api/admin/actions/${a.id}/test`,{method:'POST',headers:{Authorization:'Bearer qa','Content-Type':'application/json'},body:'{}'}),env,{} as ExecutionContext);return {status:r.status,value:await r.json() as any};};
 const first=await execute();expect(first.status,JSON.stringify(first.value)).toBe(200);expect(first.value).toMatchObject({ok:true,state:'tested',action_id:a.id});const second=await execute();expect(second.status,JSON.stringify(second.value)).toBe(200);expect(second.value).toMatchObject({state:'tested'});expect((await q('select attempts,provider_ref from outbound_actions where id=$1',[a.id]))[0]).toEqual({attempts:1,provider_ref:'test-sink:'+a.id});
});
it('revoking a distinct approval reviewer blocks claim and completion',async()=>{
 const approver='e77dccf7-e305-49da-8c6a-384e8d20ee7d';await q("insert into auth.users(id,email,email_confirmed_at) values($1,'qa-second-reviewer@example.invalid',now()) on conflict do nothing",[approver]);await q('update profiles set is_admin=true where id=$1',[approver]);
 const queuedByOther=async()=>{const f=await fixture();await save(f);const b=await binding(f);await rpc('manage_campaign_plan',[f.tenant,f.campaign,approver,'approve',1,{clientAuthority:'qa',ownerAuthority:'qa',ctsProfile:'qa',maxActions:1,expiresAt:new Date(Date.now()+3600000).toISOString(),signalReview:{digest:b.digest,messageReviewed:true,evidenceReviewed:true}}]);await ok(f.tenant,'rights',{leadId:f.lead,sourceId:f.fact,noticeReference:'qa'},f.campaign,1);const at=new Date(Date.now()+1000).toISOString(),r=await ok(f.tenant,'queue',{leadId:f.lead,startAt:at},f.campaign,1);return {...f,id:r.actionIds[0],at};};
 const a=await queuedByOther(),b=await queuedByOther(),token=crypto.randomUUID();expect(await rpc('claim_fenced_synthetic_action',[b.tenant,b.id,token,b.at])).toMatchObject({token});await q('update profiles set is_admin=false where id=$1',[approver]);
 try{expect(await rpc('claim_fenced_synthetic_action',[a.tenant,a.id,crypto.randomUUID(),a.at])).toBeNull();expect(await rpc('complete_fenced_synthetic_action',[b.tenant,b.id,token,1,1,b.at])).toBe(false);}finally{await q('update profiles set is_admin=true where id=$1',[approver]);}
});
it('raw null approval timestamps cannot create a usable approval receipt',async()=>{
 const f=await fixture();await save(f);await approve(f);await db.exec('set role service_role');try{await expect(q("update campaign_assets set approved_at=null,signal_review=jsonb_set(signal_review,'{reviewedAt}','null') where campaign_id=$1",[f.campaign])).rejects.toThrow();}finally{await db.exec('reset role');}
});
it('preserves timestamp-looking evidence text while canonicalizing six-digit source instants',async()=>{
 const f=await fixture(),exactText='construction AE COO workflow ownership 2026-10-25T12:34:56.123456+04:00',at=new Date(Date.now()-3600000).toISOString().replace('Z','456Z');await q('update lead_observations set observed_at=$2,assessment_excerpt=$3 where id=$1',[f.fact,at,exactText]);
 const proposal=(await ok(f.tenant,'signal-proposal',{leadId:f.lead,signalId:f.signal,synthetic:true})).proposal;expect(proposal.evidence.find((e:any)=>e.id===f.fact).excerpt).toBe(exactText);const body={...f.body,signalStrategy:{...f.body.signalStrategy,proposal}};expect(await ok(f.tenant,'save',body,f.campaign,0)).toMatchObject({version:1});const b=await binding(f);expect(b.proposal.evidence.find((e:any)=>e.id===f.fact).excerpt).toBe(exactText);await approve(f);
});
