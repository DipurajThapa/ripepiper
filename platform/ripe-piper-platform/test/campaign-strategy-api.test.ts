import {afterEach,expect,it,vi} from 'vitest';
import {Db} from '../src/lib/db';
import {campaignPlans,planError} from '../src/foundation/campaigns';
import {strategyBody} from './helpers/revive-setup';
import type {Env} from '../src/env';
import {gateRpc} from './helpers/tenant-gate';
const tenant='11111111-1111-4111-8111-111111111111',campaign='22222222-2222-4222-8222-222222222222',lead='33333333-3333-4333-8333-333333333333',actor='44444444-4444-4444-8444-444444444444';
const start=new Date(Date.now()+3600000).toISOString();
const preview=()=>({approvalStatus:'draft',authorityStatus:'not_approved',campaignId:campaign,assetVersion:1,leadId:lead,setupVersion:1,timezone:'UTC',requestedStartAt:start,steps:[{step:0,dueAt:start,localDate:start.slice(0,10),localTime:start.slice(11,19)}],delivery:'not_sent'});
afterEach(()=>vi.restoreAllMocks());
async function schedule(value:unknown){
 vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id:actor,email:'staff@example.invalid',is_admin:true});
 vi.spyOn(Db.prototype,'one').mockResolvedValue({id:tenant,name:'Fixture'});
 const rpc=gateRpc().mockResolvedValue(value);
 const response=await campaignPlans(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer staff'},body:JSON.stringify({operation:'schedule',campaign_id:campaign,version:1,body:{leadId:lead,startAt:start}})}),{} as Env,tenant);
 return {response,rpc};
}
it('previews the exact tenant, campaign, contact and asset without enrolling or granting rights',async()=>{
 const expected=preview(),{response,rpc}=await schedule({...expected,private:'hidden'});
 expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,...expected});
 expect(rpc).toHaveBeenCalledExactlyOnceWith('preview_revive_schedule',{p_tenant:tenant,p_campaign:campaign,p_actor:actor,p_version:1,p_lead:lead,p_start:start});
});
it.each([null,true,{},{...preview(),approvalStatus:'approved'},{...preview(),authorityStatus:'current'},{...preview(),approvalStatus:'unknown'}, {...preview(),campaignId:lead},{...preview(),leadId:actor},{...preview(),assetVersion:2},{...preview(),setupVersion:0},{...preview(),timezone:'invalid/zone'},{...preview(),requestedStartAt:new Date(0).toISOString()},{...preview(),delivery:'sent'},{...preview(),steps:[]},{...preview(),steps:[{...preview().steps[0],localDate:'2026-99-99'}]},{...preview(),steps:[{...preview().steps[0],localTime:'25:61:00'}]},{...preview(),steps:[{...preview().steps[0],step:1}]},{...preview(),steps:[preview().steps[0],{...preview().steps[0],step:1}]}])('refuses an unverified schedule acknowledgement %#',async value=>{
 const {response}=await schedule(value);expect(response.status).toBe(503);
});
const plan=()=>({product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'Reviewed offer',body:'Reviewed copy',evidenceReference:'interview:fixture'}]});
it('preserves manual drafts but accepts only explicit reviewed strategy payloads',()=>{
 expect(planError(plan())).toBeNull();expect(planError({...plan(),strategy:strategyBody(1)})).toBeNull();
 expect(planError({...plan(),strategy:{...strategyBody(1),confirmed:false}})).toMatch(/strategy/);
 expect(planError({...plan(),strategy:{...strategyBody(1),ownerId:actor}})).toMatch(/strategy/);
 expect(planError({...plan(),product:'events',strategy:strategyBody(1)})).toMatch(/strategy/);
 expect(planError({...plan(),strategy:{...strategyBody(1),cta:{kind:'booking',url:'http://localhost',reference:'fixture',reviewed:true}}})).toMatch(/strategy/);
});

it('distinguishes a current approved schedule from draft planning',async()=>{
 const expected={...preview(),approvalStatus:'approved',authorityStatus:'current'}, {response}=await schedule(expected);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,...expected});
});

it('accepts the same requested instant returned in PostgreSQL offset format',async()=>{
 const expected={...preview(),requestedStartAt:start.replace('Z','+00:00')}, {response}=await schedule(expected);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,...expected});
});
