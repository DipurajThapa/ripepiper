import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {asOperator} from './helpers/access';

// Independently authored adversaries against the complete production migration chain.
const actor='00000000-0000-4000-8000-000000000001';
let db:PGlite,tenant:string,upgradeTenant:string,upgradeLead:string,upgradeBefore:any;
const q=async(sql:string,args:any[]=[])=> (await db.query<any>(sql,args)).rows;
const snapshot=async(t=tenant)=> {await db.exec('set local role service_role');try{return (await q('select public.review_prospect_snapshot($1,$2,true) value',[t,actor]))[0].value;}finally{await db.exec('reset role');}};
const lead=async(t=tenant,email=crypto.randomUUID()+'@example.invalid')=>(await q("insert into leads(tenant_id,source,email) values($1,'import',$2) returning id",[t,email]))[0].id;
const person=async(email:string,confirmed=true)=>(await q("insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),$1,case when $2 then now() end) returning id",[email,confirmed]))[0].id;
async function upgradeRead(){await db.exec('set role service_role');try{return (await q('select public.revive_input_snapshot($1,$2) revive,public.signal_strategy_context($1,$2,$3) signal,public.revive_review_context($1,$2,$3) context',[upgradeTenant,upgradeLead,actor]))[0];}finally{await db.exec('reset role');}}
// Owner candidates are tenant owners plus active 'operate' grantees (the admin flag alone no longer counts).
const operators=async(pattern:string)=>{for(const {id} of await q('select id from profiles where email like $1',[pattern]))await asOperator(db,{tenantId:tenant,profileId:id});};
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;");
 const directory=new URL('../supabase/migrations/',import.meta.url);
 const migration='20261027190653_safe_bounded_prospect_snapshot.sql';
 // Seed on the pre-snapshot schema, then apply the snapshot migration, the hybrid access migration (its backfill grants the existing admin) and every later one.
 const hybrid='20261101000001_hybrid_access.sql';
 for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')&&f!==migration&&f<hybrid).sort()) await db.exec(readFileSync(new URL(file,directory),'utf8'));
 await q("insert into auth.users(id,email,email_confirmed_at) values($1,'qa-snapshot-staff@example.invalid',now())",[actor]);
 await q('update profiles set is_admin=true where id=$1',[actor]);
 tenant=(await q("insert into tenants(name,slug,country,currency,status) values('QA snapshot','qa-snapshot','AE','AED','active') returning id"))[0].id;
 upgradeTenant=(await q("insert into tenants(name,slug,country,currency,status) values('QA unchanged upgrade','qa-unchanged-upgrade','AE','AED','active') returning id"))[0].id;
 upgradeLead=await lead(upgradeTenant);
 const brief={offer:'Fixture service',industries:['construction'],markets:['AE'],roles:['owner'],needs:['follow-up'],excludedIndustries:[],maxAgeDays:90,source:{reference:'qa-upgrade',excerpt:'construction AE owner follow-up',observedAt:new Date(Date.now()-86400000).toISOString()}};
 await q('insert into business_briefs(tenant_id,version,body,created_by) values($1,1,$2,$3)',[upgradeTenant,brief,actor]);
 await q("insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'qa','unchanged',now(),'review',true,'{\"industry\":\"construction\"}','construction',$3)",[upgradeTenant,upgradeLead,actor]);
 upgradeBefore=await upgradeRead();
 for(const file of [migration,...readdirSync(directory).filter(f=>f.endsWith('.sql')&&f>=hybrid).sort()])await db.exec(readFileSync(new URL(file,directory),'utf8'));
},30000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
describe('independent complete-chain snapshot adversaries',()=>{
 it('preserves unchanged pre-migration fingerprints and public review contexts',async()=>{expect(await upgradeRead()).toEqual(upgradeBefore);});
 it('does not silently omit an otherwise verified owner whose email exceeds its safe comparison bound',async()=>{
   const owner=await person('x'.repeat(1030)+'@example.invalid');
   await q("insert into memberships(tenant_id,user_id,role) values($1,$2,'owner')",[tenant,owner]);
   expect(await snapshot()).toEqual({version:1,status:'capacity'});
 });
 it('does not execute any wide success aggregation when compressed observation bytes exceed capacity',async()=>{
   const id=await lead();
   await q("insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,assessment_facts) values($1,$2,'qa','oversized',now(),'review',true,jsonb_build_object('industry',repeat('x',2000000)))",[tenant,id]);
   expect(await snapshot()).toEqual({version:1,status:'capacity'});
   const sql=(await q("select prosrc from pg_proc where oid='public.review_prospect_snapshot(uuid,uuid,boolean)'::regprocedure"))[0].prosrc
     .replace(/\bp_tenant\b/g,'$1::uuid').replace(/\bp_actor\b/g,'$2::uuid').replace(/\bp_synthetic\b/g,'$3::boolean');
   await db.exec('set local role service_role');
   const plan=(await q('explain (analyze,verbose,format json) '+sql,[tenant,actor,true]))[0]['QUERY PLAN'][0].Plan;
   await db.exec('reset role');
   const nodes:any[]=[];const walk=(n:any)=>{nodes.push(n);for(const c of n.Plans??[])walk(c);};walk(plan);
   const wide=nodes.filter(n=>n['Node Type']==='Aggregate'&&(n.Output??[]).some((s:string)=>s.includes('jsonb_agg')));
   expect(wide.length).toBeGreaterThanOrEqual(4);expect(wide.every(n=>n['Actual Loops']===0)).toBe(true);
 });
 it('admits exactly 100 verified operator owners and rejects the 101st',async()=>{
   await q("insert into auth.users(id,email,email_confirmed_at) select gen_random_uuid(),'bound-admin-'||g||'@example.invalid',now() from generate_series(1,99) g");
   await operators('bound-admin-%');
   const complete=await snapshot();expect(complete.status).toBe('complete');expect(complete.ownerCount).toBe(100);expect(complete.owners).toHaveLength(100);
   const extra=await person('bound-admin-extra@example.invalid');await asOperator(db,{tenantId:tenant,profileId:extra});
   expect(await snapshot()).toEqual({version:1,status:'capacity'});
 });
 it('admits exactly 100 raw tenant owners including admin duplication and rejects the 101st',async()=>{
   await q("insert into auth.users(id,email,email_confirmed_at) select gen_random_uuid(),'bound-owner-'||g||'@example.invalid',now() from generate_series(1,99) g");
   await q("insert into memberships(tenant_id,user_id,role) select $1,id,'owner' from profiles where email like 'bound-owner-%' or id=$2",[tenant,actor]);
   const complete=await snapshot();expect(complete.status).toBe('complete');expect(complete.ownerCount).toBe(100);expect(complete.owners).toHaveLength(100);
   const extra=await person('bound-owner-extra@example.invalid');await q("insert into memberships(tenant_id,user_id,role) values($1,$2,'owner')",[tenant,extra]);
   expect(await snapshot()).toEqual({version:1,status:'capacity'});
 });
 it('treats missing stored metadata as capacity and forbids direct metadata writes',async()=>{
   for(const table of ['leads','lead_observations','business_briefs','profiles']){
     await db.exec('savepoint corrupt_metadata');
     await expect(q('update public.'+table+' set prospect_review_bytes=0')).rejects.toThrow();
     await db.exec('rollback to savepoint corrupt_metadata');
     // Deliberately corrupt only the isolated database schema to exercise fail-closed drift handling.
     await db.exec('alter table public.'+table+' alter column prospect_review_bytes drop expression');
     await q('update public.'+table+' set prospect_review_bytes=null');
     expect(await snapshot(upgradeTenant)).toEqual({version:1,status:'capacity'});
     await db.exec('rollback to savepoint corrupt_metadata');
   }
 });
 it('never counts unverified operator grantees as owner candidates',async()=>{
   // Hybrid: candidates come from this tenant's grants filtered by can_operate (verified actor), so unverified grantees are excluded rather than counted.
   await q("insert into auth.users(id,email) select gen_random_uuid(),'unverified-admin-'||g||'@example.invalid' from generate_series(1,100) g");
   await operators('unverified-admin-%');
   expect(await snapshot()).toMatchObject({status:'complete',ownerCount:1});
 });
 it('counts 101 raw owner memberships before filtering out unverified identities',async()=>{
   await q("insert into auth.users(id,email) select gen_random_uuid(),'unverified-owner-'||g||'@example.invalid' from generate_series(1,101) g");
   await q("insert into memberships(tenant_id,user_id,role) select $1,id,'owner' from profiles where email like 'unverified-owner-%'",[tenant]);
   expect(await snapshot()).toEqual({version:1,status:'capacity'});
 });
 it('deduplicates admin membership and excludes viewers and foreign owners',async()=>{
   const owner=await person('qa-owner@example.invalid'),viewer=await person('qa-viewer@example.invalid'),foreign=await person('qa-foreign@example.invalid');
   const other=(await q("insert into tenants(name,slug,country,currency) values('Other','qa-other','AE','AED') returning id"))[0].id;
   await q("insert into memberships(tenant_id,user_id,role) values($1,$2,'owner'),($1,$3,'owner'),($1,$4,'viewer'),($5,$6,'owner')",[tenant,actor,owner,viewer,other,foreign]);
   const value=await snapshot();expect(value.status).toBe('complete');expect(value.ownerCount).toBe(2);
   expect(value.owners.map((p:any)=>p.id).sort()).toEqual([actor,owner].sort());
 });
 it('does not include or budget unrelated wide lead fields',async()=>{
   const id=await lead();await q("update leads set name=repeat('x',2000000) where id=$1",[id]);
   const value=await snapshot();expect(value.status).toBe('complete');expect(value.leads).toHaveLength(1);
   expect(Object.keys(value.leads[0]).sort()).toEqual(['company','email','id','status']);
 });
 it('returns complete scoped stops for email, per-lead and unsubscribed status',async()=>{
   const global=await lead(tenant,'GLOBAL@example.invalid'),individual=await lead(),unsubscribed=await lead(),clean=await lead();
   await q("insert into suppression(email,reason) values('global@example.invalid','QA fixture')");
   await q("insert into lead_suppression(tenant_id,lead_id,reason) values($1,$2,'QA fixture')",[tenant,individual]);
   await q("update leads set status='unsubscribed' where id=$1",[unsubscribed]);
   const value=await snapshot();expect(value.status).toBe('complete');
   expect(value.stoppedLeadIds.sort()).toEqual([global,individual,unsubscribed].sort());expect(value.stoppedLeadIds).not.toContain(clean);
 });
 it('denies actor email mismatch and never emits success rows',async()=>{
   await q("update auth.users set email='mismatch@example.invalid' where id=$1",[actor]);
   expect(await snapshot()).toEqual({version:1,status:'unauthorized'});
 });
 it('denies browser roles even with a verified actor ID',async()=>{
   for(const role of ['anon','authenticated']){
     await db.exec('savepoint role_probe');await db.exec('set local role '+role);
     await expect(q('select public.review_prospect_snapshot($1,$2,true)',[tenant,actor])).rejects.toThrow();await db.exec('rollback to savepoint role_probe');
   }
 });
});




