import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireTenant} from '../routes/http';
import {assessProspect,validBrief,validInstant,type Observation,type BusinessBrief} from './prospecting';
import {productError,reviewProducts} from './products';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ReviveContext {
 lead:{id:string;tenant_id:string;email:string;status:string};
 brief:{version:number;body:BusinessBrief}|null;
 observations:Observation[];suppressed:boolean;snapshot:string;
 review:{version:number;state:string;expires_at:string;snapshot:string}|null;
}

/** Reuse the existing qualification and history rules. Dormancy alone is never eligibility. */
export function assessRevive(context:ReviveContext,now=Date.now()) {
 const {lead,brief,observations}=context;
 if(!brief || !validBrief(brief.body,now))return {eligible:false,reasons:['current_reviewed_brief_required'],expiresAt:null,fitState:'unknown',historyState:'needs_evidence'};
 const synthetic=lead.email.toLowerCase().endsWith('.invalid');
 const fit=assessProspect(lead.tenant_id,lead.id,brief.body,observations,{now,synthetic,suppressed:context.suppressed||lead.status==='unsubscribed'});
 const histories=observations.filter(o=>o.synthetic===synthetic && o.assessment_reviewed_by && o.product_context?.product==='revive' && o.product_context.kind==='history' && !productError(o.product_context,o.observed_at,now))
  .sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at)||a.id.localeCompare(b.id));
 const history=histories[0];
 const products=reviewProducts(observations,now,context.suppressed||lead.status==='unsubscribed',fit.state);
 const state=products.find(p=>p.product==='revive')?.state??'needs_evidence';
 const reasons:string[]=[];
 if(fit.state!=='candidate')reasons.push(...fit.reasons.map(String),'current_fit_required');
 if(state!=='dormant_review')reasons.push(state);
 const cutoff=now-brief.body.maxAgeDays*86400000;
 if(!history || Date.parse(history.observed_at)<cutoff)reasons.push('fresh_history_review_required');
 if(history && histories.some(h=>h.observed_at===history.observed_at && JSON.stringify(h.product_context)!==JSON.stringify(history.product_context)))reasons.push('conflicting_history');
 const supporting=observations.filter(o=>fit.fields.some(f=>f.evidence.some(e=>e.id===o.id)));
 if(supporting.some(o=>!String((o as any).rights_reference??'').trim()) || history&&!String((history as any).rights_reference??'').trim())reasons.push('source_use_reference_required');
 const expiry=Math.min(now+30*86400000,Date.parse(brief.body.source.observedAt)+brief.body.maxAgeDays*86400000,
  ...supporting.map(o=>Date.parse(o.observed_at)+brief.body.maxAgeDays*86400000),history?Date.parse(history.observed_at)+brief.body.maxAgeDays*86400000:now);
 if(!Number.isFinite(expiry)||expiry<=now)reasons.push('evidence_expired');
 return {eligible:reasons.length===0,reasons:[...new Set(reasons)],expiresAt:expiry>now?new Date(expiry).toISOString():null,fitState:fit.state,historyState:state};
}

/** One explicit staff cohort decision; subsequent queue/claim/completion reuse this exact snapshot. */
export async function reviveReview(req:Request,env:Env,tenant:string){
 const actor=await requireTenant(req,env,tenant,'operate'),body=await readJson(req);
 if(!uuid.test(tenant)||!uuid.test(body.lead_id??'')||!['preview','accept','reject'].includes(body.operation))return bad('Choose a contact and a Revive review operation.');
 const db=new Db(env,15000);
 try{
  const context=await db.rpc<ReviveContext>('revive_review_context',{p_tenant:tenant,p_lead:body.lead_id,p_actor:actor.id});
  if(!context)return bad('Contact not found in this client account.',404);
  const assessment=assessRevive(context);
  if(body.operation==='preview')return json({ok:true,assessment,snapshot:context.snapshot,version:context.review?.version??0,review:context.review,contactAllowed:false});
  if(!Number.isInteger(body.version)||body.version<0||body.snapshot!==context.snapshot || typeof body.reason!=='string'||body.reason.trim().length<8||body.reason.length>1000)return bad('Refresh the contact review and record a reason of 8–1000 characters.',409);
  if(body.operation==='accept'&&!assessment.eligible)return bad('This contact is not eligible for Revive. Resolve its current evidence, fit and history findings.',409);
  const expires=assessment.expiresAt??new Date(Date.now()+86400000).toISOString();
  const review=await db.rpc<{version:number;state:string;snapshot:string;expires_at:string}>('review_revive_candidate',{
   p_tenant:tenant,p_lead:body.lead_id,p_actor:actor.id,p_expected_version:body.version,p_snapshot:context.snapshot,
   p_brief_version:context.brief?.version??null,p_decision:body.operation==='accept'?'accepted':'rejected',
   p_reason:body.reason.trim(),p_expires:expires,
  });
  if(!review||review.state!==(body.operation==='accept'?'accepted':'rejected')||review.version!==body.version+1||review.snapshot!==context.snapshot||!validInstant(review.expires_at)||Date.parse(review.expires_at)!==Date.parse(expires))throw Error('Uncertain cohort acknowledgement');
  return json({ok:true,review,contactAllowed:false,delivery:'not_sent'});
 }catch(e){
  if(e instanceof DbError){
   if(e.body.includes('23503'))return bad('Contact not found in this client account.',404);
   if(e.body.includes('40001')||e.isConflict)return bad('The contact evidence or review changed. Refresh before continuing.',409);
   if(e.body.includes('22023'))return bad('Revive review is blocked by current evidence, history, account state or limits.',409);
  }
  throw e;
 }
}
