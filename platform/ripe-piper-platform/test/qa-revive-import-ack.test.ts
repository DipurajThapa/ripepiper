import {afterEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import type {Env} from '../src/env';
const tenant='a1111111-1111-4111-8111-111111111111',actor='a2222222-2222-4222-8222-222222222222',lead='a3333333-3333-4333-8333-333333333333',observation='a4444444-4444-4444-8444-444444444444';
const env={SUPABASE_URL:'https://qa-intake.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-secret',SUPABASE_ANON_KEY:'fixture-public'} as Env;
const row={email:'qa-prospect@example.invalid',company:'QA synthetic company',reference:'qa-stable-reference',rights_reference:'qa-permitted-use',observed_at:'2026-10-22T00:00:00Z'};
afterEach(()=>vi.restoreAllMocks());
function adapter(receipt:unknown){
 const writes:any[]=[];
 vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const url=new URL(input);if(url.origin!==env.SUPABASE_URL)throw Error('External network forbidden');
  if(url.pathname==='/auth/v1/user')return Response.json({id:actor,email:'qa-staff@example.invalid'});
  if(url.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);
  if(url.pathname==='/rest/v1/tenants')return Response.json([{id:tenant}]);
  if(url.pathname==='/rest/v1/rpc/import_review_lead'){writes.push(JSON.parse(String(init.body)));return Response.json(receipt);}
  throw Error('Unexpected database or provider operation');
 });return writes;
}
function call(rows:any[]=[row]){return worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${tenant}/prospect-import`,{method:'POST',headers:{Authorization:'Bearer synthetic-staff','Content-Type':'application/json'},body:JSON.stringify({synthetic:true,rows})}),env,{} as ExecutionContext);}
it.each([
 ['null',null],['false',false],['empty object',{}],['array',[]],
 ['invalid identifiers',{state:'created',lead_id:'invalid',observation_id:observation}],
 ['missing observation',{state:'duplicate',lead_id:lead}],
 ['unknown state',{state:'delivered',lead_id:lead,observation_id:observation}],
])('actual import route stops at an uncertain %s acknowledgement without claiming success or processing later rows',async(_name,receipt)=>{
 const writes=adapter(receipt);const response=await call([row,{...row,email:'qa-second@example.invalid',reference:'qa-second-reference'}]);
 expect(response.status).toBe(503);const result=await response.json() as any;
 expect(result.ok).toBe(false);expect(result.results).toEqual([{row:1,state:'review',reason:'result_uncertain_retry_same_reference'}]);expect(writes).toHaveLength(1);
});
it('actual import route whitelists valid receipts and cannot overwrite the UI row number or leak internal payloads',async()=>{
 const writes=adapter({state:'duplicate',lead_id:lead,observation_id:observation,row:999,secret:'PRIVATE_SERVER_DETAIL'});
 const response=await call();expect(response.status).toBe(200);const result=await response.json() as any;
 expect(result.results).toEqual([{row:1,state:'duplicate',lead_id:lead,observation_id:observation}]);expect(JSON.stringify(result)).not.toContain('PRIVATE_SERVER_DETAIL');
 expect(writes).toEqual([{p_tenant:tenant,p_actor:actor,p_email:row.email,p_company:row.company,p_reference:row.reference,p_rights:row.rights_reference,p_observed:row.observed_at,p_synthetic:true}]);
});
