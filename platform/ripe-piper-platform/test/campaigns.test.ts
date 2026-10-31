import {afterEach,describe,it,expect,vi} from 'vitest';
import {campaignPlans,planError} from '../src/foundation/campaigns';
import {Db} from '../src/lib/db';
import type {Env} from '../src/env';
import {gateRpc} from './helpers/tenant-gate';
const step={offsetHours:0,subject:'Reviewing your enquiry',body:'Is this still a priority?',evidenceReference:'interview:1'};
const plan={product:'revive',purpose:'reactivation',market:'AE',timezone:'Asia/Dubai',steps:[step]};
describe('message plan validation',()=>{
 it('permits reviewed plain-text plans and rejects missing evidence or malformed scopes',()=>{
  expect(planError(plan)).toBeNull();
  for(const p of [{...plan,product:'other'},{...plan,timezone:'invalid'},{...plan,steps:[{...step,evidenceReference:''}]},{...plan,steps:[{...step,subject:'Header\nBcc: other'}]}])expect(planError(p)).not.toBeNull();
 });
 it('caps the sequence, separates messages and requires immediate first step',()=>{
  expect(planError({...plan,steps:[step,{...step,offsetHours:72},{...step,offsetHours:168}]})).toBeNull();
  for(const steps of [[],[step,step],[{...step,offsetHours:1}],[step,{...step,offsetHours:721}],[step,{...step,offsetHours:24},{...step,offsetHours:48},{...step,offsetHours:72}]])expect(planError({...plan,steps})).not.toBeNull();
 });
});
describe('save under an operating envelope',()=>{
 const tenant='11111111-1111-4111-8111-111111111111',campaign='22222222-2222-4222-8222-222222222222';
 afterEach(()=>vi.restoreAllMocks());
 const save=(version:number)=>{
  vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id:crypto.randomUUID(),email:'fixture@example.invalid',is_admin:false});
  vi.spyOn(Db.prototype,'one').mockResolvedValue({id:tenant,name:'Fixture'} as any);
  return campaignPlans(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({operation:'save',campaign_id:campaign,version,body:plan})}),{} as Env,tenant);
 };
 it('reports envelope approval or escalation with the save, and a paused campaign saves as the next version instead of a 409',async()=>{
  gateRpc().mockResolvedValue({id:campaign,version:2,status:'draft',envelope:{campaignId:campaign,assetVersion:2,status:'approved',by:'envelope',envelopeVersion:1}});
  expect(await (await save(1)).json()).toEqual({ok:true,id:campaign,version:2,status:'approved',envelope:{status:'approved',by:'envelope',envelopeVersion:1},delivery:'not_sent'});
  vi.restoreAllMocks();gateRpc().mockResolvedValue({id:campaign,version:2,status:'draft',envelope:{campaignId:campaign,assetVersion:2,status:'escalated',envelopeVersion:1,reasons:['prohibited_claim']}});
  expect(await (await save(1)).json()).toMatchObject({status:'draft',envelope:{status:'escalated',reasons:['prohibited_claim']}});
  vi.restoreAllMocks();gateRpc().mockResolvedValue({id:campaign,version:2,status:'draft',envelope:{campaignId:campaign,assetVersion:2,status:'escalated',reasons:['PRIVATE text']}});
  const uncertain=await (await save(1)).json();expect(uncertain).toMatchObject({status:'draft',envelope:{status:'unknown'}});expect(JSON.stringify(uncertain)).not.toContain('PRIVATE');
  vi.restoreAllMocks();gateRpc().mockResolvedValue({id:campaign,version:1,status:'paused'});
  expect((await save(1)).status).toBe(503);
 });
});
