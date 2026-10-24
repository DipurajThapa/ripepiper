import {afterEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import type {Env} from '../src/env';
const actor='af51d9a7-44a8-4d45-bcd9-df1530b3bb62',tenant='b0050ce6-d457-4bf3-8b7f-ea9a47edaf70';
const env={SUPABASE_URL:'https://setup-qa.invalid',SUPABASE_ANON_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'} as Env;
const brief={offer:'Reviewed enquiry follow-up',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up'],excludedIndustries:[],maxAgeDays:90,source:{reference:'qa-interview',excerpt:'Reviewed offer and audience',observedAt:new Date(Date.now()-3600000).toISOString()}};
const prepared={name:'QA existing client',slug:'qa-client',country:'AE',currency:'AED',package:'revive'};
const setup={website:null,supportedClaims:[],sourceInventory:[{type:'interview',reference:'qa-interview',rightsReference:'qa-rights'}],relationshipSummary:{text:'Previous enquiries deferred',reference:'qa-history'},senderName:'QA operator',senderEmail:'qa-sender@example.invalid',ownerId:actor,market:'AE',language:'en',timezone:'Asia/Dubai',salesCapacityPerWeek:5,outcomeWindowDays:30,workingDays:[1,2,3,4,5],startMinute:540,endMinute:1020,dailyContactCap:2};
afterEach(()=>vi.unstubAllGlobals());
function intercept(receipt:unknown,admin=true){let writes=0;vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
 const u=new URL(input);if(u.origin!==env.SUPABASE_URL)throw Error('External network forbidden');
 if(u.pathname==='/auth/v1/user')return Response.json({id:actor,email:'qa-staff@example.invalid'});
 if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:admin}]);
 if(u.pathname==='/rest/v1/tenants'&&(!init.method||init.method==='GET'))return Response.json([{id:tenant}]);
 if(u.pathname==='/rest/v1/tenants'&&init.method==='POST'){writes++;return Response.json(receipt);}
 if(['/rest/v1/rpc/save_business_brief','/rest/v1/rpc/revive_setup_context','/rest/v1/rpc/save_revive_setup'].includes(u.pathname)){writes++;return Response.json(receipt);}
 throw Error('Unexpected fixture endpoint');
 });return ()=>writes;}
function call(path:string,body:any,token='qa-staff'){return worker.fetch(new Request('https://worker.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}),env,{} as ExecutionContext);}
it.each([
 {id:tenant,slug:'qa-client',status:'active'},
 {id:'not-a-uuid',slug:'qa-client',status:'onboarding'},
 {id:tenant,slug:'another-client',status:'onboarding'},
 {id:tenant,slug:'qa-client'},
].map(row=>({receipt:[row]})))('does not claim a prepared client from a mismatched tenant receipt %j',async({receipt})=>{
 const writes=intercept(receipt),r=await call('/api/admin/tenants',prepared);expect(r.status).toBe(503);expect(writes()).toBe(1);expect(await r.json()).not.toHaveProperty('tenant');
});
it('accepts and whitelists an exactly correlated onboarding preparation receipt',async()=>{
 intercept([{id:tenant,slug:'qa-client',status:'onboarding',privateValue:'DO_NOT_RETURN'}]);const r=await call('/api/admin/tenants',prepared);expect(r.status).toBe(201);expect(await r.json()).toEqual({ok:true,tenant:{id:tenant,slug:'qa-client',status:'onboarding'}});
});
it.each([null,{},false,'1',0,3])('does not claim a business brief was saved from malformed/version-mismatched acknowledgement %j',async(receipt)=>{
 const writes=intercept(receipt),r=await call(`/api/admin/tenants/${tenant}/brief`,{expected_version:0,brief});expect(r.status).toBe(503);expect(writes()).toBe(1);expect(await r.json()).not.toHaveProperty('version');
});
it('retains exact numeric brief save and same-version retry receipts',async()=>{
 for(const expected of [0,1]){intercept(1);const r=await call(`/api/admin/tenants/${tenant}/brief`,{expected_version:expected,brief});expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,version:1});}
});
it('does not trust ready:true when setup context is incomplete or scoped to another client',async()=>{
 const context={tenantId:tenant,setup:{version:1,briefVersion:1,state:'reviewed',body:setup,createdBy:actor,createdAt:new Date().toISOString()},currentBriefVersion:1,ready:true,missing:[],owners:[{id:actor,label:'QA owner'}],brief:{version:1,body:brief}};
 for(const value of [{...context,tenantId:crypto.randomUUID()},{...context,setup:{...context.setup,body:{...setup,sourceInventory:[]}}},{...context,brief:{version:1,body:{maxAgeDays:90}}}]){
  intercept(value);const r=await call(`/api/admin/tenants/${tenant}/revive-setup`,{operation:'get'});expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('context');
 }
});
it('accepts the complete current setup context without creating another tenant or activating it',async()=>{
 const context={tenantId:tenant,setup:{version:1,briefVersion:1,state:'reviewed',body:setup,createdBy:actor,createdAt:new Date().toISOString()},currentBriefVersion:1,ready:true,missing:[],owners:[{id:actor,label:'QA owner'}],brief:{version:1,body:brief}};
 const calls=intercept(context),r=await call(`/api/admin/tenants/${tenant}/revive-setup`,{operation:'get'});expect(r.status).toBe(200);expect(await r.json()).toMatchObject({ok:true,context,delivery:'not_sent'});expect(calls()).toBe(1);
});
it('denies anonymous and tenant viewer setup calls before a setup RPC',async()=>{
 for(const token of ['', 'qa-viewer']){const calls=intercept({},false),r=await call(`/api/admin/tenants/${tenant}/revive-setup`,{operation:'get'},token);expect(r.status).toBe(token?403:401);expect(calls()).toBe(0);}
});
