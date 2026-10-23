import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireUser} from '../routes/http';
import {validInstant} from './prospecting';
import {PRODUCTS} from './products';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded=(v:unknown,n:number):v is string=>typeof v==='string' && !!v.trim() && v.length<=n;
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
 if(!await db.one('tenants',`id=eq.${tenantId}&select=id`))return bad('Client not found.',404);
 if(b.operation==='list'){
  const campaigns=await db.select('campaigns',`tenant_id=eq.${tenantId}&order=created_at.desc&limit=101`);
  const assets=await db.select('campaign_assets',`tenant_id=eq.${tenantId}&order=version.desc&limit=1000`);
  const actions=await db.select('outbound_actions',`tenant_id=eq.${tenantId}&order=due_at&limit=1000`);
  const leads=await db.select<any>('leads',`tenant_id=eq.${tenantId}&select=id,email,company&limit=101`);
  const sources=await db.select<any>('lead_observations',`tenant_id=eq.${tenantId}&synthetic=eq.true&select=id,lead_id,external_ref&limit=1000`);
  if(leads.length>100||sources.length>=1000||campaigns.length>100||assets.length>=1000||actions.length>=1000)return bad('This review needs pagination before more records can be displayed.',409);
  return json({ok:true,campaigns,assets,actions,leads:leads.filter(l=>l.email.toLowerCase().endsWith('.invalid')),sources,delivery:'synthetic_only'});
 }
 if(!uuid.test(b.campaign_id??'') || !Number.isInteger(b.version) || b.version<0)return bad('Provide the campaign and loaded version.');
 if(b.operation==='save'){const error=planError(b.body);if(error)return bad(error);}
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
  return json({ok:true,...await db.rpc<any>('manage_campaign_plan',{p_tenant:tenantId,p_campaign:b.campaign_id,p_actor:user.id,p_operation:b.operation,p_version:b.version,p_body:b.body??{}}),delivery:'not_sent'});
 }catch(e){
  if(e instanceof DbError){
   if(e.body.includes('40001')||e.isConflict)return bad('Campaign changed or this enrolment already exists. Reload before continuing.',409);
   if(e.body.includes('23503'))return bad('Campaign not found in this account.',404);
   if(e.body.includes('22023')||e.body.includes('22007')||e.body.includes('23514'))return bad('Operation blocked. Check the current brief, active account, authority, contact rights, stop status and schedule limits.');
  }
  throw e;
 }
}
