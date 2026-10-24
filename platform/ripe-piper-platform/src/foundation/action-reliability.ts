import type {Env} from '../env';
import {Db} from '../lib/db';
import {bad,json,requireUser} from '../routes/http';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Claim={token:string;approvalVersion:number;assetVersion:number};
type Action={id:string;tenant_id:string;state:string;dispatch_token:string|null;provider_ref:string|null;acknowledged_at:string|null;lease_until:string|null;error_code:string|null;approval_version:number;asset_version:number};
const fields='id,tenant_id,state,dispatch_token,provider_ref,acknowledged_at,lease_until,error_code,approval_version,asset_version';
function receipt(a:Action){
 return a.state==='tested' && a.dispatch_token && a.provider_ref===`test-sink:${a.id}` && a.acknowledged_at
  ? {kind:'synthetic_sink',reference:`test-sink:${a.id}`,acknowledgedAt:a.acknowledged_at} : null;
}
async function action(db:Db,tenant:string,id:string){return db.one<Action>('outbound_actions',`id=eq.${id}&tenant_id=eq.${tenant}&select=${fields}`);}
/** Read-only reconciliation: inspect a stored sink receipt; never resend or alter a stop. */
export async function inspectActionReceipt(req:Request,env:Env,tenant:string,id:string){
 await requireUser(req,env,true);
 if(!uuid.test(tenant)||!uuid.test(id))return bad('Invalid action or client account.');
 const a=await action(new Db(env,15000),tenant,id);
 if(!a)return bad('Action not found in this client account.',404);
 const ack=receipt(a);
 return json({ok:true,action_id:a.id,state:a.state,receipt:ack,delivery:'not_sent',canRetry:false,
  requiresReview:!ack && (a.state==='review'||a.state==='claimed'),error_code:a.error_code});
}
/** Existing test-only API. Database transactions acknowledge exact claims; no provider is called. */
export async function dispatchSyntheticAction(req:Request,env:Env,id:string){
 await requireUser(req,env,true);
 return executeSyntheticAction(new Db(env,15000),env,id);
}
/** Internal worker boundary shared by staff tests and the bounded Revive scheduler. */
export async function executeSyntheticAction(db:Db,env:Env,id:string,tenantId?:string){
 if(env.SYNTHETIC_SINK_ENABLED!=='true')return bad('The synthetic action sink is disabled.',403);
 if(!uuid.test(id)||(tenantId!==undefined&&!uuid.test(tenantId)))return bad('Invalid action ID.');
 const found=tenantId?await action(db,tenantId,id):await db.one<Action>('outbound_actions',`id=eq.${id}&select=${fields}`);
 if(!found)return bad('Action not found.',404);
 // Lost HTTP responses can be retried safely: report the persisted acknowledgement.
 if(receipt(found))return json({ok:true,state:'tested',action_id:id});
 const dispatchToken=crypto.randomUUID();
 let claim:Claim|null=null;
 try{
  claim=await db.rpc<Claim|null>('claim_fenced_synthetic_action',{p_tenant:found.tenant_id,p_id:id,p_token:dispatchToken,p_now:new Date().toISOString()});
  if(!claim)return bad('Action is unavailable or current authority does not permit this test.',409);
  if(claim.token!==dispatchToken||!uuid.test(claim.token)||!Number.isInteger(claim.approvalVersion)||!Number.isInteger(claim.assetVersion))throw Error('Invalid claim response');
  const done=await db.rpc<boolean>('complete_fenced_synthetic_action',{p_tenant:found.tenant_id,p_id:id,p_token:claim.token,p_approval:claim.approvalVersion,p_asset:claim.assetVersion,p_now:new Date().toISOString()});
  if(done===false)return bad('The action needs operator review; no test result was recorded.',409);
  if(done!==true)throw Error('Invalid acknowledgement response');
  return json({ok:true,state:'tested',action_id:id});
 }catch{
  // A rejected/lost database response says nothing about whether its transaction committed.
  // Re-read the same identity before pausing; never replay the acknowledgement operation.
  try{const current=await action(db,found.tenant_id,id);if(current && receipt(current))return json({ok:true,state:'tested',action_id:id});}catch{}
  try{await db.rpc('expire_fenced_synthetic_action',{p_tenant:found.tenant_id,p_id:id,p_token:dispatchToken,p_now:new Date().toISOString()});}catch{}
  return bad('The test result is uncertain. Inspect this action before taking any further action; it was not retried.',503);
 }
}
