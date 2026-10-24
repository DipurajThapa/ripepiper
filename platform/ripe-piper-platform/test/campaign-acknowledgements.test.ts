import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {campaignPlans} from '../src/foundation/campaigns';
import {Db} from '../src/lib/db';
import type {Env} from '../src/env';
const tenant='11111111-1111-4111-8111-111111111111',campaign='22222222-2222-4222-8222-222222222222',lead='33333333-3333-4333-8333-333333333333',source='44444444-4444-4444-8444-444444444444',action='55555555-5555-4555-8555-555555555555';
const env={SYNTHETIC_SINK_ENABLED:'true'}as Env;
const cases:any[]=[
 {operation:'save',version:0,body:{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'Fixture',body:'Reviewed copy',evidenceReference:'source:fixture'}]},ack:{id:campaign,version:1,status:'draft'}},
 {operation:'approve',version:1,body:{clientAuthority:'review:client',ownerAuthority:'review:owner',ctsProfile:'review:market',maxActions:3,expiresAt:'2026-10-24T12:00:00Z'},ack:{id:campaign,version:1,status:'approved'}},
 {operation:'pause',version:1,body:{},ack:{id:campaign,status:'paused'}},
 {operation:'rights',version:1,body:{leadId:lead,sourceId:source,noticeReference:'notice:fixture'},ack:{id:campaign,status:'synthetic_rights_recorded'}},
 {operation:'queue',version:1,body:{leadId:lead,startAt:'2026-10-24T12:00:00Z'},ack:{actionIds:[action],replayed:false}},
];
function request(c:any){return new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({...c,campaign_id:campaign})});}
beforeEach(()=>{
 vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id:crypto.randomUUID(),email:'fixture@example.invalid',is_admin:true});
 vi.spyOn(Db.prototype,'one').mockImplementation(async table=>table==='campaigns'?{id:campaign,capability:'revive'} as any:{id:tenant,name:'Ripe Piper'} as any);
});afterEach(()=>vi.restoreAllMocks());
describe('strict existing campaign mutation receipts',()=>{
 for(const c of cases) {
  it(`accepts only the whitelisted ${c.operation} receipt and never spreads private fields`,async()=>{
   vi.spyOn(Db.prototype,'rpc').mockResolvedValue({...c.ack,ok:false,delivery:'delivered',private:'PRIVATE',dispatch_token:'PRIVATE_TOKEN'});
   const response=await campaignPlans(request(c),env,tenant),body=await response.json();
   expect(response.status).toBe(200);expect(body).toEqual({ok:true,...c.ack,delivery:'not_sent'});expect(JSON.stringify(body)).not.toContain('PRIVATE');
  });
  it.each([null,true,false,1,[],{}, {ok:true}, {id:crypto.randomUUID(),version:1,status:'draft'}])(`does not certify a malformed ${c.operation} acknowledgement %j`,async receipt=>{
   vi.spyOn(Db.prototype,'rpc').mockResolvedValue(receipt);const response=await campaignPlans(request(c),env,tenant);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ok:false});
  });
 }
 it.each([{actionIds:[action,action],replayed:false},{actionIds:[action],replayed:'false'},{actionIds:[],replayed:false},{actionIds:['not-a-uuid'],replayed:true}])('rejects malformed queue identities/replay state %j',async receipt=>{
  vi.spyOn(Db.prototype,'rpc').mockResolvedValue(receipt);expect((await campaignPlans(request(cases[4]),env,tenant)).status).toBe(503);
 });
 it('allows an unchanged approved save replay but never an autoapproved new version',async()=>{
  const rpc=vi.spyOn(Db.prototype,'rpc').mockResolvedValue({id:campaign,version:1,status:'approved'});
  expect((await campaignPlans(request({...cases[0],version:1}),env,tenant)).status).toBe(200);
  expect((await campaignPlans(request(cases[0]),env,tenant)).status).toBe(503);
  rpc.mockResolvedValue({id:campaign,version:2,status:'approved'});expect((await campaignPlans(request({...cases[0],version:1}),env,tenant)).status).toBe(503);
 });
 it('treats a lost writer response as uncertain without automatic retry or leaking database text',async()=>{
  const rpc=vi.spyOn(Db.prototype,'rpc').mockRejectedValue(Error('PRIVATE DB result lost'));const response=await campaignPlans(request(cases[0]),env,tenant);expect(response.status).toBe(503);expect(await response.text()).not.toContain('PRIVATE');expect(rpc).toHaveBeenCalledTimes(1);
 });
});

it('refuses Signal enrolment before invoking the database writer even when the sink is enabled',async()=>{
 vi.spyOn(Db.prototype,'one').mockImplementation(async table=>table==='campaigns'?{id:campaign,capability:'signal'} as any:{id:tenant,name:'Ripe Piper'} as any);
 const rpc=vi.spyOn(Db.prototype,'rpc');const response=await campaignPlans(request(cases[4]),env,tenant);expect(response.status).toBe(409);expect(await response.text()).toContain('trigger-bound strategy');expect(rpc).not.toHaveBeenCalled();
});
