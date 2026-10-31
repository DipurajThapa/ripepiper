import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {brandProfile,seedReviveSetup,strategyBody} from './helpers/revive-setup';
import {asOperator,asOwner} from './helpers/access';
import {proposeReviveDraft} from '../src/foundation/revive-draft';
let db:PGlite;
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}finally{await db.exec('reset role');}}
// The default templates are the proposeReviveDraft strings (src/foundation/revive-draft.ts); SQL appends the setup sign-off.
const TEMPLATES=[
 {offsetHours:0,subject:'A question about {{need}}',body:"Hello,\n\nI'm {{sender}} from {{business}}. Our offer is {{offer}}.\n\n{{cta}}"},
 {offsetHours:72,subject:'Following up on {{need}}',body:'Hello,\n\nA brief follow-up on {{need}}. At {{business}}, our offer is {{offer}}.\n\n{{cta}}'},
 {offsetHours:168,subject:'Closing the loop on {{need}}',body:"Hello,\n\nI'm closing the loop on {{need}}.\n\n{{cta}}"},
];
const envelope=(o:Record<string,any>={})=>({capabilities:['revive'],purposes:['reactivation'],channels:['email'],
 legalBasis:[{channel:'email',market:'AE',purpose:'reactivation',basis:'legitimate_interest',noticeReference:'notice:fixture'}],needs:['lead follow-up'],templates:TEMPLATES,bookingUrl:null,
 prohibitedTerms:['guaranteed'],limits:{perCampaignMaxActions:10,totalActions:100,maxActiveCampaigns:3,maxAudience:5,maxCampaignDays:30},budget:{currency:'AED',maxMinor:0},
 stopConditions:{minSample:5,maxOptOutPct:10,maxReviewActions:2,maxReplies:0},...o});
const days=(n:number)=>new Date(Date.now()+n*86400000).toISOString();
async function user(email:string){const id=crypto.randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);return id;}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
},30000);
afterAll(async()=>db?.close());

/** A client with its brief, reviewed setup and reviewed contacts; the client admin does everything (self-service). */
async function fixture({managed=false,leads=1,needs=['lead follow-up'],brand={}}:{managed?:boolean;leads?:number;needs?:string[];brand?:Record<string,unknown>}={}){
 const name='Fixture Works '+crypto.randomUUID().slice(0,8);
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status,ownership) values($1,$2,'AE','AED','active',$3) returning id`,[name,'env-'+crypto.randomUUID(),managed?'managed':'client_owned']))[0].id;
 const owner=await user(`owner-${crypto.randomUUID()}@example.invalid`);await asOwner(db,{tenantId:tenant,profileId:owner});
 await rpc('save_business_brief',[tenant,0,{offer:'Recover dormant enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs,excludedIndustries:[],maxAgeDays:30,source:{reference:'audience-brief',excerpt:'Reviewed construction offer',observedAt:new Date(Date.now()-3600000).toISOString()}},owner]);
 const {body:setup}=await seedReviveSetup(db,tenant,owner,brand);
 const contacts:{lead:string;source:string}[]=[];
 for(let i=0;i<leads;i++){
  const lead=(await q(`insert into leads(tenant_id,source,email,company) values($1,'import',$2,'Reviewed construction business') returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
  const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by,product_context) values($1,$2,'fixture',$3,now()-interval '1 hour','audience review','fixture use authority',true,'{"industry":"construction","market":"AE","role":"owner","need":"lead follow-up"}','construction AE owner lead follow-up',$4,$5) returning id`,
   [tenant,lead,crypto.randomUUID(),owner,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-60*86400000).toISOString(),previousInterest:'yes',stalledReason:'Project deferred'}]))[0].id;
  const snapshot=(await q('select revive_input_snapshot($1,$2) snapshot',[tenant,lead]))[0].snapshot;
  await rpc('review_revive_candidate',[tenant,lead,owner,0,snapshot,1,'accepted','Reviewed relevant dormant business contact',days(7)]);
  contacts.push({lead,source});
 }
 // Copy rendered exactly as the Worker drafts it, so the envelope check proves TS/SQL template parity.
 const context=await rpc('revive_review_context',[tenant,contacts[0].lead,owner]);
 const proposal=proposeReviveDraft(context,name,{leadId:contacts[0].lead,sourceId:contacts[0].source,messageCount:2,senderName:'Fixture owner'},Date.now(),setup as any);
 const body=(o:Record<string,any>={})=>({product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:proposal.steps,audience:{leadIds:contacts.map(c=>c.lead),confirmed:true},strategy:strategyBody(1,'lead follow-up','audience-brief'),...o});
 const save=async(id:string,version:number,b=body())=>rpc('manage_campaign_plan',[tenant,id,owner,'save',version,b]);
 const env=async(actor:string,op:string,version:number,b:any)=>rpc('manage_operating_envelope',[tenant,actor,op,version,b]);
 const propose=async(o:Record<string,any>={},version=0)=>env(owner,'propose',version,{body:envelope(o),expiresAt:days(60)});
 const approve=async(actor:string,p:{version:number;digest:string})=>env(actor,'approve',p.version,{digest:p.digest});
 return {tenant,owner,name,contacts,proposal,body,save,env,propose,approve};
}
const receipts=async(tenant:string,kind:string)=>(await q('select message,visible_to_client from activity_log where tenant_id=$1 order by id',[tenant])).map(r=>({...JSON.parse(r.message.startsWith('{')?r.message:'{}'),visible:r.visible_to_client})).filter(r=>r.kind===kind);
const campaign=async(id:string)=>(await q('select status,envelope_version,client_authority_ref,owner_authority_ref,asset_version from campaigns where id=$1',[id]))[0];
async function synthetic(f:Awaited<ReturnType<typeof fixture>>,id:string,lead:string,version=1){
 const op=(o:string,b:any)=>rpc('manage_campaign_plan',[f.tenant,id,f.owner,o,version,b]);
 await op('rights',{leadId:lead,sourceId:f.contacts.find(c=>c.lead===lead)!.source,noticeReference:'synthetic'});
 const queued=await op('queue',{leadId:lead,startAt:new Date(Date.now()+60000).toISOString()});
 const action=queued.actionIds[0],due=(await q('select due_at from outbound_actions where id=$1',[action]))[0].due_at.toISOString(),token=crypto.randomUUID();
 const claim=await rpc('claim_fenced_synthetic_action',[f.tenant,action,token,due]);expect(claim).toMatchObject({token});
 expect(await rpc('complete_fenced_synthetic_action',[f.tenant,action,token,claim.approvalVersion,claim.assetVersion,due])).toBe(true);
 return queued.actionIds as string[];
}

describe('operating envelope approve-once',()=>{
 it('renders the default templates exactly as proposeReviveDraft does',async()=>{
  const f=await fixture();
  for(const [i,step] of f.proposal.steps.entries())
   expect(await rpc('envelope_render_step',[TEMPLATES[i],'lead follow-up','Recover dormant enquiries','Fixture owner',f.name,'Is lead follow-up relevant for your team?',`Fixture owner\n${f.name}\n\nTo opt out of follow-up, reply "stop".`])).toEqual({offsetHours:step.offsetHours,subject:step.subject,body:step.body});
 });

 it('keeps render parity with the tenant brand sign-off and the setup default booking link',async()=>{
  const f=await fixture({brand:brandProfile()}),p=await f.propose();await f.approve(f.owner,p);
  expect(f.proposal.steps[0].body.endsWith('choose a time to discuss it: https://calendar.google.com/calendar/appointments/schedules/fixture\n\nFixture owner\nHead of Sales\n\n1 Fixture Street, Dubai, AE\n\nTo opt out of follow-up, reply "stop".')).toBe(true);
  expect(f.proposal.steps[0].evidenceReference.endsWith(';booking:booking:reviewed-fixture')).toBe(true);
  expect(await f.save(crypto.randomUUID(),0)).toMatchObject({envelope:{status:'approved',by:'envelope'}});
  // Copy that drops the tenant's signature and address is not envelope template content.
  const unbranded=f.proposal.steps.map(s=>({...s,body:s.body.replace('Fixture owner\nHead of Sales\n\n1 Fixture Street, Dubai, AE','Fixture owner\n'+f.name)}));
  expect((await f.save(crypto.randomUUID(),0,f.body({steps:unbranded}))).envelope.reasons).toContain('content_not_from_template');
 });

 it('self-service: the client admin approves once and an in-bounds template campaign is approved and runs through the synthetic sink',async()=>{
  const f=await fixture(),p=await f.propose();expect(p).toMatchObject({version:1,status:'proposed'});
  await expect(f.approve(f.owner,{...p,digest:'0'.repeat(32)})).rejects.toThrow('digest');
  expect(await f.approve(f.owner,p)).toMatchObject({party:'client',effective:true});
  const id=crypto.randomUUID(),saved=await f.save(id,0);
  expect(saved).toMatchObject({status:'draft',envelope:{status:'approved',by:'envelope',envelopeVersion:1}});
  expect(await campaign(id)).toMatchObject({status:'approved',envelope_version:1,client_authority_ref:`envelope:v1:client:${f.owner}`,owner_authority_ref:'envelope:v1:operator:self'});
  expect((await receipts(f.tenant,'campaign_envelope_approved'))).toEqual([expect.objectContaining({campaignId:id,assetVersion:1,envelopeVersion:1,reasons:[],visible:true})]);
  expect((await receipts(f.tenant,'campaign_override_approved'))).toEqual([]);
  await synthetic(f,id,f.contacts[0].lead);
  expect((await q('select state from outbound_actions where campaign_id=$1 and message_step=0',[id]))[0].state).toBe('tested');
 });

 it('managed: the client approval alone is not effective; the granted operator approval makes it so and approves as the operator',async()=>{
  const f=await fixture({managed:true}),operator=await user(`operator-${crypto.randomUUID()}@example.invalid`);await asOperator(db,{tenantId:f.tenant,profileId:operator});
  const p=await f.propose();expect(await f.approve(f.owner,p)).toMatchObject({party:'client',effective:false});
  const first=crypto.randomUUID();expect((await f.save(first,0)).envelope).toMatchObject({status:'escalated',reasons:['envelope_missing']});
  expect(await f.approve(operator,p)).toMatchObject({party:'operator',effective:true});
  expect(await rpc('approve_campaign_within_envelope',[f.tenant,first,1])).toMatchObject({status:'approved',by:'envelope'});
  expect(await campaign(first)).toMatchObject({status:'approved',client_authority_ref:`envelope:v1:client:${f.owner}`,owner_authority_ref:`envelope:v1:operator:${operator}`});
  expect((await q('select approved_by from campaign_assets where campaign_id=$1',[first]))[0].approved_by).toBe(operator);
  // Revoking the operator's grant leaves no authorised operator approval.
  await q('update operator_grants set revoked_at=now(),revoked_by=$2 where tenant_id=$1',[f.tenant,f.owner]);
  expect(await rpc('envelope_campaign_fit',[f.tenant,first,1,new Date().toISOString()])).toContain('approver_not_authorised');
 });

 it('keeps actions already used against the total after the campaign is edited out of the envelope',async()=>{
  const f=await fixture({leads:2}),n=f.proposal.steps.length;
  const p=await f.propose({limits:{perCampaignMaxActions:10,totalActions:n,maxActiveCampaigns:3,maxAudience:5,maxCampaignDays:30}});await f.approve(f.owner,p);
  const only=(lead:string,extra:object={})=>f.body({audience:{leadIds:[lead],confirmed:true},...extra});
  const a=crypto.randomUUID();expect((await f.save(a,0,only(f.contacts[0].lead))).envelope.status).toBe('approved');
  await synthetic(f,a,f.contacts[0].lead);
  // An edit unbinds the campaign from the envelope; the step it already used still counts.
  const edited=f.proposal.steps.map((x:any,i:number)=>i?x:{...x,body:x.body+" Edited."});
  expect((await f.save(a,1,only(f.contacts[0].lead,{steps:edited}))).envelope.reasons).toContain('content_not_from_template');
  expect((await f.save(crypto.randomUUID(),0,only(f.contacts[1].lead))).envelope.reasons).toEqual(['total_limit']);
 });

 const cases:[string,(f:any)=>any,(f:any)=>any,string[]][]=[
  ['edited copy',()=>({}),f=>({steps:f.proposal.steps.map((s:any,i:number)=>i?s:{...s,body:s.body+'\nEdited.'})}),['content_not_from_template']],
  ['prohibited term in the offer',()=>({prohibitedTerms:['dormant']}),()=>({}),['prohibited_claim']],
  ['uncited evidence',()=>({}),f=>({steps:f.proposal.steps.map((s:any)=>({...s,evidenceReference:'unreviewed-claim'}))}),['unknown_evidence']],
  ['legal basis for another market',()=>({legalBasis:[{channel:'email',market:'SA',purpose:'reactivation',basis:'consent',noticeReference:'notice:fixture'}]}),()=>({}),['legal_basis_missing']],
  ['purpose outside the envelope',()=>({purposes:['onboarding'],legalBasis:[{channel:'email',market:'AE',purpose:'onboarding',basis:'consent',noticeReference:'notice:fixture'}]}),()=>({}),['purpose_out_of_scope','legal_basis_missing']],
  ['need outside the envelope',()=>({needs:['pipeline review']}),()=>({}),['icp_out_of_scope']],
  ['audience above the cap',()=>({limits:{perCampaignMaxActions:10,totalActions:100,maxActiveCampaigns:3,maxAudience:1,maxCampaignDays:30}}),()=>({}),['audience_out_of_scope']],
  ['actions above the per-campaign cap',()=>({limits:{perCampaignMaxActions:3,totalActions:100,maxActiveCampaigns:3,maxAudience:5,maxCampaignDays:30}}),()=>({}),['campaign_limit']],
  ['reservation above the total',()=>({limits:{perCampaignMaxActions:10,totalActions:3,maxActiveCampaigns:3,maxAudience:5,maxCampaignDays:30}}),()=>({}),['total_limit']],
 ];
 it.each(cases)('escalates %s with exactly its reason code and leaves the campaign in draft',async(_label,shape,edit,reasons)=>{
  const f=await fixture({leads:2,needs:['lead follow-up','pipeline review']}),p=await f.propose(shape(f));await f.approve(f.owner,p);
  const id=crypto.randomUUID(),saved=await f.save(id,0,f.body(edit(f)));
  expect(saved.envelope).toEqual({campaignId:id,assetVersion:1,status:'escalated',envelopeVersion:1,reasons});
  expect((await campaign(id)).status).toBe('draft');
  // The cron re-evaluates every tick but records each distinct escalation once.
  await rpc('approve_campaign_within_envelope',[f.tenant,id,1]);
  expect(await receipts(f.tenant,'campaign_escalated')).toEqual([expect.objectContaining({campaignId:id,assetVersion:1,envelopeVersion:1,reasons,visible:true})]);
 });

 it('escalates a draft whose reviewed strategy is no longer current instead of failing the approval',async()=>{
  const f=await fixture(),id=crypto.randomUUID();expect((await f.save(id,0)).envelope).toBeUndefined();
  await q('alter table lead_observations disable trigger user');
  await q(`update lead_observations set assessment_facts=jsonb_set(assessment_facts,'{need}','"pipeline review"') where tenant_id=$1`,[f.tenant]);
  await q('alter table lead_observations enable trigger user');
  const p=await f.propose();await f.approve(f.owner,p);
  const r=await rpc('approve_campaign_within_envelope',[f.tenant,id,1]);
  expect(r).toMatchObject({status:'escalated'});expect(r.reasons).toContain('icp_out_of_scope');
  expect((await campaign(id)).status).toBe('draft');
 });

 it('escalates the active-campaign limit, expiry, staleness and an inactive tenant',async()=>{
  const f=await fixture(),p=await f.propose({limits:{perCampaignMaxActions:10,totalActions:100,maxActiveCampaigns:1,maxAudience:5,maxCampaignDays:30}});await f.approve(f.owner,p);
  expect((await f.save(crypto.randomUUID(),0)).envelope.status).toBe('approved');
  const second=crypto.randomUUID();expect((await f.save(second,0)).envelope.reasons).toEqual(['active_campaign_limit']);
  const fit=()=>rpc('envelope_campaign_fit',[f.tenant,second,1,new Date().toISOString()]);
  await q(`insert into tenant_google_authority(tenant_id,connection_id,version,binding_hash,mailbox,calendar_id,purpose_reference,expires_at,verified_at,verified_by) values($1,$2,1,$3,'owner@example.invalid','calendar-fixture','fixture',now()+interval '1 day',now(),$4)`,[f.tenant,crypto.randomUUID(),'a'.repeat(64),f.owner]);
  expect(await fit()).toEqual(['envelope_stale','active_campaign_limit']);
  await q('delete from tenant_google_authority where tenant_id=$1',[f.tenant]);
  await q('alter table operating_envelopes disable trigger operating_envelope_guard');
  await q(`update operating_envelopes set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where tenant_id=$1`,[f.tenant]);
  await q('alter table operating_envelopes enable trigger operating_envelope_guard');
  expect(await fit()).toEqual(['envelope_expired','active_campaign_limit']);
  await q(`update tenants set status='paused' where id=$1`,[f.tenant]);
  expect(await fit()).toEqual(['envelope_expired','tenant_not_active','active_campaign_limit']);
 });

 it('a human approval of an escalated campaign is the audited override and envelope authorities cannot be forged',async()=>{
  const f=await fixture(),p=await f.propose({prohibitedTerms:['dormant']});await f.approve(f.owner,p);
  const id=crypto.randomUUID();await f.save(id,0);
  const approval={clientAuthority:'client reviewed',ownerAuthority:'owner reviewed',ctsProfile:'fixture compliance review',maxActions:2,expiresAt:days(3)};
  await expect(rpc('manage_campaign_plan',[f.tenant,id,f.owner,'approve',1,{...approval,clientAuthority:'envelope:v1:client:forged'}])).rejects.toThrow('bounded authority');
  expect(await rpc('manage_campaign_plan',[f.tenant,id,f.owner,'approve',1,approval])).toMatchObject({status:'approved'});
  expect(await receipts(f.tenant,'campaign_override_approved')).toEqual([expect.objectContaining({campaignId:id,assetVersion:1,reasons:['prohibited_claim'],visible:true})]);
  expect((await campaign(id)).envelope_version).toBeNull();
 });

 it('revoke pauses and cancels; a newer approved version supersedes; expiry alone stops execution',async()=>{
  const f=await fixture({leads:2}),p1=await f.propose();await f.approve(f.owner,p1);
  const a=crypto.randomUUID(),b=crypto.randomUUID();await f.save(a,0);await f.save(b,0,f.body({audience:{leadIds:[f.contacts[1].lead],confirmed:true}}));
  const actions=await synthetic(f,b,f.contacts[1].lead);
  expect((await q('select state from outbound_actions where id=$1',[actions[1]]))[0].state).toBe('queued');
  // A synthetic queued step is allowed now and refused once the envelope has expired, with no trigger involved.
  const allowed=async(id:string,at:string)=>{await db.exec('set role service_role');try{return (await q('select synthetic_action_allowed($1,$2) ok',[id,at]))[0].ok;}finally{await db.exec('reset role');}};
  const due=(await q('select due_at from outbound_actions where id=$1',[actions[1]]))[0].due_at.toISOString();
  await q('alter table operating_envelopes disable trigger operating_envelope_guard');
  await q(`update operating_envelopes set created_at=$2::timestamptz-interval '30 days',expires_at=$2 where tenant_id=$1`,[f.tenant,new Date(Date.parse(due)-1000).toISOString()]);
  await q('alter table operating_envelopes enable trigger operating_envelope_guard');
  expect(await allowed(actions[1],due)).toBe(false);
  // v2 supersedes v1: its campaigns pause visibly and resume only by saving a new version under v2.
  const p2=await f.propose({},1);await f.approve(f.owner,p2);
  expect(await campaign(a)).toMatchObject({status:'paused',envelope_version:1});
  expect((await q('select state,error_code from outbound_actions where id=$1',[actions[1]]))[0]).toEqual({state:'cancelled',error_code:'campaign_paused'});
  expect(await rpc('approve_campaign_within_envelope',[f.tenant,a,1])).toMatchObject({status:'paused'});
  expect(await f.env(f.owner,'revoke',2,{reason:'Client paused outreach'})).toMatchObject({version:2,replayed:false});
  expect((await campaign(a)).status).toBe('paused');
  expect(await rpc('approve_campaign_within_envelope',[f.tenant,a,1])).toMatchObject({status:'paused'});
  expect((await receipts(f.tenant,'envelope_revoked'))).toHaveLength(1);
 });

 it('pauses on the opt-out threshold after the minimum sample and never resumes on its own',async()=>{
  const f=await fixture({leads:5}),p=await f.propose({templates:[TEMPLATES[0]]});await f.approve(f.owner,p);
  const id=crypto.randomUUID();expect((await f.save(id,0,f.body({steps:[f.proposal.steps[0]]}))).envelope.status).toBe('approved');
  for(const c of f.contacts)await synthetic(f,id,c.lead);
  expect(await rpc('enforce_envelope_stop_conditions',[f.tenant,id])).toEqual({campaignId:id,paused:false});
  await q(`insert into lead_suppression(tenant_id,lead_id,reason) values($1,$2,'opted out')`,[f.tenant,f.contacts[0].lead]);
  expect(await rpc('enforce_envelope_stop_conditions',[f.tenant,id])).toEqual({campaignId:id,paused:true,reasons:['opt_out_rate']});
  expect((await campaign(id)).status).toBe('paused');
  expect(await receipts(f.tenant,'campaign_stop_condition')).toEqual([expect.objectContaining({campaignId:id,reasons:['opt_out_rate'],visible:true})]);
  expect(await rpc('approve_campaign_within_envelope',[f.tenant,id,1])).toMatchObject({status:'paused'});
  // Resuming saves a new version; the envelope escalates it until a human overrides the stop.
  const rest=f.contacts.slice(1).map(c=>c.lead);
  expect((await f.save(id,1,f.body({steps:[f.proposal.steps[0]],audience:{leadIds:rest,confirmed:true}}))).envelope.reasons).toEqual(['stop_condition_tripped']);
 },20000);

 it('isolates tenants: another tenant\'s approved envelope never approves this campaign',async()=>{
  const a=await fixture(),b=await fixture(),pb=await b.propose();await b.approve(b.owner,pb);
  const id=crypto.randomUUID();expect((await a.save(id,0)).envelope).toBeUndefined();
  expect(await rpc('envelope_campaign_fit',[a.tenant,id,1,new Date().toISOString()])).toEqual(['envelope_missing']);
  await expect(b.approve(a.owner,pb)).rejects.toThrow('Not authorised');
  expect(await rpc('approve_campaign_within_envelope',[a.tenant,id,1])).toMatchObject({status:'escalated',reasons:['envelope_missing']});
  expect((await campaign(id)).status).toBe('draft');
 });

 it('keeps envelopes append-only with set-once approvals and member-scoped reads',async()=>{
  const f=await fixture(),p=await f.propose();await f.approve(f.owner,p);
  await db.exec('set role service_role');
  try{await expect(q('update operating_envelopes set client_approved_by=null,client_approved_at=null where tenant_id=$1',[f.tenant])).rejects.toThrow('set-once');
   await expect(q(`update operating_envelopes set body=jsonb_set(body,'{prohibitedTerms}','[]') where tenant_id=$1`,[f.tenant])).rejects.toThrow('set-once');}
  finally{await db.exec('reset role');}
  const outsider=await user(`outsider-${crypto.randomUUID()}@example.invalid`);
  for(const [who,n] of [[f.owner,1],[outsider,0]] as const){
   await db.exec('set role authenticated');await q("select set_config('request.jwt.sub',$1,false)",[who]);
   try{expect(await q('select version from operating_envelopes where tenant_id=$1',[f.tenant])).toHaveLength(n);}finally{await db.exec('reset role');}
  }
 });
});
