import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {dispatchSyntheticAction,inspectActionReceipt} from '../src/foundation/action-reliability';
import type {Env} from '../src/env';
const admin='00000000-0000-4000-8000-000000000001';
const now='2026-10-23T12:00:00.000Z';
const later='2026-10-23T12:03:00.000Z';
const directory=new URL('../supabase/migrations/',import.meta.url);
let db:PGlite;
async function query<T=any>(sql:string,args:any[]=[]){return (await db.query<T>(sql,args)).rows;}
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;}finally{await db.exec('reset role');}}
async function fixture(){
 const tenant=(await query(`insert into tenants(name,slug,country,currency,status) values('Fixture',$1,'AE','AED','active') returning id`,[crypto.randomUUID()]))[0].id;
 const lead=(await query(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 // This is an accepted Revive cohort, not a bypass of the new cohort fence.
 // Evidence predates the fixed claim clock and remains current at test setup.
 const observed='2026-10-23T00:00:00.000Z';
 const brief={offer:'Reviewed reactivation service',industries:['construction'],markets:['AE'],roles:['owner'],needs:['dormant leads'],excludedIndustries:[],maxAgeDays:30,
  source:{reference:'fixture-brief',excerpt:'Reviewed construction offer for AE owner with dormant leads',observedAt:observed}};
 await query(`insert into business_briefs(tenant_id,version,body,created_by)values($1,1,$2,$3)`,[tenant,JSON.stringify(brief),admin]);
 const source=(await query(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,rights_reference,assessment_facts,assessment_excerpt,assessment_reviewed_by,product_context)
  values($1,$2,'fixture','fixture',$3,'appointment',true,'fixture reviewed source rights',$4,'construction AE owner dormant leads',$5,$6) returning id`,[tenant,lead,observed,
  JSON.stringify({industry:'construction',market:'AE',role:'owner',need:'dormant leads'}),admin,
  JSON.stringify({product:'revive',kind:'history',lastContactAt:'2026-08-01T00:00:00Z',previousInterest:'yes',stalledReason:'Project deferred until autumn'})]))[0].id;
 await rpc('review_revive_candidate',[tenant,lead,admin,0,(await query('select revive_input_snapshot($1,$2) value',[tenant,lead]))[0].value,1,'accepted','Reviewed evidence supports the reactivation cohort','2026-10-25T00:00:00Z']);
 // Database-owner fixture clock: ensure acceptance precedes fixed claim time.
 await query(`update revive_reviews set reviewed_at='2026-10-23T11:00:00Z' where tenant_id=$1 and lead_id=$2`,[tenant,lead]);
 await query(`insert into contact_rights(tenant_id,lead_id,source_id,purpose,channel,market,decision,reviewer_id,notice_reference) values($1,$2,$3,'appointment','email','AE','permitted',$4,'fixture-only')`,[tenant,lead,source,admin]);
 const campaign=(await query(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone,status,client_authority_ref,owner_authority_ref,cts_profile_ref,expires_at,max_actions) values($1,'revive',$2,'appointment','email','AE','UTC','approved','fixture-client','fixture-owner','fixture-cts','2026-11-20T00:00:00Z',10) returning id`,[tenant,admin]))[0].id;
 const audience=await rpc('build_revive_audience',[tenant,admin,{leadIds:[lead],confirmed:true}]);
 // Match the existing fixture clock; the server-built membership and snapshot stay intact.
 audience.reviewedAt='2026-10-23T11:00:00Z';
 await query(`insert into campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by,approved_by,revive_audience) values($1,$2,1,1,'[{"subject":"Fixture","body":"Synthetic message","offsetHours":0,"evidenceReference":"fixture"}]',$3,$3,$4)`,[tenant,campaign,admin,audience]);
 const id=(await query(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at) values($1,$2,$3,'fixture-action',1,1,$4) returning id`,[tenant,campaign,lead,now]))[0].id;
 return {tenant,lead,campaign,id,token:crypto.randomUUID()};
}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 for(const f of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,directory),'utf8'));
 await query(`insert into auth.users(id,email,email_confirmed_at) values($1,'fixture-admin@example.invalid',now())`,[admin]);
 await query('update profiles set is_admin=true where id=$1',[admin]);
});
afterAll(async()=>{await db.close();});
describe('existing ledger fenced sink acknowledgement',()=>{
 it('claims once, fences old callers/wrong tokens/versions/tenants, and persists one replayable sink receipt',async()=>{
  const f=await fixture();
  expect(await rpc('claim_fenced_synthetic_action',[f.tenant,f.id,f.token,now])).toMatchObject({token:f.token,approvalVersion:1,assetVersion:1});
  expect(await rpc('claim_fenced_synthetic_action',[f.tenant,f.id,crypto.randomUUID(),now])).toBeNull();
  expect(await rpc('complete_synthetic_action',[f.id,now])).toBe(false);
  for(const args of [[crypto.randomUUID(),f.id,f.token,1,1,now],[f.tenant,f.id,crypto.randomUUID(),1,1,now],[f.tenant,f.id,f.token,2,1,now],[f.tenant,f.id,f.token,1,2,now]])expect(await rpc('complete_fenced_synthetic_action',args)).toBe(false);
  expect(await rpc('complete_fenced_synthetic_action',[f.tenant,f.id,f.token,1,1,now])).toBe(true);
  const first=(await query('select state,provider_ref,acknowledged_at,attempts from outbound_actions where id=$1',[f.id]))[0];
  expect(first).toMatchObject({state:'tested',provider_ref:'test-sink:'+f.id,attempts:1});
  await query("update campaigns set status='paused' where id=$1",[f.campaign]);
  expect(await rpc('complete_fenced_synthetic_action',[f.tenant,f.id,f.token,1,1,later])).toBe(true);
  expect((await query('select state,provider_ref,acknowledged_at,attempts from outbound_actions where id=$1',[f.id]))[0]).toEqual(first);
  expect(await rpc('expire_fenced_synthetic_action',[f.tenant,f.id,f.token,later])).toBe(false);
 });
 it.each(['pause','suppression','approval','rights','reply'])('rechecks %s immediately before acknowledging',async change=>{
  const f=await fixture();await rpc('claim_fenced_synthetic_action',[f.tenant,f.id,f.token,now]);
  if(change==='pause')await query("update tenants set status='paused' where id=$1",[f.tenant]);
  if(change==='suppression')await query("insert into lead_suppression(tenant_id,lead_id,reason) values($1,$2,'fixture')",[f.tenant,f.lead]);
  if(change==='approval')await query('update campaigns set approval_version=2 where id=$1',[f.campaign]);
  if(change==='rights')await query('update contact_rights set withdrawn_at=now() where lead_id=$1',[f.lead]);
  if(change==='reply')await rpc('record_product_event',[f.tenant,f.lead,admin,'reply-fixture','fixture-rights','Fixture reply','2026-10-22T00:00:00Z',true,{product:'response',kind:'reply',threadRef:'fixture',disposition:'human',need:'',authority:'',timing:''}]);
  expect(await rpc('complete_fenced_synthetic_action',[f.tenant,f.id,f.token,1,1,now])).toBe(false);
  expect((await query('select acknowledged_at from outbound_actions where id=$1',[f.id]))[0].acknowledged_at).toBeNull();
 });
 it('routes ambiguous or expired results to review, pauses campaign and never requeues',async()=>{
  const f=await fixture();await rpc('claim_fenced_synthetic_action',[f.tenant,f.id,f.token,now]);
  expect(await rpc('complete_fenced_synthetic_action',[f.tenant,f.id,f.token,1,1,later])).toBe(false);
  expect(await rpc('expire_fenced_synthetic_action',[crypto.randomUUID(),f.id,f.token,later])).toBe(false);
  expect(await rpc('expire_fenced_synthetic_action',[f.tenant,f.id,crypto.randomUUID(),later])).toBe(false);
  expect(await rpc('expire_fenced_synthetic_action',[f.tenant,f.id,f.token,later])).toBe(true);
  expect(await rpc('claim_fenced_synthetic_action',[f.tenant,f.id,crypto.randomUUID(),later])).toBeNull();
  expect(await rpc('complete_synthetic_action',[f.id,later])).toBe(false);
  expect((await query('select state,error_code from outbound_actions where id=$1',[f.id]))[0]).toEqual({state:'review',error_code:'uncertain_result'});
  expect((await query('select status from campaigns where id=$1',[f.campaign]))[0].status).toBe('paused');
 });
 it('serializes simultaneous claims and denies non-service direct execution',async()=>{
  const f=await fixture();await db.exec('set role service_role');
  try{const replies=await Promise.all([crypto.randomUUID(),crypto.randomUUID()].map(token=>query('select claim_fenced_synthetic_action($1,$2,$3,$4) value',[f.tenant,f.id,token,now])));expect(replies.filter(r=>r[0].value)).toHaveLength(1);}finally{await db.exec('reset role');}
  await db.exec('set role authenticated');
  try{await expect(query('select complete_fenced_synthetic_action($1,$2,$3,1,1,$4)',[f.tenant,f.id,f.token,now])).rejects.toThrow();}finally{await db.exec('reset role');}
 });
});
const tenant='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://fixture.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-secret',SUPABASE_ANON_KEY:'fixture-public',SYNTHETIC_SINK_ENABLED:'true'} as Env;
const request=()=>new Request('https://fixture.invalid/api/test',{method:'POST',headers:{Authorization:'Bearer fixture-admin'}});
describe('bounded synthetic dispatch and read-only receipt adapter',()=>{
 let row:any,calls:{url:URL,init:RequestInit}[],mode:string;
 beforeEach(()=>{
  mode='normal';row={id,tenant_id:tenant,state:'queued',dispatch_token:null,provider_ref:null,acknowledged_at:null,lease_until:null,error_code:null,approval_version:1,asset_version:1};calls=[];
  vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
   const url=new URL(input);calls.push({url,init});
   if(url.host!=='fixture.supabase.invalid')throw Error('Unexpected external provider');
   if(url.pathname==='/auth/v1/user')return Response.json({id:admin,email:'fixture@example.invalid'});
   if(url.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);
   if(url.pathname==='/rest/v1/outbound_actions')return Response.json(url.searchParams.get('tenant_id') && url.searchParams.get('tenant_id')!=='eq.'+tenant?[]:[row]);
   const b=JSON.parse(String(init.body));
   if(url.pathname.endsWith('/claim_fenced_synthetic_action')){
    if(row.state!=='queued')return Response.json(null);row.state='claimed';row.dispatch_token=b.p_token;
    if(mode==='claim_lost')throw Error('PRIVATE token response lost');
    return Response.json({token:b.p_token,approvalVersion:1,assetVersion:1});
   }
   if(url.pathname.endsWith('/complete_fenced_synthetic_action')){
    if(mode==='completion_timeout')throw Error('PRIVATE timeout');
    if(mode==='completion_malformed')return Response.json({});
    row.state='tested';row.provider_ref='test-sink:'+id;row.acknowledged_at=now;
    if(mode==='completion_lost')throw Error('PRIVATE result lost');return Response.json(true);
   }
   if(url.pathname.endsWith('/expire_fenced_synthetic_action')){if(row.dispatch_token===b.p_token&&row.state==='claimed'){row.state='review';row.error_code='uncertain_result';}return Response.json(true);}
   throw Error('Unexpected route');
  });
 });
 it.each(['normal','completion_lost'])('reports only the persisted test acknowledgement and recovers %s without a repeat completion',async selected=>{
  mode=selected;expect((await dispatchSyntheticAction(request(),env,id)).status).toBe(200);
  expect((await dispatchSyntheticAction(request(),env,id)).status).toBe(200);
  expect(calls.filter(c=>c.url.pathname.endsWith('/complete_fenced_synthetic_action'))).toHaveLength(1);
  expect(calls.filter(c=>c.url.pathname.endsWith('/claim_fenced_synthetic_action'))).toHaveLength(1);
  expect(calls.filter(c=>c.url.pathname.startsWith('/rest/')&&!c.url.pathname.endsWith('/profiles')).every(c=>c.init.signal instanceof AbortSignal)).toBe(true);
 });
 it.each(['claim_lost','completion_timeout','completion_malformed'])('holds %s for review without a second attempt or private error leakage',async selected=>{
  mode=selected;const result=await dispatchSyntheticAction(request(),env,id);expect(result.status).toBe(503);expect(await result.text()).not.toContain('PRIVATE');
  expect(row.state).toBe('review');expect((await dispatchSyntheticAction(request(),env,id)).status).toBe(409);
  expect(calls.filter(c=>c.url.pathname.endsWith('/complete_fenced_synthetic_action'))).toHaveLength(selected==='claim_lost'?0:1);
 });
 it('inspects a tenant-scoped receipt with no write and never reveals the fence token',async()=>{
  await dispatchSyntheticAction(request(),env,id);calls=[];
  const result=await inspectActionReceipt(request(),env,tenant,id),text=await result.text();
  expect(result.status).toBe(200);expect(text).toContain('synthetic_sink');expect(text).toContain('not_sent');expect(text).not.toContain(row.dispatch_token);
  expect(calls.every(c=>!c.init.method||c.init.method==='GET')).toBe(true);
  expect((await inspectActionReceipt(request(),env,crypto.randomUUID(),id)).status).toBe(404);
 });
});
