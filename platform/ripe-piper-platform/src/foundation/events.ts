import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireTenant,verifyTurnstile} from '../routes/http';
import {validInstant} from './prospecting';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded=(s:unknown,n:number):s is string=>typeof s==='string'&&!!s.trim()&&s.length<=n;
function registrationResult(value:any,eventId:string,version:number,operation:string,recovery=false){
 if(!value||typeof value!=='object'||value.eventId!==eventId||value.identityStatus!=='unverified'||value.delivery!=='not_sent')return null;
 if(value.state==='request_received')return operation==='register'&&value.controlAvailable===false?{eventId:eventId,state:'request_received',identityStatus:'unverified',controlAvailable:false,delivery:'not_sent'}:null;
 if(!uuid.test(value.registrationId??'')||!['registered','cancelled','schedule_changed'].includes(value.state)||!Number.isInteger(value.version)||value.version<1||!Number.isInteger(value.acknowledgedVersion)||value.acknowledgedVersion<1||value.acknowledgedVersion>value.version||value.attendance!=='unknown'||value.marketingPermission!=='not_granted')return null;
 if(value.version<version||(!recovery&&operation==='register'&&(value.version!==version||value.acknowledgedVersion!==version))||(operation==='acknowledge'&&value.state!=='cancelled'&&(value.version!==version||value.acknowledgedVersion!==version)))return null;
 return {eventId:eventId,registrationId:value.registrationId,state:value.state,version:value.version,acknowledgedVersion:value.acknowledgedVersion,identityStatus:'unverified',attendance:'unknown',marketingPermission:'not_granted',delivery:'not_sent'};
}
const enabled=(env:Env)=>env.EVENT_REGISTRATION_ENABLED==='true'&&env.SYNTHETIC_SINK_ENABLED==='true';
function blocked(error:unknown){
 if(error instanceof DbError){if(error.body.includes('40001')||error.isConflict)return bad('The event or request changed. Reload the current event before continuing.',409);
 if(error.body.includes('22023')||error.body.includes('23503')||error.body.includes('23514')||error.body.includes('22007'))return bad('This event or registration is unavailable. Check its version, schedule, approval and capacity.',409);}
 throw error;
}
export async function eventOperations(req:Request,env:Env,tenantId:string){
 const actor=await requireTenant(req,env,tenantId,'operate'),body=await readJson(req),db=new Db(env);
 if(!await db.one('tenants',`id=eq.${tenantId}&select=id`))return bad('Client not found.',404);
 if(body.operation==='list'){
  const campaigns=await db.select('campaigns',`tenant_id=eq.${tenantId}&capability=eq.events&order=created_at.desc&limit=101`);
  const raw=await db.select<any>('lead_observations',`tenant_id=eq.${tenantId}&synthetic=eq.true&source=in.(event_registration,event_registration_cancel,event_registration_ack)&select=id,lead_id,source,external_ref,observed_at,product_context&order=observed_at.desc&limit=1000`);
  if(campaigns.length>100||raw.length>=1000)return bad('Event review needs pagination before more data can be shown.',409);
  const registrations=raw.filter(r=>r.source==='event_registration').map(r=>{
   const context=r.product_context, campaign:any=campaigns.find((c:any)=>c.id===context?.eventRef);
   const acknowledged=Math.max(context?.eventVersion??0,...raw.filter(a=>a.source==='event_registration_ack'&&a.product_context?.registrationRef===r.external_ref).map(a=>a.product_context?.eventVersion??0));
   return {id:r.id,leadId:r.lead_id,eventRef:context?.eventRef,eventVersion:context?.eventVersion,name:context?.registrantName,email:context?.registrantEmail,observedAt:r.observed_at,identityStatus:'unverified',attendance:'unknown',state:raw.some(c=>c.source==='event_registration_cancel'&&c.external_ref===r.external_ref)?'cancelled':acknowledged!==campaign?.event_version?'schedule_changed':'registered'};
  });
  if(registrations.some(r=>!uuid.test(r.id)||!uuid.test(r.leadId)||!uuid.test(r.eventRef)||typeof r.email!=='string'||!/^[^\s@]+@[^\s@]+\.invalid$/i.test(r.email)||!bounded(r.name,120)))return bad('Event review returned invalid records. Reload before continuing.',503);
  return json({ok:true,campaigns,registrations,registrationEnabled:enabled(env),mode:'synthetic_only',delivery:'not_sent'});
 }
 const b=body.settings;
 if(body.operation!=='configure'||!uuid.test(body.campaign_id??'')||!Number.isSafeInteger(body.expected_version)||body.expected_version<0||body.expected_version>2147483646||!b||b.confirmed!==true||typeof b.open!=='boolean'||
 !bounded(b.title,160)||!bounded(b.noticeReference,240)||!bounded(b.timezone,80)||!Number.isInteger(b.capacity)||b.capacity<1||b.capacity>100||!validInstant(b.startsAt)||!validInstant(b.endsAt)||Date.parse(b.endsAt)<=Date.parse(b.startsAt))return bad('Confirm reviewed event details, current version, timezone and bounded capacity.');
 try{new Intl.DateTimeFormat('en',{timeZone:b.timezone});}catch{return bad('Choose a valid timezone.');}
 try{const result=await db.rpc<any>('manage_event_settings',{p_tenant:tenantId,p_campaign:body.campaign_id,p_actor:actor.id,p_expected:body.expected_version,p_body:b});
 if(result?.id!==body.campaign_id||(!Number.isInteger(result?.version)||result.version<1||!([body.expected_version,body.expected_version+1].includes(result.version))||(result.version===body.expected_version&&result.replayed!==true))||typeof result.replayed!=='boolean')return bad('Event settings could not be confirmed. Reload before retrying.',503);
 return json({ok:true,id:result.id,version:result.version,replayed:result.replayed,delivery:'not_sent'});}catch(e){return blocked(e);}
}
export async function publicEventMetadata(_req:Request,env:Env,eventId:string){
 if(!enabled(env)||!uuid.test(eventId))return bad('Event registration is unavailable.',404);
 const event=await new Db(env).rpc<any>('event_public_metadata',{p_campaign:eventId});
 if(event===null)return bad('Event registration is unavailable.',404);
 if(event?.id!==eventId||!Number.isInteger(event.version)||event.version<1||!bounded(event.title,160)||!bounded(event.timezone,80)||!bounded(event.noticeReference,240)||!validInstant(event.startsAt)||!validInstant(event.endsAt)||Date.parse(event.endsAt)<=Date.parse(event.startsAt)||event.mode!=='synthetic_only')return bad('Event information could not be verified.',503);
 return json({ok:true,event:{id:event.id,version:event.version,title:event.title,startsAt:event.startsAt,endsAt:event.endsAt,timezone:event.timezone,noticeReference:event.noticeReference,mode:'synthetic_only'}});
}
export async function publicEventRegistration(req:Request,env:Env,eventId:string){
 if(!enabled(env)||!uuid.test(eventId))return bad('Event registration is unavailable.',404);
 const b=await readJson(req);
 if(!['register','cancel','acknowledge'].includes(b.operation)||!Number.isSafeInteger(b.version)||b.version<1||b.version>2147483646||typeof b.capability!=='string'||!/^[0-9a-f]{64}$/.test(b.capability))return bad('Use the current event version and your registration control code.');
 // Only a capability digest crosses the database boundary. No email/calendar provider write.
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(b.capability)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const db=new Db(env);
 try{
  if(b.operation==='register'){
   if(typeof b.email!=='string'||!/^[^\s@]+@[^\s@]+\.invalid$/i.test(b.email.trim())||b.email.length>254||!bounded(b.name,120)||b.consent!==true)return bad('Use a .invalid test contact and acknowledge event-only registration.');
   const params={p_campaign:eventId,p_version:b.version,p_email:b.email.trim().toLowerCase(),p_name:b.name.trim(),p_hash:digest};
   const prior=await db.rpc('read_synthetic_registration',params);
   if(prior!==null){const registration=registrationResult(prior,eventId,b.version,b.operation,true);return registration?json({ok:true,registration}):bad('Registration receipt could not be verified. Keep your control code and retry.',503);}
   if(!await verifyTurnstile(env,b.turnstile_token,req))return bad('Complete verification before registering.');
   const registration=registrationResult(await db.rpc('register_synthetic_event',params),eventId,b.version,b.operation);
   return registration?json({ok:true,registration}):bad('Registration could not be confirmed. Keep your control code and retry the same request.',503);
  }
  const registration=registrationResult(await db.rpc('change_synthetic_registration',{p_campaign:eventId,p_version:b.version,p_hash:digest,p_operation:b.operation}),eventId,b.version,b.operation);
  return registration?json({ok:true,registration}):bad('Registration change could not be confirmed. Keep your control code and retry the same request.',503);
 }catch(error){return blocked(error);}
}
