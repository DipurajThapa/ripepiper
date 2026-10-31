/** Offboarding: full JSON export, connection revocation, end of service and the retention purge (single purge path). */
import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {hmacHex} from '../lib/payments';
import {revokeGoogleToken,GoogleError} from '../lib/google';
import {VaultError,connectionAad,open} from '../lib/vault';
import {cleanText} from '../lib/validate';
import {bad,json,readJson,requireTenant,tenantAccess} from '../routes/http';

type OffboardEnv=Env&{OFFBOARD_PURGE_ENABLED?:string;SUPPRESSION_HMAC_KEY?:string};
/** Days between end of service and purge. SQL public.tenant_retention() is the enforcing copy (test-checked equal). */
export const RETENTION_DAYS=90;
const PAGE=1000;
// Exported tables and their keyset order (unique within the tenant). Rows are read with tenant_id=eq.<id> only.
export const EXPORT_TABLES:Record<string,string[]>={tenants:['id'],memberships:['user_id'],invites:['id'],operator_grants:['id'],
 leads:['id'],lead_observations:['id'],contact_rights:['id'],lead_suppression:['lead_id'],subject_requests:['id'],
 business_briefs:['version'],revive_setups:['version'],revive_reviews:['lead_id'],operating_envelopes:['version'],
 campaigns:['id'],campaign_assets:['campaign_id','version'],outbound_actions:['id'],outbound_stops:['id'],meetings:['id'],
 deals:['id'],proposals:['id'],quotes:['id'],payments:['id'],fees:['id'],outreach_weekly:['week_start'],ad_accounts:['id'],
 ad_metrics_daily:['platform','day','campaign_ref'],activity_log:['id'],tenant_activation_reviews:['execution_version'],
 tenant_google_authority:['tenant_id'],tenant_connections:['id']};
/** Every other table with tenant_id, with the reason it is not exported (drift test: each tenant table is in one list). */
export const EXCLUDED:Record<string,string>={
 build_usage:'Ripe Piper AI spend ledger; no client content',
 tenant_suppression:'keyed hashes kept after purge to honour objections; not client data',
 'ripepiper_private.tenant_unsubscribe_tokens':'bearer token hashes',
 'ripepiper_private.oauth_states':'transient PKCE state',
};
// Token, hash and secret material never leaves in an export, whatever table it appears in.
const SECRET=/token|hash|secret|ciphertext|^raw$/i;
const scrub=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([k])=>!SECRET.test(k)));
const lit=(v:unknown)=>typeof v==='number'?String(v):`"${String(v).replace(/["\\]/g,'\\$&')}"`;
/** PostgREST keyset filter: rows strictly after `row` in `keys` order. */
export function keysetFilter(keys:string[],row:Record<string,unknown>){
 const parts=keys.map((k,i)=>{const gt=`${k}.gt.${lit(row[k])}`;return i?`and(${[...keys.slice(0,i).map(p=>`${p}.eq.${lit(row[p])}`),gt].join(',')})`:gt;});
 return `or=${encodeURIComponent(`(${parts.join(',')})`)}`;
}

async function* exportChunks(db:Db,tenant:string){
 yield `{"exportedAt":${JSON.stringify(new Date().toISOString())},"tenantId":"${tenant}","tables":{`;
 let first=true;
 for(const [table,keys] of Object.entries(EXPORT_TABLES)){
  yield `${first?'':','}"${table}":[`;first=false;
  const filter=`${table==='tenants'?'id':'tenant_id'}=eq.${tenant}${table==='activity_log'?'&visible_to_client=eq.true':''}`;
  let last:Record<string,unknown>|null=null,n=0;
  do{
   const rows:Record<string,unknown>[]=await db.select(table,`${filter}&select=*&order=${keys.map(k=>`${k}.asc`).join(',')}&limit=${PAGE}${last?'&'+keysetFilter(keys,last):''}`);
   for(const r of rows)yield `${n++?',':''}${JSON.stringify(scrub(r))}`;
   last=rows.length===PAGE?rows[PAGE-1]:null;
  }while(last);
  yield ']';
 }
 yield '}}';
}

/** GET /api/admin/tenants/{id}/export: owner or a 'read' grantee (viewers 404). Audited, then streamed page by page. */
export async function exportTenant(req:Request,env:Env,tenantId:string){
 const user=await requireTenant(req, env, tenantId, 'read'),tenant=tenantId.toLowerCase(),db=new Db(env,15000);
 if(await db.rpc<boolean>('record_tenant_export',{p_tenant:tenant,p_actor:user.id})!==true)return bad('Not found.',404);
 const chunks=exportChunks(db,tenant),enc=new TextEncoder();
 const body=new ReadableStream<Uint8Array>({async pull(c){const {value,done}=await chunks.next();if(done)c.close();else c.enqueue(enc.encode(value));}});
 return new Response(body,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'Content-Disposition':`attachment; filename="ripe-piper-export-${tenant}.json"`}});
}

type Revocable={id:string;provider:string;version:number;status:string;keyId:string|null;iv:string|null;ciphertext:string|null};
const unb64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
/** Provider revoke first (Google), then the registry revoke deletes the sealed secret. Microsoft has no per-app revoke: deleting the secret is it. */
export async function revokeAllConnections(env:Env,db:Db,tenantId:string,actorId:string){
 const rows=await db.rpc<Revocable[]>('tenant_connections_to_revoke',{p_tenant:tenantId});
 if(!Array.isArray(rows))throw Error('Invalid connection list');
 let providerRevoked=0;
 for(const c of rows){
  if(c.provider==='google_workspace'&&c.keyId&&c.iv&&c.ciphertext){
   await revokeGoogleToken(await open(env,connectionAad(tenantId,c.id,c.provider),{keyId:c.keyId,iv:unb64(c.iv),ciphertext:unb64(c.ciphertext)}));
   providerRevoked++;
  }
  const r=await db.rpc<any>('revoke_tenant_connection',{p_tenant:tenantId,p_actor:actorId,p_connection:c.id,p_expected_version:c.version});
  if(r?.connectionId!==c.id||r.status!=='revoked')throw Error('Uncertain revocation');
 }
 return {revoked:rows.length,providerRevoked};
}

/** POST /api/admin/tenants/{id}/offboard {reason, requestReference?}: end (authority checked, execution paused, no new
 * connections), then revoke every connection. Retrying on an ended account only finishes revocation. Export stays until purge. */
export async function offboardTenant(req:Request,env:Env,tenantId:string){
 const user=await requireTenant(req, env, tenantId, 'approve'),b=await readJson(req),tenant=tenantId.toLowerCase(),db=new Db(env,15000);
 await tenantAccess(env,user,tenant,'operate'); // revoke_tenant_connection needs it; checked before anything ends
 const reason=cleanText(b.reason,500),reference=b.requestReference===undefined?null:cleanText(b.requestReference,200);
 if(reason.length<8)return bad('Give a reason for ending this service.');
 try{
  const ended=await db.rpc<any>('end_tenant',{p_tenant:tenant,p_actor:user.id,p_reason:reason,p_request_reference:reference});
  if(ended?.id!==tenant||ended.status!=='ended'||Number.isNaN(Date.parse(ended.endedAt)))return bad('The end acknowledgement is uncertain. Reload the account before retrying.',503);
  const connections=await revokeAllConnections(env,db,tenant,user.id);
  return json({ok:true,status:'ended',endedAt:ended.endedAt,purgeAfter:new Date(Date.parse(ended.endedAt)+RETENTION_DAYS*86400000).toISOString(),
   exportPath:`/api/admin/tenants/${tenant}/export`,connections});
 }catch(e){
  if(e instanceof DbError&&e.body.includes('42501'))return bad('Not found.',404);
  if(e instanceof DbError&&e.body.includes('22023'))return bad('Staff can end a self-service account only with the client\'s written request reference.',400);
  if(e instanceof DbError&&(e.isConflict||e.body.includes('40001')))return bad('A connection changed while ending. Retry to finish revoking.',409);
  if(e instanceof GoogleError||e instanceof VaultError)return bad('The service has ended, but a mailbox connection could not be revoked yet. Retry shortly to finish.',502);
  throw e;
 }
}

/** Keyed so a leaked table cannot be matched against address lists; the tenant in the message stops cross-tenant linking. */
export const suppressionHmac=(key:string,tenantId:string,email:string)=>hmacHex(key,`${tenantId.toLowerCase()}:${email.trim().toLowerCase()}`);

/** Scheduled purge. Kill switch OFFBOARD_PURGE_ENABLED: 'true' purges, 'dry_run' only counts, anything else does nothing. */
export async function purgeDue(env:OffboardEnv,now=new Date()){
 const mode=env.OFFBOARD_PURGE_ENABLED;
 if(mode!=='true'&&mode!=='dry_run')return {disabled:true};
 const db=new Db(env,30000),p_now=now.toISOString();
 const due=(await db.rpc<{due:string[]}>('purge_ended_tenants',{p_now,p_dry_run:true,p_suppression:{}}))?.due;
 if(!Array.isArray(due))throw Error('Invalid purge listing');
 if(mode==='dry_run'||!due.length)return {dryRun:mode==='dry_run',due:due.length,purged:0};
 const key=env.SUPPRESSION_HMAC_KEY;
 if(!key||key.length<32)return {due:due.length,purged:0,blocked:'suppression_key_missing'};
 const suppression:Record<string,{hmac:string;reason:string}[]>={};
 for(const t of due){
  const rows=await db.rpc<{email:string;reason:string}[]>('tenant_suppression_candidates',{p_tenant:t,p_lead:null});
  suppression[t]=await Promise.all(rows.map(async r=>({hmac:await suppressionHmac(key,t,r.email),reason:r.reason})));
 }
 const r=await db.rpc<{purged:string[];skipped:string[]}>('purge_ended_tenants',{p_now,p_dry_run:false,p_suppression:suppression});
 return {due:due.length,purged:r.purged.length,skipped:r.skipped.length};
}
