// Independent QA: execute actual Worker routing and auth, never a live provider.
import {beforeEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import type {Env} from '../src/env';
const tenant='11111111-1111-4111-8111-111111111111',action='22222222-2222-4222-8222-222222222222';
const staff='33333333-3333-4333-8333-333333333333',client='44444444-4444-4444-8444-444444444444';
const env={SUPABASE_URL:'https://qa-supabase.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-public',SITE_URL:'https://fixture.example.invalid'} as Env;
let calls:{url:URL;init:RequestInit}[];
beforeEach(()=>{
 calls=[];vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const url=new URL(input);calls.push({url,init});if(url.origin!==env.SUPABASE_URL)throw Error('External network forbidden');
  if(url.pathname==='/auth/v1/user')return Response.json({id:(init.headers as any).Authorization==='Bearer client'?client:staff,email:'fixture@example.invalid'});
  if(url.pathname==='/rest/v1/profiles')return Response.json([{is_admin:url.searchParams.get('id')==='eq.'+staff}]);
  if(url.pathname==='/rest/v1/rpc/tenant_access')return Response.json(JSON.parse(String(init.body)).p_actor===staff);
  if(url.pathname==='/rest/v1/tenants')return Response.json([{id:tenant}]);
  if(url.pathname==='/rest/v1/outbound_actions')return Response.json(url.searchParams.get('tenant_id')==='eq.'+tenant?[{id:action,tenant_id:tenant,state:'tested',dispatch_token:'PRIVATE-FENCE',provider_ref:'test-sink:'+action,acknowledged_at:'2026-10-23T00:00:00Z'}]:[]);
  if(url.pathname==='/rest/v1/rpc/response_review_owners')return Response.json([{id:staff,label:'QA owner'}]);
  throw Error('Unexpected provider operation');
 });
});
const call=(path:string,token?:string,body:any={})=>worker.fetch(new Request('https://fixture.example.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}),env,{waitUntil(){}} as unknown as ExecutionContext);
it('actual receipt route denies anonymous/client, scopes staff lookup and never mutates or exposes token',async()=>{
 const path='/api/admin/tenants/'+tenant+'/actions/'+action+'/receipt';
 expect((await call(path)).status).toBe(401);expect(calls).toHaveLength(0);
 expect((await call(path,'client')).status).toBe(404);
 calls=[];const result=await call(path,'staff'),text=await result.text();expect(result.status).toBe(200);expect(text).toContain('synthetic_sink');expect(text).toContain('not_sent');expect(text).not.toContain('PRIVATE-FENCE');
 expect(calls.every(c=>c.url.pathname==='/rest/v1/rpc/tenant_access'||!c.init.method||c.init.method==='GET')).toBe(true);
 expect((await call(path.replace(tenant,client),'staff')).status).toBe(404);
});
it('actual conversation review route denies anonymous/client and uses authenticated staff for owner read',async()=>{
 const path='/api/admin/tenants/'+tenant+'/conversation-review';
 expect((await call(path,undefined,{operation:'owners'})).status).toBe(401);expect(calls).toHaveLength(0);
 expect((await call(path,'client',{operation:'owners'})).status).toBe(404);
 calls=[];const result=await call(path,'staff',{operation:'owners',actor:client});expect(result.status).toBe(200);
 expect(await result.json()).toMatchObject({owners:[{id:staff,label:'QA owner'}]});
 const lookup=calls.find(c=>c.url.pathname.endsWith('/response_review_owners'))!;expect(JSON.parse(String(lookup.init.body))).toEqual({p_tenant:tenant,p_actor:staff});
 expect(calls.some(c=>c.url.pathname.endsWith('/save_response_review'))).toBe(false);
});
it('public health route reports identity only without authentication, database or provider operations',async()=>{
 const response=await worker.fetch(new Request('https://fixture.example.invalid/api/health'),env,{waitUntil(){}} as unknown as ExecutionContext);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,service:'ripe-piper-api',contract:1,database:'not_probed',providers:'not_probed'});
 expect(response.headers.get('cache-control')).toBe('no-store');expect(calls).toHaveLength(0);
});
