import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireUser} from '../routes/http';
import {validInstant} from './prospecting';
import {PRODUCTS} from './products';
import {proposeReviveDraft,reviveDraftInputError,validDraftSave} from './revive-draft';
import type {ReviveContext} from './revive';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded=(v:unknown,n:number):v is string=>typeof v==='string' && !!v.trim() && v.length<=n;
function campaignAcknowledgement(operation:string,value:any,campaign:string,version:number):Record<string,unknown>|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 if(operation==='queue')return Array.isArray(value.actionIds)&&value.actionIds.length>=1&&value.actionIds.length<=3&&new Set(value.actionIds).size===value.actionIds.length&&value.actionIds.every((id:unknown)=>typeof id==='string'&&uuid.test(id))&&typeof value.replayed==='boolean'?{actionIds:value.actionIds,replayed:value.replayed}:null;
 if(value.id!==campaign)return null;
 if(operation==='save')return Number.isInteger(value.version)&&value.version>0&&(value.version===version+1||(version>0&&value.version===version))&&(value.status==='draft'||value.status==='approved'&&version>0&&value.version===version)?{id:value.id,version:value.version,status:value.status}:null;
 if(operation==='approve')return value.status==='approved'&&value.version===version?{id:value.id,version:value.version,status:'approved'}:null;
 if(operation==='pause')return value.status==='paused'?{id:value.id,status:'paused'}:null;
 if(operation==='rights')return value.status==='synthetic_rights_recorded'?{id:value.id,status:'synthetic_rights_recorded'}:null;
 return null;
}
export function planError(b:any):string|null {
 if(!b || !PRODUCTS.includes(b.product) || !bounded(b.purpose,160) || !/^[A-Z]{2}$/.test(b.market??''))return 'Choose a product, purpose and two-letter market.';
 try{if(!bounded(b.timezone,80))throw Error();new Intl.DateTimeFormat('en',{timeZone:b.timezone});}catch{return 'Choose a valid timezone.';}
 if(!Array.isArray(b.steps)||b.steps.length<1||b.steps.length>3)return 'Use one to three messages.';
 let prior=-1;
 for(const step of b.steps){
  if(!step || !Number.isInteger(step.offsetHours) || step.offsetHours>720 || (prior===-1?step.offsetHours!==0:step.offsetHours-prior<24)
   || !bounded(step.subject,160) || /[\r\n]/.test(step.subject) || !bounded(step.body,4000) || !bounded(step.evidenceReference,240))return 'Each message needs a subject, body and evidence reference. Start at hour 0; separate follow-ups by at least 24 hours, within 30 days.';
  prior=step.offsetHours;
 }
 return null;
}
export async function campaignPlans(req:Request,env:Env,tenantId:string){
 const user=await requireUser(req,env,true),b=await readJson(req),db=new Db(env);
 const tenant=await db.one<{id:string;name:string}>('tenants',`id=eq.${tenantId}&select=id,name`);
 if(!tenant)return bad('Client not found.',404);
 if(b.operation==='list'){
  const campaigns=await db.select('campaigns',`tenant_id=eq.${tenantId}&order=created_at.desc&limit=101`);
  const assets=await db.select('campaign_assets',`tenant_id=eq.${tenantId}&order=version.desc&limit=1000`);
  const actions=await db.select('outbound_actions',`tenant_id=eq.${tenantId}&order=due_at&limit=1000`);
  const leads=await db.select<any>('leads',`tenant_id=eq.${tenantId}&select=id,email,company&limit=101`);
  const sources=await db.select<any>('lead_observations',`tenant_id=eq.${tenantId}&synthetic=eq.true&select=id,lead_id,external_ref&limit=1000`);
  const draftSources=await db.select<any>('lead_observations',`tenant_id=eq.${tenantId}&assessment_reviewed_by=not.is.null&select=id,lead_id,external_ref&limit=1000`);
  if(leads.length>100||sources.length>=1000||draftSources.length>=1000||campaigns.length>100||assets.length>=1000||actions.length>=1000)return bad('This review needs pagination before more records can be displayed.',409);
  return json({ok:true,campaigns,assets,actions:actions.map(({dispatch_token,...row}:any)=>row),leads:leads.filter(l=>l.email.toLowerCase().endsWith('.invalid')),sources,draftLeads:leads,draftSources,delivery:'synthetic_only'});
 }
 if(b.operation==='draft'){
  const error=reviveDraftInputError(b.body);if(error)return bad(error);
  const context=await db.rpc<ReviveContext>('revive_review_context',{p_tenant:tenantId,p_lead:b.body.leadId,p_actor:user.id});
  if(!context)return bad('Contact not found in this client account.',404);
  if(context.lead.tenant_id!==tenantId)return bad('Contact not found in this client account.',404);
  try{return json({ok:true,proposal:proposeReviveDraft(context,tenant.name,b.body)});}
  catch{return bad('Drafting needs a current accepted Revive review, current reviewed need evidence and a plain-text business name/offer. Refresh the review before continuing.',409);}
 }
 if(!uuid.test(b.campaign_id??'') || !Number.isInteger(b.version) || b.version<0)return bad('Provide the campaign and loaded version.');
 if(b.operation==='save'){
  const error=planError(b.body);if(error)return bad(error);
  if(b.body?.draftContext!==undefined){
   if(b.body.product!=='revive'||!uuid.test(b.body.draftContext?.leadId??''))return bad('Draft provenance does not match this message plan.',409);
   const context=await db.rpc<ReviveContext>('revive_review_context',{p_tenant:tenantId,p_lead:b.body.draftContext.leadId,p_actor:user.id});
   if(!context||context.lead.tenant_id!==tenantId||b.body.draftContext.businessName!==tenant.name||!validDraftSave(context,b.body.draftContext))return bad('Draft evidence or its approval changed or expired. Prepare a new reviewed draft before saving.',409);
  }
 }
 else if(b.operation==='approve'){
  if(!b.body || !['clientAuthority','ownerAuthority','ctsProfile'].every(k=>bounded(b.body[k],240)) || !Number.isInteger(b.body.maxActions)||b.body.maxActions<1||b.body.maxActions>100||!validInstant(b.body.expiresAt))return bad('Record the authority references, expiry and a maximum of 1–100 actions.');
 }
 else if(b.operation==='rights'){
  if(env.SYNTHETIC_SINK_ENABLED!=='true')return bad('Synthetic sequence testing is disabled.',403);
  if(!uuid.test(b.body?.leadId??'')||!uuid.test(b.body?.sourceId??'')||!bounded(b.body?.noticeReference,240))return bad('Choose a test contact, its source and a synthetic notice reference.');
 }
 else if(b.operation==='queue'){
  if(env.SYNTHETIC_SINK_ENABLED!=='true')return bad('Synthetic sequence testing is disabled.',403);
  if(!uuid.test(b.body?.leadId??'')||!validInstant(b.body?.startAt))return bad('Select a test lead and a timezone-aware start time.');
 }
 else if(b.operation!=='pause')return bad('Unknown campaign operation.');
 try{
  const args={p_tenant:tenantId,p_campaign:b.campaign_id,p_actor:user.id,p_version:b.version,p_body:b.body??{}};
  const result=b.operation==='save'&&b.body?.draftContext!==undefined?await db.rpc<any>('save_reviewed_revive_draft',args):await db.rpc<any>('manage_campaign_plan',{...args,p_operation:b.operation});
  const ack=campaignAcknowledgement(b.operation,result,b.campaign_id,b.version);
  if(!ack)return bad('The campaign acknowledgement is uncertain. Reload and inspect the same campaign before approving, queuing or repeating an operation.',503);
  return json({ok:true,...ack,delivery:'not_sent'});
 }catch(e){
  if(e instanceof DbError){
   if(e.body.includes('40001')||e.isConflict)return bad('Campaign changed or this enrolment already exists. Reload before continuing.',409);
   if(e.body.includes('23503'))return bad('Campaign not found in this account.',404);
   if(e.body.includes('22023')||e.body.includes('22007')||e.body.includes('23514'))return bad('Operation blocked. Check the current brief, active account, authority, contact rights, stop status and schedule limits.');
  }
  return bad('The campaign result is uncertain. Reload and inspect the same campaign before approving, queuing or repeating an operation.',503);
 }
}
