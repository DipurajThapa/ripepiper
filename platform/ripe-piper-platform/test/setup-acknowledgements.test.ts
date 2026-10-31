import {afterEach,expect,it,vi} from 'vitest';
import {Db} from '../src/lib/db';
import {prepareTenant} from '../src/foundation/tenants';
import {saveBrief} from '../src/foundation/prospecting-routes';
import type {Env} from '../src/env';
import {gateRpc} from './helpers/tenant-gate';
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const brief={offer:'Reviewed follow-up service',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up'],excludedIndustries:[],maxAgeDays:90,source:{reference:'interview:fixture',excerpt:'Reviewed business interview',observedAt:new Date().toISOString()}};
const request=(body:unknown)=>new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)});
function staff(){vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id:actor,email:'staff@example.invalid',is_admin:true});vi.spyOn(Db.prototype,'one').mockResolvedValue({id:tenant});}
afterEach(()=>vi.restoreAllMocks());
it.each([null,true,{},0,-1,'1',3])('does not claim a saved brief from an uncorrelated acknowledgement %j',async ack=>{
 staff();gateRpc().mockResolvedValue(ack);
 expect((await saveBrief(request({brief,expected_version:0}),{} as Env,tenant)).status).toBe(503);
});
it.each([1,2])('accepts the current brief replay or exact next version %s',async ack=>{
 staff();gateRpc().mockResolvedValue(ack);
 expect((await saveBrief(request({brief,expected_version:1}),{} as Env,tenant)).status).toBe(200);
});
it.each([[],[null],[{}],[{id:tenant,slug:'other',status:'onboarding'}],[{id:tenant,slug:'fixture',status:'active'}],[{id:'invalid',slug:'fixture',status:'onboarding'}]].map(ack=>({ack})))('holds uncertain client creation instead of reporting success %#',async ({ack})=>{
 staff();vi.spyOn(Db.prototype,'insert').mockResolvedValue(ack as any);
 expect((await prepareTenant(request({name:'Fixture',slug:'fixture',country:'AE',currency:'AED',package:'revive'}),{} as Env)).status).toBe(503);
});
it('returns only the verified account identity with no activation',async()=>{
 staff();vi.spyOn(Db.prototype,'insert').mockResolvedValue([{id:tenant,slug:'fixture',status:'onboarding',private:'hidden'}]);
 const response=await prepareTenant(request({name:'Fixture',slug:'fixture',country:'AE',currency:'AED',package:'revive'}),{} as Env);
 expect(response.status).toBe(201);expect(await response.json()).toEqual({ok:true,tenant:{id:tenant,slug:'fixture',status:'onboarding'}});
});
