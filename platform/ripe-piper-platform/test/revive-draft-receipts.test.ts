import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {assessRevive} from '../src/foundation/revive';
import {proposeReviveDraft,reviewedReviveDraftSource,validDraftSave} from '../src/foundation/revive-draft';
import {asOperator} from './helpers/access';
const actor='91111111-1111-4111-8111-111111111111',otherActor='92222222-2222-4222-8222-222222222222';
let db:PGlite;
const q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return(await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,dir),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'receipt-staff@example.invalid',now()),($2,'other-staff@example.invalid',now())`,[actor,otherActor]);await q('update profiles set is_admin=true where id in($1,$2)',[actor,otherActor]);
},30000);afterAll(async()=>db?.close());
async function fixture(needs=['project recovery','quote follow-up']){
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('Receipt fixture',$1,'AE','AED','active') returning id`,[crypto.randomUUID()]))[0].id;
 await asOperator(db,{tenantId:tenant,profileId:actor});
 const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 const observed=new Date(Date.now()-86400000).toISOString(),body={offer:'project recovery',industries:['construction'],markets:['AE'],roles:['owner'],needs,aliases:{need:{'PROJECT RECOVERY':['schedule recovery']}},excludedIndustries:[],maxAgeDays:90,source:{reference:'review:brief',excerpt:'Approved delivery offer',observedAt:observed}};
 await rpc('save_business_brief',[tenant,0,body,actor]);
 const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'reviewed','source-original',$3,'assessment','review:source',true,$4,'construction AE owner schedule recovery',$5) returning id`,[tenant,lead,observed,{industry:'construction',market:'AE',role:'owner',need:'schedule recovery'},actor]))[0].id;
 const unrelated=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'staff_import','unrelated',$3,'review','review:source',true,'{}','Unrelated staff note',$4) returning id`,[tenant,lead,observed,actor]))[0].id;
 await rpc('record_product_event',[tenant,lead,actor,'review:history','review:source','Reviewed relationship',observed,true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-75*86400000).toISOString(),previousInterest:'yes',stalledReason:'Budget timing'}]);
 let context=await rpc('revive_review_context',[tenant,lead,actor]);const assessment=assessRevive(context);expect(assessment.eligible).toBe(true);
 await rpc('review_revive_candidate',[tenant,lead,actor,0,context.snapshot,1,'accepted','Reviewed current cohort evidence',assessment.expiresAt]);context=await rpc('revive_review_context',[tenant,lead,actor]);
 const proposal=proposeReviveDraft(context,'Receipt fixture',{leadId:lead,sourceId:source,senderName:'Reviewer',messageCount:1});
 const receipt=await rpc('record_revive_draft_proposal',[tenant,actor,proposal.draftContext]);
 return{tenant,lead,source,unrelated,context,proposal,receipt,campaign:crypto.randomUUID(),body:{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:proposal.steps,draftContext:{...receipt.draftContext,proposalId:receipt.proposalId},audience:{leadIds:[lead],confirmed:true}}};
}
describe('service-owned original draft source receipts',()=>{
 it('records an idempotent exact source/need receipt and saves operator-edited copy with immutable asset provenance',async()=>{
  const f=await fixture();expect(f.receipt.proposalId).toMatch(/^[1-9][0-9]*$/);expect(f.receipt.draftContext).toEqual(f.proposal.draftContext);
  expect(await rpc('record_revive_draft_proposal',[f.tenant,actor,f.proposal.draftContext])).toEqual(f.receipt);
  expect(f.body.draftContext.canonicalNeed).toBe('project recovery');expect(validDraftSave(f.context,f.body.draftContext)).toBe(true);
  f.body.steps[0].body+='\nReviewed operator correction.';
  expect(await rpc('save_reviewed_revive_draft',[f.tenant,f.campaign,actor,0,f.body])).toMatchObject({id:f.campaign,status:'draft',version:1});
  const asset=(await q('select revive_draft_context,steps,approved_by from campaign_assets where campaign_id=$1',[f.campaign]))[0];expect(asset.revive_draft_context).toEqual(f.body.draftContext);expect(asset.steps).toEqual(f.body.steps);expect(asset.approved_by).toBeNull();
  await expect(q(`update campaign_assets set revive_draft_context='{}' where campaign_id=$1`,[f.campaign])).rejects.toThrow(/immutable/);
  const {draftContext,...untagged}=f.body;await expect(rpc('manage_campaign_plan',[f.tenant,f.campaign,actor,'save',1,untagged])).rejects.toThrow(/cannot be omitted/);
  expect((await q('select count(*)::int n from campaign_assets where campaign_id=$1',[f.campaign]))[0].n).toBe(1);
 });
 it('records a proposal when only an unrelated brief need contains characters drafts cannot use',async()=>{
  const f=await fixture(['project recovery','CRM cleanup [x]']);expect(f.receipt.proposalId).toMatch(/^[1-9][0-9]*$/);expect(f.receipt.draftContext.canonicalNeed).toBe('project recovery');
 });
 it('rejects an unrelated same-contact source swap without a new campaign, saved audit or action',async()=>{
  const f=await fixture(),swapped={...f.body,draftContext:{...f.body.draftContext,sourceId:f.unrelated}};
  expect(reviewedReviveDraftSource(f.context,f.unrelated)).toBeNull();expect(validDraftSave(f.context,swapped.draftContext)).toBe(false);
  await expect(rpc('save_reviewed_revive_draft',[f.tenant,f.campaign,actor,0,swapped])).rejects.toThrow(/Original draft source/);
  expect(await q('select id from campaigns where id=$1',[f.campaign])).toHaveLength(0);expect(await q('select id from outbound_actions where tenant_id=$1',[f.tenant])).toHaveLength(0);
  expect((await q(`select count(*)::int n from activity_log where tenant_id=$1 and message::jsonb->>'kind'='revive_draft_saved'`,[f.tenant]))[0].n).toBe(0);
 });
 it('binds another otherwise valid source identity to regeneration even if the canonical need is identical',async()=>{
  const f=await fixture();
  const another=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) select tenant_id,lead_id,source,'second-valid',observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by from lead_observations where id=$1 returning id`,[f.source]))[0].id;
  // Accept all current evidence first, then create a new original-source proposal receipt.
  let c=await rpc('revive_review_context',[f.tenant,f.lead,actor]);await rpc('review_revive_candidate',[f.tenant,f.lead,actor,c.review.version,c.snapshot,1,'accepted','Reviewed both current sources',assessRevive(c).expiresAt]);c=await rpc('revive_review_context',[f.tenant,f.lead,actor]);
  const original=proposeReviveDraft(c,'Receipt fixture',{leadId:f.lead,sourceId:f.source,senderName:'Reviewer',messageCount:1}),receipt=await rpc('record_revive_draft_proposal',[f.tenant,actor,original.draftContext]);
  const swapped={...receipt.draftContext,proposalId:receipt.proposalId,sourceId:another};expect(reviewedReviveDraftSource(c,another)?.canonicalNeed).toBe('project recovery');
  await expect(rpc('assert_revive_draft_context',[f.tenant,actor,swapped])).rejects.toThrow(/Original draft source/);
  const replacement=proposeReviveDraft(c,'Receipt fixture',{leadId:f.lead,sourceId:another,senderName:'Reviewer',messageCount:1}),regenerated=await rpc('record_revive_draft_proposal',[f.tenant,actor,replacement.draftContext]);expect(regenerated.proposalId).not.toBe(receipt.proposalId);await expect(rpc('assert_revive_draft_context',[f.tenant,actor,{...regenerated.draftContext,proposalId:regenerated.proposalId}])).resolves.toBeDefined();
 });
 it.each(['empty_facts','uncited_need','ambiguous','wrong_mode','stale','missing_rights','outside_brief'])('atomically refuses selected source %s even if caller supplies a current accepted cohort snapshot',async mode=>{
  const f=await fixture();
  const changes:any={empty_facts:{assessment_facts:{}},uncited_need:{assessment_excerpt:'construction AE owner'},ambiguous:{assessment_excerpt:'construction AE owner schedule recovery maybe'},wrong_mode:{synthetic:false},stale:{observed_at:new Date(Date.now()-91*86400000).toISOString()},missing_rights:{rights_reference:''},outside_brief:{assessment_facts:{need:'other issue'},assessment_excerpt:'other issue'}};
  const patch=changes[mode],fields=Object.keys(patch),args=Object.values(patch);await q(`update lead_observations set ${fields.map((name,i)=>name+'=$'+(i+1)).join(',')} where id=$${fields.length+1}`,[...args,f.source]);
  expect(await rpc('reviewed_revive_draft_need',[f.tenant,f.lead,f.source,1,new Date().toISOString()])).toBeNull();
  await expect(rpc('assert_revive_draft_context',[f.tenant,actor,f.body.draftContext])).rejects.toThrow();
 });
 it('does not allow forging private receipts through authenticated admin note writes or ordinary-note updates',async()=>{
  const f=await fixture(),message=JSON.stringify({kind:'revive_draft_proposed',provenance:f.proposal.draftContext});
  const ordinary=(await q(`insert into activity_log(tenant_id,actor,kind,message,visible_to_client) values($1,$2,'note','ordinary note',false) returning id`,[f.tenant,actor]))[0].id;
  await db.exec(`set role authenticated;select set_config('request.jwt.sub','${actor}',false)`);
  try{
   // Hybrid RLS is select-only for staff: the insert is refused and the update/delete raise or match no row.
   await expect(q(`insert into activity_log(tenant_id,actor,kind,message,visible_to_client) values($1,$2,'note',$3,false)`,[f.tenant,actor,message])).rejects.toThrow();
   await q('update activity_log set message=$1 where id=$2',[message,ordinary]).catch(()=>undefined);
   await q('delete from activity_log where id=$1',[f.receipt.proposalId]).catch(()=>undefined);
  }finally{await db.exec('reset role');}
  expect((await q('select message from activity_log where id=$1',[ordinary]))[0].message).toBe('ordinary note');
  expect(await q('select id from activity_log where id=$1',[f.receipt.proposalId])).toHaveLength(1);
 });
 it('keeps service receipts immutable while preserving ordinary malformed-text notes and tenant cascade cleanup',async()=>{
  const f=await fixture();
  // In this disposable database, additionally grant DELETE so the trigger itself
  // is challenged, rather than stopping at the existing narrower table grant.
  await db.exec('grant delete on activity_log,tenants to service_role;set role service_role');
  try{
   await expect(q('update activity_log set visible_to_client=true where id=$1',[f.receipt.proposalId])).rejects.toThrow(/immutable/);
   await expect(q('delete from activity_log where id=$1',[f.receipt.proposalId])).rejects.toThrow(/immutable/);
   await q(`insert into activity_log(tenant_id,actor,kind,message) values($1,'staff','note','{malformed ordinary text')`,[f.tenant]);
  }finally{await db.exec('reset role');}
  await q('delete from revive_reviews where tenant_id=$1',[f.tenant]);await q('delete from lead_observations where tenant_id=$1',[f.tenant]);await q('delete from leads where tenant_id=$1',[f.tenant]);await q('delete from business_briefs where tenant_id=$1',[f.tenant]);
  await db.exec('set role service_role');try{await q('delete from tenants where id=$1',[f.tenant]);expect(await q('select id from activity_log where tenant_id=$1',[f.tenant])).toHaveLength(0);}finally{await db.exec('reset role;revoke delete on activity_log,tenants from service_role');}
 });
 it('requires regeneration for another staff actor and denies public receipt RPCs',async()=>{
  const f=await fixture();await asOperator(db,{tenantId:f.tenant,profileId:otherActor});await expect(rpc('assert_revive_draft_context',[f.tenant,otherActor,f.body.draftContext])).rejects.toThrow(/actor or account/);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await expect(q('select record_revive_draft_proposal($1,$2,$3)',[f.tenant,actor,f.proposal.draftContext])).rejects.toThrow(/permission/);await expect(q('select assert_revive_draft_context($1,$2,$3)',[f.tenant,actor,f.body.draftContext])).rejects.toThrow(/permission/);}finally{await db.exec('reset role');}}
 });
});
