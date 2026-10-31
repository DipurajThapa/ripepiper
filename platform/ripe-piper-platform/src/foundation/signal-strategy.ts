import {Db} from '../lib/db';
import {bad,json} from '../routes/http';
import {assessProspect,validBrief,validInstant,type BusinessBrief,type Observation} from './prospecting';
import {reviewProducts} from './products';
import {validSetupContext,type SetupContext} from './revive-setup';
import {brandSignoff} from '../lib/brand';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(v:unknown,n:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=n;
const plain=(v:unknown,n:number):v is string=>text(v,n)&&!/[\u0000-\u001f\u007f<>`{}\[\]]|\$\{|<%|%>|%\w+%/.test(v);
const email=(v:unknown):v is string=>plain(v,254)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export interface SignalProposalInput {leadId:string;signalId:string;synthetic:boolean}
export interface SignalSnapshot {tenant:{id:string;name:string;status:string};lead:{id:string;tenant_id:string;email:string;status:string};setup:SetupContext;observations:Observation[];stops:{tenant_id:string;lead_id:string}[];globalStops:{email:string}[]}
export class SignalProposalError extends Error {constructor(message:string,public status=409){super(message);}}
const hold=(message:string):never=>{throw new SignalProposalError(message);};
const malformed=():never=>{throw new SignalProposalError('The proposal source could not be verified. Refresh before continuing.',503);};
export function signalProposalInput(value:any):value is SignalProposalInput {return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3&&Object.keys(value).every(k=>['leadId','signalId','synthetic'].includes(k))&&uuid(value.leadId)&&uuid(value.signalId)&&typeof value.synthetic==='boolean';}
/** Pure deterministic preparation. Source excerpts remain separate from message copy. */
export function buildSignalProposal(tenantId:string,input:SignalProposalInput,s:SignalSnapshot,now=Date.now()) {
 if(!s.tenant||s.tenant.id!==tenantId||!text(s.tenant.name,200)||typeof s.tenant.status!=='string'||!s.lead||s.lead.id!==input.leadId||s.lead.tenant_id!==tenantId||!email(s.lead.email)||typeof s.lead.status!=='string')malformed();
 if(s.lead.status==='unsubscribed')hold('This contact is unsubscribed.');
 if(input.synthetic!==s.lead.email.toLowerCase().endsWith('.invalid'))hold('Evidence mode must match the contact.');
 if(s.tenant.status!=='active')hold('This client is not active.');
 if(!validSetupContext(s.setup,tenantId))malformed();
 if(!s.setup.ready||!s.setup.setup||!s.setup.brief)hold('Complete and review the current client setup and business brief.');
 const setup=s.setup.setup!,brief=s.setup.brief!.body;
 if(!validBrief(brief,now))hold('Refresh the current business brief.');
 const b=brief as unknown as BusinessBrief;
 if(!/^en(?:-|$)/i.test(setup.body.language??''))hold('Proposal preparation currently supports English.');
 if(!plain(s.tenant.name,200)||!plain(setup.body.senderName,80)||!email(setup.body.senderEmail)||!plain(b.offer,500))hold('Review unsafe or incomplete business, sender or offer text.');
 if(!Array.isArray(s.observations)||!Array.isArray(s.stops)||!Array.isArray(s.globalStops))malformed();
 if(s.observations.length>=1000)hold('Evidence requires pagination before preparation.');
 if(s.observations.some(o=>!o||!uuid(o.id)||o.tenant_id!==tenantId||o.lead_id!==input.leadId||o.synthetic!==input.synthetic||!text(o.source,240)||!text(o.external_ref,240)||!validInstant(o.observed_at)||!(o.assessment_reviewed_by===null||uuid(o.assessment_reviewed_by)))||new Set(s.observations.map(o=>o.id.toLowerCase())).size!==s.observations.length)malformed();
 if(s.stops.some(o=>!o||o.tenant_id!==tenantId||o.lead_id!==input.leadId)||s.globalStops.some(o=>!o||typeof o.email!=='string'||o.email.toLowerCase()!==s.lead.email.toLowerCase()))malformed();
 if(s.stops.length||s.globalStops.length)hold('This contact is suppressed.');
 if(s.observations.some(o=>o.product_context?.product==='response'&&['reply','enquiry'].includes(o.product_context.kind)))hold('A recorded reply or enquiry requires conversation review.');
 const assessment=assessProspect(tenantId,input.leadId,b,s.observations,{now,synthetic:input.synthetic,suppressed:false});
 if(assessment.state!=='candidate')hold('Current matching evidence is required in all four fit dimensions.');
 const field=(name:string)=>assessment.fields.find(f=>f.field===name)!;
 if(field('market').values[0]!==setup.body.market?.toLowerCase())hold('The setup market does not match this contact.');
 const trigger=reviewProducts(s.observations,now,false,assessment.state).find(p=>p.product==='signal'&&p.reference===input.signalId);
 if(!trigger||trigger.state!=='prioritise_review'||!trigger.validUntil)hold('Choose a current reviewed Signal trigger for this contact.');
 const canonicalNeed=field('need').values[0],buyerRole=field('role').values[0];
 if(!plain(canonicalNeed,100)||!plain(buyerRole,100))hold('Review unsafe need or role text.');
 const ids=new Set([input.signalId,...assessment.fields.flatMap(f=>f.evidence.map(e=>e.id))]);
 const evidence=s.observations.filter(o=>ids.has(o.id)).sort((a,b)=>a.id.localeCompare(b.id)).map(o=>{
  if(!text(o.assessment_excerpt,2000))malformed();
  return {id:o.id,reference:o.external_ref,observedAt:o.observed_at,excerpt:o.assessment_excerpt!};
 });
 const source=s.observations.find(o=>o.id===input.signalId)!;
 const relevance=(source.product_context as {relevance:string}).relevance;
 const triggerHypothesis='Hypothesis: '+relevance;
 if(!text(triggerHypothesis,500))hold('Review a shorter trigger relevance hypothesis.');
 const validUntil=new Date(Math.min(Date.parse(trigger!.validUntil!),Date.parse(b.source.observedAt)+b.maxAgeDays*86400000,...evidence.filter(e=>e.id!==input.signalId||assessment.fields.some(f=>f.evidence.some(x=>x.id===e.id))).map(e=>Date.parse(e.observedAt)+b.maxAgeDays*86400000))).toISOString();
 if(Date.parse(validUntil)<=now)hold('Supporting evidence has expired.');
 // The setup's reviewed booking link is the default call to action; SQL signal_binding_valid mirrors this copy.
 const cta=setup.body.booking?`If this is relevant, choose a time to discuss it: ${setup.body.booking.url}`:`Would a conversation about ${canonicalNeed} be useful?`;
 const subject=`A conversation about ${canonicalNeed}`;
 const body=`Hello,\n\nI am reaching out about ${canonicalNeed} for ${buyerRole} teams.\n\n${s.tenant.name}'s reviewed offer: ${b.offer}\n\n${cta}\n\n${brandSignoff(setup.body,s.tenant.name,'Reply stop if you would prefer no further contact.')}`;
 return {tenantId,leadId:input.leadId,signalId:input.signalId,synthetic:input.synthetic,briefVersion:s.setup.brief!.version,setupVersion:setup.version,recipient:s.lead.email,sender:{name:setup.body.senderName!,email:setup.body.senderEmail!},preparedAt:new Date(now).toISOString(),validUntil,strategy:{canonicalNeed,buyerRole,offer:b.offer,triggerHypothesis,cta},message:{subject,body},evidence,claimSources:{canonicalNeed:field('need').evidence.map(e=>e.id),buyerRole:field('role').evidence.map(e=>e.id),offer:{reference:b.source.reference,observedAt:b.source.observedAt,excerpt:b.source.excerpt}},reviewRequired:true as const,persisted:false as const};
}
export type SignalProposal=ReturnType<typeof buildSignalProposal>;
function canonical(value:any):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
function snapshotKey(s:SignalSnapshot):string {return canonical({...s,observations:[...s.observations].sort((a,b)=>a.id.localeCompare(b.id)),stops:[...s.stops].sort((a,b)=>canonical(a).localeCompare(canonical(b))),globalStops:[...s.globalStops].sort((a,b)=>canonical(a).localeCompare(canonical(b)))});}
async function readSnapshot(db:Db,tenantId:string,actor:string,input:SignalProposalInput):Promise<SignalSnapshot>{
 const tenants=await db.select<any>('tenants',`id=eq.${tenantId}&select=id,name,status&limit=2`);
 const leads=await db.select<any>('leads',`tenant_id=eq.${tenantId}&id=eq.${input.leadId}&select=id,tenant_id,email,status&limit=2`);
 if(!Array.isArray(tenants)||tenants.length>1||!Array.isArray(leads)||leads.length>1)malformed();
 if(!tenants.length||!leads.length)throw new SignalProposalError('Client or contact not found.',404);
 if(!email(leads[0].email))malformed();
 const [setup,observations,stops,globalStops]=await Promise.all([
  db.rpc<SetupContext>('revive_setup_context',{p_tenant:tenantId,p_actor:actor}),
  db.select<Observation>('lead_observations',`tenant_id=eq.${tenantId}&lead_id=eq.${input.leadId}&synthetic=eq.${input.synthetic}&order=id&limit=1001`),
  db.select<{tenant_id:string;lead_id:string}>('lead_suppression',`tenant_id=eq.${tenantId}&lead_id=eq.${input.leadId}&select=tenant_id,lead_id&limit=1001`),
  db.select<{email:string}>('suppression',`email=eq.${encodeURIComponent(leads[0].email.toLowerCase())}&select=email&limit=1001`),
 ]);
 return {tenant:tenants[0],lead:leads[0],setup,observations,stops,globalStops};
}
export async function prepareSignalProposal(db:Db,tenantId:string,actor:string,body:unknown){
 if(!uuid(tenantId)||!signalProposalInput(body))return bad('Choose a lead, Signal trigger and Boolean evidence mode.');
 try{
  const first=await readSnapshot(db,tenantId,actor,body);buildSignalProposal(tenantId,body,first);
  const second=await readSnapshot(db,tenantId,actor,body);
  if(snapshotKey(first)!==snapshotKey(second))hold('The client, contact or evidence changed. Refresh before preparing again.');
  const proposal=buildSignalProposal(tenantId,body,second);
  return json({ok:true,proposal,delivery:'not_sent',contactAllowed:false});
 }catch(e){return bad(e instanceof SignalProposalError?e.message:'The proposal sources are unavailable. No proposal was saved or sent.',e instanceof SignalProposalError?e.status:503);}
}

/** Reconstruct the authoritative proposal before saving the exact reviewed copy. */
export async function signalStrategyForSave(db:Db,tenantId:string,actor:string,plan:any){
 const input=plan.signalStrategy;
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==5||!['leadId','signalId','synthetic','proposal','reviewed'].every(k=>Object.hasOwn(input,k))||input.reviewed!==true||input.synthetic!==true||!uuid(input.leadId)||!uuid(input.signalId)||!input.proposal)throw new SignalProposalError('Review the exact synthetic Signal proposal before saving.',400);
 if(plan.product!=='signal'||!Array.isArray(plan.steps)||plan.steps.length!==1||plan.steps[0].offsetHours!==0)throw new SignalProposalError('Signal strategies use one bound recipient and one message.',400);
 const step=plan.steps[0];
 if(!plain(step.subject,160)||!text(step.body,4000)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>`{}\[\]]|%\w+%/.test(step.body)||step.evidenceReference!==`signal:${input.signalId}`)throw new SignalProposalError('Use reviewed plain-text copy and the exact Signal evidence reference.',400);
 const snapshot=await db.rpc<SignalSnapshot>('signal_strategy_context',{p_tenant:tenantId,p_lead:input.leadId,p_actor:actor});
 const proposal=buildSignalProposal(tenantId,{leadId:input.leadId,signalId:input.signalId,synthetic:true},snapshot);
 const normalize=(value:any):any=>{const v=structuredClone(value);delete v.preparedAt;
  if(validInstant(v.validUntil))v.validUntil=new Date(v.validUntil).toISOString();
  if(Array.isArray(v.evidence))for(const e of v.evidence)if(validInstant(e?.observedAt))e.observedAt=new Date(e.observedAt).toISOString();
  if(validInstant(v.claimSources?.offer?.observedAt))v.claimSources.offer.observedAt=new Date(v.claimSources.offer.observedAt).toISOString();
  return v;
 };
 if(canonical(normalize(input.proposal))!==canonical(normalize(proposal)))throw new SignalProposalError('The prepared evidence or client configuration changed. Prepare and review a fresh strategy.');
 if(plan.market!==snapshot.setup.setup!.body.market||plan.timezone!==snapshot.setup.setup!.body.timezone)throw new SignalProposalError('Use the reviewed client setup market and timezone.');
 return {proposal:normalize(proposal),sourceSnapshot:snapshot,reviewedBy:actor,reviewed:true};
}
