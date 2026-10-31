import type {Env} from '../env';
import {Db} from '../lib/db';
import {bad,json,requireTenant} from '../routes/http';
import {OUTCOMES,productError} from './products';
import {validInstant} from './prospecting';

type Outcome=typeof OUTCOMES[number];
type Campaign={id:string;tenant_id:string;capability:string;purpose:string;status:string};
type Lead={id:string;tenant_id:string;email:string};
type Action={id:string;tenant_id:string;campaign_id:string;lead_id:string;state:string;asset_version:number;due_at:string;dispatch_token:string|null;provider_ref:string|null;acknowledged_at:string|null;lease_until?:string|null};
type Asset={tenant_id:string;campaign_id:string;version:number;approved_by:string|null;approved_at:string|null};
type Evidence={id:string;tenant_id:string;lead_id:string;observed_at:string;synthetic:boolean;assessment_reviewed_by:string|null;product_context:any};
export interface ReviveReportInput {campaigns:Campaign[];leads:Lead[];actions:Action[];assets:Asset[];observations:Evidence[]}
type Mode='synthetic'|'business';
const contactKeys=['enrolled','queued','claimed','testAcknowledged','providerAcknowledged','replyHeld','requiresReview','blocked','cancelled'] as const;
type ContactKey=typeof contactKeys[number];
const actionKeys=['total','queued','claimed','testAcknowledged','providerAcknowledged','review','blocked','cancelled','failed','unverifiedReceipt'] as const;
type ActionKey=typeof actionKeys[number];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const counts=<K extends string>(keys:readonly K[])=>Object.fromEntries(keys.map(k=>[k,0])) as Record<K,number>;
const sets=<K extends string>(keys:readonly K[])=>Object.fromEntries(keys.map(k=>[k,new Set<string>()])) as Record<K,Set<string>>;
function bucket(){return {contacts:sets(contactKeys),actions:counts(actionKeys),outcomes:sets(OUTCOMES),outcomeRecords:0};}
type Bucket=ReturnType<typeof bucket>;
function serialize(b:Bucket){
 const conflicting=new Set([...b.outcomes.accepted].filter(id=>b.outcomes.rejected.has(id)).concat([...b.outcomes.won].filter(id=>b.outcomes.lost.has(id))));
 return {contacts:Object.fromEntries(contactKeys.map(k=>[k,b.contacts[k].size])) as Record<ContactKey,number>,actions:b.actions,
  outcomes:Object.fromEntries(OUTCOMES.map(k=>[k,b.outcomes[k].size])) as Record<Outcome,number>,outcomeRecords:b.outcomeRecords,
  conflictingOutcomeContacts:conflicting.size,recipientDeliveryConfirmed:null};
}
function receipt(a:Action,lead:Lead,assets:Asset[],now:number):'testAcknowledged'|'providerAcknowledged'|null {
 if(!a.dispatch_token||!uuid.test(a.dispatch_token)||!validInstant(a.acknowledged_at)||!validInstant(a.due_at))return null;
 const at=Date.parse(a.acknowledged_at!);
 if(at>now||at<Date.parse(a.due_at)||!assets.some(v=>v.campaign_id===a.campaign_id&&v.version===a.asset_version&&v.approved_by&&validInstant(v.approved_at)&&Date.parse(v.approved_at!)<=at))return null;
 const synthetic=lead.email.toLowerCase().endsWith('.invalid');
 if(synthetic&&a.state==='tested'&&a.provider_ref===`test-sink:${a.id}`)return 'testAcknowledged';
 if(!synthetic&&a.state==='delivered'&&typeof a.provider_ref==='string'&&!!a.provider_ref.trim()&&!a.provider_ref.startsWith('test-sink:'))return 'providerAcknowledged';
 return null;
}

/** Read-only aggregation. Counts concern reviewed evidence, never inferred delivery, causality or uplift. */
export function buildReviveReport(tenant:string,input:ReviveReportInput,now=Date.now()) {
 const campaigns=new Map(input.campaigns.filter(c=>c.tenant_id===tenant&&c.capability==='revive').map(c=>[c.id,c]));
 const leads=new Map(input.leads.filter(l=>l.tenant_id===tenant&&typeof l.email==='string').map(l=>[l.id,l]));
 const assets=input.assets.filter(v=>v.tenant_id===tenant&&campaigns.has(v.campaign_id));
 const actions=new Map(input.actions.filter(a=>a.tenant_id===tenant&&campaigns.has(a.campaign_id)&&leads.has(a.lead_id)).map(a=>[a.id,a]));
 const byCampaign=new Map([...campaigns.keys()].map(id=>[id,{synthetic:bucket(),business:bucket()}]));
 const totals={synthetic:bucket(),business:bucket()};
 const unlinked={synthetic:{contacts:new Set<string>(),outcomes:sets(OUTCOMES),records:0},business:{contacts:new Set<string>(),outcomes:sets(OUTCOMES),records:0}};
 const modeFor=(lead:Lead):Mode=>lead.email.toLowerCase().endsWith('.invalid')?'synthetic':'business';
 const evidence=[...new Map(input.observations.filter(o=>o.tenant_id===tenant&&leads.has(o.lead_id)).map(o=>[o.id,o])).values()];
 const reviewed=evidence.filter(o=>o.assessment_reviewed_by&&o.synthetic===(modeFor(leads.get(o.lead_id)!)==='synthetic')&&!productError(o.product_context,o.observed_at,now));
 // Operational holds mirror SQL's conservative raw reply/enquiry predicate.
 // Review, schema validity and evidence mode govern outcomes, not permission to resume.
 const held=new Set(evidence.filter(o=>o.product_context?.product==='response'&&['reply','enquiry'].includes(o.product_context.kind)).map(o=>o.lead_id));
 for(const a of actions.values()){
  const lead=leads.get(a.lead_id)!,mode=modeFor(lead),ack=receipt(a,lead,assets,now);
  for(const b of [totals[mode],byCampaign.get(a.campaign_id)![mode]]){
   b.contacts.enrolled.add(lead.id);b.actions.total++;
   if(['queued','claimed','review','blocked','cancelled','failed'].includes(a.state))b.actions[a.state as ActionKey]++;
   if(['queued','claimed','blocked','cancelled'].includes(a.state))b.contacts[a.state as ContactKey].add(lead.id);
   if(a.state==='review'||a.state==='claimed'&&(!validInstant(a.lease_until)||Date.parse(a.lease_until!)<=now))b.contacts.requiresReview.add(lead.id);
   if(held.has(lead.id))b.contacts.replyHeld.add(lead.id);
   if(ack){b.contacts[ack].add(lead.id);b.actions[ack]++;}
   else if(a.state==='tested'||a.state==='delivered')b.actions.unverifiedReceipt++;
  }
 }
 let unverifiedLinkedRecords=0;
 for(const o of reviewed){
  const c=o.product_context;if(c.product!=='revive'||c.kind!=='outcome')continue;
  const lead=leads.get(o.lead_id)!,mode=modeFor(lead),outcome=c.outcome as Outcome;
  if(!c.campaignId&&!c.actionId){const b=unlinked[mode];b.contacts.add(lead.id);b.outcomes[outcome].add(lead.id);b.records++;continue;}
  const a=actions.get(c.actionId),ack=a&&receipt(a,lead,assets,now);
  if(!a||a.campaign_id!==c.campaignId||a.lead_id!==lead.id||!ack||Date.parse(o.observed_at)<Date.parse(a.acknowledged_at!)){unverifiedLinkedRecords++;continue;}
  for(const b of [totals[mode],byCampaign.get(a.campaign_id)![mode]]){b.outcomes[outcome].add(lead.id);b.outcomeRecords++;}
 }
 const serializeUnlinked=(m:Mode)=>({contacts:unlinked[m].contacts.size,records:unlinked[m].records,outcomes:Object.fromEntries(OUTCOMES.map(k=>[k,unlinked[m].outcomes[k].size])) as Record<Outcome,number>});
 return {rulesVersion:1,generatedAt:new Date(now).toISOString(),totals:{synthetic:serialize(totals.synthetic),business:serialize(totals.business)},
  campaigns:[...campaigns.values()].map(c=>({id:c.id,purpose:c.purpose,status:c.status,modes:{synthetic:serialize(byCampaign.get(c.id)!.synthetic),business:serialize(byCampaign.get(c.id)!.business)}})),
  unattributed:{synthetic:serializeUnlinked('synthetic'),business:serializeUnlinked('business')},unverifiedLinkedRecords,
  abComparison:{available:false,reason:'No predeclared variant assignment or experiment cohort is recorded.'},
  notes:['Counts are unique contacts per category, cumulative and not mutually exclusive; no conversion rate or uplift is inferred.',
   'Reply holds are conservative operational stops from recorded replies/enquiries, including records awaiting review; they are not verified human replies or positive engagement.',
   'Test acknowledgements are synthetic. Provider acknowledgement does not prove recipient delivery. Recipient-delivery telemetry is not connected.',
   'Meetings and opportunities require reviewed linked outcomes; no booking, attendance or causal attribution is inferred from an action.',
   'Unattributed outcomes are tenant-level evidence and are not assigned to any campaign. Conflicting accepted/rejected or won/lost evidence requires review.',
   'This report aggregates existing reviewed records automatically. Live reply/provider/calendar outcome collection is a separate integration.']};
}

/** Staff-only bounded report; a capped dataset is rejected rather than presented as a complete funnel. */
export async function reviveReport(req:Request,env:Env,tenant:string){
 await requireTenant(req,env,tenant,'read');
 if(!uuid.test(tenant))return bad('Invalid client account.');
 const db=new Db(env,15000);
 if(!await db.one('tenants',`id=eq.${tenant}&select=id`))return bad('Client not found.',404);
 const [campaigns,leads,actions,assets,observations]=await Promise.all([
  db.select<Campaign>('campaigns',`tenant_id=eq.${tenant}&capability=eq.revive&select=id,tenant_id,capability,purpose,status&order=id&limit=101`),
  db.select<Lead>('leads',`tenant_id=eq.${tenant}&select=id,tenant_id,email&order=id&limit=101`),
  db.select<Action>('outbound_actions',`tenant_id=eq.${tenant}&select=id,tenant_id,campaign_id,lead_id,state,asset_version,due_at,dispatch_token,provider_ref,acknowledged_at,lease_until&order=id&limit=1001`),
  db.select<Asset>('campaign_assets',`tenant_id=eq.${tenant}&select=tenant_id,campaign_id,version,approved_by,approved_at&order=campaign_id,version&limit=1001`),
  db.select<Evidence>('lead_observations',`tenant_id=eq.${tenant}&product_context=not.is.null&select=id,tenant_id,lead_id,observed_at,synthetic,assessment_reviewed_by,product_context&order=id&limit=1001`),
 ]);
 if(campaigns.length>100||leads.length>100||actions.length>=1000||assets.length>=1000||observations.length>=1000)return bad('The outcome report needs pagination before this account can be reported completely.',409);
 return json({ok:true,report:buildReviveReport(tenant,{campaigns,leads,actions,assets,observations}),delivery:'not_sent'});
}
