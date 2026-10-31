import {afterAll,beforeAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {seedReviveSetup,strategyBody} from './helpers/revive-setup';
import {asOperator,asOwner} from './helpers/access';
import {EXCLUDED,EXPORT_TABLES,RETENTION_DAYS,suppressionHmac} from '../src/foundation/offboarding';

// Real migrations in isolated PGlite; synthetic tenants and .invalid contacts only.
let db:PGlite;
const KEY='k'.repeat(40);
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}finally{await db.exec('reset role');}}
async function user(label:string){const id=crypto.randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${label}-${id}@fixture.invalid`]);return id;}
async function tenant(ownership='managed'){
 const id=(await q(`insert into tenants(name,slug,country,currency,status,ownership) values('Offboard fixture',$1,'AE','AED','active',$2) returning id`,['offboard-'+crypto.randomUUID(),ownership]))[0].id as string;
 const owner=await user('owner');await asOwner(db,{tenantId:id,profileId:owner});return {id,owner};
}
const brief=()=>({offer:'Recover dormant enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up'],excludedIndustries:[],maxAgeDays:30,source:{reference:'audience-brief',excerpt:'Reviewed construction offer',observedAt:new Date(Date.now()-3600000).toISOString()}});
/** Brief, reviewed setup, accepted candidate with permitted rights, approved and queued Revive plan (same shape as access-model). */
async function plan(t:string,actor:string){
 await rpc('save_business_brief',[t,0,brief(),actor]);await seedReviveSetup(db,t,actor);
 const lead=(await q(`insert into leads(tenant_id,source,email,company) values($1,'import',$2,'Reviewed construction business') returning id`,[t,crypto.randomUUID()+'@example.invalid']))[0].id;
 const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by,product_context) values($1,$2,'fixture',$3,now()-interval '1 hour','audience review','fixture use authority',true,'{"industry":"construction","market":"AE","role":"owner","need":"lead follow-up"}','construction AE owner lead follow-up',$4,$5) returning id`,
  [t,lead,crypto.randomUUID(),actor,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-60*86400000).toISOString(),previousInterest:'yes',stalledReason:'Project deferred'}]))[0].id;
 const snapshot=(await q('select revive_input_snapshot($1,$2) snapshot',[t,lead]))[0].snapshot;
 await rpc('review_revive_candidate',[t,lead,actor,0,snapshot,1,'accepted','Reviewed relevant dormant business contact',new Date(Date.now()+7*86400000).toISOString()]);
 const id=crypto.randomUUID(),call=(op:string,version:number,b:any)=>rpc('manage_campaign_plan',[t,id,actor,op,version,b]);
 await call('save',0,{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'First',body:'Is this still relevant?',evidenceReference:'audience-brief'}],audience:{leadIds:[lead],confirmed:true},strategy:strategyBody(1,'lead follow-up','audience-brief')});
 await call('approve',1,{clientAuthority:'client reviewed',ownerAuthority:'owner reviewed',ctsProfile:'fixture compliance review',maxActions:4,expiresAt:new Date(Date.now()+3*86400000).toISOString()});
 await call('rights',1,{leadId:lead,sourceId:source,noticeReference:'synthetic'});
 const queued=await call('queue',1,{leadId:lead,startAt:new Date(Date.now()+60000).toISOString()});
 return {id,lead,action:queued.actionIds[0] as string};
}
async function objected(t:string,email:string){
 const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[t,email]))[0].id as string;
 await q(`insert into subject_requests(tenant_id,lead_id,kind) values($1,$2,'object')`,[t,lead]);return lead;
}
const counts=async(t:string)=>Object.fromEntries(await Promise.all(['leads','campaigns','outbound_actions','activity_log','memberships','revive_setups','tenant_connections','payments','fees'].map(async n=>[n,(await q(`select count(*)::int n from ${n} where tenant_id=$1`,[t]))[0].n])));

beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
},60000);
afterAll(async()=>db?.close());

it('covers every tenant table in the export allowlist or the reasoned exclusions, and the Worker retention matches SQL',async()=>{
 const tables=(await q(`select distinct case when c.table_schema='public' then c.table_name else c.table_schema||'.'||c.table_name end t from information_schema.columns c
  join information_schema.tables x on x.table_schema=c.table_schema and x.table_name=c.table_name where c.column_name='tenant_id' and x.table_type='BASE TABLE' and c.table_schema in ('public','ripepiper_private') order by 1`)).map(r=>r.t);
 expect(tables.filter(t=>!Object.hasOwn(EXPORT_TABLES,t)&&!Object.hasOwn(EXCLUDED,t)&&t!=='tenants')).toEqual([]);
 expect(Object.keys(EXPORT_TABLES).filter(t=>t!=='tenants'&&!tables.includes(t))).toEqual([]);
 expect((await q(`select extract(day from public.tenant_retention())::int d`))[0].d).toBe(RETENTION_DAYS);
});

it('ends through the pause path, stamps ended_at, keeps activation rejected and enforces the self-service rule',async()=>{
 const t=await tenant(),viewer=await user('viewer');await q(`insert into memberships(tenant_id,user_id,role) values($1,$2,'viewer')`,[t.id,viewer]);
 const p=await plan(t.id,t.owner);
 await expect(rpc('end_tenant',[t.id,viewer,'Client asked to stop',null])).rejects.toMatchObject({code:'42501'});
 const ended=await rpc('end_tenant',[t.id,t.owner,'Client asked to stop',null]);
 expect(ended).toMatchObject({id:t.id,status:'ended'});
 expect((await q('select status,ended_at from tenants where id=$1',[t.id]))[0].ended_at).not.toBeNull();
 expect((await q('select state from outbound_actions where id=$1',[p.action]))[0].state).toBe('cancelled');
 expect((await q(`select count(*)::int n from outbound_stops where tenant_id=$1 and origin='tenant_pause' and lifted_at is null`,[t.id]))[0].n).toBe(1);
 // A retried end is idempotent (so a retried offboard can finish revoking): same stamp, no second timeline entry.
 const logs=async()=>(await q(`select count(*)::int n from activity_log where tenant_id=$1 and message like 'Service ended:%'`,[t.id]))[0].n;
 expect(await logs()).toBe(1);
 expect(await rpc('end_tenant',[t.id,t.owner,'Client asked to stop',null])).toEqual(ended);expect(await logs()).toBe(1);
 const admin=await user('admin');await q('update profiles set is_admin=true where id=$1',[admin]);
 await expect(rpc('activate_tenant_execution',[t.id,admin,'ended',2,1,'Try to resume an ended account'])).rejects.toBeTruthy();
 // Service role cannot move the clock or purge early.
 await db.exec('set role service_role');
 try{await expect(q(`update tenants set ended_at=now()-interval '200 days' where id=$1`,[t.id])).rejects.toMatchObject({code:'23514'});
  await expect(q(`update tenants set purged_at=now() where id=$1`,[t.id])).rejects.toMatchObject({code:'23514'});}
 finally{await db.exec('reset role');}
 // Self-service: an approve grantee alone needs the client's request reference; the owner does not.
 const s=await tenant('client_owned'),op=await user('operator');await asOperator(db,{tenantId:s.id,profileId:op,capabilities:['approve']});
 await expect(rpc('end_tenant',[s.id,op,'Contract finished early',null])).rejects.toMatchObject({code:'22023'});
 expect((await rpc('end_tenant',[s.id,op,'Contract finished early','Email from client 2026-10-30'])).status).toBe('ended');
});

it('purges only after retention, keeps the suppression, finances and tombstone, and leaves the other tenant untouched',async()=>{
 const a=await tenant(),b=await tenant();await plan(a.id,a.owner);await plan(b.id,b.owner);
 const email=`object-${crypto.randomUUID()}@example.invalid`;await objected(a.id,email);await objected(b.id,`b-${email}`);
 await rpc('register_tenant_connection',[a.id,a.owner,crypto.randomUUID(),'google_workspace','owner@client.invalid',['mail_send'],[],'k1',btoa('0123456789ab'),btoa('x'.repeat(40))]);
 await q(`insert into payments(tenant_id,provider,provider_ref,purpose,amount,currency,status) values($1,'bank',$2,'advance',100,'AED','paid')`,[a.id,'bank-'+crypto.randomUUID()]);
 await q(`insert into fees(tenant_id,month,type,amount,currency) values($1,date '2026-10-01','retainer',100,'AED')`,[a.id]);
 const before=await counts(b.id);
 await rpc('end_tenant',[a.id,a.owner,'Client asked to stop',null]);
 const now=new Date().toISOString(),candidates=await rpc('tenant_suppression_candidates',[a.id,null]);
 expect(candidates).toEqual([{email,reason:'objection'}]);
 const suppression={[a.id]:await Promise.all(candidates.map(async(c:any)=>({hmac:await suppressionHmac(KEY,a.id,c.email),reason:c.reason})))};
 // Not due yet: nothing happens, even with a future clock from the caller.
 expect(await rpc('purge_ended_tenants',[new Date(Date.now()+365*86400000).toISOString(),false,suppression])).toEqual({due:[],purged:[],skipped:[]});
 await q(`update tenants set ended_at=now()-interval '91 days' where id=$1`,[a.id]);
 expect((await rpc('purge_ended_tenants',[now,true,{}])).due).toContain(a.id);
 // An incomplete suppression set skips the tenant instead of losing the objection.
 expect((await rpc('purge_ended_tenants',[now,false,{[a.id]:[]}])).skipped).toEqual([a.id]);
 expect((await counts(a.id)).leads).toBeGreaterThan(0);
 expect((await rpc('purge_ended_tenants',[now,false,suppression])).purged).toEqual([a.id]);
 expect(await counts(a.id)).toMatchObject({leads:0,campaigns:0,outbound_actions:0,activity_log:0,memberships:0,revive_setups:0,tenant_connections:0,fees:1});
 expect((await counts(a.id)).payments).toBe(1);
 expect(await q('select email_hmac,reason from tenant_suppression where tenant_id=$1',[a.id])).toEqual([{email_hmac:suppression[a.id][0].hmac,reason:'objection'}]);
 expect((await q('select count(*)::int n from ripepiper_private.tenant_connection_secrets s left join tenant_connections c on c.id=s.connection_id where c.id is null'))[0].n).toBe(0);
 const tomb=(await q('select name,slug,status,purged_at from tenants where id=$1',[a.id]))[0];
 expect(tomb).toMatchObject({name:'Purged client',slug:'purged-'+a.id.replace(/-/g,''),status:'ended'});expect(tomb.purged_at).not.toBeNull();
 expect(await counts(b.id)).toEqual(before);
 expect(await q('select 1 from tenant_suppression where tenant_id=$1',[b.id])).toHaveLength(0);
});

it('erases a single objected contact on a live account and keeps its keyed suppression',async()=>{
 const t=await tenant(),email=`erase-${crypto.randomUUID()}@example.invalid`,lead=await objected(t.id,email),viewer=await user('viewer');
 const hmac=await suppressionHmac(KEY,t.id,email);
 await expect(rpc('erase_tenant_lead',[t.id,viewer,lead,hmac,'Verified erasure request'])).rejects.toMatchObject({code:'42501'});
 expect(await rpc('erase_tenant_lead',[t.id,t.owner,lead,hmac,'Verified erasure request'])).toEqual({leadId:lead,erased:true});
 expect(await q('select 1 from leads where id=$1',[lead])).toHaveLength(0);
 expect(await q('select reason from tenant_suppression where tenant_id=$1 and email_hmac=$2',[t.id,hmac])).toEqual([{reason:'objection'}]);
 expect((await q(`select message from activity_log where tenant_id=$1 and visible_to_client order by id desc limit 1`,[t.id]))[0].message).toMatch(/Contact erased .*requests closed: object /);
});

it('keeps the new RPCs and the suppression table away from browser roles',async()=>{
 for(const fn of ['record_tenant_export(uuid,uuid)','tenant_connections_to_revoke(uuid)','end_tenant(uuid,uuid,text,text)','tenant_suppression_candidates(uuid,uuid)','erase_tenant_lead(uuid,uuid,uuid,text,text)','purge_ended_tenants(timestamp with time zone,boolean,jsonb)'])
  expect((await q(`select has_function_privilege('authenticated',$1::regprocedure,'EXECUTE') a,has_function_privilege('anon',$1::regprocedure,'EXECUTE') n,has_function_privilege('service_role',$1::regprocedure,'EXECUTE') s`,[fn]))[0]).toEqual({a:false,n:false,s:true});
 await db.exec('set role authenticated');try{await expect(q('select * from tenant_suppression')).rejects.toThrow('permission denied');}finally{await db.exec('reset role');}
});
