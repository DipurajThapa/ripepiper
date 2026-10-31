import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {envelopeOperations} from '../src/foundation/envelope';
import {Db,DbError} from '../src/lib/db';
import type {Env} from '../src/env';
import {gateRpc} from './helpers/tenant-gate';
const tenant='11111111-1111-4111-8111-111111111111',actor='33333333-3333-4333-8333-333333333333';
const call=(body:any)=>envelopeOperations(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)}),{} as Env,tenant);
beforeEach(()=>{vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id:actor,email:'owner@example.invalid',is_admin:false});});
afterEach(()=>vi.restoreAllMocks());
describe('envelope route',()=>{
 it('gates on tenant approve authority with the identical 404',async()=>{
  const rpc=gateRpc(()=>false);await expect(call({operation:'status'})).rejects.toMatchObject({status:404,message:'Not found.'});expect(rpc).not.toHaveBeenCalled();
 });
 it('passes only bounded operations to SQL and requires the exact digest to approve',async()=>{
  const rpc=gateRpc((a)=>a.p_capability==='approve').mockResolvedValue({tenantId:tenant,version:1,digest:'a'.repeat(32),party:'client',effective:true});
  for(const bad of [{operation:'approve',version:1},{operation:'approve',version:1,digest:'short'},{operation:'propose',version:0,body:{},expires_at:new Date(Date.now()+91*86400000).toISOString()},{operation:'revoke',version:1},{operation:'delete'}])
   expect((await call(bad)).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  expect(await (await call({operation:'approve',version:1,digest:'a'.repeat(32)})).json()).toMatchObject({ok:true,effective:true});
  expect(rpc).toHaveBeenCalledWith('manage_operating_envelope',{p_tenant:tenant,p_actor:actor,p_operation:'approve',p_version:1,p_body:{digest:'a'.repeat(32)}});
 });
 it('maps SQL refusals without leaking database text',async()=>{
  gateRpc().mockRejectedValue(new DbError(400,JSON.stringify({code:'40001',message:'PRIVATE'})));
  const r=await call({operation:'revoke',version:1,reason:'Client request'});expect(r.status).toBe(409);expect(JSON.stringify(await r.json())).not.toContain('PRIVATE');
 });
});
