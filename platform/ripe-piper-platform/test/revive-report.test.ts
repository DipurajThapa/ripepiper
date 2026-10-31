import {describe,expect,it,vi} from 'vitest';
import {buildReviveReport,reviveReport,type ReviveReportInput} from '../src/foundation/revive-report';
import type {Env} from '../src/env';
const tenant='11000000-0000-4000-8000-000000000001',foreign='11000000-0000-4000-8000-000000000002';
const staff='11000000-0000-4000-8000-000000000003',viewer='11000000-0000-4000-8000-000000000004';
const now=Date.parse('2026-10-23T12:00:00Z'),ack='2026-10-23T10:00:00Z',observed='2026-10-23T11:00:00Z';
function fixture():ReviveReportInput{return {
 campaigns:[{id:'campaign',tenant_id:tenant,capability:'revive',purpose:'Fixture reactivation',status:'approved'}],
 leads:[{id:'lead',tenant_id:tenant,email:'fixture@example.invalid'}],
 assets:[{tenant_id:tenant,campaign_id:'campaign',version:1,approved_by:staff,approved_at:'2026-10-22T12:00:00Z'}],
 actions:[{id:'action',tenant_id:tenant,campaign_id:'campaign',lead_id:'lead',state:'tested',asset_version:1,due_at:'2026-10-23T09:00:00Z',dispatch_token:staff,provider_ref:'test-sink:action',acknowledged_at:ack}],
 observations:[],
};}
// Action/campaign IDs are valid UUIDs on linked observation contexts in real data.
const campaign='22000000-0000-4000-8000-000000000001',action='22000000-0000-4000-8000-000000000002';
function linkedFixture(){const data=fixture();data.campaigns[0].id=campaign;data.assets[0].campaign_id=campaign;Object.assign(data.actions[0],{id:action,campaign_id:campaign,provider_ref:'test-sink:'+action});return data;}
function outcome(id='outcome',kind='meeting_held',synthetic=true):ReviveReportInput['observations'][number]{return {id,tenant_id:tenant,lead_id:'lead',observed_at:observed,synthetic,assessment_reviewed_by:staff,product_context:{product:'revive',kind:'outcome',outcome:kind,reason:'Reviewed source evidence',campaignId:campaign,actionId:action}};}
describe('read-only Revive evidence aggregation',()=>{
 it('keeps synthetic test receipt and business provider acknowledgement separate, never recipient delivery',()=>{
  const data=linkedFixture();data.observations=[outcome()];
  const synthetic=buildReviveReport(tenant,data,now);
  expect(synthetic.totals.synthetic).toMatchObject({contacts:{enrolled:1,testAcknowledged:1,providerAcknowledged:0},outcomes:{meeting_held:1},recipientDeliveryConfirmed:null});
  expect(synthetic.totals.business.contacts.enrolled).toBe(0);
  data.leads[0].email='business@example.test';Object.assign(data.actions[0],{state:'delivered',provider_ref:'provider-fixture'});data.observations[0].synthetic=false;
  const business=buildReviveReport(tenant,data,now);
  expect(business.totals.business).toMatchObject({contacts:{enrolled:1,testAcknowledged:0,providerAcknowledged:1},outcomes:{meeting_held:1},recipientDeliveryConfirmed:null});
  expect(business.totals.synthetic.contacts.enrolled).toBe(0);
  expect(business.abComparison.available).toBe(false);
  expect(business.notes.join(' ')).toContain('not prove recipient delivery');
 });
 it('counts contacts once across repeated steps, records and campaigns; categories remain cumulative',()=>{
  const data=linkedFixture();data.actions.push({...data.actions[0],id:'second-action',provider_ref:'test-sink:second-action'});
  data.campaigns.push({...data.campaigns[0],id:'second-campaign'});data.assets.push({...data.assets[0],campaign_id:'second-campaign'});
  data.actions.push({...data.actions[0],id:'third-action',campaign_id:'second-campaign',provider_ref:'test-sink:third-action'});
  data.observations=[outcome('one'),outcome('two'),outcome('two')];
  const r=buildReviveReport(tenant,data,now);
  expect(r.totals.synthetic).toMatchObject({contacts:{enrolled:1,testAcknowledged:1},actions:{total:3,testAcknowledged:3},outcomes:{meeting_held:1},outcomeRecords:2});
  expect(r.campaigns.map(c=>c.modes.synthetic.contacts.enrolled)).toEqual([1,1]);
 });
 it('does not infer a meeting or opportunity from a tested or acknowledged action',()=>{
  const data=linkedFixture(),r=buildReviveReport(tenant,data,now);
  expect(r.totals.synthetic.outcomes.meeting_held).toBe(0);expect(r.totals.synthetic.outcomes.opportunity).toBe(0);
  expect(r.unattributed.synthetic.contacts).toBe(0);
 });
 it('keeps unlinked history tenant-level; never spreads it across campaigns',()=>{
  const data=linkedFixture(),legacy=outcome();delete legacy.product_context.campaignId;delete legacy.product_context.actionId;
  data.observations=[legacy];const r=buildReviveReport(tenant,data,now);
  expect(r.unattributed.synthetic).toMatchObject({contacts:1,records:1,outcomes:{meeting_held:1}});
  expect(r.campaigns[0].modes.synthetic.outcomes.meeting_held).toBe(0);
 });
 it('highlights contradictory dispositions without inventing a conversion rate',()=>{
  const data=linkedFixture();data.observations=[outcome('a','accepted'),outcome('b','rejected'),outcome('c','won'),outcome('d','lost')];
  const r=buildReviveReport(tenant,data,now);
  expect(r.totals.synthetic.conflictingOutcomeContacts).toBe(1);
  expect(JSON.stringify(r)).not.toMatch(/conversionRate|upliftPercent|winRate/);
 });
 it('holds all enrolled campaigns for a reviewed reply and separates expired claims/review',()=>{
  const data=linkedFixture();data.observations=[{...outcome(),product_context:{product:'response',kind:'reply',threadRef:'fixture-thread',disposition:'interested',need:'Known need',authority:'',timing:''}}];
  Object.assign(data.actions[0],{state:'claimed',lease_until:'2026-10-23T11:59:59Z'});
  const r=buildReviveReport(tenant,data,now);
  expect(r.totals.synthetic.contacts).toMatchObject({replyHeld:1,requiresReview:1,claimed:1,testAcknowledged:0});
  data.actions[0].lease_until='2026-10-23T12:00:01Z';expect(buildReviveReport(tenant,data,now).totals.synthetic.contacts.requiresReview).toBe(0);
 });
 it.each(['unreviewed','malformed','wrong-mode','future','enquiry'])('reports the conservative operational hold for a %s Response record without adding business outcomes',variation=>{
  const data=linkedFixture(),reply:ReviveReportInput['observations'][number]={...outcome('reply'),product_context:{product:'response',kind:variation==='enquiry'?'enquiry':'reply',threadRef:'fixture-thread',disposition:'interested',need:'Known need',authority:'',timing:''}};
  if(variation==='unreviewed')reply.assessment_reviewed_by=null;
  if(variation==='malformed')reply.product_context={product:'response',kind:'reply'};
  if(variation==='wrong-mode')reply.synthetic=false;
  if(variation==='future')reply.observed_at='2026-10-24T00:00:00Z';
  data.observations=[reply,{...outcome('unreviewed-meeting'),assessment_reviewed_by:null}];
  const r=buildReviveReport(tenant,data,now);
  expect(r.totals.synthetic.contacts.replyHeld).toBe(1);
  expect(r.campaigns[0].modes.synthetic.contacts.replyHeld).toBe(1);
  expect(r.totals.synthetic.outcomeRecords).toBe(0);
  expect(r.totals.synthetic.outcomes.meeting_held).toBe(0);
  expect(r.notes.join(' ')).toContain('not verified human replies');
 });
 it('counts raw reply holds once for enrolled contacts while excluding foreign, missing and unenrolled contacts',()=>{
  const data=linkedFixture(),reply={...outcome('reply'),assessment_reviewed_by:null,product_context:{product:'response',kind:'reply'}};
  data.leads.push({id:'unenrolled',tenant_id:tenant,email:'unrelated@example.invalid'});
  data.observations=[{...reply,id:'foreign',tenant_id:foreign},{...reply,id:'missing',lead_id:'missing'},{...reply,id:'unenrolled',lead_id:'unenrolled'}];
  expect(buildReviveReport(tenant,data,now).totals.synthetic.contacts.replyHeld).toBe(0);
  data.observations.push(reply,{...reply,id:'duplicate-reply'});
  data.actions.push({...data.actions[0],id:'second-action',provider_ref:'test-sink:second-action'});
  const r=buildReviveReport(tenant,data,now);
  expect(r.totals.synthetic.contacts.replyHeld).toBe(1);
  expect(r.campaigns[0].modes.synthetic.contacts.replyHeld).toBe(1);
 });
 it('ignores foreign tenant/campaign/contact and unreviewed, future or wrong-mode observations',()=>{
  const data=linkedFixture();data.campaigns.push({...data.campaigns[0],id:'foreign',tenant_id:foreign});
  data.actions.push({...data.actions[0],id:'foreign-action',tenant_id:foreign});
  data.observations=[{...outcome('foreign'),tenant_id:foreign},{...outcome('missing'),lead_id:'missing'},{...outcome('unreviewed'),assessment_reviewed_by:null},{...outcome('future'),observed_at:'2026-10-24T00:00:00Z'},outcome('wrong-mode','won',false)];
  const r=buildReviveReport(tenant,data,now);expect(r.campaigns).toHaveLength(1);expect(r.totals.synthetic.actions.total).toBe(1);expect(r.totals.synthetic.outcomeRecords).toBe(0);
 });
 it('rejects linked outcomes for another contact, campaign or an observation before acknowledgement',()=>{
  const data=linkedFixture();data.observations=[outcome('campaign'),outcome('contact'),{...outcome('early'),observed_at:'2026-10-23T09:59:59Z'}];
  data.observations[0].product_context.campaignId='33000000-0000-4000-8000-000000000001';
  data.leads.push({...data.leads[0],id:'other'});data.observations[1].lead_id='other';
  const r=buildReviveReport(tenant,data,now);expect(r.unverifiedLinkedRecords).toBe(3);expect(r.totals.synthetic.outcomes.meeting_held).toBe(0);
 });
 it.each(['missing-fence','wrong-receipt','unapproved-asset','future-ack','ack-before-due','wrong-mode'])('does not count a malformed action receipt: %s',variation=>{
  const data=linkedFixture();data.observations=[outcome()];
  if(variation==='missing-fence')data.actions[0].dispatch_token=null;
  if(variation==='wrong-receipt')data.actions[0].provider_ref='unverified';
  if(variation==='unapproved-asset')data.assets[0].approved_by=null;
  if(variation==='future-ack')data.actions[0].acknowledged_at='2026-10-24T00:00:00Z';
  if(variation==='ack-before-due')data.actions[0].acknowledged_at='2026-10-23T08:00:00Z';
  if(variation==='wrong-mode')data.actions[0].state='delivered';
  const r=buildReviveReport(tenant,data,now);expect(r.totals.synthetic.actions.unverifiedReceipt).toBe(1);expect(r.totals.synthetic.contacts.testAcknowledged).toBe(0);expect(r.unverifiedLinkedRecords).toBe(1);
 });
 it('returns only aggregate metadata, without emails, message bodies, source excerpts or claim tokens',()=>{
  const data=linkedFixture();data.observations=[outcome()];
  const value=JSON.stringify(buildReviveReport(tenant,data,now));
  for(const privateValue of [data.leads[0].email,staff,'Reviewed source evidence'])expect(value).not.toContain(privateValue);
 });
});
describe('staff-only bounded Revive report endpoint',()=>{
 const env={SUPABASE_URL:'https://fixture.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',SUPABASE_ANON_KEY:'public-fixture'} as Env;
 function request(token='staff'){return new Request('https://fixture.invalid/api',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:'{}'});}
 function provider(data=linkedFixture(),exists=true){const calls:RequestInit[]=[];vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const u=new URL(input);if(u.origin!==env.SUPABASE_URL)throw Error('Provider access forbidden');if(u.pathname==='/rest/v1/rpc/tenant_access')return Response.json(JSON.parse(String(init.body)).p_actor===staff);calls.push(init);
  if(u.pathname==='/auth/v1/user')return Response.json({id:(init.headers as any).Authorization==='Bearer viewer'?viewer:staff,email:'fixture@example.invalid'});
  if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:u.searchParams.get('id')==='eq.'+staff}]);
  expect(u.searchParams.get('tenant_id')??u.searchParams.get('id')).toBe('eq.'+tenant);
  const table=u.pathname.split('/').pop();if(table==='tenants')return Response.json(exists?[{id:tenant}]:[]);
  const rows=table==='campaigns'?data.campaigns:table==='leads'?data.leads:table==='outbound_actions'?data.actions:table==='campaign_assets'?data.assets:table==='lead_observations'?data.observations:null;
  if(rows===null)throw Error('Unexpected API operation');return Response.json(rows);
 });return calls;}
 it('requires actual staff and never makes a provider or database mutation',async()=>{
  const calls=provider();await expect(reviveReport(request(''),env,tenant)).rejects.toThrow('sign in');await expect(reviveReport(request('viewer'),env,tenant)).rejects.toMatchObject({status:404,message:'Not found.'});
  const r=await reviveReport(request(),env,tenant);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({ok:true,delivery:'not_sent'});
  expect(calls.every(c=>!c.method||c.method==='GET')).toBe(true);
 });
 it('rejects missing accounts and invalid scope',async()=>{
  provider(linkedFixture(),false);expect((await reviveReport(request(),env,tenant)).status).toBe(404);
  await expect(reviveReport(request(),env,'bad-scope')).rejects.toMatchObject({status:404});
 });
 it.each(['campaigns','leads','actions','assets','observations'] as const)('rejects capped %s instead of returning an incomplete funnel',async table=>{
  const data=linkedFixture(),limit=table==='campaigns'||table==='leads'?101:1000;
  if(table==='observations')data.observations=[outcome()];
  (data[table] as any[])=Array.from({length:limit},()=>data[table][0]);provider(data);
  expect((await reviveReport(request(),env,tenant)).status).toBe(409);
 });
});
