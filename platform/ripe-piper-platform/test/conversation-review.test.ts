import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {reviewProducts,productError} from '../src/foundation/products';
import {conversationReview} from '../src/foundation/conversation-review';
import type {Env} from '../src/env';
import {asOperator} from './helpers/access';
const admin='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002',viewer='00000000-0000-4000-8000-000000000003',foreign='00000000-0000-4000-8000-000000000004';
let db:PGlite,tenant:string,otherTenant:string;
const reply={product:'response',kind:'reply',threadRef:'thread-one',disposition:'interested',need:'Known need',authority:'',timing:''};
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,dir),'utf8'));
 tenant=(await db.query<any>(`insert into tenants(name,slug,country,currency,status) values('Fixture','response-fixture','AE','AED','active') returning id`)).rows[0].id;
 otherTenant=(await db.query<any>(`insert into tenants(name,slug,country,currency,status) values('Other','response-other','AE','AED','active') returning id`)).rows[0].id;
 for(const [id,name]of[[admin,'Admin'],[owner,'Owner'],[viewer,'Viewer'],[foreign,'Foreign']])await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,now(),$3)`,[id,name.toLowerCase()+'@example.invalid',JSON.stringify({full_name:name})]);
 await db.query('update profiles set is_admin=true where id=$1',[admin]);await db.query(`insert into memberships(tenant_id,user_id,role)values($1,$2,'owner'),($1,$3,'viewer'),($4,$5,'owner')`,[tenant,owner,viewer,otherTenant,foreign]);
 for(const t of [tenant,otherTenant])await asOperator(db,{tenantId:t,profileId:admin});
});
afterAll(async()=>db.close());
async function service<T>(fn:()=>Promise<T>){await db.exec('set role service_role');try{return await fn();}finally{await db.exec('reset role');}}
async function lead(){return(await db.query<any>(`insert into leads(tenant_id,source,email)values($1,'import',$2)returning id`,[tenant,crypto.randomUUID()+'@example.invalid'])).rows[0].id;}
async function inbound(id:string,thread='thread-one',at='2026-10-20T00:00:00Z'){
 return service(async()=>(await db.query<any>(`select record_product_event($1,$2,$3,$4,'fixture-rights','Fixture inbound',$5,true,$6) id`,[tenant,id,admin,crypto.randomUUID(),at,JSON.stringify({...reply,threadRef:thread})])).rows[0].id);
}
async function snapshot(id:string,thread='thread-one'){return(await db.query<any>(`select string_agg(id::text,',' order by id) snapshot from lead_observations where lead_id=$1 and product_context->>'kind' in('reply','enquiry') and product_context->>'threadRef'=$2`,[id,thread])).rows[0].snapshot;}
async function save(id:string,version:number,snap:string,overrides:any={}){
 const p={tenant,thread:'thread-one',actor:admin,owner,version,snap,state:'resolved',reason:'Reviewed and handled manually',request:crypto.randomUUID(),synthetic:true,...overrides};
 return service(async()=>(await db.query<any>(`select save_response_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) review`,[p.tenant,id,p.thread,p.actor,p.owner,p.version,p.snap,p.state,p.reason,p.request,p.synthetic])).rows[0].review);
}
async function rows(id:string){return JSON.parse(JSON.stringify((await db.query<any>('select * from lead_observations where tenant_id=$1 and lead_id=$2',[tenant,id])).rows));}
const response=(observations:any[],owners=[{id:owner,label:'Current owner'}])=>reviewProducts(observations,Date.now(),false,'candidate',owners).find(r=>r.product==='response'&&r.reference==='thread-one')!;
describe('tenant-scoped conversation assignment and human resolution',()=>{
 it('keeps review RPCs invoker-only, private to service role, and unavailable through product-event validation',async()=>{
  const functions=(await db.query<any>(`select proname,prosecdef,has_function_privilege('authenticated',oid,'execute') auth_execute,has_function_privilege('anon',oid,'execute') anon_execute from pg_proc where proname in('save_response_review','response_review_owners')`)).rows;
  expect(functions).toHaveLength(2);expect(functions.every(f=>!f.prosecdef&&!f.auth_execute&&!f.anon_execute)).toBe(true);
  expect(productError({product:'response',kind:'conversation_review'},'2026-10-20T00:00:00Z',Date.now(),true)).toContain('ownership review controls');
 });
 it('lists current verified platform staff and this tenant owner, not foreign owners or viewers',async()=>{
  const owners=await service(async()=>(await db.query<any>('select response_review_owners($1,$2) owners',[tenant,admin])).rows[0].owners);
  expect(owners.map((o:any)=>o.id).sort()).toEqual([admin,owner].sort());
 });
 it('appends owner/resolution, preserves a retry identity and rejects changed replay',async()=>{
  const id=await lead();await inbound(id);const snap=await snapshot(id),request=crypto.randomUUID();
  const first=await save(id,0,snap,{request});expect(await save(id,0,snap,{request})).toMatchObject({id:first.id,version:1,replayed:true});
  await expect(save(id,0,snap,{request,reason:'Changed review'})).rejects.toThrow('reference reused');
  expect(response(await rows(id))).toMatchObject({state:'resolved',dueAt:null,contactAllowed:false,conversation:{ownerId:owner,state:'resolved',version:1,ownerLabel:'Current owner'}});
  await expect(save(id,0,snap)).rejects.toThrow('review changed');
 });
 it('allows one competing update and reopens when older-dated inbound arrives',async()=>{
  const id=await lead();await inbound(id);const snap=await snapshot(id);
  const attempts=await Promise.allSettled([save(id,0,snap,{state:'open'}),save(id,0,snap)]);
  expect(attempts.filter(a=>a.status==='fulfilled')).toHaveLength(1);
  expect(attempts.filter(a=>a.status==='rejected')).toHaveLength(1);
  await save(id,1,snap);await inbound(id,'thread-one','2026-10-19T00:00:00Z');
  expect(response(await rows(id))).toMatchObject({state:'human',conversation:{state:'open',reopened:true}});
  await expect(save(id,2,snap)).rejects.toThrow('Inbound evidence changed');
 });
 it('invalidates review after same-count inbound replacement and keeps other threads separate',async()=>{
  const id=await lead();const original=await inbound(id);const snap=await snapshot(id);await save(id,0,snap);
  await inbound(id,'different-thread');expect(response(await rows(id)).state).toBe('resolved');
  await db.query('delete from lead_observations where id=$1',[original]);await inbound(id);
  expect(response(await rows(id))).toMatchObject({state:'human',conversation:{reopened:true}});
 });
 it('rejects foreign owner, viewer, unverified owner, foreign lead/tenant, mode and paused writes',async()=>{
  const id=await lead();await inbound(id);const snap=await snapshot(id);
  for(const assigned of [viewer,foreign])await expect(save(id,0,snap,{owner:assigned})).rejects.toThrow('not currently authorized');
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[owner]);await expect(save(id,0,snap)).rejects.toThrow('not currently authorized');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[owner]);
  await expect(save(id,0,snap,{tenant:otherTenant})).rejects.toThrow('scope');await expect(save(id,0,snap,{synthetic:false})).rejects.toThrow('mode');
  await db.query(`update tenants set status='paused' where id=$1`,[tenant]);await expect(save(id,0,snap)).rejects.toThrow('unavailable');await db.query(`update tenants set status='active' where id=$1`,[tenant]);
 });
 it('reopens unavailable-owner work and never removes suppression or releases queued follow-ups',async()=>{
  const id=await lead();await inbound(id);const snap=await snapshot(id);await save(id,0,snap);
  expect(response(await rows(id),[])).toMatchObject({state:'human',conversation:{state:'owner_unavailable',ownerAvailable:false}});
  await db.query(`insert into lead_suppression(tenant_id,lead_id,reason)values($1,$2,'fixture stop')`,[tenant,id]);
  const campaign=(await db.query<any>(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone)values($1,'response',$2,'fixture','email','AE','UTC')returning id`,[tenant,admin])).rows[0].id;
  await db.query(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,state)values($1,$2,$3,'held-fixture',1,1,now(),'cancelled')`,[tenant,campaign,id]);
  await save(id,1,snap,{state:'open'});await save(id,2,snap);
  expect((await db.query(`select * from lead_suppression where lead_id=$1`,[id])).rows).toHaveLength(1);
  expect((await db.query<any>(`select state from outbound_actions where lead_id=$1`,[id])).rows[0].state).toBe('cancelled');
  expect(reviewProducts(await rows(id),Date.now(),true,'candidate',[{id:owner,label:'Owner'}]).find(r=>r.product==='response')?.state).toBe('suppressed');
 });
 it('denies direct authenticated review insertion and RPC invocation even for a platform admin',async()=>{
  const id=await lead();const ctx={product:'response',kind:'conversation_review'};
  await db.exec(`set role authenticated;select set_config('request.jwt.sub','${admin}',false)`);
  try{
   await expect(db.query(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,assessment_reviewed_by,product_context)values($1,$2,'not-response-review','forged',now(),'fixture',$3,$4)`,[tenant,id,admin,JSON.stringify(ctx)])).rejects.toThrow('Staff service review');
   await expect(db.query('select response_review_owners($1,$2)',[tenant,admin])).rejects.toThrow('permission denied');
  }finally{await db.exec('reset role');}
 });
});
describe('conversation review HTTP boundary',()=>{
 const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'} as Env;
 function request(body:any,token='staff'){return new Request('https://fixture.invalid/api',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify(body)});}
 function provider(error?:string,result:any={id:admin,version:1,replayed:false}){const writes:any[]=[];vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const u=new URL(input);if(u.pathname==='/auth/v1/user')return Response.json({id:(init.headers as any).Authorization==='Bearer viewer'?viewer:admin,email:'admin@example.invalid'});
  if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:u.searchParams.get('id')!=='eq.'+viewer}]);
  if(u.pathname==='/rest/v1/rpc/tenant_access')return Response.json(JSON.parse(String(init.body)).p_actor!==viewer);
  if(u.pathname==='/rest/v1/tenants')return Response.json([{id:tenant}]);
  writes.push(JSON.parse(String(init.body)));return error?Response.json({code:error},{status:409}):Response.json(result);
 });return writes;}
 const body=()=>({operation:'save',lead_id:admin,thread_ref:'thread-one',owner_id:owner,expected_version:0,inbound_snapshot:admin,state:'resolved',reason:'Reviewed',request_id:viewer,synthetic:true});
 it('uses authenticated staff actor and validates shape before RPC',async()=>{
  const writes=provider();await expect(conversationReview(request(body(),''),env,tenant)).rejects.toThrow('sign in');await expect(conversationReview(request(body(),'viewer'),env,tenant)).rejects.toMatchObject({status:404});
  expect((await conversationReview(request({...body(),expected_version:-1}),env,tenant)).status).toBe(400);
  expect((await conversationReview(request({...body(),actor:foreign}),env,tenant)).status).toBe(200);expect(writes).toHaveLength(1);expect(writes[0].p_actor).toBe(admin);
 });
 it.each([null,{},false,1,{id:admin,version:2,replayed:false},{id:admin,version:1,replayed:'false'}])('does not claim a malformed review receipt succeeded: %j',async value=>{provider(undefined,value);expect((await conversationReview(request(body()),env,tenant)).status).toBe(503);});
 it.each([null,{},false,[{id:admin,label:''}],[{id:'not-a-user',label:'Owner'}]])('rejects malformed owner identities: %j',async value=>{provider(undefined,value);expect((await conversationReview(request({operation:'owners'}),env,tenant)).status).toBe(503);});
 it('returns only whitelisted owner and receipt fields',async()=>{
  provider(undefined,[{id:owner,label:'Fixture owner',privateUnexpected:'hidden'}]);expect(JSON.stringify(await(await conversationReview(request({operation:'owners'}),env,tenant)).json())).not.toContain('privateUnexpected');
  provider(undefined,{id:admin,version:1,replayed:false,privateUnexpected:'hidden'});expect(JSON.stringify(await(await conversationReview(request(body()),env,tenant)).json())).not.toContain('privateUnexpected');
 });
 it('turns stale-state errors into a reload-required conflict',async()=>{provider('40001');expect((await conversationReview(request(body()),env,tenant)).status).toBe(409);});
});
