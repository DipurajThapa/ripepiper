import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {productError,reviewProducts,type ProductContext} from '../src/foundation/products';
import {recordProductEvent} from '../src/foundation/prospecting-routes';
import type {Env} from '../src/env';
import {seedReviveSetup,resolvedReviveStrategy,type strategyBody} from './helpers/revive-setup';
const staff='11000000-0000-4000-8000-000000000001';
const viewer='11000000-0000-4000-8000-000000000002';
let db:PGlite,tenant:string,foreign:string;
type Fixture={lead:string;campaign:string;action:string;synthetic:boolean};
const strategies=new Map<string,ReturnType<typeof strategyBody>>();
const historicalBusiness=new Map<string,Fixture>();
let historicalSignal:Fixture;
const env={SUPABASE_URL:'https://fixture.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-public'} as Env;
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 const migrations=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
 const strategyIndex=migrations.indexOf('20261024162439_revive_strategy_schedule.sql');
 expect(strategyIndex).toBeGreaterThan(0);
 for(const file of migrations.slice(0,strategyIndex))await db.exec(readFileSync(new URL(file,dir),'utf8'));
 await db.query(`insert into auth.users(id,email,email_confirmed_at)values($1,'staff@example.invalid',now()),($2,'viewer@example.invalid',now())`,[staff,viewer]);
 await db.query('update profiles set is_admin=true where id=$1',[staff]);
 for(const slug of ['attribution-fixture','attribution-foreign']){
  const id=(await db.query<any>(`insert into tenants(name,slug,country,currency,package,status)values('Fixture',$1,'AE','AED','revive','onboarding')returning id`,[slug])).rows[0].id;
  await db.query(`insert into business_briefs(tenant_id,version,body,created_by)values($1,1,$2,$3)`,[id,JSON.stringify({offer:'Reviewed reactivation service',industries:['construction'],markets:['AE'],roles:['owner'],needs:['quote follow-up'],excludedIndustries:[],maxAgeDays:365,source:{reference:'attribution:brief',excerpt:'Reviewed construction reactivation service for AE owner quote follow-up.',observedAt:new Date(Date.now()-3600_000).toISOString()}}),staff]);
  const configured=await seedReviveSetup(db,id,staff);strategies.set(id,configured.strategy);
  await service(()=>db.query('select activate_tenant_execution($1,$2,$3,$4,$5,$6)',[id,staff,'onboarding',0,1,'Reviewed synthetic fixture setup']));
  if(!tenant)tenant=id;else foreign=id;
 }
 // Preserve genuine historical mode coverage: these acknowledged database fixtures
 // predate the synthetic-only slot guard. No provider is called and no trigger is
 // disabled. The new migration must preserve their outcome history while blocking
 // any future execution of legacy assets without a reviewed strategy.
 for(const state of ['delivered','tested'])historicalBusiness.set(state,await buildFixture({synthetic:false,state},true));
 for(const file of migrations.slice(strategyIndex)){
  if(file.endsWith('_signal_trigger_review.sql'))historicalSignal=await buildFixture({capability:'signal'});
  await db.exec(readFileSync(new URL(file,dir),'utf8'));
 }
});
afterAll(async()=>db.close());
async function service<T>(fn:()=>Promise<T>){await db.exec('set role service_role');try{return await fn();}finally{await db.exec('reset role');}}
async function fixture(options:{synthetic?:boolean;capability?:string;state?:string}={}):Promise<Fixture>{
 if(options.synthetic===false){const prior=historicalBusiness.get(options.state??'delivered');if(!prior)throw Error('Historical business fixture missing');return prior;}
 return buildFixture(options);
}
async function buildFixture(options:{synthetic?:boolean;capability?:string;state?:string}={},beforeStrategy=false):Promise<Fixture>{
 const synthetic=options.synthetic??true;
 const lead=(await db.query<any>(`insert into leads(tenant_id,source,email)values($1,'import',$2)returning id`,[tenant,`${crypto.randomUUID()}@example.${synthetic?'invalid':'test'}`])).rows[0].id;
 const source=(await db.query<any>(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by)values($1,$2,'qa_fixture',$3,now()-interval '1 hour','fixture','Reviewed fixture source use',$4,$5,'construction AE owner quote follow-up',$6)returning id`,[tenant,lead,crypto.randomUUID(),synthetic,{industry:'construction',market:'AE',role:'owner',need:'quote follow-up'},staff])).rows[0].id;
 // Seed reviewed history/current acceptance, independently of the eligibility tests.
 await service(()=>db.query('select record_product_event($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tenant,lead,staff,crypto.randomUUID(),'fixture-source','Reviewed fixture history',new Date(Date.now()-86400000).toISOString(),synthetic,JSON.stringify({product:'revive',kind:'history',lastContactAt:new Date(Date.now()-60*86400000).toISOString(),previousInterest:'yes',stalledReason:'Reviewed fixture timing'})]));
 await service(()=>db.query(`select review_revive_candidate($1,$2,$3,0,revive_input_snapshot($1,$2),1,'accepted','Reviewed fixture only',now()+interval '1 day')`,[tenant,lead,staff]));
 await db.query(`insert into contact_rights(tenant_id,lead_id,source_id,purpose,channel,market,decision,reviewer_id,notice_reference)values($1,$2,$3,'fixture','email','AE','permitted',$4,'Synthetic or historical database fixture only')`,[tenant,lead,source,staff]);
 const campaign=(await db.query<any>(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone,status,client_authority_ref,owner_authority_ref,cts_profile_ref,expires_at,max_actions)values($1,$2,$3,'fixture','email','AE','UTC','approved','fixture-client','fixture-owner','fixture-profile',now()+interval '1 day',3)returning id`,[tenant,options.capability??'revive',staff])).rows[0].id;
 const audience=(options.capability??'revive')==='revive'?(await service(()=>db.query<any>('select build_revive_audience($1,$2,$3) value',[tenant,staff,{leadIds:[lead],confirmed:true}]))).rows[0].value:null;
 const steps=JSON.stringify([{offsetHours:0,subject:'Fixture',body:'Fixture only',evidenceReference:'attribution:brief'}]);
 if(beforeStrategy)await db.query(`insert into campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by,approved_by,approved_at,revive_audience)values($1,$2,1,1,$3,$4,$4,now(),$5)`,[tenant,campaign,steps,staff,audience]);
 else {
  const resolved=(options.capability??'revive')==='revive'?await resolvedReviveStrategy(db,tenant,staff,[lead],strategies.get(tenant)!):{strategy:null};
  await db.query(`insert into campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by,approved_by,approved_at,revive_audience,revive_strategy)values($1,$2,1,1,$3,$4,$4,now(),$5,$6)`,[tenant,campaign,steps,staff,audience,resolved.strategy]);
 }
 const action=crypto.randomUUID();
 await db.query(`insert into outbound_actions(id,tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,state,dispatch_token,provider_ref,acknowledged_at)values($1::uuid,$2,$3,$4,$1::text,1,1,now(),$5,$6,$7,now())`,[action,tenant,campaign,lead,options.state??(synthetic?'tested':'delivered'),crypto.randomUUID(),synthetic?'test-sink:'+action:'provider-fixture:'+action]);
 return {lead,campaign,action,synthetic};
}
function context(f:Awaited<ReturnType<typeof fixture>>):ProductContext{return {product:'revive',kind:'outcome',outcome:'meeting_held',reason:'Reviewed fixture attendance, not an inferred meeting',campaignId:f.campaign,actionId:f.action};}
async function record(f:Awaited<ReturnType<typeof fixture>>,ctx:any=context(f),options:{tenant?:string;lead?:string;synthetic?:boolean;at?:string;reference?:string}={}){
 const at=options.at??new Date().toISOString();
 return service(async()=>(await db.query<any>('select record_product_event($1,$2,$3,$4,$5,$6,$7,$8,$9) id',[options.tenant??tenant,options.lead??f.lead,staff,options.reference??crypto.randomUUID(),'fixture-permitted-source','Reviewed outcome source',at,options.synthetic??f.synthetic,JSON.stringify(ctx)])).rows[0].id);
}
describe('exact acknowledged Revive action attribution',()=>{
 it('accepts synthetic rehearsal and real-mode acknowledged fixtures with distinct scope; neither proves causality',async()=>{
  for(const synthetic of [true,false]){
   const f=await fixture({synthetic});await record(f);
   const rows=JSON.parse(JSON.stringify((await db.query<any>('select * from lead_observations where tenant_id=$1 and lead_id=$2',[tenant,f.lead])).rows));
   const result=reviewProducts(rows,Date.now(),false,'candidate').find(p=>p.product==='revive')!;
   expect(result).toMatchObject({outcomeScope:synthetic?'synthetic_action':'action_reference',contactAllowed:false,bookingAvailable:false});
   expect(result.outcomes[0]).toMatchObject({synthetic,deliveryEstablished:false,campaignId:f.campaign,actionId:f.action});
  }
 });
 it('keeps old and pre-campaign decisions explicitly unattributed',async()=>{
  const f=await fixture();await record(f,{product:'revive',kind:'outcome',outcome:'accepted',reason:'Reviewed before campaign'});
  const rows=JSON.parse(JSON.stringify((await db.query<any>('select * from lead_observations where lead_id=$1',[f.lead])).rows));
  expect(reviewProducts(rows,Date.now(),false,'candidate').find(p=>p.product==='revive')).toMatchObject({outcomeScope:'unattributed',outcomes:[{attributionScope:'unattributed',synthetic:true}]});
 });
 it('preserves same-reference identity and rejects changed payload replay',async()=>{
  const f=await fixture(),reference=crypto.randomUUID(),at=new Date().toISOString();
  const first=await record(f,context(f),{reference,at});expect(await record(f,context(f),{reference,at})).toBe(first);
  await expect(record(f,{...context(f),outcome:'won'},{reference,at})).rejects.toThrow('Reference reused');
 });
 it('rejects foreign tenant, contact, product and mismatched same-lead campaign',async()=>{
  const f=await fixture(),other=await fixture(),signal=historicalSignal; // Historical foreign-product receipt predates the Signal execution fence.
  await expect(record(f,context(f),{tenant:foreign})).rejects.toThrow('scope mismatch');
  await expect(record(f,context(f),{lead:other.lead})).rejects.toThrow('exact acknowledged action');
  await expect(record(f,{...context(f),campaignId:other.campaign})).rejects.toThrow('exact acknowledged action');
  await expect(record(signal)).rejects.toThrow('exact acknowledged action');
 });
 it('rejects queued/review/uncertain receipts, false mode and outcomes preceding acknowledgement',async()=>{
  const f=await fixture();
  await expect(record(f,context(f),{synthetic:false})).rejects.toThrow('mode mismatch');
  await expect(record(f,context(f),{at:new Date(Date.now()-3600_000).toISOString()})).rejects.toThrow('exact acknowledged action');
  for(const state of ['queued','review','blocked','claimed']){
   await db.query('update outbound_actions set state=$1 where id=$2',[state,f.action]);
   await expect(record(f)).rejects.toThrow('exact acknowledged action');
  }
 });
 it('rejects missing fence, unapproved asset and malformed sink receipt',async()=>{
  for(const change of ['dispatch_token=null',"provider_ref='unverified'",'acknowledged_at=null']){
   const f=await fixture();await db.query('update outbound_actions set '+change+' where id=$1',[f.action]);
   await expect(record(f)).rejects.toThrow('exact acknowledged action');
  }
  const f=await fixture();await db.query('update campaign_assets set approved_by=null where campaign_id=$1',[f.campaign]);
  await expect(record(f)).rejects.toThrow('exact acknowledged action');
 });
 it('does not treat a tested real-mode contact as a delivered action',async()=>{
  const f=await fixture({synthetic:false,state:'tested'});await expect(record(f)).rejects.toThrow('exact acknowledged action');
 });
 it('makes reviewed outcomes append-only; corrections have new source identities',async()=>{
  const f=await fixture(),id=await record(f);
  await expect(db.query('delete from lead_observations where id=$1',[id])).rejects.toThrow('append-only');
  await expect(db.query("update lead_observations set assessment_excerpt='Changed' where id=$1",[id])).rejects.toThrow('append-only');
  const correction=await record(f,{...context(f),outcome:'rejected',reason:'New reviewed correction'});expect(correction).not.toBe(id);
 });
 it('denies browser direct-write attribution even for an authenticated platform admin',async()=>{
  const f=await fixture();await db.exec(`set role authenticated;select set_config('request.jwt.sub','${staff}',false)`);
  try{await expect(db.query(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,assessment_reviewed_by,product_context)values($1,$2,'forged','forged',now(),'fixture',true,$3,$4)`,[tenant,f.lead,staff,JSON.stringify(context(f))])).rejects.toThrow('Staff service attribution');}
  finally{await db.exec('reset role');}
 });
 it('rejects partial/malformed identities in API validation and direct service insert',async()=>{
  const f=await fixture();
  for(const ctx of [{...context(f),actionId:undefined},{...context(f),campaignId:null},{...context(f),actionId:'not-an-id'}]){
   expect(productError(ctx,new Date().toISOString(),Date.now(),true)).toContain('both its campaign and action');
   await expect(record(f,ctx)).rejects.toThrow('Paired campaign/action');
  }
  expect(productError({...context(f),product:'signal'},new Date().toISOString(),Date.now(),true)).not.toBeNull();
 });
});
describe('Revive outcome API to actual local SQL persistence',()=>{
 function request(body:any,token='staff'){return new Request('https://fixture.invalid/api',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify(body)});}
 function mockDatabase(malformed?:unknown){
  vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
   const u=new URL(input);if(u.origin!==env.SUPABASE_URL)throw Error('External provider access forbidden');
   if(u.pathname==='/auth/v1/user')return Response.json({id:(init.headers as any).Authorization==='Bearer viewer'?viewer:staff,email:'fixture@example.invalid'});
   if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:u.searchParams.get('id')==='eq.'+staff}]);
   if(u.pathname==='/rest/v1/leads')return Response.json((await db.query('select id,email from leads where tenant_id=$1 and id=$2',[u.searchParams.get('tenant_id')!.slice(3),u.searchParams.get('id')!.slice(3)])).rows);
   if(u.pathname==='/rest/v1/rpc/record_product_event'){
    if(malformed!==undefined)return Response.json(malformed);
    const b=JSON.parse(String(init.body));
    try{return Response.json(await service(async()=>(await db.query<any>('select record_product_event($1,$2,$3,$4,$5,$6,$7,$8,$9) id',[b.p_tenant,b.p_lead,b.p_actor,b.p_reference,b.p_rights,b.p_excerpt,b.p_observed,b.p_synthetic,JSON.stringify(b.p_context)])).rows[0].id));}
    catch(e:any){return Response.json({code:e.code,message:e.message},{status:e.code==='23505'?409:400});}
   }
   throw Error('Unexpected network request '+u.pathname);
  });
 }
 function body(f:Awaited<ReturnType<typeof fixture>>){return {lead_id:f.lead,reference:crypto.randomUUID(),rights_reference:'fixture-source',excerpt:'Reviewed fixture',observed_at:new Date().toISOString(),synthetic:f.synthetic,context:context(f)};}
 it('persists and reads an exact linked outcome without any provider call',async()=>{
  const f=await fixture();mockDatabase();const r=await recordProductEvent(request(body(f)),env,tenant);expect(r.status).toBe(201);
  const receipt:any=await r.json();expect(receipt.delivery).toBe('not_sent');
  expect((await db.query<any>('select product_context from lead_observations where id=$1',[receipt.id])).rows[0].product_context).toMatchObject({campaignId:f.campaign,actionId:f.action});
 });
 it('rejects viewer/anonymous and foreign action at the server/transaction boundary',async()=>{
  const f=await fixture(),other=await fixture();mockDatabase();
  await expect(recordProductEvent(request(body(f),''),env,tenant)).rejects.toThrow('sign in');
  await expect(recordProductEvent(request(body(f),'viewer'),env,tenant)).rejects.toThrow('administrators');
  const b=body(f);b.context={...b.context,actionId:other.action};expect((await recordProductEvent(request(b),env,tenant)).status).toBe(409);
 });
 it.each([{},false,'not-a-uuid'])('does not accept a malformed persistence acknowledgement %j',async value=>{
  const f=await fixture();mockDatabase(value);expect((await recordProductEvent(request(body(f)),env,tenant)).status).toBe(503);
 });
});
