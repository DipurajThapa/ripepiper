/** Shared operator workflow. These records never authorise delivery or calendar booking. */
import { validDate, validInstant, type Observation } from './prospecting';
export const PRODUCTS = ['revive','signal','response','events'] as const;
export type Product = typeof PRODUCTS[number];
export const OUTCOMES = ['accepted','rejected','qualified_conversation','meeting_held','opportunity','won','lost'] as const;
export const DISPOSITIONS = ['interested','not_interested','later','wrong_person','opt_out','human','uncertain'] as const;
export type ProductContext =
 | {product:'revive';kind:'history';lastContactAt:string;previousInterest:'yes'|'no'|'unknown';stalledReason:string}
 | {product:'signal';kind:'trigger';relevance:string;expiresAt:string}
 | {product:'response';kind:'enquiry'|'reply';threadRef:string;disposition:typeof DISPOSITIONS[number];need:string;authority:string;timing:string;nextContactAt?:string}
 | {product:'events';kind:'registration'|'attendance';eventRef:string;endsAt:string;timezone:string;attendance:'unknown'|'attended'|'verified_no_show';rosterComplete:boolean}
 | {product:Product;kind:'outcome';outcome:typeof OUTCOMES[number];reason:string;threadRef?:string;eventRef?:string};
const text=(v:unknown,n=500):v is string=>typeof v==='string' && !!v.trim() && v.length<=n;
const answer=(v:unknown):v is string=>typeof v==='string' && v.length<=500;
export function productError(v:any,observedAt:string,now:number,requireOutcomeScope=false):string|null {
 if(!v || !PRODUCTS.includes(v.product) || !validDate(observedAt,now)) return 'Choose a product and a valid observation time.';
 if(v.kind==='outcome') {
   if(!OUTCOMES.includes(v.outcome) || !text(v.reason)) return 'Choose an outcome and record its evidence-based reason.';
   if(v.threadRef!==undefined && (v.product!=='response' || !text(v.threadRef,240))) return 'Use a valid conversation reference only for Response.';
   if(v.eventRef!==undefined && (v.product!=='events' || !text(v.eventRef,240))) return 'Use a valid event reference only for Events.';
   if(requireOutcomeScope && ((v.product==='response' && !text(v.threadRef,240)) || (v.product==='events' && !text(v.eventRef,240)))) return 'Link this outcome to its existing conversation or event reference.';
   return null;
 }
 if(v.product==='revive' && v.kind==='history') return validDate(v.lastContactAt,Date.parse(observedAt)) && ['yes','no','unknown'].includes(v.previousInterest) && text(v.stalledReason) ? null : 'Record last contact, previous interest and the known reason or explicitly unknown reason.';
 if(v.product==='signal' && v.kind==='trigger') return text(v.relevance) && validInstant(v.expiresAt) && Date.parse(v.expiresAt)>Date.parse(observedAt) && Date.parse(v.expiresAt)-Date.parse(observedAt)<=365*86400000 ? null : 'Record business relevance and an expiry within one year of observation.';
 if(v.product==='response' && ['enquiry','reply'].includes(v.kind)) {
   if(!text(v.threadRef,240) || !DISPOSITIONS.includes(v.disposition) || ![v.need,v.authority,v.timing].every(answer)) return 'Record the thread, reviewed disposition and known qualification answers; leave unknown answers blank.';
   if(v.disposition==='later' && (!validInstant(v.nextContactAt) || Date.parse(v.nextContactAt)<=Date.parse(observedAt))) return 'A later response needs its agreed future review time.';
   return null;
 }
 if(v.product==='events' && ['registration','attendance'].includes(v.kind)) {
   if(!text(v.eventRef,240) || !validInstant(v.endsAt) || !text(v.timezone,80) || !['unknown','attended','verified_no_show'].includes(v.attendance) || typeof v.rosterComplete!=='boolean') return 'Record event identity, end time, timezone and attendance evidence.';
   try { new Intl.DateTimeFormat('en',{timeZone:v.timezone}); } catch { return 'Use a valid event timezone.'; }
   if(v.kind==='registration' && v.attendance!=='unknown') return 'Registration is not attendance.';
   if(v.attendance==='verified_no_show' && (!v.rosterComplete || Date.parse(v.endsAt)>Date.parse(observedAt))) return 'No-show requires a complete authoritative roster after the event ended.';
   return null;
 }
 return 'This event belongs to a different product workflow.';
}
export function reviewProducts(observations:Observation[],now:number,suppressed:boolean,fitState:string) {
 const source = observations.filter(o=>o.assessment_reviewed_by && o.product_context && !productError(o.product_context,o.observed_at,now))
  .sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at) || a.id.localeCompare(b.id));
 const replies=source.filter(o=>o.product_context?.product==='response' && ['reply','enquiry'].includes(o.product_context.kind));
 const stopped=suppressed || replies.some(o=>(o.product_context as any).disposition==='opt_out');
 const work = PRODUCTS.flatMap(product=>{
   const keys=[...new Set(source.filter(o=>o.product_context!.product===product).map(o=>{const c=o.product_context!;return 'threadRef' in c?c.threadRef:'eventRef' in c?c.eventRef:'';}))];
   return (keys.length?keys:['']).map(key=>({product,key}));
 });
 return work.map(({product,key})=>{
   const history=source.filter(o=>{const c=o.product_context!;return c.product===product && (('threadRef' in c?c.threadRef:'eventRef' in c?c.eventRef:'')===key);});
   const latest=history.find(o=>o.product_context!.kind!=='outcome');
   const context=latest?.product_context;
   let state='needs_evidence', nextAction='Record reviewed source evidence.', dueAt:string|null=null;
   let question:string|null=null;
   const missing:string[]=[];
   if(context?.kind==='history') {
     const age=(now-Date.parse(context.lastContactAt))/86400000;
     state=context.previousInterest==='no'?'not_interested':age<30?'recent_contact':context.previousInterest==='unknown'?'review':'dormant_review';
     nextAction=state==='dormant_review'?'Review current need and contact rights before drafting reactivation.':'Review relationship history; do not assume inactivity means interest.';
     question='Is this still a priority, or should we close the loop?';
   }
   if(context?.kind==='trigger') {
     state=Date.parse(context.expiresAt)<=now?'stale':fitState==='candidate'?'prioritise_review':'qualify_fit';
     nextAction=state==='stale'?'Refresh the source before using this signal.':'Validate whether the observed change creates a relevant need; intent remains unknown.';
     question='Does this change create a problem your team is currently trying to solve?';
   }
   if(context && (context.kind==='reply'||context.kind==='enquiry')) {
     state=context.disposition;
     let conflicting=false;
     for(const field of ['need','authority','timing'] as const) {
       const values=[...new Set(history.flatMap(o=>{const c=o.product_context!;return (c.kind==='reply'||c.kind==='enquiry') && c[field].trim() && !/^(unknown|unsure|not known|n\/a)$/i.test(c[field].trim()) ? [c[field].trim().toLowerCase()] : [];}))];
       if(!values.length)missing.push(field);
       if(values.length>1)conflicting=true;
     }
     const questions:Record<string,string>={need:'What outcome are you trying to achieve?',authority:'Who else needs to be involved in this decision?',timing:'When would you like to address this?'};
     question=context.disposition==='interested' && missing.length ? questions[missing[0]] : null;
     nextAction=context.disposition==='interested' ? missing.length?'Ask the next unanswered question.':'Sales-owner review; answers alone do not establish SQL or confirm a booking.'
       : context.disposition==='later'?'Review at the agreed time; do not automatically resume a sequence.'
       : context.disposition==='wrong_person'?'Review the correct contact; do not invent a referral.'
       : context.disposition==='not_interested'?'Close this conversation; do not continue persuasion.'
       : 'Human review required. Follow-ups are held.';
     if(conflicting){state='review';question=null;nextAction='Resolve conflicting answers in this thread before qualification.';}
     dueAt=context.disposition==='later' ? context.nextContactAt! : ['interested','human','uncertain'].includes(context.disposition) ? new Date(Date.parse(latest!.observed_at)+60000).toISOString() : null;
   }
   if(context && (context.kind==='registration'||context.kind==='attendance')) {
     // A registration is never interpreted as attendance; incomplete rosters stay unknown.
     state=context.kind==='registration'?'registered':context.attendance;
     nextAction=state==='attended'?'Review the discussion and agreed next step.':state==='verified_no_show'?'Offer a relevant recap only under the applicable contact authority.':'Reconcile attendance; do not assume a no-show.';
     dueAt=new Date(Date.parse(context.endsAt)+86400000).toISOString();
   }
   if(product!=='response' && replies.length) {state='reply_hold';nextAction='A reply or enquiry exists. Review the conversation before any further prospecting.';question=null;}
   if(stopped) {state='suppressed';nextAction='No marketing follow-up. Route any service request to staff.';question=null;dueAt=null;}
   return {product,reference:key || null,state,nextAction,question,missing,dueAt,overdue:dueAt!==null && Date.parse(dueAt)<now,
     contactAllowed:false,bookingAvailable:false,outcomeScope:(product==='response'||product==='events') && !key?(history.some(o=>o.product_context?.kind==='outcome')?'unattributed':null):'product_reference',history:history.map(o=>({id:o.id,reference:o.external_ref,observedAt:o.observed_at,excerpt:o.assessment_excerpt,context:o.product_context,briefVersion:o.brief_version ?? null})),
     outcomes:history.filter(o=>o.product_context?.kind==='outcome').map(o=>({at:o.observed_at,...o.product_context as Extract<ProductContext,{kind:'outcome'}>}))};
 });
}
