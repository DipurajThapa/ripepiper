import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index';
import {assessRevive} from '../src/foundation/revive';
import type {Env} from '../src/env';
import {seedReviveSetup} from './helpers/revive-setup';
import {asOperator} from './helpers/access';

const actor='90111111-1111-4111-8111-111111111111',viewer='90222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://qa-revive.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',SUPABASE_ANON_KEY:'public-fixture',REVIVE_AUTOMATION_ENABLED:'true',SYNTHETIC_SINK_ENABLED:'true'} as Env;
let db:PGlite;
const q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;}finally{await db.exec('reset role');}}
const EGM='20261026041450_revive_egm_execution_guards.sql',HYBRID='20261101000001_hybrid_access.sql';
// Without EGM the history is seeded on the pre-hybrid schema; the test then applies EGM, the hybrid migration (whose backfill grants the existing admin) and every later one.
async function initializeDatabase(includeEgm=true){
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);
 for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')&&(includeEgm||f<HYBRID&&f!==EGM)).sort())await db.exec(readFileSync(new URL(file,directory),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'qa-staff@example.invalid',now()),($2,'qa-viewer@example.invalid',now())`,[actor,viewer]);
 await q('update profiles set is_admin=true where id=$1',[actor]);
}
beforeAll(async()=>initializeDatabase(),30000);
afterAll(async()=>db?.close());afterEach(()=>vi.restoreAllMocks());

async function fixture(){
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('QA boundary',$1,'AE','AED','active') returning id`,[crypto.randomUUID()]))[0].id;
 if((await q("select to_regclass('public.operator_grants') t"))[0].t)await asOperator(db,{tenantId:tenant,profileId:actor});
 const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 const observed=new Date(Date.now()-86400000).toISOString();
 const body={offer:'Recover construction enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['quote follow-up'],excludedIndustries:[],maxAgeDays:90,source:{reference:'qa-brief',excerpt:'Approved construction offer',observedAt:observed}};
 await rpc('save_business_brief',[tenant,0,body,actor]);const seeded=await seedReviveSetup(db,tenant,actor);
 await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'qa','qa-fit',$3,'review','qa-authority',true,$4,'construction AE owner quote follow-up',$5)`,[tenant,lead,observed,{industry:'construction',market:'AE',role:'owner',need:'quote follow-up'},actor]);
 await rpc('record_product_event',[tenant,lead,actor,'qa-history','qa-authority','Prior enquiry verified',observed,true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-75*86400000).toISOString(),previousInterest:'yes',stalledReason:'Deferred previously'}]);
 return {tenant,lead,body,strategy:seeded.strategy};
}
async function accept(f:any){
 const context=await rpc('revive_review_context',[f.tenant,f.lead,actor]);const assessment=assessRevive(context);expect(assessment.eligible).toBe(true);
 return rpc('review_revive_candidate',[f.tenant,f.lead,actor,context.review?.version??0,context.snapshot,1,'accepted','QA reviewed current relationship',assessment.expiresAt]);
}
async function campaign(f:any,offset=0){
 const id=crypto.randomUUID();await rpc('manage_campaign_plan',[f.tenant,id,actor,'save',0,{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',strategy:f.strategy,audience:{leadIds:[f.lead],confirmed:true},steps:[{offsetHours:0,subject:'Is this relevant?',body:'May we close the loop?',evidenceReference:'qa-fit'},...(offset?[{offsetHours:offset,subject:'Closing the loop',body:'Final reviewed step',evidenceReference:'qa-history'}]:[])]}]);
 await rpc('manage_campaign_plan',[f.tenant,id,actor,'approve',1,{clientAuthority:'qa-client',ownerAuthority:'qa-owner',ctsProfile:'qa-profile',maxActions:3,expiresAt:new Date(Date.now()+29*86400000).toISOString()}]);
 const source=(await q(`select id from lead_observations where tenant_id=$1 and external_ref='qa-fit'`,[f.tenant]))[0].id;
 await rpc('manage_campaign_plan',[f.tenant,id,actor,'rights',1,{leadId:f.lead,sourceId:source,noticeReference:'qa-notice'}]);return id;
}
async function afterDue(id:string){return new Date(Date.parse((await q('select due_at from outbound_actions where id=$1',[id]))[0].due_at)+1000).toISOString();}
const queue=(f:any,c:string)=>rpc('manage_campaign_plan',[f.tenant,c,actor,'queue',1,{leadId:f.lead,startAt:new Date(Date.now()+1000).toISOString()}]);

it('rejects accepted cohort snapshots after backdated new evidence, although latest history is unchanged',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f);
 await rpc('record_product_event',[f.tenant,f.lead,actor,'qa-backdated','qa-authority','Earlier recorded uncertainty',new Date(Date.now()-2*86400000).toISOString(),true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-80*86400000).toISOString(),previousInterest:'unknown',stalledReason:'Unknown'}]);
 expect(await rpc('revive_history_current',[f.tenant,f.lead,new Date().toISOString()])).toBe(true);
 expect(await rpc('revive_candidate_current',[f.tenant,f.lead,new Date().toISOString()])).toBe(false);
 await expect(queue(f,c)).rejects.toThrow(/Revive cohort|campaign audience|Current reviewed setup and strategy required/);
 expect(await q('select id from outbound_actions where campaign_id=$1',[c])).toHaveLength(0);
});
it('refuses a future step at or after cohort expiry atomically, leaving no partial enrolment',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f,48);
 await q(`update revive_reviews set expires_at=now()+interval '1 day' where tenant_id=$1`,[f.tenant]);
 await expect(queue(f,c)).rejects.toThrow(/expires before|evidence or rights expiry/);
 expect((await q('select count(*)::int n from outbound_actions where campaign_id=$1',[c]))[0].n).toBe(0);
});
it('cannot complete an old claimed action after a second accepted review of the identical evidence',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f);const id=(await queue(f,c)).actionIds[0],token=crypto.randomUUID(),at=await afterDue(id);
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});
 await accept(f);expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(false);
 expect((await q('select state,acknowledged_at from outbound_actions where id=$1',[id]))[0]).toEqual({state:'blocked',acknowledged_at:null});
});
it('cannot reuse synthetic acceptance after contact identity changes to a business address',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f);const id=(await queue(f,c)).actionIds[0];
 await q(`update leads set email='qa-person@business.example' where id=$1`,[f.lead]);
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,crypto.randomUUID(),await afterDue(id)])).toBeNull();
});
it('rejects a cohort expiry exactly at claim time and never grants contact permission through review',async()=>{
 const f=await fixture();await accept(f);expect((await q('select count(*)::int n from contact_rights where tenant_id=$1',[f.tenant]))[0].n).toBe(0);
 const c=await campaign(f),id=(await queue(f,c)).actionIds[0],at=await afterDue(id);
 await q('update revive_reviews set expires_at=$1 where tenant_id=$2',[at,f.tenant]);
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,crypto.randomUUID(),at])).toBeNull();
});
it('blocks historical Revive action rows that have no cohort fence, while preserving another product',async()=>{
 // Seed genuine pre-migration history, then apply the current guard without disabling it.
 const currentDb=db;
 try{
 await initializeDatabase(false);
 const f=await fixture();await accept(f);const c=await campaign(f);const id=(await queue(f,c)).actionIds[0];
 await q('update outbound_actions set revive_review_version=null,revive_review_snapshot=null where id=$1',[id]);
 for(const file of [EGM,...readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')&&f>=HYBRID).sort()])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 const at=await afterDue(id);expect(await rpc('synthetic_action_allowed',[id,at])).toBe(false);
 await q(`update campaigns set capability='signal' where id=$1`,[c]);
 expect(await rpc('synthetic_action_allowed',[id,at])).toBe(false);
 // Signal now has its own qualification hold; Events remains the non-Revive control.
 await q(`update campaigns set capability='events' where id=$1`,[c]);
 expect(await rpc('synthetic_action_allowed',[id,at])).toBe(true);
 }finally{await db.close();db=currentDb;}
},30000);
it('rejects cross-tenant cohort RPC identity rather than borrowing the other tenant review',async()=>{
 const f=await fixture(),foreign=await fixture();await accept(f);
 expect(await rpc('revive_review_context',[foreign.tenant,f.lead,actor])).toBeNull();
 expect(await rpc('revive_candidate_current',[foreign.tenant,f.lead,new Date().toISOString()])).toBe(false);
 const context=await rpc('revive_review_context',[f.tenant,f.lead,actor]);
 await expect(rpc('review_revive_candidate',[foreign.tenant,f.lead,actor,0,context.snapshot,1,'accepted','Foreign tenant forged review',new Date(Date.now()+86400000).toISOString()])).rejects.toThrow(/Lead missing/);
});
it('direct authenticated administrator cannot mutate accepted cohort, bind action snapshots or activate accounts',async()=>{
 const f=await fixture();await accept(f);await db.exec(`set role authenticated;select set_config('request.jwt.sub','${actor}',false)`);
 try{
  await expect(q(`update revive_reviews set state='accepted',snapshot=repeat('a',32) where tenant_id=$1`,[f.tenant])).rejects.toThrow(/permission denied/);
  await expect(q('update outbound_actions set revive_review_version=999 where tenant_id=$1',[f.tenant])).rejects.toThrow(/permission denied/);
  await expect(q(`insert into tenants(name,slug,country,currency,status) values('Forged',$1,'AE','AED','active')`,[crypto.randomUUID()])).rejects.toThrow(/onboarding|Staff service activation required/);
 }finally{await db.exec('reset role');}
});
it('actual Worker rejects anonymous and tenant-viewer calls to all three new staff operations before RPC',async()=>{
 const f=await fixture();let calls=0;
 vi.stubGlobal('fetch',async(input:string)=>{const u=new URL(input);if(u.origin!==env.SUPABASE_URL)throw Error('External network forbidden');if(u.pathname==='/auth/v1/user')return Response.json({id:viewer,email:'qa-viewer@example.invalid'});if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:false}]);if(u.pathname==='/rest/v1/rpc/tenant_access')return Response.json(false);calls++;throw Error('Unexpected database mutation');});
 for(const operation of ['activate','revive-review','revive-run'])for(const authenticated of [false,true]){
  const response=await worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${f.tenant}/${operation}`,{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer fixture-viewer'}:{})},body:'{}'}),env,{} as ExecutionContext);
  expect(response.status).toBe(!authenticated?401:operation==='activate'?403:404);
 }expect(calls).toBe(0);
});
