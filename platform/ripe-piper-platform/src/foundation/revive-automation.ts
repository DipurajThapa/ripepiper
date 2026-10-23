import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,requireUser} from '../routes/http';
import {executeSyntheticAction} from './action-reliability';
import {validInstant} from './prospecting';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limits={campaigns:10,reviews:25,actionsPerCampaign:100,enrolments:10,dispatches:20,milliseconds:15000};
type Scope={tenantId?:string;campaignId?:string};
type Campaign={id:string;tenant_id:string;operator_id:string;capability:string;status:string;asset_version:number};
type Action={id:string;tenant_id:string;campaign_id:string;lead_id:string;state:string;due_at:string;lease_until:string|null;dispatch_token:string|null};
type Review={tenant_id:string;lead_id:string;state:string;expires_at:string};
const actionFields='id,tenant_id,campaign_id,lead_id,state,due_at,lease_until,dispatch_token';

/** Existing ledger only: no real provider, new approval, contact right or learned rule. */
export async function runReviveAutomation(env:Env,scope:Scope={}) {
 const report={enabled:env.REVIVE_AUTOMATION_ENABLED==='true'&&env.SYNTHETIC_SINK_ENABLED==='true',
  delivery:'not_sent' as const,campaigns:0,enrolled:0,tested:0,blocked:0,review:0,existing:0,limited:false};
 // A normal deployment/configuration cannot accidentally start this routine.
 if(!report.enabled)return {...report,disabled:true};
 if((scope.tenantId!==undefined&&!uuid.test(scope.tenantId))||(scope.campaignId!==undefined&&!uuid.test(scope.campaignId)))return {...report,blocked:1};
 const deadline=Date.now()+limits.milliseconds;
 let dispatchAttempts=0;
 const available=()=>Date.now()<deadline;
 // Per-operation timeout is at most two seconds and never exceeds the remaining run budget.
 const db=()=>new Db(env,Math.max(1,Math.min(2000,deadline-Date.now())));
 try {
  const campaigns=await db().select<Campaign>('campaigns',`capability=eq.revive&status=eq.approved${scope.tenantId?`&tenant_id=eq.${scope.tenantId}`:''}${scope.campaignId?`&id=eq.${scope.campaignId}`:''}&select=id,tenant_id,operator_id,capability,status,asset_version&order=id&limit=${limits.campaigns+1}`);
  if(campaigns.length>limits.campaigns)return {...report,blocked:1,limited:true};
  for(const c of campaigns) {
   if(!available()){report.limited=true;break;}
   if(!uuid.test(c.id)||!uuid.test(c.tenant_id)||!uuid.test(c.operator_id)||c.capability!=='revive'||c.status!=='approved'||!Number.isInteger(c.asset_version)||c.asset_version<1||(scope.tenantId&&c.tenant_id!==scope.tenantId)||(scope.campaignId&&c.id!==scope.campaignId)){report.blocked++;continue;}
   if(!await db().one('tenants',`id=eq.${c.tenant_id}&status=eq.active&select=id`)){report.blocked++;continue;}
   report.campaigns++;
   const actions=await db().select<Action>('outbound_actions',`tenant_id=eq.${c.tenant_id}&campaign_id=eq.${c.id}&select=${actionFields}&order=message_step,id&limit=${limits.actionsPerCampaign+1}`);
   if(actions.length>limits.actionsPerCampaign||actions.some(a=>a.tenant_id!==c.tenant_id||a.campaign_id!==c.id||!uuid.test(a.id)||!uuid.test(a.lead_id))){report.blocked++;report.limited=true;continue;}
   // An abandoned fence is reconciled to review, never completed/reclaimed by another run.
   let claimed=false;
   for(const a of actions.filter(a=>a.state==='claimed')) {
    claimed=true;
    if(!available()){report.limited=true;break;}
    if(a.dispatch_token&&uuid.test(a.dispatch_token)&&validInstant(a.lease_until)&&Date.parse(a.lease_until!)<=Date.now()) {
     await db().rpc('expire_fenced_synthetic_action',{p_tenant:c.tenant_id,p_id:a.id,p_token:a.dispatch_token,p_now:new Date().toISOString()});
     report.review++;
    }
   }
   if(claimed)continue;
   const reviews=await db().select<Review>('revive_reviews',`tenant_id=eq.${c.tenant_id}&state=eq.accepted&expires_at=gt.${new Date().toISOString()}&select=tenant_id,lead_id,state,expires_at&order=lead_id&limit=${limits.reviews+1}`);
   if(reviews.length>limits.reviews){report.blocked++;report.limited=true;continue;}
   let enrolmentUncertain=false;
   for(const review of reviews) {
    if(!available()||report.enrolled>=limits.enrolments){report.limited=true;break;}
    if(review.tenant_id!==c.tenant_id||!uuid.test(review.lead_id)||review.state!=='accepted'||!validInstant(review.expires_at)||Date.parse(review.expires_at)<=Date.now()){report.blocked++;continue;}
    if(actions.some(a=>a.lead_id===review.lead_id)){report.existing++;continue;}
    // Persisted enrolments are never rescheduled, including cancelled/blocked/old versions.
    // Database rechecks current review, history, brief, rights, caps and stops atomically.
    try {
     const ack=await db().rpc<any>('manage_campaign_plan',{p_tenant:c.tenant_id,p_campaign:c.id,p_actor:c.operator_id,p_operation:'queue',p_version:c.asset_version,p_body:{leadId:review.lead_id,startAt:new Date(Date.now()+5000).toISOString()}});
     if(!ack||!Array.isArray(ack.actionIds)||!ack.actionIds.length||ack.actionIds.length>3||new Set(ack.actionIds).size!==ack.actionIds.length||ack.actionIds.some((id:unknown)=>typeof id!=='string'||!uuid.test(id))||typeof ack.replayed!=='boolean')throw Error('Enrolment acknowledgement uncertain');
     if(ack.replayed)report.existing++;else report.enrolled++;
    }catch(e) {
     if(e instanceof DbError&&(e.isConflict||e.body.includes('22023')||e.body.includes('23514')||e.body.includes('42501'))){report.blocked++;continue;}
     // Unknown completion may have committed. Stop this campaign, not another enrolment attempt.
     report.review++;
     enrolmentUncertain=true;
     await db().rpc('manage_campaign_plan',{p_tenant:c.tenant_id,p_campaign:c.id,p_actor:c.operator_id,p_operation:'pause',p_version:c.asset_version,p_body:{}}).catch(()=>{});
     break;
    }
   }
   if(enrolmentUncertain)continue;
   if(!available()){report.limited=true;break;}
   const due=await db().select<Action>('outbound_actions',`tenant_id=eq.${c.tenant_id}&campaign_id=eq.${c.id}&state=eq.queued&due_at=lte.${new Date().toISOString()}&select=${actionFields}&order=due_at,message_step,id&limit=${limits.dispatches+1}`);
   // Do not quietly act on a truncated work set. Operator can narrow to one campaign.
   if(due.length>limits.dispatches){report.blocked++;report.limited=true;continue;}
   for(const a of due) {
    if(!available()||dispatchAttempts>=limits.dispatches){report.limited=true;break;}
    if(a.tenant_id!==c.tenant_id||a.campaign_id!==c.id||a.state!=='queued'||!uuid.test(a.id)||!validInstant(a.due_at)||Date.parse(a.due_at)>Date.now()){report.blocked++;continue;}
    dispatchAttempts++;
    const result=await executeSyntheticAction(db(),env,a.id,c.tenant_id);
    if(result.ok) {
     const ack=await result.json() as any;
     if(ack.ok===true&&ack.state==='tested'&&ack.action_id===a.id)report.tested++;
     else {report.review++;break;}
    }else if(result.status===503){report.review++;break;}
    else report.blocked++;
   }
  }
 }catch {
  // Reports contain no provider/database text, private source material, identities or tokens.
  report.review++;
 }
 return report;
}

/** Staff entry point; background execution calls the same bounded routine without a browser token. */
export async function runReviveAutomationAdmin(req:Request,env:Env,tenantId:string) {
 await requireUser(req,env,true);
 if(!uuid.test(tenantId))return bad('Invalid client account.');
 if(env.REVIVE_AUTOMATION_ENABLED!=='true'||env.SYNTHETIC_SINK_ENABLED!=='true')return bad('Revive automation is disabled in this environment.',403);
 return json({ok:true,...await runReviveAutomation(env,{tenantId})});
}
