/** Managed-access grants, operating mode and the counts-only platform view. SQL re-checks every actor (can_operate). */
import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireOwnerOrPlatformAdmin,requirePlatformAdmin} from '../routes/http';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAPABILITIES=['read','operate','approve'];
const MODES=['managed','client_owned'];
const MAX_GRANT_MS=366*86400000;
const text=(v:unknown,min:number,max:number):v is string=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
const grantFields='id,operator_id,capabilities,authority,contract_reference,starts_at,expires_at,revoked_at,created_at,operator:operator_id(email)';
function sqlCode(e:unknown){if(!(e instanceof DbError))return null;try{return JSON.parse(e.body)?.code??null;}catch{return null;}}
function failure(e:unknown){
 const code=sqlCode(e);
 if(code==='42501'||code==='P0002')return bad('Not found.',404);
 if(code==='40001')return bad('Access changed. Reload before trying again.',409);
 if(code==='22023'||code==='23514'||code==='23503')return bad('The grant does not meet the access rules.',400);
 throw e;
}

/** Owner grants as client_admin; a platform admin grants only under a contract reference. */
export async function operatorGrants(req:Request,env:Env,tenantId:string){
 const {user,owner}=await requireOwnerOrPlatformAdmin(req,env,tenantId),b=await readJson(req),db=new Db(env,10000),tenant=tenantId.toLowerCase();
 if(b.operation==='list'){
  const grants=await db.select('operator_grants',`tenant_id=eq.${tenant}&select=${grantFields}&order=created_at.desc&limit=101`);
  if(grants.length>100)return bad('Grant history needs pagination before more can be shown.',409);
  return json({ok:true,grants});
 }
 try{
  if(b.operation==='revoke'){
   if(!uuid.test(b.grant_id??''))return bad('Choose a grant to revoke.');
   if(!await db.one('operator_grants',`id=eq.${b.grant_id.toLowerCase()}&tenant_id=eq.${tenant}&select=id`))return bad('Not found.',404);
   await db.rpc('revoke_operator_access',{p_grant:b.grant_id.toLowerCase(),p_actor:user.id});
   return json({ok:true,revoked:b.grant_id.toLowerCase()});
  }
  if(b.operation!=='grant')return bad('Unknown grant operation.');
  const caps=b.capabilities,expires=Date.parse(b.expires_at);
  if(!text(b.operator_email,3,254)||!email.test(b.operator_email.trim())||!Array.isArray(caps)||!caps.length||caps.some(c=>!CAPABILITIES.includes(c))||new Set(caps).size!==caps.length||
     !Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+MAX_GRANT_MS)return bad('Choose an operator, capabilities and an expiry within 366 days.');
  // Authority comes from the caller's role, never from the request body.
  const authority=owner?'client_admin':'contract';
  if(authority==='contract'&&!text(b.contract_reference,3,200))return bad('A contract reference is required for staff-authorised access.');
  const operator=await db.one<{id:string}>('profiles',`email=eq.${encodeURIComponent(b.operator_email.trim().toLowerCase())}&is_operator=eq.true&select=id`);
  if(!operator)return bad('No Ripe Piper operator uses that email.',404);
  const id=await db.rpc<string>('grant_operator_access',{p_tenant:tenant,p_actor:user.id,p_operator:operator.id,p_capabilities:caps,p_authority:authority,
   p_contract_reference:authority==='contract'?b.contract_reference.trim():null,p_expires_at:new Date(expires).toISOString()});
  if(typeof id!=='string'||!uuid.test(id))return bad('The grant acknowledgement is uncertain. Reload the grant list before trying again.',503);
  return json({ok:true,id,authority},201);
 }catch(e){return failure(e);}
}

/** Operating mode is presentation and expectation only; access never depends on it and no data moves. */
export async function tenantMode(req:Request,env:Env,tenantId:string){
 const {user}=await requireOwnerOrPlatformAdmin(req,env,tenantId),b=await readJson(req);
 if(!MODES.includes(b.expected)||!MODES.includes(b.to)||!text(b.reason,8,500))return bad('Choose the current mode, the new mode and a reason.');
 try{
  await new Db(env,10000).rpc('set_tenant_ownership',{p_tenant:tenantId.toLowerCase(),p_actor:user.id,p_expected:b.expected,p_to:b.to,p_reason:b.reason.trim()});
  return json({ok:true,ownership:b.to});
 }catch(e){return failure(e);}
}

/** Counts and health only. Called with the admin's own JWT so is_admin() is evaluated for that user, not the service role. */
export async function platformOverview(req:Request,env:Env){
 await requirePlatformAdmin(req,env);
 const token=(req.headers.get('Authorization')??'').replace(/^Bearer\s+/i,'');
 const res=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/platform_tenant_overview`,{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});
 if(!res.ok)throw new DbError(res.status,await res.text());
 const tenants=await res.json();
 if(!Array.isArray(tenants))return bad('The platform overview is unavailable. Reload and try again.',503);
 return json({ok:true,tenants});
}
