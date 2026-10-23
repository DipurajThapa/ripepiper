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
 const connection=entry.connections.find(c=>c.tenantId===tenantId);
 if(!connection||!connection.enabled||Date.parse(connection.expiresAt)<=Date.now())return null;
 let provider=entry.environments.get(connection.id);
 if(!provider){provider={...env,GOOGLE_CLIENT_ID:connection.clientId,GOOGLE_CLIENT_SECRET:connection.clientSecret,GOOGLE_REFRESH_TOKEN:connection.refreshToken,GOOGLE_CALENDAR_ID:connection.calendarId};entry.environments.set(connection.id,provider);}
 return {connection,provider};
}
export async function tenantConnection(req:Request,env:Env,tenantId:string){
 const user=await requireUser(req,env,true),b=await readJson(req),db=new Db(env);
 if(!['status','check','list','preview','import'].includes(b.operation))return bad('Unknown connection operation.');
 const tenant=await db.one<any>('tenants',`id=eq.${tenantId}&select=id,status`);
 if(!tenant)return bad('Client not found.',404);
 let binding;
 try{binding=tenantGoogleConnection(env,tenantId);}catch{return bad('The tenant connection configuration needs operator repair.',503);}
 if(!binding||tenant.status!=='active')return json({ok:true,state:'not_connected',canRead:false,canSend:false});
 const {connection:c,provider}=binding;
 if(b.operation==='status')return json({ok:true,state:'configured_unverified',canRead:false,canSend:false,mailbox:c.mailbox,calendarId:c.calendarId,expiresAt:c.expiresAt});
 const current=async()=>{
  const active=await db.one('tenants',`id=eq.${tenantId}&status=eq.active&select=id`);
  const now=tenantGoogleConnection(env,tenantId);
  if(!active||!now||now.connection!==c)throw Error('Connection changed or paused.');
 };
 try{
  // Never infer identity from a refresh token or a chat-connected account.
  const mailbox=await googleMailbox(provider);
  if(mailbox.toLowerCase()!==c.mailbox.toLowerCase())return bad('The Google account does not match this client connection.',409);
  if(b.operation==='check'){
   const calendar=await googleCalendarIdentity(provider);
   if(calendar.id!==c.calendarId)return bad('The calendar does not match this client connection.',409);
   await current();
   return json({ok:true,state:'identity_verified',mailbox:c.mailbox,calendarId:c.calendarId,calendarRole:calendar.role,checkedAt:new Date().toISOString(),canRead:false,canSend:false});
  }
  if(!uuid.test(b.lead_id??''))return bad('Choose an existing client contact.');
  const lead=await db.one<any>('leads',`id=eq.${b.lead_id}&tenant_id=eq.${tenantId}&select=id,email`);
  if(!lead)return bad('Contact not found in this client account.',404);
  if(!email.test(lead.email)||lead.email.toLowerCase().endsWith('.invalid'))return bad('Live mailbox reads require a business contact.');
  if(b.operation==='list'){
   const messages=await listInboundMessages(provider,lead.email,c.mailbox);
   await current();return json({ok:true,messages,canSend:false});
  }
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(b.message_id??''))return bad('Select a message.');
  const message=await readInboundMessage(provider,b.message_id,lead.email,c.mailbox);
  await current();
  if(b.operation==='preview')return json({ok:true,message,canSend:false});
  if(b.reviewed!==true||b.digest!==message.digest)return bad('Review the current excerpt before importing; the source may have changed.',409);
  const context={product:'response',kind:'reply',threadRef:`gmail:${c.id}:${message.threadId}`,disposition:'human',need:'',authority:'',timing:''};
  const reference=`gmail:${c.id}:${message.id}`;
  // Existing RPC enforces scope, immutable reference/replay and atomic cross-product reply holds.
  const id=await db.rpc<string>('record_product_event',{p_tenant:tenantId,p_lead:lead.id,p_actor:user.id,p_reference:reference,p_rights:c.purposeReference,
   p_excerpt:message.excerpt,p_observed:message.observedAt,p_synthetic:false,p_context:context});
  return json({ok:true,id,reference,threadRef:context.threadRef,reviewState:'human',excerptTruncated:message.truncated,delivery:'not_sent'},201);
 }catch(e){
  if(e instanceof DbError&&e.isConflict)return bad('This message is already recorded with different evidence. Review the existing history.',409);
  return bad('The connection or selected message could not be verified. Check account consent, contact identity, message format and connection status. No message was sent.',409);
 }
}
