import {afterAll,beforeAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {seedReviveSetup,strategyBody} from './helpers/revive-setup';
import {asOperator,asOwner} from './helpers/access';

const ACCESS_MIGRATION='20261101000001_hybrid_access.sql';
let db:PGlite;let before:Record<string,string>={};
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}finally{await db.exec('reset role');}}
async function user(label:string,flags:{admin?:boolean}={}){
 const id=crypto.randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${label}-${id}@fixture.invalid`]);
 if(flags.admin)await q('update profiles set is_admin=true where id=$1',[id]);return id;
}
async function tenant(status='active'){return (await q(`insert into tenants(name,slug,country,currency,status) values('Access fixture',$1,'AE','AED',$2) returning id`,['access-'+crypto.randomUUID(),status]))[0].id as string;}
const brief=()=>({offer:'Recover dormant enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up'],excludedIndustries:[],maxAgeDays:30,source:{reference:'audience-brief',excerpt:'Reviewed construction offer',observedAt:new Date(Date.now()-3600000).toISOString()}});
const denied=expect.objectContaining({code:'42501'});
// Function-level snapshot taken before the access migration, compared after it (rewrite preservation).
const meta=`select p.oid::regprocedure::text sig,coalesce(p.proacl::text,'')||'|'||coalesce(array_to_string(p.proconfig,','),'')||'|'||p.prosecdef m from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`;

beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort()){
  if(f===ACCESS_MIGRATION)before=Object.fromEntries((await q(meta)).map(r=>[r.sig,r.m]));
  await db.exec(readFileSync(new URL(f,dir),'utf8'));
 }
},60000);
afterAll(async()=>db?.close());

/** Brief, reviewed setup, accepted candidate, saved+approved+queued Revive plan, all by one actor. */
async function plan(t:string,actor:string){
 await rpc('save_business_brief',[t,0,brief(),actor]);
 await seedReviveSetup(db,t,actor);
 const lead=(await q(`insert into leads(tenant_id,source,email,company) values($1,'import',$2,'Reviewed construction business') returning id`,[t,crypto.randomUUID()+'@example.invalid']))[0].id;
 const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by,product_context) values($1,$2,'fixture',$3,now()-interval '1 hour','audience review','fixture use authority',true,'{"industry":"construction","market":"AE","role":"owner","need":"lead follow-up"}','construction AE owner lead follow-up',$4,$5) returning id`,
  [t,lead,crypto.randomUUID(),actor,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-60*86400000).toISOString(),previousInterest:'yes',stalledReason:'Project deferred'}]))[0].id;
 const snapshot=(await q('select revive_input_snapshot($1,$2) snapshot',[t,lead]))[0].snapshot;
 await rpc('review_revive_candidate',[t,lead,actor,0,snapshot,1,'accepted','Reviewed relevant dormant business contact',new Date(Date.now()+7*86400000).toISOString()]);
 const id=crypto.randomUUID();
 const call=(op:string,version:number,b:any)=>rpc('manage_campaign_plan',[t,id,actor,op,version,b]);
 await call('save',0,{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'First',body:'Is this still relevant?',evidenceReference:'audience-brief'}],audience:{leadIds:[lead],confirmed:true},strategy:strategyBody(1,'lead follow-up','audience-brief')});
 await call('approve',1,{clientAuthority:'client reviewed',ownerAuthority:'owner reviewed',ctsProfile:'fixture compliance review',maxActions:4,expiresAt:new Date(Date.now()+3*86400000).toISOString()});
 await call('rights',1,{leadId:lead,sourceId:source,noticeReference:'synthetic'});
 const queued=await call('queue',1,{leadId:lead,startAt:new Date(Date.now()+60000).toISOString()});
 return {id,lead,action:queued.actionIds[0] as string};
}
async function allowed(action:string){
 const due=(await q('select due_at from outbound_actions where id=$1',[action]))[0].due_at.toISOString();
 await db.exec('set role service_role');try{return (await q('select synthetic_action_allowed($1,$2) ok',[action,due]))[0].ok;}finally{await db.exec('reset role');}
}

it('leaves no raw staff check outside the platform allowlist and preserves every rewritten function ACL, config and security',async()=>{
 const raw=(await q(`select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','ripepiper_private') and (p.prosrc ~ 'is_admin' or p.prosrc ~ 'google_authority_admin[(]p_actor[)]') order by 1`)).map(r=>r.sig);
 expect(raw).toEqual(['is_admin()','lock_revive_reviewer()','platform_tenant_overview()','ripepiper_private.can_operate(uuid,uuid,text)']);
 const rewritten=(await q(`${meta} and (p.prosrc ~ 'can_operate|is_platform_admin|is_tenant_owner|google_authority_admin[(]p_tenant' or p.proname='lock_revive_reviewer')`));
 const existing=rewritten.filter(r=>before[r.sig]!==undefined);
 expect(existing.length).toBeGreaterThanOrEqual(45);
 for(const r of existing)expect([r.sig,r.m]).toEqual([r.sig,before[r.sig]]);
 for(const fn of ['tenant_access(uuid,uuid,text)','grant_operator_access(uuid,uuid,uuid,text[],text,text,timestamp with time zone)','revoke_operator_access(uuid,uuid)','set_tenant_ownership(uuid,uuid,text,text,text)'])
  expect((await q(`select has_function_privilege('authenticated',$1::regprocedure,'EXECUTE') a,has_function_privilege('service_role',$1::regprocedure,'EXECUTE') s`,[fn]))[0]).toEqual({a:false,s:true});
});

it('requires a live grant for an operator: no grant, revoked and expired grants all fail closed',async()=>{
 const t=await tenant(),operator=await user('operator'),owner=await user('owner'),admin=await user('admin',{admin:true});await asOwner(db,{tenantId:t,profileId:owner});
 await q('update profiles set is_operator=true where id=$1',[operator]);
 const l=(await q(`insert into leads(tenant_id,source,email) values($1,'import','stop@fixture.invalid') returning id`,[t]))[0].id;
 const tries=()=>[rpc('save_business_brief',[t,0,brief(),operator]),rpc('manage_campaign_plan',[t,crypto.randomUUID(),operator,'save',0,{}]),rpc('record_tenant_unsubscribe',[t,l,operator,'Verified objection #1'])];
 for(const p of tries())await expect(p).rejects.toEqual(denied);
 expect(await rpc('tenant_access',[t,admin,'read'])).toBe(false);
 const grant=await rpc('grant_operator_access',[t,owner,operator,['operate','read','operate'],'client_admin',null,new Date(Date.now()+86400000).toISOString()]);
 expect((await q('select capabilities,authority,authorised_by from operator_grants where id=$1',[grant]))[0]).toEqual({capabilities:['operate','read'],authority:'client_admin',authorised_by:owner});
 expect(await rpc('save_business_brief',[t,0,brief(),operator])).toBeTruthy();
 expect(await rpc('record_tenant_unsubscribe',[t,l,operator,'Verified objection #1'])).toMatchObject({status:'stopped'});
 expect(await rpc('tenant_access',[t,operator,'approve'])).toBe(false);
 expect(await rpc('revoke_operator_access',[grant,owner])).toMatchObject({alreadyRevoked:false});
 expect(await rpc('revoke_operator_access',[grant,owner])).toMatchObject({alreadyRevoked:true});
 await expect(rpc('save_business_brief',[t,1,brief(),operator])).rejects.toEqual(denied);
 const second=await rpc('grant_operator_access',[t,admin,operator,['operate'],'contract','MSA-2026-11',new Date(Date.now()+86400000).toISOString()]);
 expect(await rpc('tenant_access',[t,operator,'operate'])).toBe(true);
 await q(`alter table operator_grants disable trigger operator_grant_guard`);await q(`update operator_grants set starts_at=now()-interval '2 days',expires_at=now()-interval '1 second' where id=$1`,[second]);await q(`alter table operator_grants enable trigger operator_grant_guard`);
 expect(await rpc('tenant_access',[t,operator,'operate'])).toBe(false);
 await expect(rpc('save_business_brief',[t,1,brief(),operator])).rejects.toEqual(denied);
 const log=await q(`select message,visible_to_client from activity_log where tenant_id=$1 and message like 'Operator access%' order by id`,[t]);
 expect(log.map(r=>[r.message.split(' ').slice(0,3).join(' '),r.visible_to_client])).toEqual([['Operator access granted',true],['Operator access revoked',true],['Operator access granted',true]]);
 await expect(q('update operator_grants set capabilities=$2 where id=$1',[grant,['approve']])).rejects.toThrow('append only');
},60000);

it('enforces contract references, no self-grant, operator-only grantees and the 366-day cap',async()=>{
 const t=await tenant(),operator=await user('operator'),plain=await user('plain'),admin=await user('admin',{admin:true}),owner=await user('owner');await asOwner(db,{tenantId:t,profileId:owner});
 await q('update profiles set is_operator=true where id=any($1)',[[operator,admin]]);
 const later=new Date(Date.now()+86400000).toISOString();
 await expect(rpc('grant_operator_access',[t,admin,operator,['read'],'contract',null,later])).rejects.toThrow();
 await expect(rpc('grant_operator_access',[t,admin,admin,['read'],'contract','MSA-1',later])).rejects.toThrow();
 await expect(rpc('grant_operator_access',[t,admin,plain,['read'],'contract','MSA-1',later])).rejects.toEqual(denied);
 await expect(rpc('grant_operator_access',[t,owner,operator,['read'],'contract','MSA-1',later])).rejects.toEqual(denied);
 await expect(rpc('grant_operator_access',[t,admin,operator,['read'],'client_admin',null,later])).rejects.toEqual(denied);
 await expect(rpc('grant_operator_access',[t,owner,operator,['read'],'client_admin',null,new Date(Date.now()+367*86400000).toISOString()])).rejects.toThrow();
 await expect(rpc('grant_operator_access',[t,owner,operator,['delete'],'client_admin',null,later])).rejects.toThrow();
 await expect(rpc('grant_operator_access',[await tenant(),owner,operator,['read'],'client_admin',null,later])).rejects.toEqual(denied);
 await db.exec('set role service_role');try{await expect(q(`insert into operator_grants(tenant_id,operator_id,capabilities,authority,contract_reference,expires_at) values($1,$2,'{read}','contract','pre-hybrid-backfill',now()+interval '1 day')`,[t,operator])).rejects.toEqual(denied);}finally{await db.exec('reset role');}
});

it('lets a client admin run the whole flow alone, denies viewers, and keeps owner-approved work executable',async()=>{
 const t=await tenant(),owner=await user('owner'),viewer=await user('viewer');await asOwner(db,{tenantId:t,profileId:owner});
 await q(`insert into memberships(tenant_id,user_id,role) values($1,$2,'viewer')`,[t,viewer]);
 const f=await plan(t,owner);
 expect(await allowed(f.action)).toBe(true);
 await expect(rpc('import_review_lead',[t,owner,'imported@fixture.invalid','Imported Ltd','import:1','Synthetic rights',new Date().toISOString(),true])).resolves.toBeTruthy();
 await expect(rpc('save_business_brief',[t,1,brief(),viewer])).rejects.toEqual(denied);
 await expect(rpc('manage_campaign_plan',[t,f.id,viewer,'pause',1,{}])).rejects.toEqual(denied);
 await expect(rpc('import_review_lead',[t,viewer,'v@fixture.invalid','V Ltd','import:2','Synthetic rights',new Date().toISOString(),true])).rejects.toEqual(denied);
 expect(await rpc('tenant_access',[t,viewer,'read'])).toBe(true);
},60000);

it('stops execution when the approving operator loses the grant, and scopes owner candidates to the tenant',async()=>{
 const a=await tenant(),b=await tenant(),operator=await user('operator'),ownerB=await user('owner'),admin=await user('admin',{admin:true});
 const grant=await asOperator(db,{tenantId:a,profileId:operator});await asOwner(db,{tenantId:b,profileId:ownerB});
 const f=await plan(a,operator);
 expect(await allowed(f.action)).toBe(true);
 await expect(rpc('response_review_owners',[b,operator])).rejects.toEqual(denied);
 await expect(rpc('revoke_tenant_google_authority',[b,operator,0])).rejects.toEqual(denied);
 expect(await rpc('review_prospect_snapshot',[b,operator,true])).toEqual({version:1,status:'unauthorized'});
 const owners=(await rpc('response_review_owners',[b,ownerB])).map((o:any)=>o.id);
 expect(owners).toEqual([ownerB]);expect(owners).not.toContain(admin);
 expect((await rpc('response_review_owners',[a,operator])).map((o:any)=>o.id)).toEqual([operator]);
 await rpc('revoke_operator_access',[grant,admin]);
 expect(await allowed(f.action)).toBe(false);
},60000);

it('hides tenant rows from a platform admin without a grant but keeps agency and platform rows visible',async()=>{
 const t=await tenant(),admin=await user('admin',{admin:true});
 const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import','tenant@fixture.invalid') returning id`,[t]))[0].id;
 const agencyLead=(await q(`insert into leads(tenant_id,source,email) values(null,'import','agency@fixture.invalid') returning id`))[0].id;
 const obs=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose) values($1,$2,'fixture','rls',now(),'outreach') returning id`,[t,lead]))[0].id;
 await q(`insert into contact_rights(tenant_id,lead_id,source_id,purpose,channel,market) values($1,$2,$3,'outreach','email','AE')`,[t,lead,obs]);
 await q(`insert into meetings(tenant_id,kind,start_at,end_at,attendee_email) values($1,'client_prospect',now(),now()+interval '1 hour','m@fixture.invalid'),(null,'discovery',now(),now()+interval '1 hour','agency-meeting@fixture.invalid')`,[t]);
 const read=async(sql:string)=>{await db.exec(`set role authenticated;select set_config('request.jwt.sub','${admin}',false)`);try{return await q(sql);}finally{await db.exec(`reset role;select set_config('request.jwt.sub','',false)`);}};
 for(const table of ['leads','lead_observations','contact_rights','meetings','campaign_assets','outbound_actions','campaigns','activity_log'])
  expect(await read(`select count(*)::int n from ${table} where tenant_id='${t}'`)).toEqual([{n:0}]);
 expect((await read(`select id from leads where id='${agencyLead}'`))).toHaveLength(1);
 expect((await read(`select id from meetings where attendee_email='agency-meeting@fixture.invalid'`))).toHaveLength(1);
 expect((await read(`select id from tenants where id='${t}'`))).toHaveLength(1);
 await read('select count(*) from payments');await read('select count(*) from proposals');
 await expect(read(`insert into memberships(tenant_id,user_id,role) values('${t}','${admin}','owner')`)).rejects.toThrow();
 await expect(read(`insert into invites(tenant_id,email,role) values('${t}','self@fixture.invalid','owner')`)).rejects.toThrow();
 expect(await read(`select count(*)::int n from memberships where tenant_id='${t}'`)).toEqual([{n:0}]);
 const overview=await read('select * from platform_tenant_overview()');
 expect(overview.find(r=>r.tenant_id===t)).toMatchObject({lead_count:1,active_grants:0,google_authority:'none'});
 const columns=(await q(`select unnest(proargnames) c from pg_proc where proname='platform_tenant_overview'`)).map(r=>r.c);
 expect(columns.filter((c:string)=>/email|body|message|subject|phone|name$/.test(c)&&c!=='name')).toEqual([]);
 await asOperator(db,{tenantId:t,profileId:admin,capabilities:['read']});
 expect(await read(`select count(*)::int n from leads where tenant_id='${t}'`)).toEqual([{n:1}]);
 // A timeline note needs 'operate', not just 'read'.
 await expect(read(`insert into activity_log(tenant_id,actor,kind,message,visible_to_client) values('${t}','Ripe Piper','note','Fixture update',true)`)).rejects.toThrow();
 await asOperator(db,{tenantId:t,profileId:admin,capabilities:['operate']});
 await read(`insert into activity_log(tenant_id,actor,kind,message,visible_to_client) values('${t}','Ripe Piper','note','Fixture update',true)`);
 await db.exec(`set role authenticated;select set_config('request.jwt.sub','${crypto.randomUUID()}',false)`);try{expect(await q('select * from platform_tenant_overview()')).toEqual([]);}finally{await db.exec(`reset role;select set_config('request.jwt.sub','',false)`);}
});

it('switches operating mode by compare-and-set without moving data',async()=>{
 const t=await tenant(),owner=await user('owner'),viewer=await user('viewer');await asOwner(db,{tenantId:t,profileId:owner});
 await q(`insert into memberships(tenant_id,user_id,role) values($1,$2,'viewer')`,[t,viewer]);
 await q(`insert into leads(tenant_id,source,email) values($1,'import','mode@fixture.invalid')`,[t]);
 const counts=async()=>(await q(`select (select count(*) from leads where tenant_id=$1)::int leads,(select count(*) from memberships where tenant_id=$1)::int members`,[t]))[0];
 const start=await counts();
 expect(await rpc('set_tenant_ownership',[t,owner,'managed','client_owned','Client runs it in-house'])).toMatchObject({ownership:'client_owned',changed:true});
 await expect(rpc('set_tenant_ownership',[t,owner,'managed','client_owned','Stale'])).rejects.toEqual(expect.objectContaining({code:'40001'}));
 await expect(rpc('set_tenant_ownership',[t,viewer,'client_owned','managed','Viewer'])).rejects.toEqual(denied);
 expect(await rpc('set_tenant_ownership',[t,owner,'client_owned','managed','Back to managed'])).toMatchObject({ownership:'managed',changed:true});
 expect(await counts()).toEqual(start);
 expect((await q(`select message from activity_log where tenant_id=$1 and message like 'Operating mode%' order by id`,[t])).map(r=>r.message)).toEqual(['Operating mode changed from managed to self-service: Client runs it in-house','Operating mode changed from self-service to managed: Back to managed']);
});
