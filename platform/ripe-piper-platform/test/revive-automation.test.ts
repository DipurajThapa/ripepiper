import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Env} from '../src/env';
import {Db,DbError} from '../src/lib/db';
import {runReviveAutomation,runReviveAutomationAdmin} from '../src/foundation/revive-automation';

const tenant='11111111-1111-4111-8111-111111111111',campaign='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',lead='44444444-4444-4444-8444-444444444444';
const now=Date.parse('2026-10-23T12:00:00Z');
const env={SUPABASE_URL:'https://fixture.supabase.invalid',SUPABASE_ANON_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-secret',REVIVE_AUTOMATION_ENABLED:'true',SYNTHETIC_SINK_ENABLED:'true'}as Env;
const freshReview=()=>({tenant_id:tenant,lead_id:lead,state:'accepted',expires_at:new Date(now+86400000).toISOString()});
const freshAction=(state='queued')=>({id:crypto.randomUUID(),tenant_id:tenant,campaign_id:campaign,lead_id:lead,state,due_at:new Date(now-1000).toISOString(),lease_until:null,dispatch_token:null,provider_ref:null,acknowledged_at:null,error_code:null,approval_version:1,asset_version:1});
function adapter(options:any={}) {
 const campaigns:any[]=options.campaigns??[{id:campaign,tenant_id:tenant,operator_id:admin,capability:'revive',status:'approved',asset_version:1}];
 const reviews:any[]=options.reviews??[freshReview()],actions:any[]=options.actions??[],calls:any[]=[];
 const select=vi.spyOn(Db.prototype,'select').mockImplementation(async(table,query='')=>{
  calls.push({table,query});
  if(options.readError)throw Error('PRIVATE database details');
  if(table==='tenants')return options.paused?[]:[{id:tenant}];
  if(table==='profiles')return[{is_admin:!options.viewer}];
  if(table==='campaigns')return campaigns.filter(c=>c.status==='approved');
  if(table==='revive_reviews')return reviews;
  if(table==='outbound_actions'){
   const params=new URLSearchParams(query),id=params.get('id')?.slice(3),scopeTenant=params.get('tenant_id')?.slice(3),scopeCampaign=params.get('campaign_id')?.slice(3);
   return actions.filter(a=>(!id||a.id===id)&&(!scopeTenant||a.tenant_id===scopeTenant)&&(!scopeCampaign||a.campaign_id===scopeCampaign)&&(!params.has('state')||(a.state==='queued'&&Date.parse(a.due_at)<=Date.now())));
  }
  throw Error('Unexpected table '+table);
 });
 const rpc=vi.spyOn(Db.prototype,'rpc').mockImplementation(async(name,args:any)=>{
  calls.push({name,args});
  if(name==='manage_campaign_plan') {
   if(args.p_operation==='pause'){campaigns.find(c=>c.id===args.p_campaign).status='paused';actions.filter(a=>a.campaign_id===args.p_campaign&&a.state==='queued').forEach(a=>a.state='cancelled');return{id:campaign,status:'paused'};}
   if(options.queueBlocked)throw new DbError(400,'22023 rights or review invalid');
   if(options.queueLost)throw Error('PRIVATE queue response lost');
   if(options.malformedQueue)return{ok:true};
   const existing=actions.filter(a=>a.campaign_id===args.p_campaign&&a.lead_id===args.p_body.leadId);
   if(existing.length)return{actionIds:existing.map(a=>a.id),replayed:true};
   const a={...freshAction(),lead_id:args.p_body.leadId,due_at:args.p_body.startAt};actions.push(a);return{actionIds:[a.id],replayed:false};
  }
  const action=actions.find(a=>a.id===args.p_id&&a.tenant_id===args.p_tenant);
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
 return{actions,reviews,campaigns,calls,select,rpc};
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
  expect(a.calls.filter(c=>c.table==='revive_reviews')[0].query).toContain('state=eq.accepted');
 });
 it.each(['cancelled','blocked','tested','delivered','review'])('never restarts an existing %s enrolment',async state=>{
  const a=adapter({actions:[freshAction(state)]});expect(await runReviveAutomation(env)).toMatchObject({enrolled:0,tested:0,existing:1});expect(a.calls.some(c=>c.name==='manage_campaign_plan')).toBe(false);
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
  const a=adapter({reviews:[{...freshReview(),...patch}]});expect((await runReviveAutomation(env)).blocked).toBe(1);expect(a.calls.some(c=>c.name)).toBe(false);
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
 it('refuses a truncated due-action set instead of hiding the twenty-action capacity boundary',async()=>{
  const a=adapter({reviews:[],actions:Array.from({length:21},()=>({...freshAction(),lead_id:crypto.randomUUID()}))});
  expect(await runReviveAutomation(env)).toMatchObject({tested:0,limited:true,blocked:1});expect(a.calls.some(c=>c.name)).toBe(false);
 });
 it('can process the exact due-action bound through fenced acknowledgements',async()=>{
  const a=adapter({reviews:[],actions:Array.from({length:20},()=>({...freshAction(),lead_id:crypto.randomUUID()}))});
  expect(await runReviveAutomation(env)).toMatchObject({tested:20,limited:false,blocked:0});expect(a.actions.every(a=>a.state==='tested')).toBe(true);
 });
 it('stops scheduling further work when the run time budget is exhausted',async()=>{
  const a=adapter();const original=a.select.getMockImplementation()!;a.select.mockImplementation(async(...args)=>{const result=await original(...args);vi.setSystemTime(Date.now()+16000);return result;});
  expect(await runReviveAutomation(env)).toMatchObject({limited:true,enrolled:0,tested:0});expect(a.calls.some(c=>c.name)).toBe(false);
 });
 it('returns only aggregate review state when a database read fails',async()=>{
  adapter({readError:true});const result=await runReviveAutomation(env);expect(result.review).toBe(1);expect(JSON.stringify(result)).not.toContain('PRIVATE');
 });
 it('requires a verified administrator before the operator route runs',async()=>{
  const a=adapter();await expect(runReviveAutomationAdmin(new Request('https://fixture.invalid'),env,tenant)).rejects.toMatchObject({status:401});expect(a.calls).toEqual([]);
  vi.stubGlobal('fetch',async()=>Response.json({id:admin,email:'fixture@example.invalid'}));
  expect((await runReviveAutomationAdmin(new Request('https://fixture.invalid',{headers:{Authorization:'Bearer fixture'}}),{...env,REVIVE_AUTOMATION_ENABLED:'false'},tenant)).status).toBe(403);
 });
});
