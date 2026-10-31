import {afterEach,describe,expect,it,vi} from 'vitest';
import worker from '../src/index';
import type {Env} from '../src/env';
const tenant='11111111-1111-4111-8111-111111111111',grant='22222222-2222-4222-8222-222222222222',action='44444444-4444-4444-8444-444444444444';
const agencyMeeting='55555555-5555-4555-8555-555555555551',tenantMeeting='55555555-5555-4555-8555-555555555552';
const users:Record<string,{id:string;admin:boolean;owner:boolean;viewer:boolean;granted:string[]}>={
 admin:{id:'a0000000-0000-4000-8000-000000000001',admin:true,owner:false,viewer:false,granted:[]},
 operator:{id:'a0000000-0000-4000-8000-000000000002',admin:false,owner:false,viewer:false,granted:['read','operate']},
 owner:{id:'a0000000-0000-4000-8000-000000000003',admin:false,owner:true,viewer:false,granted:['read','operate','approve']},
 viewer:{id:'a0000000-0000-4000-8000-000000000004',admin:false,owner:false,viewer:true,granted:['read']},
};
const env={SUPABASE_URL:'https://db.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',SITE_URL:'https://ripepiper.example'} as Env;
type Call={path:string;auth:string|null;body:any};
function stub(as:keyof typeof users){
 const u=users[as],calls:Call[]=[];
 vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const url=new URL(input),path=url.pathname,body=init.body?JSON.parse(String(init.body)):null;
  calls.push({path:path+url.search,auth:new Headers(init.headers).get('Authorization'),body});
  if(url.origin!==env.SUPABASE_URL)throw Error('External network forbidden');
  if(path==='/auth/v1/user')return Response.json({id:u.id,email:`${as}@example.invalid`});
  if(path==='/rest/v1/profiles')return Response.json(url.searchParams.has('is_operator')?[{id:users.operator.id}]:[{is_admin:u.admin}]);
  if(path==='/rest/v1/rpc/tenant_access')return Response.json(body.p_tenant===tenant&&body.p_actor===u.id&&u.granted.includes(body.p_capability));
  if(path==='/rest/v1/memberships')return Response.json(u.owner?[{user_id:u.id}]:[]);
  if(path==='/rest/v1/tenants')return Response.json([{id:tenant,status:'active',execution_version:1}]);
  if(path==='/rest/v1/tenant_google_authority')return Response.json([]);
  if(path==='/rest/v1/rpc/save_business_brief')return Response.json(body.p_expected_version+1);
  if(path==='/rest/v1/rpc/review_prospect_snapshot')return Response.json({version:1,status:'capacity'});
  if(path==='/rest/v1/outbound_actions')return Response.json(url.searchParams.get('id')===`eq.${action}`?[{tenant_id:tenant}]:[]);
  if(path==='/rest/v1/meetings'){const id=url.searchParams.get('id');return Response.json(id===`eq.${agencyMeeting}`?[{tenant_id:null}]:id===`eq.${tenantMeeting}`?[{tenant_id:tenant}]:[]);}
  if(path==='/rest/v1/operator_grants')return Response.json(url.searchParams.get('id')?[{id:grant}]:[]);
  if(path==='/rest/v1/rpc/grant_operator_access')return Response.json(grant);
  if(path==='/rest/v1/rpc/revoke_operator_access')return Response.json(grant);
  if(path==='/rest/v1/rpc/set_tenant_ownership')return Response.json({ownership:body.p_to});
  if(path==='/rest/v1/rpc/platform_tenant_overview')return Response.json([{tenant_id:tenant,leads:3}]);
  throw Error(`Unexpected ${path}`);
 });
 return calls;
}
const call=(method:string,path:string,body?:object)=>worker.fetch(new Request(`https://api.example${path}`,{method,headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:body&&method!=='GET'?JSON.stringify(body):undefined}),env,{} as ExecutionContext);
const brief={brief:{offer:'Synthetic offer',maxAgeDays:90,source:{reference:'fixture-brief',excerpt:'Synthetic excerpt',observedAt:new Date(Date.now()-86400000).toISOString()},industries:['Software'],markets:['AE'],roles:['Founder'],needs:['Pipeline'],excludedIndustries:[]},expected_version:0};
afterEach(()=>vi.unstubAllGlobals());

describe('requireTenant gate',()=>{
 it('gives a platform admin without a grant the same 404 as a missing tenant, before any tenant read',async()=>{
  for(const [path,body] of [['brief',brief],['shortlist',{synthetic:true}],['connection',{operation:'status'}]] as const){
   const calls=stub('admin'),res=await call('POST',`/api/admin/tenants/${tenant}/${path}`,body);
   expect(res.status).toBe(404);expect(await res.json()).toEqual({ok:false,error:'Not found.'});
   expect(calls.map(c=>c.path.split('?')[0])).toEqual(['/auth/v1/user','/rest/v1/profiles','/rest/v1/rpc/tenant_access']);
  }
  const calls=stub('admin');expect((await call('POST','/api/admin/tenants/33333333-3333-4333-8333-333333333333/connection',{operation:'status'})).status).toBe(404);
  expect(calls.at(-1)!.path).toBe('/rest/v1/rpc/tenant_access');
 });
 it.each(['operator','owner'] as const)('lets a %s through with the capability each route needs',async as=>{
  let calls=stub(as);
  expect((await call('POST',`/api/admin/tenants/${tenant}/brief`,brief)).status).toBe(200);
  expect(calls.find(c=>c.path==='/rest/v1/rpc/tenant_access')!.body).toEqual({p_tenant:tenant,p_actor:users[as].id,p_capability:'operate'});
  calls=stub(as);expect((await call('POST',`/api/admin/tenants/${tenant}/connection`,{operation:'status'})).status).toBe(200);
  calls=stub(as);expect((await call('POST',`/api/admin/tenants/${tenant}/shortlist`,{synthetic:true})).status).toBe(409);
  expect(calls.find(c=>c.path==='/rest/v1/rpc/tenant_access')!.body.p_capability).toBe('read');
  expect(calls.some(c=>c.path==='/rest/v1/rpc/review_prospect_snapshot')).toBe(true);
 });
 it('lets a viewer read the shortlist but not operate',async()=>{
  stub('viewer');expect((await call('POST',`/api/admin/tenants/${tenant}/shortlist`,{synthetic:true})).status).toBe(409);
  stub('viewer');expect((await call('POST',`/api/admin/tenants/${tenant}/connection`,{operation:'status'})).status).toBe(404);
 });
});

describe('record-scoped routes resolve the record tenant',()=>{
 const deny=async(res:Response)=>{expect(res.status).toBe(404);expect(await res.json()).toEqual({ok:false,error:'Not found.'});};
 it('gates the synthetic action test on the action tenant, with one 404 for missing and denied',async()=>{
  let calls=stub('admin');await deny(await call('POST',`/api/admin/actions/${action}/test`,{}));
  expect(calls.at(-1)).toMatchObject({path:'/rest/v1/rpc/tenant_access',body:{p_tenant:tenant,p_actor:users.admin.id,p_capability:'operate'}});
  stub('operator');await deny(await call('POST','/api/admin/actions/44444444-4444-4444-8444-444444444440/test',{}));
  calls=stub('operator');expect((await call('POST',`/api/admin/actions/${action}/test`,{})).status).toBe(403);// past the gate: the sink is off
 });
 it('keeps agency consultations platform-admin and tenant consultations behind tenant operate',async()=>{
  stub('operator');await deny(await call('POST',`/api/admin/meetings/${agencyMeeting}/attendance`,{}));
  stub('admin');await deny(await call('POST',`/api/admin/meetings/${tenantMeeting}/attendance`,{}));
  stub('admin');await deny(await call('POST','/api/admin/meetings/55555555-5555-4555-8555-555555555550/attendance',{}));
  stub('admin');expect((await call('POST',`/api/admin/meetings/${agencyMeeting}/attendance`,{})).status).toBe(400);
  stub('operator');expect((await call('POST',`/api/admin/meetings/${tenantMeeting}/attendance`,{})).status).toBe(400);
 });
});

describe('platform-only routes',()=>{
 it('keeps 403 for a tenant owner on requirePlatformAdmin routes',async()=>{
  for(const [method,path] of [['POST','/api/admin/tenants'],['POST',`/api/admin/tenants/${tenant}/pause`],['POST','/api/admin/quotes'],['GET','/api/admin/platform-overview']]){
   stub('owner');expect((await call(method,path,{})).status).toBe(403);
  }
 });
 it('reads the overview with the admin JWT so is_admin() is evaluated for that user',async()=>{
  const calls=stub('admin'),res=await call('GET','/api/admin/platform-overview');
  expect(res.status).toBe(200);expect(await res.json()).toEqual({ok:true,tenants:[{tenant_id:tenant,leads:3}]});
  expect(calls.at(-1)).toMatchObject({path:'/rest/v1/rpc/platform_tenant_overview',auth:'Bearer token'});
 });
});

describe('grant and mode routes',()=>{
 const grantBody=(extra={})=>({operation:'grant',operator_email:'op@example.invalid',capabilities:['read','operate'],expires_at:new Date(Date.now()+30*86400000).toISOString(),...extra});
 it('returns 404 to a viewer and an ungranted operator',async()=>{
  for(const as of ['viewer','operator'] as const){const calls=stub(as);expect((await call('POST',`/api/admin/tenants/${tenant}/operator-grants`,{operation:'list'})).status).toBe(404);expect(calls.some(c=>c.path.startsWith('/rest/v1/operator_grants'))).toBe(false);}
 });
 it('derives client_admin authority from ownership and ignores body authority',async()=>{
  const calls=stub('owner'),res=await call('POST',`/api/admin/tenants/${tenant}/operator-grants`,grantBody({authority:'contract'}));
  expect(res.status).toBe(201);expect(await res.json()).toEqual({ok:true,id:grant,authority:'client_admin'});
  expect(calls.find(c=>c.path==='/rest/v1/rpc/grant_operator_access')!.body).toMatchObject({p_tenant:tenant,p_actor:users.owner.id,p_operator:users.operator.id,p_capabilities:['read','operate'],p_authority:'client_admin',p_contract_reference:null});
 });
 it('requires a contract reference for a platform admin and rejects over-long or unknown grants',async()=>{
  stub('admin');expect((await call('POST',`/api/admin/tenants/${tenant}/operator-grants`,grantBody())).status).toBe(400);
  let calls=stub('admin');expect((await call('POST',`/api/admin/tenants/${tenant}/operator-grants`,grantBody({contract_reference:'MSA-2026-01'}))).status).toBe(201);
  expect(calls.find(c=>c.path==='/rest/v1/rpc/grant_operator_access')!.body).toMatchObject({p_authority:'contract',p_contract_reference:'MSA-2026-01'});
  for(const bad of [{expires_at:new Date(Date.now()+367*86400000).toISOString()},{capabilities:['admin']},{capabilities:[]}]){
   calls=stub('owner');expect((await call('POST',`/api/admin/tenants/${tenant}/operator-grants`,grantBody(bad))).status).toBe(400);expect(calls.some(c=>c.path.includes('grant_operator_access'))).toBe(false);
  }
 });
 it('revokes only a grant of the path tenant',async()=>{
  const calls=stub('owner');expect((await call('POST',`/api/admin/tenants/${tenant}/operator-grants`,{operation:'revoke',grant_id:grant})).status).toBe(200);
  expect(calls.find(c=>c.path.startsWith('/rest/v1/operator_grants'))!.path).toContain(`tenant_id=eq.${tenant}`);
  expect(calls.at(-1)).toMatchObject({path:'/rest/v1/rpc/revoke_operator_access',body:{p_grant:grant,p_actor:users.owner.id}});
 });
 it('writes the expected mode RPC arguments and refuses a viewer',async()=>{
  const calls=stub('owner'),res=await call('POST',`/api/admin/tenants/${tenant}/mode`,{expected:'managed',to:'client_owned',reason:'Client team takes over'});
  expect(res.status).toBe(200);
  expect(calls.at(-1)).toMatchObject({path:'/rest/v1/rpc/set_tenant_ownership',body:{p_tenant:tenant,p_actor:users.owner.id,p_expected:'managed',p_to:'client_owned',p_reason:'Client team takes over'}});
  stub('viewer');expect((await call('POST',`/api/admin/tenants/${tenant}/mode`,{expected:'managed',to:'client_owned',reason:'Client team takes over'})).status).toBe(404);
 });
});
