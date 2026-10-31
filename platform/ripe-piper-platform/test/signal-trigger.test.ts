import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {productError,reviewProducts,type ProductContext} from '../src/foundation/products';
import type {Observation} from '../src/foundation/prospecting';
const now=Date.parse('2026-10-25T00:00:00Z'),one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222';
function trigger(id=one,patch:Partial<Observation>={}):Observation{return {id,tenant_id:'tenant',lead_id:'lead',source:'product_review',external_ref:'fixture:'+id,observed_at:'2026-10-24T00:00:00Z',assessment_facts:{},assessment_excerpt:'Reviewed expansion',assessment_reviewed_by:'staff',synthetic:true,product_context:{product:'signal',kind:'trigger',relevance:'Review expansion need',expiresAt:'2026-11-24T00:00:00Z'},...patch};}
function outcome(signalId?:string,patch:Partial<Observation>={}):Observation{return trigger(crypto.randomUUID(),{product_context:{product:'signal',kind:'outcome',outcome:'accepted',reason:'Reviewed source',...(signalId?{signalId}:{})},...patch});}
const signal=(rows:Observation[],fit='candidate',suppressed=false)=>reviewProducts(rows,now,suppressed,fit).filter(r=>r.product==='signal');
describe('trigger-scoped Signal review',()=>{
 it('keeps independent triggers and outcomes separate while retaining unattributed history',()=>{
  const rows=signal([trigger(),trigger(two),outcome(one),outcome()]);expect(rows).toHaveLength(3);
  expect(rows.find(r=>r.reference===one)).toMatchObject({outcomeScope:'signal_reference',outcomes:[{signalId:one,deliveryEstablished:false}]});
  expect(rows.find(r=>r.reference===two)?.outcomes).toEqual([]);
  expect(rows.find(r=>r.reference===null)).toMatchObject({outcomeScope:'unattributed',state:'needs_evidence'});
 });
 it('does not attach missing, foreign-mode, foreign-contact or pre-trigger outcome evidence',()=>{
  for(const patch of [{synthetic:false},{lead_id:'other'},{tenant_id:'other'},{observed_at:'2026-10-23T00:00:00Z'}]){
   const rows=signal([trigger(),outcome(one,patch)]);expect(rows.find(r=>r.reference===one)?.outcomes).toEqual([]);expect(rows.find(r=>!r.reference)?.outcomeScope).toBe('unattributed');
  }
  expect(signal([outcome(one)])[0]).toMatchObject({reference:null,outcomeScope:'unattributed'});
 });
 it('expires a source at thirty days even when its declared expiry is later and preserves exclusions/holds',()=>{
  const aged=trigger(one,{observed_at:'2026-09-25T00:00:00Z',product_context:{product:'signal',kind:'trigger',relevance:'Reviewed change',expiresAt:'2027-01-01T00:00:00Z'}});
  expect(signal([aged])[0]).toMatchObject({state:'stale',validUntil:'2026-10-25T00:00:00.000Z',question:null});
  expect(signal([trigger()],'excluded')[0]).toMatchObject({state:'excluded',question:null});
  expect(signal([trigger()],'candidate',true)[0].state).toBe('suppressed');
  const reply=trigger(two,{product_context:{product:'response',kind:'reply',threadRef:'reply',disposition:'interested',need:'',authority:'',timing:''}});
  expect(signal([trigger(),reply])[0]).toMatchObject({state:'reply_hold',question:null,contactAllowed:false});
 });
 it('requires Signal scope for new outcomes, forbids cross-product IDs and keeps legacy parsing',()=>{
  const legacy=outcome().product_context!;expect(productError(legacy,'2026-10-24T00:00:00Z',now,true)).toMatch(/Signal trigger/);expect(productError(legacy,'2026-10-24T00:00:00Z',now)).toBeNull();
  expect(productError({...legacy,signalId:one},'2026-10-24T00:00:00Z',now,true)).toBeNull();
  expect(productError({...legacy,signalId:'bad'},'2026-10-24T00:00:00Z',now,true)).not.toBeNull();
  expect(productError({...legacy,product:'revive',signalId:one},'2026-10-24T00:00:00Z',now,true)).not.toBeNull();
 });
});
let db:PGlite,tenant:string,otherTenant:string,lead:string,otherLead:string,staff:string,source:string,foreignSource:string,otherLeadSource:string,legacyOutcome:string,campaign:string,queued:string,claimed:string,token:string;
const q=async(sql:string,args:any[]=[])=> (await db.query<any>(sql,args)).rows;
const service=async<T>(fn:()=>Promise<T>)=>{await db.exec('set role service_role');try{return await fn();}finally{await db.exec('reset role');}};
async function event(ctx:any,options:{tenant?:string;lead?:string;at?:string;synthetic?:boolean;reference?:string}={}){return service(async()=>(await q('select record_product_event($1,$2,$3,$4,$5,$6,$7,$8,$9) id',[options.tenant??tenant,options.lead??lead,staff,options.reference??crypto.randomUUID(),'Reviewed fixture use','Reviewed Signal excerpt',options.at??new Date().toISOString(),options.synthetic??true,JSON.stringify(ctx)]))[0].id);}
const outcomeContext=(signalId=source)=>({product:'signal',kind:'outcome',outcome:'accepted',reason:'Reviewed fixture evidence',signalId});
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort(),migration=files.find(f=>f.endsWith('_signal_trigger_review.sql'))!;expect(migration).toBeTruthy();
 for(const file of files.filter(f=>f<migration))await db.exec(readFileSync(new URL(file,dir),'utf8'));
 staff=crypto.randomUUID();await q(`insert into auth.users(id,email,email_confirmed_at)values($1,'signal-staff@example.invalid',now())`,[staff]);await q('update profiles set is_admin=true where id=$1',[staff]);
 tenant=(await q(`insert into tenants(name,slug,country,currency,package,status)values('Signal fixture','signal-trigger-fixture','AE','AED','signal','active')returning id`))[0].id;
 otherTenant=(await q(`insert into tenants(name,slug,country,currency,package,status)values('Other fixture','signal-other-fixture','AE','AED','signal','active')returning id`))[0].id;
 lead=(await q(`insert into leads(tenant_id,source,email)values($1,'import','signal@example.invalid')returning id`,[tenant]))[0].id;
 otherLead=(await q(`insert into leads(tenant_id,source,email)values($1,'import','signal-other@example.invalid')returning id`,[tenant]))[0].id;
 const foreignLead=(await q(`insert into leads(tenant_id,source,email)values($1,'import','signal-foreign@example.invalid')returning id`,[otherTenant]))[0].id;
 const ctx={product:'signal',kind:'trigger',relevance:'Expansion can change routing',expiresAt:new Date(Date.now()+86400000).toISOString()},at=new Date(Date.now()-3600000).toISOString();
 source=await event(ctx,{at});foreignSource=await event(ctx,{tenant:otherTenant,lead:foreignLead,at});otherLeadSource=await event(ctx,{lead:otherLead,at});
 legacyOutcome=await event({product:'signal',kind:'outcome',outcome:'accepted',reason:'Historical unscoped fixture'});
 campaign=(await q(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone,status,client_authority_ref,owner_authority_ref,cts_profile_ref,expires_at,max_actions)values($1,'signal',$2,'fixture','email','AE','UTC','approved','fixture','fixture','fixture',now()+interval '1 day',10)returning id`,[tenant,staff]))[0].id;
 await q(`insert into campaign_assets(tenant_id,campaign_id,version,steps,created_by,approved_by,approved_at)values($1,$2,1,$3,$4,$4,now())`,[tenant,campaign,JSON.stringify([{offsetHours:0,subject:'Fixture',body:'Fixture',evidenceReference:'fixture'}]),staff]);
 await q(`insert into contact_rights(tenant_id,lead_id,source_id,purpose,channel,market,decision,reviewer_id,notice_reference)values($1,$2,$3,'fixture','email','AE','permitted',$4,'Synthetic fixture only')`,[tenant,lead,source,staff]);
 queued=(await q(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at)values($1,$2,$3,'signal:legacy:queued',1,1,now()-interval '1 minute')returning id`,[tenant,campaign,lead]))[0].id;
 token=crypto.randomUUID();claimed=(await q(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,state,attempts,lease_until,dispatch_token)values($1,$2,$3,'signal:legacy:claimed',1,1,now()-interval '1 minute','claimed',1,now()+interval '1 day',$4)returning id`,[tenant,campaign,lead,token]))[0].id;
 // Baseline demonstrates that generic authority alone previously enabled this Signal action.
 expect((await service(()=>q('select synthetic_action_allowed($1,now()) allowed',[queued])))[0].allowed).toBe(true);
 for(const file of files.filter(f=>f>=migration))await db.exec(readFileSync(new URL(file,dir),'utf8'));
});
afterAll(async()=>db.close());
describe('actual Signal SQL attribution and execution boundary',()=>{
 it('accepts matching trigger outcomes idempotently without rewriting old records',async()=>{
  const at=new Date().toISOString(),reference=crypto.randomUUID(),first=await event(outcomeContext(),{at,reference});expect(await event(outcomeContext(),{at,reference})).toBe(first);
  expect((await q('select product_context from lead_observations where id=$1',[legacyOutcome]))[0].product_context).not.toHaveProperty('signalId');
  await expect(event({...outcomeContext(),outcome:'won'},{at,reference})).rejects.toThrow(/Reference reused/);
 });
 it('rejects missing, foreign, wrong-contact and pre-trigger attribution at the database boundary',async()=>{
  for(const id of [foreignSource,otherLeadSource,crypto.randomUUID()])await expect(event(outcomeContext(id))).rejects.toThrow(/Signal outcome requires/);
  await expect(event({product:'signal',kind:'outcome',outcome:'accepted',reason:'Missing source'})).rejects.toThrow(/trigger identity/);
  await expect(event(outcomeContext(),{at:new Date(Date.now()-7200000).toISOString()})).rejects.toThrow(/Signal outcome requires/);
  await expect(event(outcomeContext(),{synthetic:false})).rejects.toThrow(/Evidence mode/);
 });
 it('keeps reviewed triggers and linked outcomes immutable but permits existing erasure paths',async()=>{
  const id=await event(outcomeContext());await expect(service(()=>q('update lead_observations set assessment_excerpt=$1 where id=$2',['Replacement',source]))).rejects.toThrow(/append-only/);
  await expect(service(()=>q('update lead_observations set product_context=$1 where id=$2',[JSON.stringify({...outcomeContext(),signalId:otherLeadSource}),id]))).rejects.toThrow(/append-only/);
  await service(()=>q('delete from lead_observations where id=$1',[id]));expect(await q('select id from lead_observations where id=$1',[id])).toEqual([]);
 });
 it('denies legacy queued actions and fenced completion without fabricating delivery',async()=>{
  expect((await service(()=>q('select synthetic_action_allowed($1,now()) allowed',[queued])))[0].allowed).toBe(false);
  expect((await service(()=>q('select claim_fenced_synthetic_action($1,$2,$3,now()) claim',[tenant,queued,crypto.randomUUID()])))[0].claim).toBeNull();
  expect((await service(()=>q('select complete_fenced_synthetic_action($1,$2,$3,1,1,now()) done',[tenant,claimed,token])))[0].done).toBe(false);
  expect((await q('select state,acknowledged_at,provider_ref from outbound_actions where id=$1',[claimed]))[0]).toMatchObject({state:'blocked',acknowledged_at:null,provider_ref:null});
 });
 it('denies new queue and direct active-state inserts while retaining recovery/cancellation',async()=>{
  await expect(service(()=>q(`select manage_campaign_plan($1,$2,$3,'queue',1,$4)`,[tenant,campaign,staff,JSON.stringify({leadId:otherLead,startAt:new Date(Date.now()+60000).toISOString()})]))).rejects.toThrow(/Signal (?:binding|live delivery|claim receipt)|Fenced Signal|Signal execution/);
  for(const state of ['queued','claimed','tested','delivered'])await expect(service(()=>q(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,state)values($1,$2,$3,$4,1,1,now(),$5)`,[tenant,campaign,lead,crypto.randomUUID(),state]))).rejects.toThrow(/Signal (?:binding|live delivery|claim receipt)|Fenced Signal|Signal execution/);
  await service(()=>q(`update outbound_actions set state='cancelled' where id=$1`,[queued]));expect((await q('select state from outbound_actions where id=$1',[queued]))[0].state).toBe('cancelled');
 });
 it('exposes no public/private guard execution to anonymous or authenticated roles',async()=>{
  for(const name of ['public.guard_signal_evidence()','public.guard_signal_execution()','public.synthetic_action_allowed(uuid,timestamptz)','ripepiper_private.synthetic_action_allowed(uuid,timestamptz)'])for(const role of ['anon','authenticated'])expect((await q('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,name]))[0].allowed).toBe(false);
 });
});

describe('Signal outcome API scope',()=>{
 it('checks source scope before the write and returns a verified receipt',async()=>{
  const {recordProductEvent}=await import('../src/foundation/prospecting-routes');
  const {vi}=await import('vitest');const calls:{url:URL;body:any}[]=[];
  const actor=crypto.randomUUID(),t=crypto.randomUUID(),l=crypto.randomUUID(),id=crypto.randomUUID();
  let present=true;
  vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
   const url=new URL(input),body=init.body?JSON.parse(String(init.body)):null;if(url.pathname==='/rest/v1/rpc/tenant_access')return Response.json(body.p_actor===actor);calls.push({url,body});
   if(url.pathname==='/auth/v1/user')return Response.json({id:actor,email:'staff@example.invalid'});
   if(url.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);
   if(url.pathname==='/rest/v1/leads')return Response.json([{id:l,email:'signal@example.invalid'}]);
   if(url.pathname==='/rest/v1/lead_observations')return Response.json(present?[{id}]:[]);
   if(url.pathname==='/rest/v1/rpc/record_product_event')return Response.json(one);
   throw Error('Unexpected request');
  });
  const env={SUPABASE_URL:'https://signal-api.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',SUPABASE_ANON_KEY:'synthetic'} as import('../src/env').Env;
  const at=new Date().toISOString();const invoke=(context:any)=>recordProductEvent(new Request('https://fixture.invalid/',{method:'POST',headers:{Authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({lead_id:l,reference:'api:fixture',rights_reference:'reviewed-source',excerpt:'Reviewed outcome',observed_at:at,synthetic:true,context})}),env,t);
  try{
   const missing=await invoke({product:'signal',kind:'outcome',outcome:'accepted',reason:'Reviewed'});expect(missing.status).toBe(400);expect(calls.some(c=>c.url.pathname.includes('/rpc/'))).toBe(false);
   const valid={product:'signal',kind:'outcome',outcome:'accepted',reason:'Reviewed',signalId:id.toUpperCase()};expect((await invoke(valid)).status).toBe(201);
   const query=calls.find(c=>c.url.pathname==='/rest/v1/lead_observations')!.url.searchParams;
   for(const [key,value] of Object.entries({id:'eq.'+id,tenant_id:'eq.'+t,lead_id:'eq.'+l,synthetic:'eq.true',assessment_reviewed_by:'not.is.null','product_context->>product':'eq.signal','product_context->>kind':'eq.trigger',observed_at:'lte.'+at}))expect(query.get(key)).toBe(value);
   expect(calls.find(c=>c.url.pathname.includes('/rpc/'))?.body.p_context.signalId).toBe(id);
   calls.length=0;present=false;expect((await invoke(valid)).status).toBe(409);expect(calls.some(c=>c.url.pathname.includes('/rpc/'))).toBe(false);
  }finally{vi.unstubAllGlobals();}
 });
});
