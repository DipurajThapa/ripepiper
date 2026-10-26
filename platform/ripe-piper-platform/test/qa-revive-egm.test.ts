import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index';
import {assessRevive} from '../src/foundation/revive';
import type {Env} from '../src/env';
import {seedReviveSetup} from './helpers/revive-setup';

const actor='90111111-1111-4111-8111-111111111111',viewer='90222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://qa-revive.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',SUPABASE_ANON_KEY:'public-fixture',REVIVE_AUTOMATION_ENABLED:'true',SYNTHETIC_SINK_ENABLED:'true'} as Env;
let db:PGlite;
const q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);
 for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,directory),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'qa-staff@example.invalid',now()),($2,'qa-viewer@example.invalid',now())`,[actor,viewer]);
 await q('update profiles set is_admin=true where id=$1',[actor]);
},30000);
afterAll(async()=>db?.close());afterEach(()=>vi.restoreAllMocks());

async function fixture(briefOverrides:Record<string,unknown>={}){
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('QA boundary',$1,'AE','AED','active') returning id`,[crypto.randomUUID()]))[0].id;
 const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 const observed=new Date(Date.now()-86400000).toISOString();
 const body={offer:'Recover construction enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['quote follow-up'],excludedIndustries:[],maxAgeDays:90,source:{reference:'qa-brief',excerpt:'Approved construction offer',observedAt:observed},...briefOverrides};
 await rpc('save_business_brief',[tenant,0,body,actor]);const seeded=await seedReviveSetup(db,tenant,actor);
 await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'qa','qa-fit',$3,'review','qa-authority',true,$4,'construction AE owner quote follow-up',$5)`,[tenant,lead,observed,{industry:'construction',market:'AE',role:'owner',need:'quote follow-up'},actor]);
 await rpc('record_product_event',[tenant,lead,actor,'qa-history','qa-authority','Prior enquiry verified',observed,true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-75*86400000).toISOString(),previousInterest:'yes',stalledReason:'Deferred previously'}]);
 return {tenant,lead,body,strategy:seeded.strategy};
}
async function accept(f:any){
 const context=await rpc('revive_review_context',[f.tenant,f.lead,actor]);const assessment=assessRevive(context);expect(assessment.eligible).toBe(true);
 return rpc('review_revive_candidate',[f.tenant,f.lead,actor,context.review?.version??0,context.snapshot,1,'accepted','QA reviewed current relationship',assessment.expiresAt]);
}
async function campaign(f:any,offset=0,approver=actor){
 const id=crypto.randomUUID();await rpc('manage_campaign_plan',[f.tenant,id,actor,'save',0,{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',strategy:f.strategy,audience:{leadIds:[f.lead],confirmed:true},steps:[{offsetHours:0,subject:'Is this relevant?',body:'May we close the loop?',evidenceReference:'qa-fit'},...(offset?[{offsetHours:offset,subject:'Closing the loop',body:'Final reviewed step',evidenceReference:'qa-history'}]:[])]}]);
 await rpc('manage_campaign_plan',[f.tenant,id,approver,'approve',1,{clientAuthority:'qa-client',ownerAuthority:'qa-owner',ctsProfile:'qa-profile',maxActions:3,expiresAt:new Date(Date.now()+29*86400000).toISOString()}]);
 const source=(await q(`select id from lead_observations where tenant_id=$1 and external_ref='qa-fit'`,[f.tenant]))[0].id;
 await rpc('manage_campaign_plan',[f.tenant,id,actor,'rights',1,{leadId:f.lead,sourceId:source,noticeReference:'qa-notice'}]);return id;
}
async function afterDue(id:string){return new Date(Date.parse((await q('select due_at from outbound_actions where id=$1',[id]))[0].due_at)+1000).toISOString();}
const queue=(f:any,c:string)=>rpc('manage_campaign_plan',[f.tenant,c,actor,'queue',1,{leadId:f.lead,startAt:new Date(Date.now()+1000).toISOString()}]);


// EGM fresh-context execution QA: deny expectations are intentionally retained on defects.
it('EGM denies SQL acceptance when the Worker assessment rejects current industry fit',async()=>{
 const f=await fixture();
 await q(`update lead_observations set assessment_facts=jsonb_set(assessment_facts,'{industry}','"retail"'),assessment_excerpt='retail AE owner quote follow-up' where tenant_id=$1 and external_ref='qa-fit'`,[f.tenant]);
 const context=await rpc('revive_review_context',[f.tenant,f.lead,actor]);
 expect(assessRevive(context).eligible).toBe(false);
 await expect(rpc('review_revive_candidate',[f.tenant,f.lead,actor,0,context.snapshot,1,'accepted','QA rejects inconsistent fit',new Date(Date.now()+86400000).toISOString()])).rejects.toThrow();
 expect(await q('select * from revive_reviews where tenant_id=$1',[f.tenant])).toHaveLength(0);
});
it('EGM revoked independent message approver cannot authorize a claim',async()=>{
 const f=await fixture();await accept(f);
 await q('update profiles set is_admin=true where id=$1',[viewer]);
 const c=await campaign(f,0,viewer);
 const id=(await queue(f,c)).actionIds[0];
 await q('update profiles set is_admin=false where id=$1',[viewer]);
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,crypto.randomUUID(),await afterDue(id)])).toBeNull();
});
for(const mutation of ['recipient','rights','approval','reply','evidence','pause'] as const){
 it('EGM completion denies changed '+mutation,async()=>{
  const f=await fixture();await accept(f);const c=await campaign(f),id=(await queue(f,c)).actionIds[0],token=crypto.randomUUID(),at=await afterDue(id);
  expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});
  if(mutation==='recipient')await q("update leads set email='different@example.invalid' where id=$1",[f.lead]);
  if(mutation==='rights')await q('update contact_rights set withdrawn_at=now() where tenant_id=$1',[f.tenant]);
  if(mutation==='approval')await q('update campaigns set approval_version=approval_version+1 where id=$1',[c]);
  if(mutation==='reply')await rpc('record_product_event',[f.tenant,f.lead,actor,'egm-reply','qa-authority','Reviewed response',new Date().toISOString(),true,{product:'response',kind:'reply',conversationRef:'egm-thread',channel:'email',summary:'Please stop follow-ups'}]);
  if(mutation==='evidence')await q("update lead_observations set rights_reference='' where tenant_id=$1 and external_ref='qa-fit'",[f.tenant]);
  if(mutation==='pause')await q("update tenants set status='paused' where id=$1",[f.tenant]);
  expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(false);
 });
}
it('EGM service-role cannot fabricate a queued Revive test receipt',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f),id=(await queue(f,c)).actionIds[0];
 await db.exec('set role service_role');
 try{await expect(q("update outbound_actions set state='tested',dispatch_token=$1,provider_ref='test-sink:'||id::text,acknowledged_at=due_at where id=$2 returning state,provider_ref",[crypto.randomUUID(),id])).rejects.toThrow();}
 finally{await db.exec('reset role');}
});
it('EGM service-role cannot complete a claimed Revive action after rights withdrawal',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f),id=(await queue(f,c)).actionIds[0],token=crypto.randomUUID(),at=await afterDue(id);
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});
 await q('update contact_rights set withdrawn_at=now() where tenant_id=$1',[f.tenant]);
 await db.exec('set role service_role');
 try{await expect(q("update outbound_actions set state='tested',provider_ref='test-sink:'||id::text,acknowledged_at=$1 where id=$2 returning state,provider_ref",[at,id])).rejects.toThrow();}
 finally{await db.exec('reset role');}
});

it('EGM a previously accepted review cannot be refreshed or executed after fit changes',async()=>{
 const f=await fixture();await accept(f);
 await q(`update lead_observations set assessment_facts=jsonb_set(assessment_facts,'{industry}','"retail"'),assessment_excerpt='retail AE owner quote follow-up' where tenant_id=$1 and external_ref='qa-fit'`,[f.tenant]);
 // Neither refresh the accepted snapshot nor execute it after qualification changes.
 const context=await rpc('revive_review_context',[f.tenant,f.lead,actor]);
 await expect(q('update revive_reviews set snapshot=$1 where tenant_id=$2',[context.snapshot,f.tenant])).rejects.toThrow();
 expect(assessRevive(context).eligible).toBe(false);
 expect(await rpc('revive_candidate_current',[f.tenant,f.lead,new Date().toISOString()])).toBe(false);
 await expect(campaign(f)).rejects.toThrow();
 expect(await q('select id from outbound_actions where tenant_id=$1',[f.tenant])).toHaveLength(0);
});
it('EGM revoking only the message approver after claim prevents completion',async()=>{
 const f=await fixture();await accept(f);await q('update profiles set is_admin=true where id=$1',[viewer]);
 const c=await campaign(f,0,viewer),id=(await queue(f,c)).actionIds[0],token=crypto.randomUUID(),at=await afterDue(id);
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});
 await q('update profiles set is_admin=false where id=$1',[viewer]);
 expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(false);
});
it('EGM terminal replay after withdrawal returns the original acknowledgement without another effect',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f),id=(await queue(f,c)).actionIds[0],token=crypto.randomUUID(),at=await afterDue(id);
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});
 expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(true);
 const before=(await q('select * from outbound_actions where id=$1',[id]))[0];
 await q('update contact_rights set withdrawn_at=now() where tenant_id=$1',[f.tenant]);
 expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(true);
 expect((await q('select * from outbound_actions where id=$1',[id]))[0]).toEqual(before);
 expect(await q('select id from outbound_actions where tenant_id=$1',[f.tenant])).toHaveLength(1);
});
it('EGM explicit industry alias remains eligible through the whole synthetic chain',async()=>{
 const f=await fixture({aliases:{industry:{construction:['building trades']}}});
 await q(`update lead_observations set assessment_facts=jsonb_set(assessment_facts,'{industry}','"building trades"'),assessment_excerpt='building trades AE owner quote follow-up' where tenant_id=$1 and external_ref='qa-fit'`,[f.tenant]);
 await accept(f);const c=await campaign(f),id=(await queue(f,c)).actionIds[0],token=crypto.randomUUID(),at=await afterDue(id);
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});
 expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(true);
});
for(const variation of ['conflicting','ambiguous'] as const)it('EGM SQL acceptance denies '+variation+' current fit',async()=>{
 const f=await fixture();
 if(variation==='ambiguous')await q(`update lead_observations set assessment_excerpt='Maybe construction AE owner quote follow-up' where tenant_id=$1 and external_ref='qa-fit'`,[f.tenant]);
 else await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'qa','egm-conflict',now()-interval '1 hour','review','qa-authority',true,'{"industry":"retail"}','retail',$3)`,[f.tenant,f.lead,actor]);
 const context=await rpc('revive_review_context',[f.tenant,f.lead,actor]);expect(assessRevive(context).eligible).toBe(false);
 await expect(rpc('review_revive_candidate',[f.tenant,f.lead,actor,0,context.snapshot,1,'accepted','QA inconsistent fit denial',new Date(Date.now()+86400000).toISOString()])).rejects.toThrow();
});

it('EGM SQL and Worker both ignore oversized padded fit values',async()=>{
 const f=await fixture();await q(`update lead_observations set assessment_facts=jsonb_set(assessment_facts,'{industry}',to_jsonb(repeat(' ',101)||'construction')) where tenant_id=$1 and external_ref='qa-fit'`,[f.tenant]);
 const context=await rpc('revive_review_context',[f.tenant,f.lead,actor]);expect(assessRevive(context).eligible).toBe(false);
 await expect(rpc('review_revive_candidate',[f.tenant,f.lead,actor,0,context.snapshot,1,'accepted','QA oversized fact denial',new Date(Date.now()+86400000).toISOString()])).rejects.toThrow();
});
it('EGM direct claim retains the campaign execution cap',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f,72),ids=(await queue(f,c)).actionIds;
 const token=crypto.randomUUID(),at=await afterDue(ids[0]);expect(await rpc('claim_fenced_synthetic_action',[f.tenant,ids[0],token,at])).toMatchObject({token});expect(await rpc('complete_fenced_synthetic_action',[f.tenant,ids[0],token,1,1,at])).toBe(true);
 await db.exec('begin; set local role service_role');try{expect(await q("update outbound_actions set state='claimed',attempts=attempts+1,dispatch_token=null,lease_until=due_at+interval '2 minutes' where id=$1 returning state",[ids[1]])).toEqual([{state:'claimed'}]);}finally{await db.exec('rollback');}
 await q('update campaigns set max_actions=1 where id=$1',[c]);
 await db.exec('set role service_role');try{await expect(q("update outbound_actions set state='claimed',attempts=attempts+1,dispatch_token=null,lease_until=due_at+interval '2 minutes' where id=$1",[ids[1]])).rejects.toThrow('Current Revive contact rights and execution policy required');}finally{await db.exec('reset role');}
});
