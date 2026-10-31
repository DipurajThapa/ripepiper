import {it,expect,vi,afterEach} from 'vitest';
import worker from '../src/index';import type {Env} from '../src/env';
afterEach(()=>vi.unstubAllGlobals());
it('actual attendance router denies anonymous/client callers and derives staff actor with a whitelisted CAS receipt',async()=>{
 const actor='fa700000-0000-4000-8000-000000000001',meeting='fa700000-0000-4000-8000-000000000002';let admin=false;const writes:any[]=[];
 vi.stubGlobal('fetch',async(input:any,init:RequestInit={})=>{
  const u=new URL(String(input));if(u.origin!=='https://fixture.supabase.co')throw Error('Unexpected provider call');
  if(u.pathname==='/auth/v1/user')return Response.json({id:actor,email:'staff@example.invalid'});
  if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:admin}]);
  if(u.pathname==='/rest/v1/meetings')return Response.json([{tenant_id:null}]);
  if(u.pathname==='/rest/v1/rpc/review_consultation_attendance'){writes.push(JSON.parse(String(init.body)));return Response.json({meetingId:meeting,version:3,classification:'unknown',replayed:false,private:'must not escape'});}
  throw Error('Unexpected database operation');
 });
 const body={expected_version:2,snapshot:{id:meeting},classification:'unknown',evidence_reference:'QA incomplete record',reason:'Authoritative attendance cannot be established',evidence_verified:false,roster_complete:false,request_id:crypto.randomUUID(),actor:'forged_actor'};
 const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon'} as Env;
 const call=(token?:string)=>worker.fetch(new Request('https://fixture.invalid/api/admin/meetings/'+meeting+'/attendance',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify(body)}),env,{waitUntil(){}} as unknown as ExecutionContext);
 expect((await call()).status).toBe(401);expect((await call('client')).status).toBe(404);expect(writes).toHaveLength(0);
 admin=true;const response=await call('staff');expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,review:{meetingId:meeting,version:3,classification:'unknown',replayed:false},delivery:'not_sent'});
 expect(writes).toHaveLength(1);expect(writes[0].p_actor).toBe(actor);expect(writes[0].p_snapshot).toEqual(body.snapshot);
});
