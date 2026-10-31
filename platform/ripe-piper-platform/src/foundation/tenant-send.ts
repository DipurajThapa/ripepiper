/** Client-owned mail and calendar adapters. Credentials come only from the connection registry; TENANT_SEND_ENABLED defaults off. */
import type {Env} from '../env';
import {Db} from '../lib/db';
import {sendEmail,createMeetEvent,busyTimes,type MeetingInput,type MimeHeaders} from '../lib/google';
import {msSendMail,msCreateEvent,msBusyTimes,type MsAccount} from '../lib/microsoft';
import {brandFrom,brandSignoff} from '../lib/brand';
import {validSetupContext,type ReviveSetupBody} from './revive-setup';
import {hashUnsubscribeToken,unsubscribeOrigin} from './tenant-unsubscribe';

/** Resolved by the registry's tenantConnection(env,db,tenantId,purpose): Google gets a per-connection Env clone (client calendar), Microsoft a token account. */
export type TenantConnection={connectionId:string;version:number;identity:string}&({provider:'google_workspace';env:Env}|{provider:'microsoft_365';account:MsAccount});
export type TenantMail={from:string;to:string;subject:string;text:string;headers:MimeHeaders};
export type BlockCode='sender_unverified'|'legal_footer_required'|'unsubscribe_required'|'content_unavailable'|'send_disabled';
export class TenantSendBlocked extends Error {constructor(public code:BlockCode){super(code);}}
const link=/^(https?:\/\/[^/\s?#@]+)\/unsubscribe\.html#token=[0-9a-f]{64}$/;
function issuedLink(url:string){
 const m=link.exec(url);if(!m)return false;
 try{return unsubscribeOrigin(m[1]+'/')===m[1];}catch{return false;}
}
/** Live-send gate: sender = connected mailbox, a postal footer and an issued unsubscribe link. The approved body is never rewritten, only completed. */
export function buildTenantSend(connection:TenantConnection,setup:ReviveSetupBody,tenantName:string,action:{to:string;subject:string;body:string;unsubscribeUrl:string|null}):TenantMail {
 if(!setup.senderEmail||setup.senderEmail.trim().toLowerCase()!==connection.identity.trim().toLowerCase())throw new TenantSendBlocked('sender_unverified');
 if(!setup.legalFooter?.postalAddress?.trim())throw new TenantSendBlocked('legal_footer_required');
 const url=action.unsubscribeUrl??'';
 if(!issuedLink(url))throw new TenantSendBlocked('unsubscribe_required');
 const signoff=brandSignoff(setup,tenantName,'');
 const body=action.body.includes(signoff)?action.body:`${action.body}\n\n${signoff}`;
 // No List-Unsubscribe-Post: the fragment-token page is not an RFC 8058 one-click POST endpoint.
 return {from:brandFrom(setup.senderName?.trim()||tenantName,connection.identity),to:action.to,subject:action.subject,text:`${body}\n\nUnsubscribe: ${url}`,
  headers:{'List-Unsubscribe':`<${url}>`,...(setup.replyTo?{'Reply-To':setup.replyTo}:{})}};
}
export function sendTenantMail(env:Env,connection:TenantConnection,mail:TenantMail,beforeSend?:()=>Promise<void>):Promise<{messageId:string}> {
 return connection.provider==='google_workspace'
  ? sendEmail(connection.env,mail.to,mail.subject,mail.text,undefined,beforeSend,{from:mail.from,headers:mail.headers})
  : msSendMail(env,connection.account,mail,beforeSend);
}
/** Invitation from the client's own calendar in the setup timezone. Invitations are outreach, so the send flag gates them too. */
export async function tenantMeeting(env:Env,connection:TenantConnection,setup:ReviveSetupBody,input:MeetingInput):Promise<{eventId:string;joinUrl:string|null}> {
 if(env.TENANT_SEND_ENABLED!=='true')throw new TenantSendBlocked('send_disabled');
 // Graph sends UTC and Google applies the setup zone to naive times; only explicit instants mean the same moment on both.
 if(![input.start,input.end].every(v=>/(Z|[+-]\d{2}:\d{2})$/.test(v)))throw Error('Meeting times need an explicit offset');
 if(connection.provider==='microsoft_365')return msCreateEvent(env,connection.account,input);
 const e=await createMeetEvent(connection.env,{...input,timeZone:setup.timezone??undefined});
 return {eventId:e.eventId,joinUrl:e.meetUrl};
}
export function tenantBusy(env:Env,connection:TenantConnection,from:Date,to:Date) {
 return connection.provider==='google_workspace'?busyTimes(connection.env,from,to):msBusyTimes(env,connection.account,from,to);
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Loads the approved step, contact, reviewed setup and a freshly issued unsubscribe link for one claimed action, then applies the gate. */
export async function loadTenantSend(db:Db,env:Env,connection:TenantConnection,a:{id:string;tenant_id:string;campaign_id:string;lead_id:string;asset_version:number;message_step:number}) {
 const t=a.tenant_id;
 const [tenant,campaign,asset,lead]=await Promise.all([
  db.one<{name:string;execution_version:number}>('tenants',`id=eq.${t}&select=name,execution_version`),
  db.one<{operator_id:string}>('campaigns',`id=eq.${a.campaign_id}&tenant_id=eq.${t}&select=operator_id`),
  db.one<{steps:{subject?:unknown;body?:unknown}[]}>('campaign_assets',`tenant_id=eq.${t}&campaign_id=eq.${a.campaign_id}&version=eq.${a.asset_version}&select=steps`),
  db.one<{email:string}>('leads',`id=eq.${a.lead_id}&tenant_id=eq.${t}&select=email`)]);
 const step=Array.isArray(asset?.steps)?asset!.steps[a.message_step]:null;
 if(!tenant||!campaign||!uuid.test(campaign.operator_id??'')||!lead||typeof step?.subject!=='string'||typeof step.body!=='string')throw new TenantSendBlocked('content_unavailable');
 const context=await db.rpc<unknown>('revive_setup_context',{p_tenant:t,p_actor:campaign.operator_id});
 if(!validSetupContext(context,t)||!context.ready||!context.setup)throw new TenantSendBlocked('content_unavailable');
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const issued=await db.rpc<any>('issue_tenant_unsubscribe',{p_tenant:t,p_lead:a.lead_id,p_actor:campaign.operator_id,p_hash:await hashUnsubscribeToken(token)});
 const url=issued?.version===1&&issued.status==='issued'?unsubscribeOrigin(env.SITE_URL)+'/unsubscribe.html#token='+token:null;
 return {actor:campaign.operator_id,executionVersion:tenant.execution_version,
  mail:buildTenantSend(connection,context.setup.body,tenant.name,{to:lead.email,subject:step.subject,body:step.body,unsubscribeUrl:url})};
}
