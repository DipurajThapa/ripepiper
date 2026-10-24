import {afterEach,it,expect,vi} from 'vitest';
import {Db} from '../src/lib/db';
import worker from '../src/index';
import type {Env} from '../src/env';
const tenant='91111111-1111-4111-8111-111111111111',campaign='91222222-2222-4222-8222-222222222222',lead='91333333-3333-4333-8333-333333333333',actor='91444444-4444-4444-8444-444444444444',id='91555555-5555-4555-8555-555555555555';
const env={SUPABASE_URL:'https://qa-revive.invalid',SUPABASE_ANON_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture',REVIVE_AUTOMATION_ENABLED:'true',SYNTHETIC_SINK_ENABLED:'true'} as Env;
afterEach(()=>vi.restoreAllMocks());
it('actual Worker coordinator reconciles a committed-but-lost completion once and never repeats its effect',async()=>{
 const row:any={id,tenant_id:tenant,campaign_id:campaign,lead_id:lead,state:'queued',due_at:new Date(Date.now()-1000).toISOString(),dispatch_token:null,lease_until:null,provider_ref:null,acknowledged_at:null,error_code:null,approval_version:1,asset_version:1};
 let completions=0,claims=0,expirations=0;
 vi.stubGlobal('fetch',async(input:string)=>{if(input!==env.SUPABASE_URL+'/auth/v1/user')throw Error('Unexpected network call');return Response.json({id:actor,email:'staff@example.invalid'});});
 vi.spyOn(Db.prototype,'select').mockImplementation(async(table,query='')=>{
  if(table==='profiles')return [{is_admin:true}];if(table==='tenants')return [{id:tenant}];
  if(table==='campaigns')return [{id:campaign,tenant_id:tenant,operator_id:actor,capability:'revive',status:'approved',asset_version:1}];
  if(table==='revive_reviews')throw Error('Coordinator must not enumerate account-wide reviews');
  if(table==='campaign_assets')return [{tenant_id:tenant,campaign_id:campaign,version:1,revive_audience:{members:[{leadId:lead,reviewVersion:1,snapshot:'a'.repeat(32)}],reviewedBy:actor,reviewedAt:new Date(Date.now()-1000).toISOString()}}];
  if(table==='outbound_actions')return query.includes('state=eq.queued')&&row.state!=='queued'?[]:[{...row}];
  throw Error('Unexpected table '+table);
 });
 vi.spyOn(Db.prototype,'rpc').mockImplementation(async(name,args:any)=>{
  if(name==='claim_fenced_synthetic_action'){claims++;row.state='claimed';row.dispatch_token=args.p_token;return {token:args.p_token,approvalVersion:1,assetVersion:1};}
  if(name==='complete_fenced_synthetic_action'){completions++;row.state='tested';row.provider_ref='test-sink:'+id;row.acknowledged_at=new Date().toISOString();throw Error('Synthetic committed completion response lost');}
  if(name==='expire_fenced_synthetic_action'){expirations++;return true;}
  throw Error('Unexpected RPC '+name);
 });
 const call=()=>worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${tenant}/revive-run`,{method:'POST',headers:{Authorization:'Bearer synthetic-staff','Content-Type':'application/json'},body:'{}'}),env,{} as ExecutionContext);
 const first=await call();expect(first.status).toBe(200);expect(await first.json()).toMatchObject({ok:true,tested:1,review:0,delivery:'not_sent'});
 expect(await (await call()).json()).toMatchObject({tested:0,review:0});
 expect({completions,claims,expirations}).toEqual({completions:1,claims:1,expirations:0});
});
