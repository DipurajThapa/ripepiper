import {afterEach,expect,it,vi} from 'vitest';
import worker from '../src/index';
import type {Env} from '../src/env';
const tenant='bf92c8d7-2caf-42bf-b03e-63007b721b15',campaign='2416e181-5b28-4612-9f35-21e216e09355',lead='5cba2e6f-2688-4a9a-bbf8-a988143c91c9',actor='bca2ffb2-9831-421e-9e19-b96728e19773';
const env={SUPABASE_URL:'https://schedule-qa.invalid',SUPABASE_ANON_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'} as Env;
const start='2026-10-26T04:00:00Z';
function receipt(){return {approvalStatus:'approved',authorityStatus:'current',campaignId:campaign,assetVersion:1,leadId:lead,setupVersion:1,timezone:'Asia/Dubai',requestedStartAt:start,steps:[{step:0,dueAt:'2026-10-26T05:00:00Z',localDate:'2026-10-26',localTime:'09:00:00'}],delivery:'not_sent'};}
afterEach(()=>vi.unstubAllGlobals());
async function call(value:any){let rpcCalls=0;vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
 const u=new URL(input);if(u.origin!==env.SUPABASE_URL)throw Error('External network forbidden');if(u.pathname==='/auth/v1/user')return Response.json({id:actor,email:'staff@example.invalid'});if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);if(u.pathname==='/rest/v1/tenants'&&(!init.method||init.method==='GET'))return Response.json([{id:tenant,name:'QA'}]);
 if(u.pathname==='/rest/v1/rpc/preview_revive_schedule'){rpcCalls++;return Response.json(value);}throw Error('Unexpected read or mutation');
 });const response=await worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${tenant}/campaigns`,{method:'POST',headers:{Authorization:'Bearer qa-staff','Content-Type':'application/json'},body:JSON.stringify({operation:'schedule',campaign_id:campaign,version:1,body:{leadId:lead,startAt:start}})}),env,{} as ExecutionContext);expect(rpcCalls).toBe(1);return response;}
it.each([{localDate:'2026-02-31'},{localTime:'99:99:99'},{localTime:'10:00:00'},{localDate:'2026-10-27'}])('rejects impossible or UTC-inconsistent human-facing schedule receipt %j',async(change)=>{
 const value=receipt();Object.assign(value.steps[0],change);const r=await call(value);expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('steps');
});
it('accepts exact client-local conversion and strips unneeded receipt data without queueing',async()=>{
 const value=receipt();const r=await call({...value,private:'DO_NOT_EXPOSE',steps:[{...value.steps[0],private:'DO_NOT_EXPOSE'}]});expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,...value});
});
