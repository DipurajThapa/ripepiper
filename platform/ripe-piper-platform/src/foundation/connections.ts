/** Staff-managed, bounded read-only pilot connections. Credentials exist only in Worker secrets. */
import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireUser} from '../routes/http';
import {googleMailbox,googleCalendarIdentity,listInboundMessages,readInboundMessage} from '../lib/google';
import {validInstant} from './prospecting';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export type GoogleConnection={id:string;tenantId:string;mailbox:string;calendarId:string;purposeReference:string;expiresAt:string;enabled:boolean;clientId:string;clientSecret:string;refreshToken:string};
const cached=new WeakMap<Env,{raw:string;connections:GoogleConnection[];environments:Map<string,Env>}>();
export function tenantGoogleConnection(env:Env,tenantId:string){
 const raw=env.GOOGLE_TENANT_CONNECTIONS ?? '[]';
 if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>256*1024)throw Error('Invalid tenant connection configuration.');
 let entry=cached.get(env);
 if(!entry||entry.raw!==raw){
  let configs:GoogleConnection[];
  try{configs=JSON.parse(raw);}catch{throw Error('Invalid tenant connection configuration.');}
  if(!Array.isArray(configs)||configs.length>10)throw Error('Invalid tenant connection configuration.');
  const ids=new Set(),tenants=new Set(),mailboxes=new Set(),calendars=new Set();
  for(const c of configs){
   if(!c||!uuid.test(c.id)||!uuid.test(c.tenantId)||typeof c.mailbox!=='string'||c.mailbox.length>254||!email.test(c.mailbox)||
    ![c.calendarId,c.purposeReference,c.clientId,c.clientSecret,c.refreshToken].every(x=>typeof x==='string'&&x.trim()&&x.length<=4096)||
    c.purposeReference.length>240||c.calendarId==='primary'||!validInstant(c.expiresAt)||typeof c.enabled!=='boolean'||
    ids.has(c.id.toLowerCase())||tenants.has(c.tenantId.toLowerCase())||mailboxes.has(c.mailbox.toLowerCase())||calendars.has(c.calendarId))throw Error('Invalid tenant connection configuration.');
   c.id=c.id.toLowerCase();c.tenantId=c.tenantId.toLowerCase();c.mailbox=c.mailbox.toLowerCase();
   ids.add(c.id);tenants.add(c.tenantId);mailboxes.add(c.mailbox);calendars.add(c.calendarId);
  }
  entry={raw,connections:configs,environments:new Map()};cached.set(env,entry);
 }
 const connection=entry.connections.find(c=>c.tenantId===tenantId.toLowerCase());
 if(!connection||!connection.enabled||Date.parse(connection.expiresAt)<=Date.now())return null;
 let provider=entry.environments.get(connection.id);
 if(!provider){provider={...env,GOOGLE_CLIENT_ID:connection.clientId,GOOGLE_CLIENT_SECRET:connection.clientSecret,GOOGLE_REFRESH_TOKEN:connection.refreshToken,GOOGLE_CALENDAR_ID:connection.calendarId};entry.environments.set(connection.id,provider);}
 return {connection,provider};
}
export async function googleBindingDigest(c:GoogleConnection):Promise<string>{
 const tuple=[1,c.id.toLowerCase(),c.tenantId.toLowerCase(),c.mailbox.toLowerCase(),c.calendarId,c.purposeReference,new Date(c.expiresAt).toISOString(),c.clientId,c.clientSecret,c.refreshToken];
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(tuple))))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
type Authority={tenant_id:string;connection_id:string;version:number;binding_hash:string;mailbox:string;calendar_id:string;purpose_reference:string;expires_at:string;verified_at:string;verified_by:string;revoked:boolean};
const version=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>=0&&Number(v)<2147483647;
function authorityValid(a:any):a is Authority {
 return !!a&&typeof a==='object'&&uuid.test(a.tenant_id)&&uuid.test(a.connection_id)&&version(a.version)&&a.version>0&&
 typeof a.binding_hash==='string'&&/^[0-9a-f]{64}$/.test(a.binding_hash)&&typeof a.mailbox==='string'&&email.test(a.mailbox)&&
 typeof a.calendar_id==='string'&&typeof a.purpose_reference==='string'&&validInstant(a.expires_at)&&validInstant(a.verified_at)&&uuid.test(a.verified_by)&&typeof a.revoked==='boolean';
}
function receipt(value:any,status:string,expected:number){
 return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='authorityVersion,status,version'&&value.version===1&&value.status===status&&value.authorityVersion===expected+1;
}
class AuthorityChanged extends Error {}
export async function tenantConnection(req:Request,env:Env,tenantId:string){
 const user=await requireUser(req,env,true),b=await readJson(req),db=new Db(env,8000,64*1024);
 const fields:Record<string,string[]>={status:[],check:[],register:['reviewed','expectedVersion'],revoke:['expectedVersion'],list:['lead_id'],preview:['lead_id','message_id'],import:['lead_id','message_id','reviewed','digest']};
 if(!Object.hasOwn(fields,b.operation)||Object.keys(b).some(k=>k!=='operation'&&!fields[b.operation].includes(k)))return bad('Unknown connection operation or field.');
 if(['register','revoke'].includes(b.operation)&&(!version(b.expectedVersion)||(b.operation==='register'&&b.reviewed!==true)))return bad('Review the binding and supply its current authority version.');
 let persistence=false;
 try{
  const tenant=await db.one<any>('tenants',`id=eq.${tenantId}&select=id,status,execution_version`);
  if(!tenant)return bad('Client not found.',404);
  const authority=await db.one<Authority>('tenant_google_authority',`tenant_id=eq.${tenantId}&select=tenant_id,connection_id,version,binding_hash,mailbox,calendar_id,purpose_reference,expires_at,verified_at,verified_by,revoked`);
  if(authority&&(!authorityValid(authority)||authority.tenant_id.toLowerCase()!==tenantId.toLowerCase()))throw Error('Invalid authority');
  const authorityVersion=authority?.version??0;
  if(b.operation==='revoke'){
   persistence=true;
   const result=await db.rpc('revoke_tenant_google_authority',{p_tenant:tenantId,p_actor:user.id,p_expected_version:b.expectedVersion});
   if(!receipt(result,'revoked',b.expectedVersion))throw Error('Uncertain revocation');
   return json(result);
  }
  let binding;
  try{binding=tenantGoogleConnection(env,tenantId);}catch{
   if(b.operation==='status')return json({ok:true,state:'configuration_invalid',authorityVersion,canRead:false,canSend:false});
   throw Error('Invalid configuration');
  }
  const digest=binding?await googleBindingDigest(binding.connection):null;
  const c=binding?.connection;
  const matches=!!(authority&&c&&!authority.revoked&&Date.parse(authority.expires_at)>Date.now()&&authority.connection_id===c.id&&authority.binding_hash===digest&&authority.mailbox===c.mailbox&&authority.calendar_id===c.calendarId&&authority.purpose_reference===c.purposeReference&&Date.parse(authority.expires_at)===Date.parse(c.expiresAt));
  if(b.operation==='status')return json({ok:true,state:tenant.status==='active'&&matches?'verified':authority?.revoked?'revoked':!binding?'not_connected':authority?'binding_changed':'configured_unverified',authorityVersion,canRead:tenant.status==='active'&&matches,canSend:false,...(c?{mailbox:c.mailbox,calendarId:c.calendarId,expiresAt:c.expiresAt}:{})});
  if(!binding||!c||tenant.status!=='active')return bad('The client connection is not active.',409);
  if(b.operation==='register'&&b.expectedVersion!==authorityVersion)return bad('Connection authority changed. Reload its status.',409);
  const probe=['check','register'].includes(b.operation);
  if(!probe&&!matches)return bad('Explicit registration of the current Google binding is required.',409);
  const current=async()=>{
   const selected=tenantGoogleConnection(env,tenantId);
   if(!selected||selected.connection!==c||await googleBindingDigest(selected.connection)!==digest)throw new AuthorityChanged();
   const allowed=await db.rpc(probe?'tenant_google_probe_current':'tenant_google_authority_current',{p_tenant:tenantId,p_actor:user.id,p_execution_version:tenant.execution_version,p_authority_version:authorityVersion,...(probe?{}:{p_binding_hash:digest})});
   if(allowed===false)throw new AuthorityChanged();
   if(allowed!==true)throw Error('Invalid preflight');
  };
  await current();
  const mailbox=await googleMailbox(binding.provider,current);
  if(mailbox.toLowerCase()!==c.mailbox)return bad('The Google account does not match this client connection.',409);
  if(probe){
   const calendar=await googleCalendarIdentity(binding.provider,current);
   if(calendar.id!==c.calendarId)return bad('The calendar does not match this client connection.',409);
   await current();
   if(b.operation==='register'){
    persistence=true;
    const result=await db.rpc('register_tenant_google_authority',{p_tenant:tenantId,p_actor:user.id,p_expected_version:b.expectedVersion,p_execution_version:tenant.execution_version,p_connection:c.id,p_binding_hash:digest,p_mailbox:c.mailbox,p_calendar:c.calendarId,p_purpose:c.purposeReference,p_expires:new Date(c.expiresAt).toISOString()});
    if(!receipt(result,'verified',b.expectedVersion))throw Error('Uncertain registration');
    const selected=tenantGoogleConnection(env,tenantId);
    if(!selected||selected.connection!==c||await googleBindingDigest(selected.connection)!==digest)throw new AuthorityChanged();
    const confirmed=await db.rpc('tenant_google_authority_current',{p_tenant:tenantId,p_actor:user.id,p_execution_version:tenant.execution_version,p_authority_version:b.expectedVersion+1,p_binding_hash:digest});
    if(confirmed!==true)throw Error('Registration authority changed before return');
    return json(result);
   }
   return json({ok:true,state:'identity_verified',authorityVersion,mailbox:c.mailbox,calendarId:c.calendarId,calendarRole:calendar.role,checkedAt:new Date().toISOString(),canRead:false,canSend:false});
  }
  if(!uuid.test(b.lead_id??''))return bad('Choose an existing client contact.');
  const lead=await db.one<any>('leads',`id=eq.${b.lead_id}&tenant_id=eq.${tenantId}&select=id,email`);
  if(!lead)return bad('Contact not found in this client account.',404);
  if(!email.test(lead.email)||lead.email.toLowerCase().endsWith('.invalid'))return bad('Live mailbox reads require a business contact.');
  if(b.operation==='list'){
   const messages=await listInboundMessages(binding.provider,lead.email,c.mailbox,current);
   await current();return json({ok:true,messages,canSend:false});
  }
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(b.message_id??''))return bad('Select a message.');
  const message=await readInboundMessage(binding.provider,b.message_id,lead.email,c.mailbox,current);
  await current();
  if(b.operation==='preview')return json({ok:true,message,canSend:false});
  if(b.reviewed!==true||b.digest!==message.digest)return bad('Review the current excerpt before importing; the source may have changed.',409);
  const context={product:'response',kind:'reply',threadRef:`gmail:${c.id}:${message.threadId}`,disposition:'human',need:'',authority:'',timing:''};
  const reference=`gmail:${c.id}:${message.id}`;
  persistence=true;
  const id=await db.rpc<string>('record_authorized_gmail_event',{p_expected_version:tenant.execution_version,p_connection_expires:c.expiresAt,p_authority_version:authorityVersion,p_binding_hash:digest,p_tenant:tenantId,p_lead:lead.id,p_actor:user.id,p_reference:reference,p_rights:c.purposeReference,
   p_excerpt:message.excerpt,p_observed:message.observedAt,p_synthetic:false,p_context:context});
  if(typeof id!=='string'||!uuid.test(id)||id!==id.toLowerCase())throw Error('Uncertain evidence acknowledgement');
  await current();
  return json({ok:true,id,reference,threadRef:context.threadRef,reviewState:'human',excerptTruncated:message.truncated,delivery:'not_sent'},201);
 }catch(e){
  if(e instanceof DbError){
   if(e.body.includes('42501'))return bad('Current verified administrator authority is required.',403);
   if(e.isConflict||e.body.includes('40001'))return bad('Connection authority or evidence changed. Reload and inspect the existing reference.',409);
   if(e.body.includes('22023'))return bad('Invalid connection operation.',400);
  }
  if(e instanceof AuthorityChanged&&!persistence)return bad('Connection authority changed or the client was paused. Reload its status.',409);
  return bad(persistence?'The acknowledgement is uncertain. Inspect the saved status or evidence and retry the same reference; no message was sent.':'The connection or selected message could not be verified. Check its status and retry; no message was sent.',503);
 }
}
