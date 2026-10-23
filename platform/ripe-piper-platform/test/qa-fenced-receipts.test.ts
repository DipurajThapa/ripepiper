// Independent QA: a malformed RPC result is not a persisted sink acknowledgement.
import {it,expect,vi} from 'vitest';
import {dispatchSyntheticAction} from '../src/foundation/action-reliability';
import type {Env} from '../src/env';
const staff='33333333-3333-4333-8333-333333333333',tenant='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://fixture.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',SUPABASE_ANON_KEY:'public-fixture',SYNTHETIC_SINK_ENABLED:'true'} as Env;
it.each([{},'false',1])('does not claim tested on malformed completion receipt %j',async receipt=>{
 const row:any={id,tenant_id:tenant,state:'queued',dispatch_token:null,provider_ref:null,acknowledged_at:null,approval_version:1,asset_version:1};let completions=0;
 vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const url=new URL(input);if(url.origin!==env.SUPABASE_URL)throw Error('External network forbidden');
  if(url.pathname==='/auth/v1/user')return Response.json({id:staff,email:'staff@example.invalid'});
  if(url.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);
  if(url.pathname==='/rest/v1/outbound_actions')return Response.json([row]);
  const body=JSON.parse(String(init.body));
  if(url.pathname.endsWith('/claim_fenced_synthetic_action')){row.state='claimed';row.dispatch_token=body.p_token;return Response.json({token:body.p_token,approvalVersion:1,assetVersion:1});}
  if(url.pathname.endsWith('/complete_fenced_synthetic_action')){completions++;return Response.json(receipt);}
  if(url.pathname.endsWith('/expire_fenced_synthetic_action')){if(body.p_token===row.dispatch_token)row.state='review';return Response.json(true);}
  throw Error('Unexpected provider operation');
 });
 const request=new Request('https://fixture.invalid/api/test',{method:'POST',headers:{Authorization:'Bearer staff'}});
 const result=await dispatchSyntheticAction(request,env,id);
 expect(result.status).toBe(503);expect(row.state).toBe('review');expect(completions).toBe(1);expect(await result.text()).not.toContain('"state":"tested"');
});
