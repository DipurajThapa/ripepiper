/** Approved-source Signal acquisition. Source text is inert evidence, never instructions. */
import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireTenant} from '../routes/http';
import {validInstant} from './prospecting';
import {signalDiscovery} from './signal-discovery';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const itemId=/^[a-zA-Z0-9_-]{1,80}$/;
const email=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const text=(v:unknown,n:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=n;
export type SignalSource={id:string;tenantId:string;url:string;purposeReference:string;expiresAt:string;enabled:boolean;synthetic:boolean};
export type SignalItem={id:string;company:string;email:string;sourceUrl:string;observedAt:string;expiresAt:string;summary:string;relevance:string};
const cache=new WeakMap<Env,{raw:string;sources:SignalSource[]}>();
/** Exact operator-configured public URL only. DNS/egress verification is a separate live gate. */
export function approvedSignalUrl(value:unknown):string|null{
 if(typeof value!=='string'||value.length>512||/[?#\\\u0000-\u0020]/.test(value))return null;
 try{
  const u=new URL(value),host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||!host.includes('.')||host.endsWith('.')||
   !/^[a-z0-9.-]+$/.test(host)||/^\d+(?:\.\d+){3}$/.test(host)||
   /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion|home|lan)$/.test(host)||
   host.split('.').some(label=>!label||label.length>63||label.startsWith('-')||label.endsWith('-')))return null;
  return u.href.length<=512?u.href:null;
 }catch{return null;}
}
export function tenantSignalSource(env:Env,tenantId:string):SignalSource|null{
 const raw=env.SIGNAL_SOURCE_CONNECTIONS??'[]';let entry=cache.get(env);
 if(!entry||entry.raw!==raw){
  let sources:SignalSource[];
  try{if(raw.length>32768)throw Error();sources=JSON.parse(raw);}catch{throw Error('Invalid Signal source configuration.');}
  if(!Array.isArray(sources)||sources.length>10)throw Error('Invalid Signal source configuration.');
  const ids=new Set(),tenants=new Set(),urls=new Set();
  for(const c of sources){
   const url=approvedSignalUrl(c?.url);
   if(!c||!uuid.test(c.id)||!uuid.test(c.tenantId)||!url||!text(c.purposeReference,240)||!validInstant(c.expiresAt)||
    typeof c.enabled!=='boolean'||typeof c.synthetic!=='boolean'||ids.has(c.id.toLowerCase())||tenants.has(c.tenantId.toLowerCase())||urls.has(url))throw Error('Invalid Signal source configuration.');
   c.id=c.id.toLowerCase();c.tenantId=c.tenantId.toLowerCase();c.url=url;c.purposeReference=c.purposeReference.trim();
   ids.add(c.id);tenants.add(c.tenantId);urls.add(url);
  }
  entry={raw,sources};cache.set(env,entry);
 }
 return entry.sources.find(c=>c.tenantId===tenantId&&c.enabled&&Date.parse(c.expiresAt)>Date.now())??null;
}
function item(raw:any,c:SignalSource,now:number):SignalItem|null{
 if(!raw||typeof raw.id!=='string'||!itemId.test(raw.id)||!text(raw.company,240)||!text(raw.email,254)||!email.test(raw.email)||
  raw.email.toLowerCase().endsWith('.invalid')!==c.synthetic||!approvedSignalUrl(raw.sourceUrl)||
  !validInstant(raw.observedAt)||!validInstant(raw.expiresAt)||Date.parse(raw.observedAt)>now||
  Date.parse(raw.observedAt)<now-30*86400000||Date.parse(raw.expiresAt)<=now||
  Date.parse(raw.expiresAt)-Date.parse(raw.observedAt)>365*86400000||!text(raw.summary,1200)||!text(raw.relevance,500))return null;
 return {id:raw.id,company:raw.company.trim(),email:raw.email.toLowerCase(),sourceUrl:approvedSignalUrl(raw.sourceUrl)!,
  observedAt:new Date(raw.observedAt).toISOString(),expiresAt:new Date(raw.expiresAt).toISOString(),summary:raw.summary.trim(),relevance:raw.relevance.trim()};
}
async function digest(c:SignalSource,value:SignalItem){
 const bytes=new TextEncoder().encode(JSON.stringify({connection:c.id,tenant:c.tenantId,url:c.url,purpose:c.purposeReference,synthetic:c.synthetic,item:value}));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
/** At most one fixed URL, no redirects, 15-second deadline and 256 KiB streaming cap. */
export async function readSignalSource(c:SignalSource){
 if(approvedSignalUrl(c.url)!==c.url||!c.enabled||Date.parse(c.expiresAt)<=Date.now())throw Error('Signal source is not active.');
 const response=await fetch(c.url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
 if(!response.ok||response.redirected||(response.url&&response.url!==c.url)||
  !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')||
  Number(response.headers.get('content-length')??0)>262144||!response.body)throw Error('Approved Signal source is unavailable.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw Error('Signal source exceeds review limits.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let parsed:any;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw Error('Approved Signal source is malformed.');}
 if(!parsed||!Array.isArray(parsed.items)||parsed.items.length>20)throw Error('Signal source must contain at most twenty items.');
 const ids=new Set();let excluded=0;const items=[];
 for(const raw of parsed.items){
  if(raw&&typeof raw.id==='string'){if(ids.has(raw.id))throw Error('Signal item references must be unique.');ids.add(raw.id);}
  const value=item(raw,c,Date.now());if(!value){excluded++;continue;}
  items.push({...value,digest:await digest(c,value)});
 }
 return {items,excluded};
}
export async function signalSource(req:Request,env:Env,tenantId:string){
 const user=await requireTenant(req,env,tenantId,'operate'),b=await readJson(req),db=new Db(env,15000);
 if(['discovery-status','discover','analyse-posts'].includes(b.operation))return signalDiscovery(env,tenantId,b.operation,b.body,db);
 if(!['status','preview','import'].includes(b.operation))return bad('Unknown Signal source operation.');
 const tenant=await db.one<any>('tenants',`id=eq.${tenantId}&select=id,status`);if(!tenant)return bad('Client not found.',404);
 let c:SignalSource|null;try{c=tenantSignalSource(env,tenantId);}catch{return bad('Signal source configuration needs operator repair.',503);}
 if(!c||tenant.status!=='active')return json({ok:true,state:'not_connected',canAcquire:false,contactAllowed:false});
 if(b.operation==='status')return json({ok:true,state:'configured_unverified',sourceId:c.id,synthetic:c.synthetic,expiresAt:c.expiresAt,contactAllowed:false});
 const current=async()=>{if(!await db.one('tenants',`id=eq.${tenantId}&status=eq.active&select=id`)||tenantSignalSource(env,tenantId)!==c)throw Error('Signal source changed or paused.');};
 if(b.operation==='import'&&(!itemId.test(b.item_id??'')||b.reviewed!==true||!text(b.digest,64)))return bad('Review the source, contact identity and permitted use before importing.');
 try{
  const snapshot=await readSignalSource(c);await current();
  if(b.operation==='preview')return json({ok:true,...snapshot,sourceId:c.id,synthetic:c.synthetic,contactAllowed:false});
  const selected=snapshot.items.find(i=>i.id===b.item_id);
  if(!selected||selected.digest!==b.digest)return bad('The selected source changed or expired. Review it again.',409);
  const reference=`signal:${c.id}:${selected.id}`;
  const result=await db.rpc<{lead_id:string;observation_id:string;state:string}>('import_review_lead',{p_tenant:tenantId,p_actor:user.id,p_email:selected.email,p_company:selected.company,p_reference:reference+':contact',p_rights:c.purposeReference,p_observed:selected.observedAt,p_synthetic:c.synthetic});
  if(!result||typeof result.lead_id!=='string'||!uuid.test(result.lead_id)||typeof result.observation_id!=='string'||!uuid.test(result.observation_id)||!['created','linked','duplicate'].includes(result.state))throw Error('Uncertain contact import.');
  await current();
  const observation=await db.rpc<string>('record_product_event',{p_tenant:tenantId,p_lead:result.lead_id,p_actor:user.id,p_reference:reference+':trigger',p_rights:c.purposeReference,
   p_excerpt:`Company: ${selected.company}\nSource: ${selected.sourceUrl}\n${selected.summary}`,p_observed:selected.observedAt,p_synthetic:c.synthetic,
   p_context:{product:'signal',kind:'trigger',relevance:selected.relevance,expiresAt:selected.expiresAt}});
  if(typeof observation!=='string'||!uuid.test(observation))throw Error('Uncertain Signal observation import.');
  return json({ok:true,tenantId,sourceId:c.id,itemId:selected.id,digest:selected.digest,synthetic:c.synthetic,lead_id:result.lead_id,observation_id:observation,state:result.state,contactAllowed:false,delivery:'not_sent'});
 }catch(e){
  if(e instanceof DbError&&e.isConflict)return bad('This source reference conflicts with stored evidence. Review the source before retrying.',409);
  return bad('Signal acquisition could not be confirmed. No outreach was started. Retry the same reviewed item and reference after checking the connection.',503);
 }
}
