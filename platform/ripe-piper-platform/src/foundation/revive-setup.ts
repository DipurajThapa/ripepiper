import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireUser} from '../routes/http';
import {validBrief,validInstant} from './prospecting';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text=(v:unknown,n:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const optional=(v:unknown,check:(v:any)=>boolean)=>v===null||check(v);
const integer=(v:unknown,min:number,max:number)=>Number.isInteger(v)&&Number(v)>=min&&Number(v)<=max;
const email=(v:unknown)=>text(v,254)&&!/\s/.test(v)&&/^[^@<>]+@[^@<>]+\.[^@<>]+$/.test(v);
const reference=(v:unknown,n=240)=>text(v,n)&&!/[\r\n]/.test(v);
const keys=['website','supportedClaims','sourceInventory','relationshipSummary','senderName','senderEmail','ownerId','market','language','timezone','salesCapacityPerWeek','outcomeWindowDays','workingDays','startMinute','endMinute','dailyContactCap'];
export interface ReviveSetupBody {
 website:{url:string;reference:string}|null;supportedClaims:{text:string;reference:string}[];
 sourceInventory:{type:'website'|'email'|'interview'|'file';reference:string;rightsReference:string}[];
 relationshipSummary:{text:string;reference:string}|null;senderName:string|null;senderEmail:string|null;ownerId:string|null;
 market:string|null;language:string|null;timezone:string|null;salesCapacityPerWeek:number|null;outcomeWindowDays:number|null;
 workingDays:number[]|null;startMinute:number|null;endMinute:number|null;dailyContactCap:number|null;
}
export interface SetupContext {
 tenantId:string;setup:{version:number;briefVersion:number|null;state:'draft'|'reviewed';body:ReviveSetupBody;createdBy:string;createdAt:string}|null;
 currentBriefVersion:number|null;ready:boolean;missing:string[];owners:{id:string;label:string}[];brief:{version:number;body:Record<string,unknown>}|null;
}
export function validSetupWebsite(value:unknown):value is string {
 if(typeof value!=='string'||value.length>1000||!/^https:\/\//.test(value)||/[\s\\<>"'`{}]|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value))return false;
 try{const u=new URL(value),h=u.hostname;return !u.username&&!u.password&&!u.port&&/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]{1,62}$/.test(h)&&!/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(h);}catch{return false;}
}
export function validSetupBody(value:unknown):value is ReviveSetupBody {
 if(!exact(value,keys))return false;const b=value as Record<string,any>;
 if(!optional(b.website,w=>exact(w,['url','reference'])&&validSetupWebsite(w.url)&&reference(w.reference)))return false;
 if(!Array.isArray(b.supportedClaims)||b.supportedClaims.length>10||b.supportedClaims.some(c=>!exact(c,['text','reference'])||!text(c.text,500)||!reference(c.reference)))return false;
 if(!Array.isArray(b.sourceInventory)||b.sourceInventory.length>10||b.sourceInventory.some(s=>!exact(s,['type','reference','rightsReference'])||!['website','email','interview','file'].includes(s.type)||!reference(s.reference)||!reference(s.rightsReference)))return false;
 if(!optional(b.relationshipSummary,r=>exact(r,['text','reference'])&&text(r.text,1000)&&reference(r.reference)))return false;
 if(!optional(b.senderName,v=>reference(v,80))||!optional(b.senderEmail,email)||!optional(b.ownerId,v=>typeof v==='string'&&uuid.test(v))||!optional(b.market,v=>typeof v==='string'&&/^[A-Z]{2}$/.test(v))||!optional(b.language,v=>typeof v==='string'&&v.length<=35&&/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(v)))return false;
 if(!optional(b.timezone,v=>{if(!reference(v,80))return false;try{const tz=new Intl.DateTimeFormat('en',{timeZone:v}).resolvedOptions().timeZone;return tz===v||tz.toLowerCase()!==v.toLowerCase();}catch{return false;}}))return false;
 if(!optional(b.salesCapacityPerWeek,v=>integer(v,0,100))||!optional(b.outcomeWindowDays,v=>integer(v,1,180))||!optional(b.dailyContactCap,v=>integer(v,1,25))||!optional(b.startMinute,v=>integer(v,0,1439))||!optional(b.endMinute,v=>integer(v,1,1440)))return false;
 if(!optional(b.workingDays,v=>Array.isArray(v)&&v.length<=7&&new Set(v).size===v.length&&v.every(d=>integer(d,1,7))))return false;
 return b.startMinute===null||b.endMinute===null||b.endMinute>b.startMinute;
}
export function setupMissing(body:ReviveSetupBody):string[] {
 const missing:string[]=[];
 if(!body.sourceInventory.length)missing.push('sourceInventory');
 for(const k of ['relationshipSummary','senderName','senderEmail','ownerId','market','language','timezone','outcomeWindowDays','startMinute','endMinute','dailyContactCap']as const)if(body[k]===null)missing.push(k);
 if(body.salesCapacityPerWeek===null||body.salesCapacityPerWeek<1)missing.push('salesCapacityPerWeek');
 if(!body.workingDays?.length)missing.push('workingDays');return missing;
}
function contextMissing(c:SetupContext,now=Date.now()):string[] {
 if(!c.setup)return ['setup_required'];
 const missing=setupMissing(c.setup.body);
 if(c.setup.state!=='reviewed')missing.push('reviewed_setup_required');
 if(c.setup.briefVersion===null||c.setup.briefVersion!==c.currentBriefVersion||!c.brief||!validBrief(c.brief.body,now)||Date.parse(c.brief.body.source.observedAt)<now-c.brief.body.maxAgeDays*86400000)missing.push('current_brief_required');
 if(!c.owners.some(o=>o.id===c.setup!.body.ownerId))missing.push('owner_unavailable');
 if(!c.owners.some(o=>o.id===c.setup!.createdBy))missing.push('reviewer_unavailable');return missing;
}
/** Validate the RPC contract and recompute readiness; never accept a bare ready:true. */
export function validSetupContext(value:unknown,tenantId:string):value is SetupContext {
 if(!exact(value,['tenantId','setup','currentBriefVersion','ready','missing','owners','brief']))return false;const c=value as SetupContext;
 if(c.tenantId!==tenantId||!uuid.test(c.tenantId)||typeof c.ready!=='boolean'||!Array.isArray(c.missing)||c.missing.some(v=>typeof v!=='string')||new Set(c.missing).size!==c.missing.length||!optional(c.currentBriefVersion,v=>integer(v,1,2147483647)))return false;
 if(!Array.isArray(c.owners)||c.owners.length>100||c.owners.some(o=>!exact(o,['id','label'])||!uuid.test(o.id)||!text(o.label,320))||new Set(c.owners.map(o=>o.id)).size!==c.owners.length)return false;
 if(!optional(c.brief,b=>exact(b,['version','body'])&&integer(b.version,1,2147483647)&&object(b.body))||c.brief?.version!==c.currentBriefVersion&&!(c.brief===null&&c.currentBriefVersion===null))return false;
 if(!optional(c.setup,s=>exact(s,['version','briefVersion','state','body','createdBy','createdAt'])&&integer(s.version,1,2147483647)&&optional(s.briefVersion,v=>integer(v,1,2147483647))&&['draft','reviewed'].includes(s.state)&&validSetupBody(s.body)&&uuid.test(s.createdBy)&&validInstant(s.createdAt)))return false;
 const expected=contextMissing(c);return c.ready===(expected.length===0)&&c.missing.length===expected.length&&expected.every(v=>c.missing.includes(v));
}
export async function reviveSetup(req:Request,env:Env,tenantId:string) {
 const actor=await requireUser(req,env,true),b=await readJson(req);
 if(!uuid.test(tenantId)||!['get','save'].includes(b.operation))return bad('Choose an existing client and a setup operation.');
 const db=new Db(env,15000);
 try{
  if(b.operation==='get'){
   const context=await db.rpc<unknown>('revive_setup_context',{p_tenant:tenantId,p_actor:actor.id});
   if(!validSetupContext(context,tenantId))return bad('Client setup could not be verified. Reload before continuing.',503);
   return json({ok:true,context,delivery:'not_sent'});
  }
  if(!integer(b.expectedVersion,0,2147483646)||!optional(b.briefVersion,v=>integer(v,1,2147483647))||!['draft','reviewed'].includes(b.state)||!validSetupBody(b.body))return bad('Provide the loaded setup version, linked brief and valid client setup fields.');
  if(b.state==='reviewed'&&(setupMissing(b.body).length||b.briefVersion===null))return bad('Complete the missing setup fields and current business brief before marking this setup reviewed.',409);
  const r=await db.rpc<any>('save_revive_setup',{p_tenant:tenantId,p_actor:actor.id,p_expected_version:b.expectedVersion,p_brief_version:b.briefVersion,p_state:b.state,p_body:b.body});
  if(!exact(r,['tenantId','version','briefVersion','state','ready','delivery'])||r.tenantId!==tenantId||!integer(r.version,1,2147483647)||![b.expectedVersion,b.expectedVersion+1].includes(r.version)||r.briefVersion!==b.briefVersion||r.state!==b.state||r.ready!==(b.state==='reviewed')||r.delivery!=='not_sent')return bad('The setup result is uncertain. Reload the same client before another change.',503);
  return json({ok:true,tenantId:r.tenantId,version:r.version,briefVersion:r.briefVersion,state:r.state,ready:r.ready,delivery:'not_sent'});
 }catch(e){
  if(e instanceof DbError){
   if(e.body.includes('23503'))return bad('Client or linked business brief not found.',404);
   if(e.body.includes('40001')||e.isConflict)return bad('The setup, business brief or owner changed. Reload before continuing.',409);
   if(e.body.includes('22023')||e.body.includes('23514'))return bad('Setup is incomplete, invalid or no longer current.',409);
   if(e.body.includes('42501'))return bad('An authorized staff reviewer is required.',403);
  }
  return bad('The setup result is uncertain. Reload the same client before continuing.',503);
 }
}
