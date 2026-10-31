/** Operating envelope: approve once, then campaigns inside it are approved by SQL (approve_campaign_within_envelope). */
import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireTenant} from '../routes/http';
const OPERATIONS=['status','propose','approve','revoke'];
const MAX_EXPIRY_MS=90*86400000;
function sqlCode(e:unknown){if(!(e instanceof DbError))return null;try{return JSON.parse(e.body)?.code??null;}catch{return null;}}
function failure(e:unknown){
 const code=sqlCode(e);
 if(code==='42501')return bad('Not found.',404);
 if(code==='40001')return bad('The envelope changed. Reload before trying again.',409);
 if(code==='22023'||code==='23514'||code==='23503')return bad('The envelope does not meet the current brief, setup or bounds.',400);
 throw e;
}

/** POST /api/admin/tenants/{id}/envelope. SQL re-checks the actor (can_operate) and the exact digest on approve. */
export async function envelopeOperations(req:Request,env:Env,tenantId:string){
 const user=await requireTenant(req,env,tenantId,'approve'),b=await readJson(req),tenant=tenantId.toLowerCase();
 if(!OPERATIONS.includes(b.operation))return bad('Unknown envelope operation.');
 let body:Record<string,unknown>={};
 if(b.operation==='propose'){
  const expires=Date.parse(b.expires_at);
  if(!b.body||typeof b.body!=='object'||Array.isArray(b.body)||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+MAX_EXPIRY_MS)return bad('Provide the envelope and an expiry within 90 days.');
  body={body:b.body,expiresAt:new Date(expires).toISOString()};
 }
 if(b.operation!=='status'&&b.operation!=='propose'&&(!Number.isInteger(b.version)||b.version<1))return bad('Choose the envelope version.');
 if(b.operation==='propose'&&(!Number.isInteger(b.version)||b.version<0))return bad('Provide the loaded envelope version.');
 if(b.operation==='approve'){if(typeof b.digest!=='string'||!/^[0-9a-f]{32}$/.test(b.digest))return bad('Approve the exact envelope digest you reviewed.');body={digest:b.digest};}
 if(b.operation==='revoke'){if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>500)return bad('Give a reason for revoking the envelope.');body={reason:b.reason.trim()};}
 try{
  const result=await new Db(env,10000).rpc<any>('manage_operating_envelope',{p_tenant:tenant,p_actor:user.id,p_operation:b.operation,p_version:b.version??0,p_body:body});
  if(!result||typeof result!=='object'||result.tenantId!==tenant)return bad('The envelope acknowledgement is uncertain. Reload before trying again.',503);
  return json({ok:true,...result});
 }catch(e){return failure(e);}
}
