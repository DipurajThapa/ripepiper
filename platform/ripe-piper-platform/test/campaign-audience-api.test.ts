import {afterEach,expect,it,vi} from 'vitest';
import {campaignPlans,planError} from '../src/foundation/campaigns';
import {Db} from '../src/lib/db';
import type {Env} from '../src/env';
import {gateRpc} from './helpers/tenant-gate';
const tenant='11111111-1111-4111-8111-111111111111',lead='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';
const candidate=()=>({leadId:lead,email:'reviewed@example.invalid',company:null,reviewVersion:1,snapshot:'a'.repeat(32),expiresAt:new Date(Date.now()+86400000).toISOString()});
const plan=()=>({product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'Reviewed',body:'Reviewed copy',evidenceReference:'brief:1'}]});
afterEach(()=>vi.restoreAllMocks());
async function list(value:unknown){
 vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id:actor,email:'staff@example.invalid',is_admin:true});
 vi.spyOn(Db.prototype,'one').mockResolvedValue({id:tenant,name:'Fixture client'});
 vi.spyOn(Db.prototype,'select').mockImplementation(async table=>table==='leads'?[{id:lead,email:'reviewed@example.invalid',company:null}]:[]);
 const rpc=gateRpc().mockImplementation(async name=>name==='revive_audience_candidates'?value:{tenantId:tenant,setup:null,currentBriefVersion:null,ready:false,missing:['setup_required'],owners:[],brief:null});
 const response=await campaignPlans(new Request('https://fixture.invalid/campaigns',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({operation:'list'})}),{} as Env,tenant);
 return {response,rpc};
}
it('lists only verified scoped audience fields without granting sending authority',async()=>{
 const row=candidate(),{response,rpc}=await list([{...row,private:'must not leak'}]);
 expect(response.status).toBe(200);const body=await response.json() as any;expect(body.audienceCandidates).toEqual([row]);expect(body.delivery).toBe('synthetic_only');
 expect(rpc).toHaveBeenCalledWith('revive_audience_candidates',{p_tenant:tenant,p_actor:actor});
});
it.each([null,true,{},[null],[{...candidate(),leadId:crypto.randomUUID()}],[{...candidate(),email:'other@example.invalid'}],[{...candidate(),reviewVersion:0}],[{...candidate(),snapshot:'not-a-snapshot'}],[{...candidate(),expiresAt:'unknown'}],[candidate(),candidate()]])('refuses malformed or unrelated audience receipts %#',async value=>{
 const {response}=await list(value);expect(response.status).toBe(503);
});
it('accepts explicit bounded membership while preserving manual draft preparation',()=>{
 expect(planError(plan())).toBeNull();expect(planError({...plan(),audience:{leadIds:[lead],confirmed:true}})).toBeNull();
});
it.each([null,{}, {leadIds:[],confirmed:true},{leadIds:[lead],confirmed:false},{leadIds:[lead,lead],confirmed:true},{leadIds:['foreign-value'],confirmed:true},{leadIds:Array.from({length:26},()=>crypto.randomUUID()),confirmed:true}])('rejects invalid audience selection %#',audience=>{
 expect(planError({...plan(),audience})).toMatch(/Review one to 25/);
});
it('does not silently apply Revive audience configuration to other products',()=>{
 expect(planError({...plan(),product:'signal',audience:{leadIds:[lead],confirmed:true}})).toMatch(/Revive campaign/);
});
