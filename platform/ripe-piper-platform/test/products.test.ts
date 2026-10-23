import {describe,it,expect} from 'vitest';
import {productError,reviewProducts,type ProductContext} from '../src/foundation/products';
import type {Observation} from '../src/foundation/prospecting';
const now=Date.parse('2026-10-23T12:00:00Z'), at='2026-10-22T12:00:00Z';
function o(context:ProductContext):Observation{return {id:'one',tenant_id:'t',lead_id:'l',source:'product_review',external_ref:'fixture',observed_at:at,assessment_facts:{},assessment_excerpt:'Reviewed source',assessment_reviewed_by:'staff',synthetic:true,product_context:context};}
const reply:ProductContext={product:'response',kind:'reply',threadRef:'thread-1',disposition:'interested',need:'Reduce missed enquiries',authority:'',timing:''};
const event:ProductContext={product:'events',kind:'attendance',eventRef:'event-1',endsAt:'2026-10-21T12:00:00Z',timezone:'Asia/Dubai',attendance:'unknown',rosterComplete:false};
const review=(obs:Observation[],p:string,stop=false)=>reviewProducts(obs,now,stop,'candidate').find(r=>r.product===p)!;
describe('four standalone managed product reviews',()=>{
 it('Revive distinguishes dormant interest, recent contact and missing history',()=>{
  const c:ProductContext={product:'revive',kind:'history',lastContactAt:'2026-08-01T00:00:00Z',previousInterest:'yes',stalledReason:'Timing deferred'};
  expect(review([o(c)],'revive').state).toBe('dormant_review');
  expect(review([o({...c,lastContactAt:at})],'revive').state).toBe('recent_contact');
  expect(review([o({...c,previousInterest:'unknown'})],'revive').state).toBe('review');
  expect(review([],'revive').state).toBe('needs_evidence');
 });
 it('Signal expires business triggers and never equates them with contact authority',()=>{
  const c:ProductContext={product:'signal',kind:'trigger',relevance:'New service may require enquiry routing',expiresAt:'2026-10-24T00:00:00Z'};
  expect(review([o(c)],'signal')).toMatchObject({state:'prioritise_review',contactAllowed:false});
  expect(review([o({...c,expiresAt:'2026-10-23T00:00:00Z'})],'signal').state).toBe('stale');
 });
 it('Response asks an unanswered question, exposes overdue review and does not invent SQL or booking',()=>{
  const r=review([o(reply)],'response');
  expect(r.missing).toEqual(['authority','timing']);expect(r.question).toContain('Who else');expect(r.overdue).toBe(true);expect(r.bookingAvailable).toBe(false);
  expect(review([o({...reply,authority:'Owner',timing:'Next month'})],'response').nextAction).toContain('do not establish SQL');
 });
 it('all reply dispositions stop prospecting, opt-out overrides a later positive reply',()=>{
  expect(review([o(reply)],'revive').state).toBe('reply_hold');
  const opt=o({...reply,disposition:'opt_out'});opt.observed_at='2026-10-21T00:00:00Z';
  expect(review([opt,o(reply)],'response').state).toBe('suppressed');
  for(const disposition of ['not_interested','wrong_person','human','uncertain','opt_out'] as const) expect(review([o({...reply,disposition})],'response').question).toBeNull();
 });
 it('closed Response conversations have no overdue SLA or follow-up deadline',()=>{
  for(const disposition of ['not_interested','wrong_person','opt_out'] as const){
   const r=review([o({...reply,disposition})],'response');
   expect(r.dueAt).toBeNull();
   expect(r.overdue).toBe(false);
   expect(r.contactAllowed).toBe(false);
  }
  for(const disposition of ['interested','human','uncertain'] as const){
   expect(review([o({...reply,disposition})],'response').overdue).toBe(true);
  }
 });
 it('Events keeps registration, unknown attendance and verified no-show distinct',()=>{
  expect(review([o({...event,kind:'registration'})],'events').state).toBe('registered');
  expect(review([o(event)],'events').state).toBe('unknown');
  expect(productError({...event,attendance:'verified_no_show'},at,now)).toContain('complete authoritative roster');
  expect(productError({...event,attendance:'verified_no_show',rosterComplete:true,endsAt:'2026-10-24T00:00:00Z'},at,now)).not.toBeNull();
  expect(productError({...event,kind:'registration',attendance:'attended'},at,now)).not.toBeNull();
  expect(review([o({...event,attendance:'verified_no_show',rosterComplete:true})],'events').state).toBe('verified_no_show');
 });
 it('rejects product boundary violations, unknown timezone and future observation',()=>{
  expect(productError({...reply,product:'revive'},at,now)).not.toBeNull();
  expect(productError({...event,timezone:'unknown'},at,now)).not.toBeNull();
  expect(productError(reply,'2030-01-01T00:00:00Z',now)).not.toBeNull();
  expect(productError({...reply,disposition:'later'},at,now)).not.toBeNull();
 });
 it('records outcomes independently of engagement and never promotes a lead automatically',()=>{
  const r=review([o({product:'events',kind:'outcome',outcome:'meeting_held',reason:'Confirmed by sales owner'})],'events');
  expect(r.outcomes).toHaveLength(1);expect(r.state).toBe('needs_evidence');expect(r.contactAllowed).toBe(false);
 });
 it('retains answers in one thread and keeps separate threads and events distinct',()=>{
  const older=o({...reply,authority:'Owner'});older.observed_at='2026-10-21T00:00:00Z';
  expect(review([older,o(reply)],'response').missing).toEqual(['timing']);
  const other=o({...reply,threadRef:'thread-2',need:'Different request'});other.id='two';
  const result=reviewProducts([older,o(reply),other],now,false,'candidate').filter(r=>r.product==='response');
  expect(result).toHaveLength(2);expect(result.find(r=>r.reference==='thread-1')!.missing).toEqual(['timing']);
  const conflicting=o({...reply,authority:'Committee'});conflicting.id='three';
  expect(review([older,conflicting],'response').state).toBe('review');
  expect(reviewProducts([o(event),o({...event,eventRef:'event-2'})],now,false,'candidate').filter(r=>r.product==='events')).toHaveLength(2);
 });
});

it('attributes outcomes to their own thread or event and retains legacy unattributed history',()=>{
 for(const context of [reply,event]) {
  const product=context.product, field=product==='response'?'threadRef':'eventRef';
  const outcome={product,kind:'outcome',outcome:'meeting_held',reason:'Owner verified',[field]:'second'} as ProductContext;
  const legacy={product,kind:'outcome',outcome:'accepted',reason:'Historical record'} as ProductContext;
  const rows=reviewProducts([o(context),o({...context,[field]:'second'}),o(outcome),o(legacy)],now,false,'candidate').filter(r=>r.product===product);
  expect(rows.find(r=>r.reference==='second')!.outcomes).toHaveLength(1);
  expect(rows.find(r=>r.reference && r.reference!=='second')!.outcomes).toHaveLength(0);
  expect(rows.find(r=>!r.reference)).toMatchObject({outcomeScope:'unattributed',contactAllowed:false});
  expect(productError(legacy,at,now,true)).not.toBeNull();
  expect(productError(legacy,at,now)).toBeNull();
  expect(productError(outcome,at,now,true)).toBeNull();
 }
 expect(productError({product:'revive',kind:'outcome',outcome:'won',reason:'Verified',threadRef:'foreign'},at,now,true)).not.toBeNull();
});

it('does not label empty Response or Events groups as historical outcomes',()=>{
 for(const product of ['response','events']) expect(review([],product)).toMatchObject({outcomeScope:null,outcomes:[],state:'needs_evidence'});
});
