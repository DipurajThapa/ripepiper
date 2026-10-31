import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {activateTenant} from '../src/foundation/tenants';
import type {Env} from '../src/env';
import {seedReviveSetup} from './helpers/revive-setup';
import {asOperator} from './helpers/access';
const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
 await db.exec(`insert into auth.users(id,email,email_confirmed_at)values('${admin}','staff@example.invalid',now()),('${other}','viewer@example.invalid',now());update profiles set is_admin=true where id='${admin}';grant select,update on tenants to authenticated;`);
},30000);
afterAll(async()=>db?.close());
async function service<T>(fn:()=>Promise<T>){await db.exec('set role service_role');try{return await fn();}finally{await db.exec('reset role');}}
async function tenant(status='onboarding'){
 const id=(await db.query<any>(`insert into tenants(name,slug,country,currency,status) values('Fixture',$1,'AE','AED',$2)returning id`,['activation-'+crypto.randomUUID(),status])).rows[0].id;
 await asOperator(db,{tenantId:id,profileId:admin});
 await db.query(`insert into business_briefs(tenant_id,version,body,created_by)values($1,1,$2,$3)`,[id,JSON.stringify({offer:'Reviewed project recovery',industries:['construction'],markets:['AE'],roles:['owner'],needs:['project recovery'],excludedIndustries:[],maxAgeDays:30,source:{reference:'fixture:interview',excerpt:'Reviewed current business offer',observedAt:new Date().toISOString()}}),admin]);
 if(status!=='ended')await seedReviveSetup(db,id,admin);return id;
}
async function activate(id:string,status='onboarding',version=0,brief=1,actor=admin){return service(async()=>(await db.query<any>('select activate_tenant_execution($1,$2,$3,$4,$5,$6) result',[id,actor,status,version,brief,'Reviewed current offer and account readiness'])).rows[0].result);}
describe('controlled tenant activation database boundary',()=>{
 it('activates current onboarding once, binds the reviewed brief and rejects stale state/version',async()=>{
  const id=await tenant();expect(await activate(id)).toMatchObject({id,status:'active',version:1,briefVersion:1});
  await expect(activate(id)).rejects.toThrow('state changed');
  expect((await db.query<any>('select * from tenant_activation_reviews where tenant_id=$1',[id])).rows).toHaveLength(1);
  expect((await db.query<any>('select actor_id,from_status,brief_version from tenant_activation_reviews where tenant_id=$1',[id])).rows[0]).toEqual({actor_id:admin,from_status:'onboarding',brief_version:1});
 });
 it('resumes deliberately while preserving paused campaigns and unrelated stops',async()=>{
  const id=await tenant();await activate(id);
  const campaign=(await db.query<any>(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone,status)values($1,'revive',$2,'fixture','email','AE','UTC','paused')returning id`,[id,admin])).rows[0].id;
  await db.query(`insert into outbound_stops(scope,tenant_id,reason)values('tenant',$1,'Manual compliance hold')`,[id]);
  await service(()=>db.query('select pause_tenant_execution($1,$2)',[id,'Explicit fixture emergency pause']));
  expect(await activate(id,'paused',2)).toMatchObject({status:'active',version:3});
  const stops=(await db.query<any>('select origin,lifted_at from outbound_stops where tenant_id=$1 order by origin',[id])).rows;
  expect(stops.find(s=>s.origin==='manual').lifted_at).toBeNull();expect(stops.find(s=>s.origin==='tenant_pause').lifted_at).not.toBeNull();
  expect((await db.query<any>('select status from campaigns where id=$1',[campaign])).rows[0].status).toBe('paused');
 });
 it('rejects ended/prospect, absent/stale brief, wrong brief version and nonstaff decisions',async()=>{
  for(const state of ['ended','prospect']){const id=await tenant(state);await expect(activate(id,state)).rejects.toThrow('onboarding or paused');}
  const id=await tenant();await expect(activate(id,'onboarding',0,1,other)).rejects.toThrow('Staff required');
  await expect(activate(id,'onboarding',0,2)).rejects.toThrow('Brief changed or expired');
  await db.query(`update business_briefs set body='{"maxAgeDays":1,"source":{"observedAt":"2020-01-01T00:00:00Z"}}' where tenant_id=$1`,[id]);
  await expect(activate(id)).rejects.toThrow('Brief changed or expired');
  const missing=(await db.query<any>(`insert into tenants(name,slug,country,currency) values('Missing brief',$1,'AE','AED') returning id`,['missing-'+crypto.randomUUID()])).rows[0].id;await expect(activate(missing)).rejects.toThrow('Brief changed or expired');
 });
 it('blocks direct application activation and execution-version forgery',async()=>{
  const id=await tenant();await service(async()=>{
   await expect(db.query(`update tenants set status='active' where id=$1`,[id])).rejects.toThrow('Current activation review required');
   await expect(db.query('update tenants set execution_version=99 where id=$1',[id])).rejects.toThrow('managed by account');
  });
  await db.exec(`set role authenticated;select set_config('request.jwt.sub','${admin}',false)`);
  try{
   await db.query(`update tenants set name='Edited name' where id=$1`,[id]);
   await expect(db.query(`update tenants set status='active' where id=$1`,[id])).rejects.toThrow('Staff service');
   await expect(db.query('select activate_tenant_execution($1,$2,$3,$4,$5,$6)',[id,admin,'onboarding',0,1,'Forged direct browser decision'])).rejects.toThrow('permission denied');
   await expect(db.query('insert into tenant_activation_reviews(tenant_id,execution_version,from_status,brief_version,actor_id,reason)values($1,1,$2,1,$3,$4)',[id,'onboarding',admin,'Forged direct browser decision'])).rejects.toThrow('permission denied');
  }finally{await db.exec('reset role');}
 });
 it('protects review records from mutable service-role edits',async()=>{
  const id=await tenant();await activate(id);
  await service(async()=>{await expect(db.query('delete from tenant_activation_reviews where tenant_id=$1',[id])).rejects.toThrow('permission denied');});
 });
});
describe('activation HTTP contract',()=>{
 const env={SUPABASE_URL:'https://fixture.example.invalid',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'} as Env;
 it('passes the authenticated actor and loaded versions, and refuses malformed success',async()=>{
  let receipt:any={id:other,status:'active',version:1,briefVersion:1},calls=0;
  vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
   const url=new URL(input);if(url.origin!==env.SUPABASE_URL)throw Error('Unrelated network forbidden');
   if(url.pathname==='/auth/v1/user')return Response.json({id:admin,email:'staff@example.invalid'});
   if(url.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);
   if(url.pathname.endsWith('/activate_tenant_execution')){if(receipt==='revive')return Response.json({code:'23514',message:'Reviewed current Revive setup required before activation'},{status:400});const body=JSON.parse(String(init.body));expect(body).toMatchObject({p_actor:admin,p_tenant:other,p_status:'onboarding',p_version:0,p_brief:1});calls++;return Response.json(receipt);}
   throw Error('Unexpected operation');
  });
  function req(extra={}){return new Request('https://fixture.invalid/api',{method:'POST',headers:{Authorization:'Bearer staff'},body:JSON.stringify({expected_status:'onboarding',expected_version:0,brief_version:1,reason:'Reviewed readiness for this account',...extra})});}
  expect((await activateTenant(req(),env,other)).status).toBe(200);
  receipt={ok:true};expect((await activateTenant(req(),env,other)).status).toBe(503);
  expect((await activateTenant(req({expected_status:'ended'}),env,other)).status).toBe(400);expect(calls).toBe(2);
  receipt='revive';const blocked=await activateTenant(req(),env,other);expect(blocked.status).toBe(409);expect((await blocked.json()).error).toMatch(/Revive setup/);
 });
});
