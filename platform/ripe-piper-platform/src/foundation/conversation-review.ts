import type { Env } from '../env';
import { Db, DbError } from '../lib/db';
import { bad, json, readJson, requireUser } from '../routes/http';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function conversationReview(req:Request,env:Env,tenantId:string) {
 const actor=await requireUser(req,env,true), body=await readJson(req),db=new Db(env);
 if(!await db.one('tenants',`id=eq.${tenantId}&select=id`))return bad('Client account not found.',404);
 if(body.operation==='owners'){
  const owners=await db.rpc<any>('response_review_owners',{p_tenant:tenantId,p_actor:actor.id});
  if(!Array.isArray(owners)||owners.some(o=>!o||!uuid.test(o.id??'')||typeof o.label!=='string'||!o.label.trim()||o.label.length>320)||new Set(owners.map(o=>o.id)).size!==owners.length)return bad('Owner identities could not be verified. Reload before reviewing.',503);
  return json({ok:true,owners:owners.map(o=>({id:o.id,label:o.label}))});
 }
 if(body.operation!=='save' || !uuid.test(body.lead_id??'') || !uuid.test(body.owner_id??'') || !uuid.test(body.request_id??'') ||
  typeof body.thread_ref!=='string' || !body.thread_ref.trim() || body.thread_ref.length>240 ||
  !Number.isInteger(body.expected_version) || body.expected_version<0 ||
  typeof body.inbound_snapshot!=='string' || !/^[0-9a-f,-]{36,37000}$/.test(body.inbound_snapshot) ||
  !['open','resolved'].includes(body.state) || typeof body.reason!=='string' || !body.reason.trim() || body.reason.length>1000 || typeof body.synthetic!=='boolean')
  return bad('Select the current conversation, authorized owner and reviewed reason before saving.');
 try {
  const review=await db.rpc<any>('save_response_review',{p_tenant:tenantId,p_lead:body.lead_id,p_thread:body.thread_ref.trim(),p_actor:actor.id,p_owner:body.owner_id,
   p_expected_version:body.expected_version,p_inbound_snapshot:body.inbound_snapshot,p_state:body.state,p_reason:body.reason.trim(),p_request:body.request_id,p_synthetic:body.synthetic});
  if(!review||!uuid.test(review.id??'')||review.version!==body.expected_version+1||typeof review.replayed!=='boolean')return bad('The review result is uncertain. Reload or retry the same request before making another change.',503);
  return json({ok:true,review:{id:review.id,version:review.version,replayed:review.replayed},delivery:'not_sent',sequences:'held'});
 }catch(error){
  if(error instanceof DbError && (error.body.includes('40001') || error.isConflict))return bad('This conversation changed. Reload it before reviewing again.',409);
  if(error instanceof DbError && error.body.includes('42501'))return bad('The selected owner is no longer authorized for this account.',403);
  if(error instanceof DbError && error.body.includes('22023'))return bad('The conversation or review is no longer available in this evidence set.',409);
  throw error;
 }
}
