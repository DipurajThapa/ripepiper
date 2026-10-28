/** Tenant-only contact stops. No message delivery or retry is performed here. */
import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {json,readJson,requireUser,HttpError} from '../routes/http';
import {validInstant} from './prospecting';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hex=/^[0-9a-f]{64}$/;
function exact(v:any,keys:string[]){return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function response(v:unknown,status=200){const r=json(v,status);r.headers.set('Referrer-Policy','no-referrer');return r;}
const failure=(status=503)=>response({ok:false,error:status===503?'The result is unavailable. Inspect the contact before trying again.':'The request could not be accepted.'},status);
export async function hashUnsubscribeToken(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
export function unsubscribeOrigin(site:string){
 const u=new URL(site),host=u.hostname.toLowerCase();
 const local=host==='localhost'||host==='127.0.0.1'||host==='[::1]';
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!((u.protocol==='https:'&&!local&&!/(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(host)&&!/^(?:\d+\.){3}\d+$/.test(host)&&!host.includes(':')&&host.includes('.'))||(u.protocol==='http:'&&local)))throw Error('Invalid site origin');
 return u.origin;
}
function dbFailure(e:unknown){
 if(e instanceof DbError){try{const code=JSON.parse(e.body)?.code;if(code==='42501')return failure(403);if(code==='P0002')return failure(404);if(code==='22023')return failure(400);}catch{}}
 return failure();
}
export async function tenantUnsubscribe(req:Request,env:Env,tenantId:string,leadId:string){
 const user=await requireUser(req,env,true);
 if(req.method!=='POST')return failure(405);
 if(!uuid.test(tenantId.toLowerCase())||!uuid.test(leadId.toLowerCase()))return failure(400);
 const b=await readJson(req),db=new Db(env,10000,4096),tenant=tenantId.toLowerCase(),lead=leadId.toLowerCase();
 if(b.operation==='record'){
  if(!exact(b,['operation','reference'])||typeof b.reference!=='string'||b.reference.trim().length<8||b.reference.length>240)return failure(400);
  try{
   const r=await db.rpc<any>('record_tenant_unsubscribe',{p_tenant:tenant,p_lead:lead,p_actor:user.id,p_reference:b.reference});
   if(!exact(r,['version','status','tenantId','leadId','alreadyStopped'])||r.version!==1||r.status!=='stopped'||r.tenantId!==tenant||r.leadId!==lead||typeof r.alreadyStopped!=='boolean')return failure();
   return response(r);
  }catch(e){return dbFailure(e);}
 }
 if(b.operation!=='issue_link'||!exact(b,['operation']))return failure(400);
 try{
  const origin=unsubscribeOrigin(env.SITE_URL),token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const r=await db.rpc<any>('issue_tenant_unsubscribe',{p_tenant:tenant,p_lead:lead,p_actor:user.id,p_hash:await hashUnsubscribeToken(token)});
  if(exact(r,['version','status'])&&r.version===1&&['limited','stopped'].includes(r.status))return response(r,409);
  if(!exact(r,['version','status','expiresAt'])||r.version!==1||r.status!=='issued'||!validInstant(r.expiresAt))return failure();
  return response({...r,url:origin+'/unsubscribe.html#token='+token,delivery:'not_sent'},201);
 }catch(e){return dbFailure(e);}
}
export async function confirmTenantUnsubscribe(req:Request,env:Env){
 if(req.method!=='POST')return failure(405);
 let b;try{b=await readJson(req);}catch(e){return failure(e instanceof HttpError?e.status:400);}
 if(!exact(b,['token'])||typeof b.token!=='string'||!hex.test(b.token))return failure(400);
 try{
  const r=await new Db(env,10000,4096).rpc<any>('confirm_tenant_unsubscribe',{p_hash:await hashUnsubscribeToken(b.token)});
  if(!exact(r,['version','status'])||r.version!==1||!['invalid','confirmed'].includes(r.status))return failure();
  return response(r);
 }catch{return failure();}
}

