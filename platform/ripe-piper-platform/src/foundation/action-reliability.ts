import type {Env} from '../env';
import {Db} from '../lib/db';
import {MicrosoftError} from '../lib/microsoft';
import {bad,json,requireTenant,requireUser,tenantAccess,HttpError} from '../routes/http';
import {loadTenantSend,sendTenantMail,TenantSendBlocked,type TenantConnection} from './tenant-send';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Claim={token:string;approvalVersion:number;assetVersion:number};
/** The registry's tenantConnection(env,db,tenantId,purpose); null when the tenant has no current connection for that purpose. */
export type ConnectionResolver=(env:Env,db:Db,tenantId:string,purpose:'mail_send')=>Promise<TenantConnection|null>;
type Action={id:string;tenant_id:string;campaign_id:string;lead_id:string;message_step:number;state:string;dispatch_token:string|null;provider_ref:string|null;acknowledged_at:string|null;lease_until:string|null;error_code:string|null;approval_version:number;asset_version:number};
const fields='id,tenant_id,campaign_id,lead_id,message_step,state,dispatch_token,provider_ref,acknowledged_at,lease_until,error_code,approval_version,asset_version';
function receipt(a:Action){
 return a.state==='tested' && a.dispatch_token && a.provider_ref===`test-sink:${a.id}` && a.acknowledged_at
  ? {kind:'synthetic_sink',reference:`test-sink:${a.id}`,acknowledgedAt:a.acknowledged_at} : null;
}
async function action(db:Db,tenant:string,id:string){return db.one<Action>('outbound_actions',`id=eq.${id}&tenant_id=eq.${tenant}&select=${fields}`);}
/** Read-only reconciliation: inspect a stored sink receipt; never resend or alter a stop. */
export async function inspectActionReceipt(req:Request,env:Env,tenant:string,id:string){
 await requireTenant(req,env,tenant,'read');
 if(!uuid.test(tenant)||!uuid.test(id))return bad('Invalid action or client account.');
 const a=await action(new Db(env,15000),tenant,id);
 if(!a)return bad('Action not found in this client account.',404);
 const ack=receipt(a);
 return json({ok:true,action_id:a.id,state:a.state,receipt:ack,delivery:'not_sent',canRetry:false,
  requiresReview:!ack && (a.state==='review'||a.state==='claimed'),error_code:a.error_code});
}
/** Existing test-only API. Database transactions acknowledge exact claims; no provider is called. */
export async function dispatchSyntheticAction(req:Request,env:Env,id:string){
 const user=await requireUser(req,env),db=new Db(env,15000);
 const found=uuid.test(id)?await db.one<{tenant_id:string}>('outbound_actions',`id=eq.${id}&select=tenant_id`):null;
 if(!found)throw new HttpError(404,'Not found.');
 await tenantAccess(env,user,found.tenant_id,'operate');
 return executeSyntheticAction(db,env,id,found.tenant_id);
}
/** Internal worker boundary shared by staff tests and the bounded Revive scheduler. */
export async function executeSyntheticAction(db:Db,env:Env,id:string,tenantId?:string,connect?:ConnectionResolver){
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
  const connection=connect?await connect(env,db,found.tenant_id,'mail_send'):null;
  if(connection){
   const sent=await tenantSend(db,env,found,claim.token,connection);
   if(sent)return sent;
  }
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
const hold=async(db:Db,a:Action,token:string,code:string,ref:string|null=null)=>{
 // Reuse the fenced expiry (review + campaign pause, never requeued), then record why and any provider reference.
 await db.rpc('expire_fenced_synthetic_action',{p_tenant:a.tenant_id,p_id:a.id,p_token:token,p_now:new Date().toISOString()});
 await db.update('outbound_actions',`id=eq.${a.id}&tenant_id=eq.${a.tenant_id}&dispatch_token=eq.${token}&state=eq.review`,{error_code:code,...(ref?{provider_ref:ref}:{})});
};
/** Snapshot the connection, build the gated request, then: flag off -> synthetic sink only (null); flag on -> one provider call, held for review. */
async function tenantSend(db:Db,env:Env,a:Action,token:string,c:TenantConnection):Promise<Response|null>{
 const snap=await db.update('outbound_actions',`id=eq.${a.id}&tenant_id=eq.${a.tenant_id}&dispatch_token=eq.${token}&state=eq.claimed&connection_id=is.null`,{connection_id:c.connectionId,connection_version:c.version});
 if(snap.length!==1)throw Error('Connection snapshot uncertain');
 let send;
 try{send=await loadTenantSend(db,env,c,a);}catch(e){
  if(!(e instanceof TenantSendBlocked))throw e;
  await hold(db,a,token,e.code);
  return bad('The client send requirements are not met; the action is held for review and nothing was sent.',409);
 }
 if(env.TENANT_SEND_ENABLED!=='true')return null;
 const preflight=async()=>{
  const ok=await db.rpc('tenant_connection_current',{p_tenant:a.tenant_id,p_connection:c.connectionId,p_execution_version:send.executionVersion,p_version:c.version,p_purpose:'mail_send'});
  if(ok!==true)throw new TenantSendBlocked('sender_unverified');
 };
 try{
  const r=await sendTenantMail(env,c,send.mail,preflight);
  // No live-delivery receipt exists yet: an accepted send is held with its provider id for reconciliation.
  await hold(db,a,token,'provider_accepted',r.messageId);
  return json({ok:true,state:'review',action_id:a.id,delivery:'provider_accepted'},202);
 }catch(e){
  // An uncertain Microsoft send keeps its draft id; the action is never retried, so there is no second send.
  await hold(db,a,token,e instanceof TenantSendBlocked?e.code:'uncertain_result',e instanceof MicrosoftError&&e.messageId?e.messageId:null).catch(()=>{});
  return bad('The send result is uncertain. Inspect this action before taking any further action; it was not retried.',503);
 }
}
