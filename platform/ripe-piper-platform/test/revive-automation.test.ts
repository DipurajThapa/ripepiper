import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Env} from '../src/env';
import {Db,DbError} from '../src/lib/db';
import {runReviveAutomation,runReviveAutomationAdmin} from '../src/foundation/revive-automation';

const tenant='11111111-1111-4111-8111-111111111111',campaign='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',lead='44444444-4444-4444-8444-444444444444';
const now=Date.parse('2026-10-23T12:00:00Z');
const env={SUPABASE_URL:'https://fixture.supabase.invalid',SUPABASE_ANON_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-secret',REVIVE_AUTOMATION_ENABLED:'true',SYNTHETIC_SINK_ENABLED:'true'}as Env;
const freshReview=()=>({tenant_id:tenant,lead_id:lead,state:'accepted',expires_at:new Date(now+86400000).toISOString()});
const freshAudience=(ids=[lead])=>({members:ids.map(leadId=>({leadId,reviewVersion:1,snapshot:'a'.repeat(32)})),reviewedBy:admin,reviewedAt:new Date(now-1000).toISOString()});
const freshAction=(state='queued')=>({id:crypto.randomUUID(),tenant_id:tenant,campaign_id:campaign,lead_id:lead,state,due_at:new Date(now-1000).toISOString(),lease_until:null,dispatch_token:null,provider_ref:null,acknowledged_at:null,error_code:null,approval_version:1,asset_version:1});
function adapter(options:any={}) {
 const campaigns:any[]=options.campaigns??[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'approved',asset_version:1}];
 const reviews:any[]=options.reviews??[freshReview()],actions:any[]=options.actions??[],calls:any[]=[];
 const assets:any[]=options.assets??[{tenant_id:tenant,campaign_id:campaign,version:1,revive_audience:options.audience===undefined?freshAudience(reviews.map(r=>r.lead_id)):options.audience}];
 const select=vi.spyOn(Db.prototype,'select').mockImplementation(async(table,query='')=>{
  calls.push({table,query});
  if(options.readError)throw Error('PRIVATE database details');
  if(table==='tenants')return options.paused?[]:[{id:tenant}];
  if(table==='profiles')return[{is_admin:!options.viewer}];
  if(table==='operating_envelopes')return options.envelopes??[];
  if(table==='campaigns'){const status=new URLSearchParams(query).get('status')?.slice(3)??'approved';return campaigns.filter(c=>c.status===status);}
  if(table==='campaign_assets'){const params=new URLSearchParams(query);return assets.filter(a=>a.tenant_id===params.get('tenant_id')?.slice(3)&&a.campaign_id===params.get('campaign_id')?.slice(3)&&a.version===Number(params.get('version')?.slice(3)));}
  if(table==='revive_reviews')return reviews;
  if(table==='outbound_actions'){
   const params=new URLSearchParams(query),id=params.get('id')?.slice(3),scopeTenant=params.get('tenant_id')?.slice(3),scopeCampaign=params.get('campaign_id')?.slice(3);
   return actions.filter(a=>(!id||a.id===id)&&(!scopeTenant||a.tenant_id===scopeTenant)&&(!scopeCampaign||a.campaign_id===scopeCampaign)&&(!params.has('state')||(params.get('state')==='eq.claimed'?a.state==='claimed':a.state==='queued'&&Date.parse(a.due_at)<=Date.now()))&&(!params.has('asset_version')||(params.get('asset_version')!.startsWith('neq.')?a.asset_version!==Number(params.get('asset_version')!.slice(4)):a.asset_version===Number(params.get('asset_version')!.slice(3)))));
  }
  throw Error('Unexpected table '+table);
 });
 const rpc=vi.spyOn(Db.prototype,'rpc').mockImplementation(async(name,args:any)=>{
  if(name==='tenant_access')return !options.viewer;
  calls.push({name,args});
  if(name==='approve_campaign_within_envelope'){const c=campaigns.find(x=>x.id===args.p_campaign);if(options.envelopeFits===false)return{campaignId:c.id,assetVersion:c.asset_version,status:'escalated',reasons:['content_not_from_template']};c.status='approved';c.envelope_version=1;return{campaignId:c.id,assetVersion:c.asset_version,status:'approved',by:'envelope',envelopeVersion:1};}
  if(name==='enforce_envelope_stop_conditions'){const paused=!!options.stopTripped;if(paused)campaigns.find(x=>x.id===args.p_campaign).status='paused';return{campaignId:args.p_campaign,paused};}
  if(name==='manage_campaign_plan') {
   if(args.p_operation==='pause'){campaigns.find(c=>c.id===args.p_campaign).status='paused';actions.filter(a=>a.campaign_id===args.p_campaign&&a.state==='queued').forEach(a=>a.state='cancelled');return{id:campaign,status:'paused'};}
   if(options.queueBlocked)throw new DbError(400,'22023 rights or review invalid');
   if(options.queueLost)throw Error('PRIVATE queue response lost');
   if(options.malformedQueue)return{ok:true};
   const review=reviews.find(r=>r.lead_id===args.p_body.leadId&&r.tenant_id===args.p_tenant&&r.state==='accepted'&&Number.isFinite(Date.parse(r.expires_at))&&Date.parse(r.expires_at)>Date.now());
   if(!review)throw new DbError(400,'22023 current audience review invalid');
   const existing=actions.filter(a=>a.campaign_id===args.p_campaign&&a.lead_id===args.p_body.leadId&&a.asset_version===args.p_version);
   if(existing.length)return{actionIds:existing.map(a=>a.id),replayed:true};
   if(actions.some(a=>a.campaign_id===args.p_campaign&&a.lead_id===args.p_body.leadId&&a.asset_version!==args.p_version&&!(a.state==='cancelled'&&['campaign_paused','message_version_changed'].includes(a.error_code))))throw new DbError(500,'{"code":"40001","message":"Existing enrolment cannot restart"}');
   const a={...freshAction(),campaign_id:args.p_campaign,lead_id:args.p_body.leadId,due_at:args.p_body.startAt,asset_version:args.p_version};actions.push(a);return{actionIds:[a.id],replayed:false};
  }
  const action=actions.find(a=>a.id===args.p_id&&a.tenant_id===args.p_tenant);
  if(name==='revive_action_readiness')return options.readiness??{tenantId:args.p_tenant,actionId:args.p_id,campaignId:action?.campaign_id,assetVersion:1,disposition:'ready',reason:'working_window'};
  if(name==='claim_fenced_synthetic_action') {
   if(!action||action.state!=='queued')return null;
   if(options.revoked){action.state='blocked';return null;}
   action.state='claimed';action.dispatch_token=args.p_token;action.lease_until=new Date(Date.now()+120000).toISOString();
   if(options.claimLost)throw Error('PRIVATE claim lost');
   return{token:args.p_token,approvalVersion:1,assetVersion:1};
  }
  if(name==='complete_fenced_synthetic_action') {
   if(options.completionLost)throw Error('PRIVATE completion uncertain');
   if(options.malformedComplete)return{};
   if(options.revokedAfterClaim){action.state='blocked';return false;}
   action.state='tested';action.provider_ref='test-sink:'+action.id;action.acknowledged_at=new Date().toISOString();
   return true;
  }
  if(name==='expire_fenced_synthetic_action'){if(action?.state==='claimed'&&action.dispatch_token===args.p_token){action.state='review';campaigns.find(c=>c.id===action.campaign_id).status='paused';}return true;}
  throw Error('Unexpected RPC '+name);
 });
 return{actions,reviews,campaigns,assets,calls,select,rpc};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe('bounded autonomous Revive synthetic coordinator',()=>{
 it.each([{REVIVE_AUTOMATION_ENABLED:undefined},{REVIVE_AUTOMATION_ENABLED:'false'},{SYNTHETIC_SINK_ENABLED:'false'}])('does zero database/provider work without both exact flags %j',async flags=>{
  const a=adapter();expect(await runReviveAutomation({...env,...flags})).toMatchObject({enabled:false,disabled:true,enrolled:0,tested:0,delivery:'not_sent'});expect(a.calls).toEqual([]);
 });
 it('enrols accepted contacts once, executes due steps on the next tick and never reports email delivery',async()=>{
  const a=adapter();const first=await runReviveAutomation(env,{tenantId:tenant});expect(first).toMatchObject({enrolled:1,tested:0,delivery:'not_sent'});
  vi.setSystemTime(now+6000);expect(await runReviveAutomation(env,{tenantId:tenant})).toMatchObject({enrolled:0,tested:1,existing:1});
  expect(await runReviveAutomation(env)).toMatchObject({enrolled:0,tested:0,existing:1});
  expect(a.actions).toHaveLength(1);expect(a.actions[0].state).toBe('tested');
  expect(a.calls.filter(c=>c.name==='complete_fenced_synthetic_action')).toHaveLength(1);
  expect(a.calls.filter(c=>c.table==='campaigns')[0].query).toContain('capability=eq.revive');
  expect(a.calls.some(c=>c.table==='revive_reviews')).toBe(false);expect(a.calls.filter(c=>c.table==='campaign_assets')[0].query).toContain('version=eq.1');
 });
 it.each(['cancelled','blocked','tested','delivered','review'])('never restarts an existing %s enrolment on the current version',async state=>{
  const a=adapter({actions:[freshAction(state)]});expect(await runReviveAutomation(env)).toMatchObject({enrolled:0,tested:0,existing:1});expect(a.calls.some(c=>c.name==='manage_campaign_plan')).toBe(false);
 });
 it('re-queues a contact paused on an older version once the edited version is approved',async()=>{
  const a=adapter({campaigns:[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'approved',asset_version:2}],assets:[{tenant_id:tenant,campaign_id:campaign,version:2,revive_audience:freshAudience()}],actions:[{...freshAction('cancelled'),error_code:'campaign_paused'}]});
  expect(await runReviveAutomation(env)).toMatchObject({enrolled:1,existing:0});expect(a.calls.filter(c=>c.name==='manage_campaign_plan').map(c=>[c.args.p_operation,c.args.p_version])).toEqual([['queue',2]]);
  expect(a.actions.map(x=>[x.state,x.asset_version])).toEqual([['cancelled',1],['queued',2]]);
 });
 it('skips a contact with tested older-version history without pausing the edited campaign',async()=>{
  const a=adapter({campaigns:[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'approved',asset_version:2}],assets:[{tenant_id:tenant,campaign_id:campaign,version:2,revive_audience:freshAudience()}],actions:[freshAction('tested')]});
  expect(await runReviveAutomation(env)).toMatchObject({enrolled:0,blocked:1,review:0});expect(a.calls.filter(c=>c.name==='manage_campaign_plan').map(c=>c.args.p_operation)).toEqual(['queue']);
 });
 it('keeps processing a campaign whose older versions hold more history than the per-campaign bound',async()=>{
  const old=Array.from({length:120},()=>({...freshAction('cancelled'),id:crypto.randomUUID(),lead_id:crypto.randomUUID(),error_code:'campaign_paused'}));
  const a=adapter({campaigns:[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'approved',asset_version:2}],assets:[{tenant_id:tenant,campaign_id:campaign,version:2,revive_audience:freshAudience()}],actions:old});
  expect(await runReviveAutomation(env)).toMatchObject({enrolled:1,limited:false});expect(a.calls.filter(c=>c.table==='outbound_actions').map(c=>new URLSearchParams(c.query).get('asset_version'))).toEqual(expect.arrayContaining(['eq.2','neq.2']));
 });
 it('parallel runs use one fenced completion for the same existing due action',async()=>{
  const a=adapter({actions:[freshAction()]});const results=await Promise.all([runReviveAutomation(env),runReviveAutomation(env)]);
  expect(a.calls.filter(c=>c.name==='complete_fenced_synthetic_action')).toHaveLength(1);expect(a.actions[0].state).toBe('tested');
  expect(results.reduce((n,r)=>n+r.enrolled,0)).toBe(0);
 });
 it('does not grant missing approval, accepted review, active state or valid scope',async()=>{
  let a=adapter({reviews:[]});expect((await runReviveAutomation(env)).enrolled).toBe(0);expect(a.calls.some(c=>c.name)).toBe(false);
  vi.restoreAllMocks();a=adapter({paused:true});expect((await runReviveAutomation(env)).blocked).toBe(1);expect(a.calls.some(c=>c.name)).toBe(false);
  vi.restoreAllMocks();a=adapter();expect((await runReviveAutomation(env,{tenantId:'injected&status=active'})).blocked).toBe(1);expect(a.calls).toEqual([]);
 });
 it.each([{tenant_id:crypto.randomUUID()},{state:'rejected'},{expires_at:'invalid'},{expires_at:new Date(now).toISOString()}])('rejects foreign/stale/malformed review records %j',async patch=>{
  const a=adapter({reviews:[{...freshReview(),...patch}]});expect((await runReviveAutomation(env)).blocked).toBe(1);expect(a.calls.filter(c=>c.name).map(c=>c.args.p_operation)).toEqual(['queue']);
 });
 it.each([{capability:'signal'},{status:'draft'},{tenant_id:crypto.randomUUID()},{asset_version:0}])('does not trust mismatched campaign response %j',async patch=>{
  const a=adapter({campaigns:[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'approved',asset_version:1,...patch}]});
  expect((await runReviveAutomation(env,{tenantId:tenant})).enrolled).toBe(0);expect(a.calls.some(c=>c.name)).toBe(false);
 });
 it('leaves late qualification/rights/stop rejection blocked with no automatic approval or alternative workflow',async()=>{
  const a=adapter({queueBlocked:true});expect(await runReviveAutomation(env)).toMatchObject({enrolled:0,blocked:1,review:0});expect(a.calls.filter(c=>c.name).map(c=>c.args.p_operation)).toEqual(['queue']);
 });
 it.each(['queueLost','malformedQueue'])('pauses an uncertain %s enrolment instead of retrying or dispatching',async key=>{
  const a=adapter({[key]:true});expect(await runReviveAutomation(env)).toMatchObject({enrolled:0,tested:0,review:1});
  expect(a.calls.filter(c=>c.name==='manage_campaign_plan').map(c=>c.args.p_operation)).toEqual(['queue','pause']);
  expect((await runReviveAutomation(env)).campaigns).toBe(0);
 });
 it.each(['claimLost','completionLost','malformedComplete'])('holds %s without a second completion or exposing private errors',async key=>{
  const a=adapter({actions:[freshAction()],[key]:true});const result=await runReviveAutomation(env);expect(result).toMatchObject({tested:0,review:1});expect(JSON.stringify(result)).not.toContain('PRIVATE');
  await runReviveAutomation(env);expect(a.calls.filter(c=>c.name==='complete_fenced_synthetic_action')).toHaveLength(key==='claimLost'?0:1);expect(a.actions[0].state).toBe('review');
 });
 it.each(['revoked','revokedAfterClaim'])('reuses current database dispatch authorization at %s boundary',async key=>{
  const a=adapter({actions:[freshAction()],[key]:true});expect(await runReviveAutomation(env)).toMatchObject({tested:0,blocked:1});expect(a.actions[0].state).toBe('blocked');
 });
 it('expires abandoned fenced claims to review without reclaiming or completing them',async()=>{
  const abandoned={...freshAction('claimed'),dispatch_token:crypto.randomUUID(),lease_until:new Date(now-1).toISOString()};const a=adapter({actions:[abandoned]});
  expect(await runReviveAutomation(env)).toMatchObject({tested:0,enrolled:0,review:1});expect(a.calls.filter(c=>c.name).map(c=>c.name)).toEqual(['expire_fenced_synthetic_action']);expect(abandoned.state).toBe('review');
 });
 it('does not interfere with an unexpired claim owned by another run',async()=>{
  const a=adapter({actions:[{...freshAction('claimed'),dispatch_token:crypto.randomUUID(),lease_until:new Date(now+1000).toISOString()}]});await runReviveAutomation(env);expect(a.calls.some(c=>c.name)).toBe(false);
 });
 it.each(['campaigns','reviews','actions'])('fails closed on %s capacity overflow',async scope=>{
  const options=scope==='campaigns'?{campaigns:Array.from({length:11},()=>({id:campaign,status:'approved'}))}:scope==='reviews'?{reviews:Array.from({length:26},freshReview)}:{actions:Array.from({length:101},()=>freshAction('tested'))};
  const a=adapter(options);expect(await runReviveAutomation(env)).toMatchObject({enrolled:0,tested:0,limited:true});expect(a.calls.some(c=>c.name)).toBe(false);
 });
 it('caps new enrolments at ten even with more accepted contacts',async()=>{
  const a=adapter({reviews:Array.from({length:25},()=>({...freshReview(),lead_id:crypto.randomUUID()}))});expect(await runReviveAutomation(env)).toMatchObject({enrolled:10,limited:true});expect(a.actions).toHaveLength(10);
 });
 it('works the oldest twenty of a larger due set and leaves the remainder queued for the next run',async()=>{
  const actions=Array.from({length:21},()=>({...freshAction(),lead_id:crypto.randomUUID()})),a=adapter({reviews:[],actions,audience:freshAudience(actions.map(a=>a.lead_id))});
  expect(await runReviveAutomation(env)).toMatchObject({tested:20,limited:true,blocked:0});expect(a.actions.filter(a=>a.state==='queued')).toHaveLength(1);
 });
 it('can process the exact due-action bound through fenced acknowledgements',async()=>{
  const actions=Array.from({length:20},()=>({...freshAction(),lead_id:crypto.randomUUID()})),a=adapter({reviews:[],actions,audience:freshAudience(actions.map(a=>a.lead_id))});
  expect(await runReviveAutomation(env)).toMatchObject({tested:20,limited:false,blocked:0});expect(a.actions.every(a=>a.state==='tested')).toBe(true);
 });
 it('stops scheduling further work when the run time budget is exhausted',async()=>{
  const a=adapter();const original=a.select.getMockImplementation()!;a.select.mockImplementation(async(...args)=>{const result=await original(...args);vi.setSystemTime(Date.now()+16000);return result;});
  expect(await runReviveAutomation(env)).toMatchObject({limited:true,enrolled:0,tested:0});expect(a.calls.some(c=>c.name)).toBe(false);
 });
 it('returns only aggregate review state when a database read fails',async()=>{
  adapter({readError:true});const result=await runReviveAutomation(env);expect(result.review).toBe(1);expect(JSON.stringify(result)).not.toContain('PRIVATE');
 });
 it('uses only this campaign audience rather than every globally accepted tenant contact',async()=>{
  const outside=crypto.randomUUID(),a=adapter({reviews:[freshReview(),{...freshReview(),lead_id:outside}],audience:freshAudience([lead])});
  expect(await runReviveAutomation(env)).toMatchObject({enrolled:1,blocked:0});
  expect(a.calls.filter(c=>c.name==='manage_campaign_plan'&&c.args.p_operation==='queue').map(c=>c.args.p_body.leadId)).toEqual([lead]);expect(a.calls.some(c=>c.table==='revive_reviews')).toBe(false);
 });
 it.each([null,{members:[]},freshAudience([lead,lead]),{...freshAudience(),reviewedAt:new Date(now+1000).toISOString()}])('does not act on absent or malformed audience %j',async audience=>{
  const a=adapter({audience,actions:[freshAction()]});expect(await runReviveAutomation(env)).toMatchObject({enrolled:0,tested:0,blocked:1});expect(a.calls.some(c=>c.name)).toBe(false);
 });
 it('does not dispatch an existing due action outside the exact reviewed asset audience',async()=>{
  const outside=crypto.randomUUID(),a=adapter({reviews:[freshReview()],audience:freshAudience([lead]),actions:[{...freshAction(),lead_id:outside}]});
  expect(await runReviveAutomation(env)).toMatchObject({enrolled:1,tested:0,blocked:1});expect(a.calls.some(c=>c.name==='claim_fenced_synthetic_action')).toBe(false);
 });
 it('waits for the reviewed working window without claiming, rescheduling or consuming an attempt',async()=>{
  const action=freshAction(),a=adapter({actions:[action],readiness:{tenantId:tenant,actionId:action.id,campaignId:campaign,assetVersion:1,disposition:'wait',reason:'outside_working_window'}});
  expect(await runReviveAutomation(env)).toMatchObject({tested:0,review:0,blocked:0});expect(a.calls.some(c=>c.name==='claim_fenced_synthetic_action')).toBe(false);expect(action.state).toBe('queued');
 });
 it('routes a missed local-day action through the existing claim boundary into review, without re-enrolment',async()=>{
  const action=freshAction(),a=adapter({actions:[action],revoked:true,readiness:{tenantId:tenant,actionId:action.id,campaignId:campaign,assetVersion:1,disposition:'expired',reason:'missed_local_day'}});
  expect(await runReviveAutomation(env)).toMatchObject({tested:0,review:1,enrolled:0});expect(action.state).toBe('blocked');expect(a.calls.some(c=>c.name==='complete_fenced_synthetic_action')).toBe(false);
 });
 it('does not claim on an uncorrelated or malformed working-policy acknowledgement',async()=>{
  const a=adapter({actions:[freshAction()],readiness:{tenantId:crypto.randomUUID(),disposition:'ready'}});expect(await runReviveAutomation(env)).toMatchObject({tested:0,review:1});expect(a.calls.some(c=>c.name==='claim_fenced_synthetic_action')).toBe(false);
 });
 it('approves an in-bounds draft under the effective envelope, enrols it and tests it through the synthetic sink in one tick',async()=>{
  const a=adapter({campaigns:[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'draft',asset_version:1}],envelopes:[{tenant_id:tenant}]});
  expect(await runReviveAutomation(env)).toMatchObject({approved:1,escalated:0,enrolled:1,delivery:'not_sent'});
  expect(a.calls.filter(c=>c.name).map(c=>c.name)).toEqual(['approve_campaign_within_envelope','enforce_envelope_stop_conditions','manage_campaign_plan']);
  vi.setSystemTime(now+6000);expect(await runReviveAutomation(env)).toMatchObject({approved:0,tested:1,delivery:'not_sent'});expect(a.actions[0].state).toBe('tested');
 });
 it('leaves an out-of-bounds draft in draft and never approves without a client-approved envelope',async()=>{
  let a=adapter({campaigns:[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'draft',asset_version:1}],envelopes:[{tenant_id:tenant}],envelopeFits:false});
  expect(await runReviveAutomation(env)).toMatchObject({approved:0,escalated:1,enrolled:0});expect(a.campaigns[0].status).toBe('draft');
  vi.restoreAllMocks();a=adapter({campaigns:[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'draft',asset_version:1}]});
  expect(await runReviveAutomation(env)).toMatchObject({approved:0,escalated:0,enrolled:0});expect(a.calls.some(c=>c.name)).toBe(false);
 });
 it('pauses on a tripped stop condition before any enrolment and never resumes it',async()=>{
  const a=adapter({campaigns:[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'approved',asset_version:1,envelope_version:1}],envelopes:[{tenant_id:tenant}],stopTripped:true});
  expect(await runReviveAutomation(env)).toMatchObject({stopped:1,enrolled:0,approved:0});expect(a.campaigns[0].status).toBe('paused');
  expect(await runReviveAutomation(env)).toMatchObject({campaigns:0,approved:0});expect(a.calls.filter(c=>c.name==='manage_campaign_plan')).toEqual([]);
 });
 it('requires a verified administrator before the operator route runs',async()=>{
  const a=adapter();await expect(runReviveAutomationAdmin(new Request('https://fixture.invalid'),env,tenant)).rejects.toMatchObject({status:401});expect(a.calls).toEqual([]);
  vi.stubGlobal('fetch',async()=>Response.json({id:admin,email:'fixture@example.invalid'}));
  expect((await runReviveAutomationAdmin(new Request('https://fixture.invalid',{headers:{Authorization:'Bearer fixture'}}),{...env,REVIVE_AUTOMATION_ENABLED:'false'},tenant)).status).toBe(403);
 });
});
