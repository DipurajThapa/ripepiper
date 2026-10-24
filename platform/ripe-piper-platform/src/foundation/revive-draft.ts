import {assessRevive,type ReviveContext} from './revive';
import {ambiguousExcerpt,validBrief,validDate,validFacts,validInstant} from './prospecting';
import {productError} from './products';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type DraftInput={leadId:string;sourceId:string;messageCount:number;senderName:string;bookingUrl?:string;bookingReference?:string;bookingReviewed?:boolean};
export type DraftContext={leadId:string;sourceId:string;canonicalNeed:string;briefVersion:number;reviewVersion:number;businessName:string;snapshot:string;expiresAt:string;proposalId?:string};
// Stored reviewed text remains data. Unsupported markup/placeholders are not executable copy.
function fragment(value:unknown,max:number):value is string {
 return typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f<>`{}\[\]]|\$\{|<%|%>|%\w+%/.test(value)
  &&!/(?:ignore|override).{0,40}(?:instructions|rules)|system\s*prompt|assistant\s*:|tool[_ -]?call/i.test(value);
}
/** A supplied public link is reviewed copy, never proof of calendar ownership or availability. */
export function reviewedBookingUrl(value:unknown):string|null {
 if(typeof value!=='string'||!value||value.length>1000||/[\s\\<>"'`{}]|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value))return null;
 try {
  const url=new URL(value),host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port||!host.includes('.')||host.includes(':')||/^\d+(?:\.\d+)*$/.test(host)
   ||/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host))return null;
  return url.href;
 }catch{return null;}
}
export function reviveDraftInputError(input:any):string|null {
 if(!input||!uuid.test(input.leadId??'')||!uuid.test(input.sourceId??'')||!Number.isInteger(input.messageCount)||input.messageCount<1||input.messageCount>3||!fragment(input.senderName,80))return 'Choose a contact, reviewed source, one to three messages and a plain-text sender name.';
 if(input.bookingUrl!==undefined&&input.bookingUrl!=='') {
  if(!reviewedBookingUrl(input.bookingUrl)||input.bookingReviewed!==true||!fragment(input.bookingReference,80))return 'Use a reviewed public HTTPS booking URL and its source reference (up to 80 characters). This does not verify calendar availability.';
 }else if(input.bookingReference||input.bookingReviewed)return 'A booking reference requires its reviewed booking URL.';
 return null;
}
export function currentReviveDraftContext(context:ReviveContext,now=Date.now()):boolean {
 return !!context.review&&context.review.state==='accepted'&&context.review.snapshot===context.snapshot&&validInstant(context.review.expires_at)&&Date.parse(context.review.expires_at)>now&&assessRevive(context,now).eligible;
}
/** One selected-source contract for proposal generation and subsequent tagged saves. */
export function reviewedReviveDraftSource(context:ReviveContext,sourceId:unknown,now=Date.now()) {
 if(typeof sourceId!=='string'||!uuid.test(sourceId)||!context.brief||!validBrief(context.brief.body,now))return null;
 const brief=context.brief.body,synthetic=context.lead.email.toLowerCase().endsWith('.invalid');
 const source=context.observations.find(o=>o.id===sourceId&&o.tenant_id===context.lead.tenant_id&&o.lead_id===context.lead.id&&o.synthetic===synthetic&&o.assessment_reviewed_by);
 const rights=source&&(source as typeof source&{rights_reference?:unknown}).rights_reference;
 if(!source||typeof rights!=='string'||!rights.trim()||rights.length>240||!source.external_ref?.trim()||!source.source?.trim()
  ||!validDate(source.observed_at,now)||Date.parse(source.observed_at)<now-brief.maxAgeDays*86400000
  ||!validFacts(source.assessment_facts,source.assessment_excerpt)||ambiguousExcerpt(source.assessment_excerpt!)||!source.assessment_facts.need||!fragment(source.assessment_facts.need,100))return null;
 const sourceNeed=source.assessment_facts.need.trim().toLowerCase();
 const canonicalNeed=brief.needs.find(n=>n.trim().toLowerCase()===sourceNeed||(Object.entries(brief.aliases?.need??{}).find(([canonical])=>canonical.trim().toLowerCase()===n.trim().toLowerCase())?.[1]??[]).some(alias=>alias.trim().toLowerCase()===sourceNeed));
 return canonicalNeed&&fragment(canonicalNeed,100)?{source,canonicalNeed}:null;
}
export function validReviveProposalId(value:unknown):value is string {
 return typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
}
/** Deterministic proposals only. Existing save/version/approval operations remain authoritative. */
export function proposeReviveDraft(context:ReviveContext,company:string,input:DraftInput,now=Date.now()) {
 const error=reviveDraftInputError(input);if(error)throw Error(error);
 if(context.lead.id!==input.leadId||!currentReviveDraftContext(context,now)||!context.brief)throw Error('A current accepted Revive review is required before drafting.');
 const brief=context.brief,synthetic=context.lead.email.toLowerCase().endsWith('.invalid');
 const selected=reviewedReviveDraftSource(context,input.sourceId,now);
 if(!selected)throw Error('Choose current reviewed source evidence with an unambiguous cited need and permitted-use reference.');
 const {source,canonicalNeed:need}=selected;
 if(!fragment(brief.body.offer,500)||!fragment(company,160))throw Error('The business name and offer need plain-text human review before they can be used in a draft.');
 const history=context.observations.filter(o=>o.tenant_id===context.lead.tenant_id&&o.lead_id===context.lead.id&&o.synthetic===synthetic&&o.assessment_reviewed_by&&o.product_context?.product==='revive'&&o.product_context.kind==='history'&&!productError(o.product_context,o.observed_at,now)).sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at)||a.id.localeCompare(b.id))[0];
 if(!history)throw Error('Reviewed relationship history is required.');
 // Campaign assets are shared by the cohort. Never insert the selected contact's private
 // need/company/history into reusable copy; map only to the reviewed brief's segment label.
 const sender=input.senderName.trim(),offer=brief.body.offer.trim(),name=company.trim();
 const booking=input.bookingUrl?reviewedBookingUrl(input.bookingUrl):null;
 const cta=booking?`If this is relevant, choose a time to discuss it: ${booking}`:`Is ${need} relevant for your team?`;
 const signoff=`${sender}\n${name}\n\nTo opt out of follow-up, reply "stop".`;
 const evidenceReference=`brief:v${brief.version};source:${source.id};history:${history.id};review:v${context.review!.version}${booking?`;booking:${input.bookingReference}`:''}`;
 const steps=[
  {offsetHours:0,subject:`A question about ${need}`,body:`Hello,\n\nI'm ${sender} from ${name}. Our offer is ${offer}.\n\n${cta}\n\n${signoff}`,evidenceReference},
  {offsetHours:72,subject:`Following up on ${need}`,body:`Hello,\n\nA brief follow-up on ${need}. At ${name}, our offer is ${offer}.\n\n${cta}\n\n${signoff}`,evidenceReference},
  {offsetHours:168,subject:`Closing the loop on ${need}`,body:`Hello,\n\nI'm closing the loop on ${need}.\n\n${cta}\n\n${signoff}`,evidenceReference},
 ].slice(0,input.messageCount);
 const expiresAt=new Date(Math.min(Date.parse(context.review!.expires_at),Date.parse(source.observed_at)+brief.body.maxAgeDays*86400000,now+86400000)).toISOString();
 return {product:'revive',steps,draftContext:{leadId:context.lead.id,sourceId:source.id,canonicalNeed:need,briefVersion:brief.version,reviewVersion:context.review!.version,businessName:company,snapshot:context.snapshot,expiresAt},
  basis:{briefVersion:brief.version,briefReference:brief.body.source.reference,sourceId:source.id,sourceReference:source.external_ref,sourceExcerpt:source.assessment_excerpt,historyId:history.id,reviewVersion:context.review!.version,bookingReference:booking?input.bookingReference:null},
  strategy:'Reusable cohort copy uses the reviewed tenant offer and brief need only. Selected-contact evidence supports staff review and is not personalized into shared messages. Review cohort appropriateness before saving.',
  requiresReview:true,contactAllowed:false,approvalGranted:false,externalCalls:0,delivery:'not_sent',bookingVerification:booking?'supplied_reviewed_url_only':'not_requested'};
}
/** Draft provenance cannot silently move to a newer brief/evidence snapshot when saved. */
export function validDraftSave(context:ReviveContext,value:any,now=Date.now()):value is DraftContext {
 const selected=value&&reviewedReviveDraftSource(context,value.sourceId,now);
 return !!selected&&validReviveProposalId(value.proposalId)&&uuid.test(value.leadId??'')&&uuid.test(value.sourceId??'')&&value.leadId===context.lead.id&&value.canonicalNeed===selected.canonicalNeed&&value.briefVersion===context.brief?.version&&Number.isInteger(value.reviewVersion)&&value.reviewVersion===context.review?.version&&fragment(value.businessName,160)&&value.snapshot===context.snapshot
  &&validInstant(value.expiresAt)&&Date.parse(value.expiresAt)>now&&Date.parse(value.expiresAt)<=now+86400000&&Date.parse(value.expiresAt)<=Date.parse(context.review?.expires_at??'')&&currentReviveDraftContext(context,now)
  &&Date.parse(value.expiresAt)<=Date.parse(selected.source.observed_at)+context.brief!.body.maxAgeDays*86400000;
}
