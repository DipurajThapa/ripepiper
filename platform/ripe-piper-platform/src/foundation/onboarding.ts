/** One onboarding view per client: the setup steps computed from real records, and the connector catalogue with honest status. */
import type {Env} from '../env';
import {Db} from '../lib/db';
import {json,requireTenant} from '../routes/http';
import {PROVIDERS,oauthEnabled} from '../lib/oauth';
import {registryList} from './connections';

// operational: built, tested and needs nothing outside Ripe Piper. testing: built, waiting on provider approval or live proof.
// planned: on the roadmap, no adapter. not_supported: the provider offers no permitted way to automate it.
type Status='operational'|'testing'|'planned'|'not_supported';
type Connector={id:string;name:string;category:string;status:Status;method:string;ripePiperManages:string;customerDoes:string;permissions:string[];adminConsent:string;validation:string};
const scopes=(p:keyof typeof PROVIDERS)=>[...PROVIDERS[p].base,...Object.values(PROVIDERS[p].scopes).flat()];

export const CONNECTORS:Connector[]=[
 {id:'google_workspace',name:'Google Workspace (Gmail and Calendar)',category:'Email and calendar',status:'testing',method:'OAuth with PKCE',
  ripePiperManages:'One Google Cloud app, its verification, token encryption, refresh and revocation.',customerDoes:'Signs in with the sending mailbox and allows send and calendar access.',
  permissions:scopes('google_workspace'),adminConsent:'Only if the Workspace admin restricts third-party apps; then the admin must trust the Ripe Piper app.',
  validation:'Signed-in mailbox must match the requested mailbox and the declared sender; every granted scope is checked before use.'},
 {id:'microsoft_365',name:'Microsoft 365 (Outlook and Calendar)',category:'Email and calendar',status:'testing',method:'OAuth with PKCE (multi-tenant Entra app)',
  ripePiperManages:'One multi-tenant Entra app, publisher verification, token encryption, refresh and revocation.',customerDoes:'Signs in with the sending mailbox and allows send and calendar access.',
  permissions:scopes('microsoft_365'),adminConsent:'Only if the organisation blocks user consent; then a Microsoft 365 admin grants consent once.',
  validation:'Signed-in mailbox must match the requested mailbox and the declared sender; every granted scope is checked before use.'},
 {id:'csv_import',name:'CSV contact import',category:'Data import',status:'operational',method:'File upload',
  ripePiperManages:'Row checks, per-client duplicate removal and error reporting.',customerDoes:'Uploads contacts they have the right to contact and confirms the source.',
  permissions:[],adminConsent:'Not needed.',validation:'Each row is checked and duplicates within the client are rejected with a stable error.'},
 {id:'internal_crm',name:'Ripe Piper record of leads, deals and outcomes',category:'CRM',status:'operational',method:'Built in',
  ripePiperManages:'Storage, client isolation, export and deletion.',customerDoes:'Nothing.',permissions:[],adminConsent:'Not needed.',validation:'Always on.'},
 {id:'signal_feed',name:'Approved JSON signal feeds',category:'Intent signals',status:'testing',method:'HTTPS feed on an approved host',
  ripePiperManages:'Host allowlist, preview, import and expiry of each signal.',customerDoes:'Names the sources they are entitled to use.',
  permissions:[],adminConsent:'Not needed.',validation:'Only allowlisted hosts; each signal is reviewed before use.'},
 {id:'hubspot',name:'HubSpot',category:'CRM',status:'planned',method:'OAuth app',ripePiperManages:'A public HubSpot app and contact, deal and meeting sync.',
  customerDoes:'Installs the app in their HubSpot account.',permissions:[],adminConsent:'A HubSpot super admin installs it.',validation:'Not built.'},
 {id:'salesforce',name:'Salesforce',category:'CRM',status:'planned',method:'OAuth connected app',ripePiperManages:'A connected app and sync.',
  customerDoes:'An admin approves the connected app.',permissions:[],adminConsent:'Yes.',validation:'Not built.'},
 {id:'pipedrive',name:'Pipedrive',category:'CRM',status:'planned',method:'OAuth marketplace app',ripePiperManages:'A marketplace app and sync.',
  customerDoes:'Installs the app.',permissions:[],adminConsent:'Account admin.',validation:'Not built.'},
 {id:'enrichment',name:'Company and contact data provider',category:'Enrichment and verification',status:'planned',method:'API key held by Ripe Piper or the customer',
  ripePiperManages:'Licensed source selection, caching per licence and email verification.',customerDoes:'Nothing, or supplies their own provider key.',
  permissions:[],adminConsent:'Not needed.',validation:'Waiting for a licensed source whose terms allow this use.'},
 {id:'webhooks',name:'Outbound webhooks',category:'Extensibility',status:'planned',method:'Signed HTTPS callbacks',ripePiperManages:'Signing, retries and delivery log.',
  customerDoes:'Gives a receiving URL.',permissions:[],adminConsent:'Not needed.',validation:'Not built.'},
 {id:'whatsapp_cloud',name:'WhatsApp Business',category:'Messaging',status:'testing',method:'Meta Cloud API with an approved template',
  ripePiperManages:'Template use, opt-in records and webhooks.',customerDoes:'Owns the WhatsApp Business account and number and approves per-message cost.',
  permissions:['whatsapp_business_messaging'],adminConsent:'Meta Business account owner.',validation:'Consultation reminders only, after the guest opts in; off by default.'},
 {id:'sms',name:'Phone and SMS',category:'Messaging',status:'planned',method:'Provider API key',ripePiperManages:'Provider account, consent records and opt-out handling.',
  customerDoes:'Approves sender registration and cost.',permissions:[],adminConsent:'Not needed.',validation:'Not built.'},
 {id:'linkedin',name:'LinkedIn',category:'Social',status:'not_supported',method:'None for messaging',ripePiperManages:'Nothing. LinkedIn offers no permitted API for prospecting messages.',
  customerDoes:'Uses LinkedIn by hand; Ripe Piper can store the profile link.',permissions:[],adminConsent:'Not applicable.',validation:'Automated LinkedIn outreach is never offered.'},
];

/** GET /api/admin/tenants/{id}/onboarding: read access is enough; nothing here changes state. */
export async function onboardingStatus(req:Request,env:Env,tenantId:string){
 await requireTenant(req,env,tenantId,'read');
 const db=new Db(env,8000),t=tenantId.toLowerCase();
 const [tenant,brief,setup,envelope,campaign,connections]=await Promise.all([
  db.one<any>('tenants',`id=eq.${t}&select=status,ownership`),
  db.one<any>('business_briefs',`tenant_id=eq.${t}&select=version&order=version.desc`),
  db.one<any>('revive_setups',`tenant_id=eq.${t}&select=version&order=version.desc`),
  db.one<any>('operating_envelopes',`tenant_id=eq.${t}&select=version&order=version.desc`),
  db.one<any>('campaigns',`tenant_id=eq.${t}&status=eq.approved&select=id`),
  registryList(db,t)]);
 const now=new Date().toISOString();
 // A reviewed setup stops counting once a newer brief replaces the one it was reviewed against; the envelope refuses it then too.
 const [setupCurrent,envelopeEffective]=await Promise.all([
  setup?db.rpc<boolean>('revive_setup_current',{p_tenant:t,p_version:setup.version,p_now:now}).then(r=>r===true):false,
  envelope?db.rpc<boolean>('envelope_effective',{p_tenant:t,p_version:envelope.version,p_now:now}).then(r=>r===true):false]);
 const mailbox=connections.find(c=>c.canSend&&c.senderVerified),calendar=connections.find(c=>c.canBook);
 const steps=[
  {id:'business_brief',label:'Describe the business, offer and ideal customers',done:!!brief},
  {id:'setup',label:'Review the sending details: sender, postal address, working hours and limits',done:setupCurrent},
  {id:'account_active',label:'Activate the account against the reviewed brief',done:tenant?.status==='active'},
  {id:'mailbox',label:'Connect the sending mailbox (Google or Microsoft)',done:!!mailbox,available:oauthEnabled(env)},
  {id:'calendar',label:'Connect the calendar for booked meetings (optional)',done:!!calendar,optional:true,available:oauthEnabled(env)},
  {id:'envelope',label:tenant?.ownership==='managed'?'Approve the operating limits (you and your Ripe Piper operator)':'Approve the operating limits',done:envelopeEffective},
  {id:'first_campaign',label:'First campaign approved inside those limits',done:!!campaign},
 ];
 const next=steps.find(s=>!s.done&&!s.optional)?.id??null;
 return json({ok:true,mode:tenant?.ownership??null,next,steps,// Dispatch does not call the tenant send adapter yet (RP-013), so no flag can make sending live.
 liveSending:false,connectors:CONNECTORS});
}
