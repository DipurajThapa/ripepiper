import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,requireTenant} from '../routes/http';
import {executeSyntheticAction} from './action-reliability';
import {validInstant} from './prospecting';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limits={campaigns:10,reviews:25,actionsPerCampaign:100,enrolments:10,dispatches:20,milliseconds:15000};
type Scope={tenantId?:string;campaignId?:string};
type Campaign={id:string;tenant_id:string;operator_id:string;capability:string;status:string;asset_version:number;envelope_version?:number|null};
type Action={id:string;tenant_id:string;campaign_id:string;lead_id:string;state:string;due_at:string;lease_until:string|null;dispatch_token:string|null;asset_version:number};
type AudienceMember={leadId:string;reviewVersion:number;snapshot:string};
function reviewedMembers(value:any):AudienceMember[]|null {
 if(!value||typeof value!=='object'||!Array.isArray(value.members)||value.members.length<1||value.members.length>limits.reviews||!uuid.test(value.reviewedBy??'')||!validInstant(value.reviewedAt)||Date.parse(value.reviewedAt)>Date.now())return null;
 if(value.members.some((m:any)=>!m||!uuid.test(m.leadId??'')||!Number.isInteger(m.reviewVersion)||m.reviewVersion<1||typeof m.snapshot!=='string'||!/^[a-f0-9]{32}$/.test(m.snapshot))||new Set(value.members.map((m:AudienceMember)=>m.leadId)).size!==value.members.length)return null;
 return value.members;
}
const actionFields='id,tenant_id,campaign_id,lead_id,state,due_at,lease_until,dispatch_token,asset_version';

/** Existing ledger only: no real provider, contact right or learned rule. Approval comes only from an effective client-approved envelope (SQL). */
export async function runReviveAutomation(env:Env,scope:Scope={}) {
 const report={enabled:env.REVIVE_AUTOMATION_ENABLED==='true'&&env.SYNTHETIC_SINK_ENABLED==='true',
  delivery:'not_sent' as const,campaigns:0,approved:0,escalated:0,stopped:0,enrolled:0,tested:0,blocked:0,review:0,existing:0,limited:false};
 // A normal deployment/configuration cannot accidentally start this routine.
 if(!report.enabled)return {...report,disabled:true};
 if((scope.tenantId!==undefined&&!uuid.test(scope.tenantId))||(scope.campaignId!==undefined&&!uuid.test(scope.campaignId)))return {...report,blocked:1};
 const deadline=Date.now()+limits.milliseconds;
 let dispatchAttempts=0;
 const available=()=>Date.now()<deadline;
 // Per-operation timeout is at most two seconds and never exceeds the remaining run budget.
 const db=()=>new Db(env,Math.max(1,Math.min(2000,deadline-Date.now())));
 try {
  await approveWithinEnvelopes(db,scope,report,available);
  const campaigns=await db().select<Campaign>('campaigns',`capability=eq.revive&status=eq.approved${scope.tenantId?`&tenant_id=eq.${scope.tenantId}`:''}${scope.campaignId?`&id=eq.${scope.campaignId}`:''}&select=id,tenant_id,operator_id,capability,status,asset_version,envelope_version&order=id&limit=${limits.campaigns+1}`);
  if(campaigns.length>limits.campaigns)return {...report,blocked:1,limited:true};
  for(const c of campaigns) {
   if(!available()){report.limited=true;break;}
   if(!uuid.test(c.id)||!uuid.test(c.tenant_id)||!uuid.test(c.operator_id)||c.capability!=='revive'||c.status!=='approved'||!Number.isInteger(c.asset_version)||c.asset_version<1||(scope.tenantId&&c.tenant_id!==scope.tenantId)||(scope.campaignId&&c.id!==scope.campaignId)){report.blocked++;continue;}
   if(!await db().one('tenants',`id=eq.${c.tenant_id}&status=eq.active&select=id`)){report.blocked++;continue;}
   report.campaigns++;
   // Campaign-level stop conditions pause before any further work; a stopped campaign is never resumed here.
   if(c.envelope_version!=null){
    const stop=await db().rpc<any>('enforce_envelope_stop_conditions',{p_tenant:c.tenant_id,p_campaign:c.id});
    if(stop?.campaignId!==c.id||typeof stop.paused!=='boolean'){report.review++;continue;}
    if(stop.paused){report.stopped++;continue;}
   }
   // Current-version work plus any claim still in flight; older-version history is the database's restart check.
   const ledger=(filter:string)=>db().select<Action>('outbound_actions',`tenant_id=eq.${c.tenant_id}&campaign_id=eq.${c.id}&${filter}&select=${actionFields}&order=message_step,id&limit=${limits.actionsPerCampaign+1}`);
   const actions=[...await ledger(`asset_version=eq.${c.asset_version}`),...await ledger(`asset_version=neq.${c.asset_version}&state=eq.claimed`)];
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
   const asset=await db().one<any>('campaign_assets',`tenant_id=eq.${c.tenant_id}&campaign_id=eq.${c.id}&version=eq.${c.asset_version}&select=tenant_id,campaign_id,version,revive_audience`);
   if(Array.isArray(asset?.revive_audience?.members)&&asset.revive_audience.members.length>limits.reviews)report.limited=true;
   const members=asset&&asset.tenant_id===c.tenant_id&&asset.campaign_id===c.id&&asset.version===c.asset_version?reviewedMembers(asset.revive_audience):null;
   if(!members){report.blocked++;continue;}
   let enrolmentUncertain=false;
   for(const member of members) {
    if(!available()||report.enrolled>=limits.enrolments){report.limited=true;break;}
    if(actions.some(a=>a.lead_id===member.leadId&&a.asset_version===c.asset_version)){report.existing++;continue;}
    // Enrolments on this version are never rescheduled. Older-version history is the database's call:
    // only work cancelled by pause or edit resumes. It rechecks review, brief, rights, caps and stops atomically.
    try {
     const ack=await db().rpc<any>('manage_campaign_plan',{p_tenant:c.tenant_id,p_campaign:c.id,p_actor:c.operator_id,p_operation:'queue',p_version:c.asset_version,p_body:{leadId:member.leadId,startAt:new Date(Date.now()+5000).toISOString()}});
     if(!ack||!Array.isArray(ack.actionIds)||!ack.actionIds.length||ack.actionIds.length>3||new Set(ack.actionIds).size!==ack.actionIds.length||ack.actionIds.some((id:unknown)=>typeof id!=='string'||!uuid.test(id))||typeof ack.replayed!=='boolean')throw Error('Enrolment acknowledgement uncertain');
     if(ack.replayed)report.existing++;else report.enrolled++;
    }catch(e) {
     // 40001 (e.g. 'Existing enrolment cannot restart') aborted the transaction, so nothing committed.
     if(e instanceof DbError&&(e.isConflict||e.body.includes('22023')||e.body.includes('23514')||e.body.includes('42501')||e.body.includes('40001'))){report.blocked++;continue;}
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
   // Work the deterministic oldest prefix; later runs pick up the remainder instead of stalling the campaign.
   if(due.length>limits.dispatches){report.limited=true;due.length=limits.dispatches;}
   for(const a of due) {
    if(!available()||dispatchAttempts>=limits.dispatches){report.limited=true;break;}
    if(a.tenant_id!==c.tenant_id||a.campaign_id!==c.id||a.state!=='queued'||!uuid.test(a.id)||!members.some(m=>m.leadId===a.lead_id)||!validInstant(a.due_at)||Date.parse(a.due_at)>Date.now()){report.blocked++;continue;}
    const readiness=await db().rpc<any>('revive_action_readiness',{p_tenant:c.tenant_id,p_id:a.id,p_now:new Date().toISOString()});
    if(!readiness||readiness.tenantId!==c.tenant_id||readiness.actionId!==a.id||readiness.campaignId!==c.id||readiness.assetVersion!==c.asset_version||!['ready','wait','expired'].includes(readiness.disposition)||!['working_window','strategy_changed','missed_local_day','not_due','outside_working_window','daily_capacity'].includes(readiness.reason)){report.review++;break;}
    // Closed windows are temporary, without claiming/rescheduling or consuming a send attempt.
    if(readiness.disposition==='wait')continue;
    dispatchAttempts++;
    const result=await executeSyntheticAction(db(),env,a.id,c.tenant_id);
    if(readiness.disposition==='expired'){report.review++;continue;}
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

/** Drafts of tenants with a client-approved, unrevoked, unexpired envelope; SQL re-checks every bound and escalates the rest. */
async function approveWithinEnvelopes(db:()=>Db,scope:Scope,report:{approved:number;escalated:number;review:number;limited:boolean},available:()=>boolean){
 // Unreadable envelope state approves nothing this tick (fail closed); the ledger reads below report any outage.
 const envelopes=await db().select<{tenant_id:string}>('operating_envelopes',`client_approved_at=not.is.null&revoked_at=is.null&expires_at=gt.${new Date().toISOString()}${scope.tenantId?`&tenant_id=eq.${scope.tenantId}`:''}&select=tenant_id&order=tenant_id&limit=${limits.campaigns+1}`).catch(()=>[]);
 const tenants=[...new Set(envelopes.map(e=>e.tenant_id))].filter(t=>uuid.test(t));
 if(!tenants.length)return;
 const drafts=await db().select<Campaign>('campaigns',`capability=eq.revive&status=eq.draft&tenant_id=in.(${tenants.join(',')})${scope.campaignId?`&id=eq.${scope.campaignId}`:''}&select=id,tenant_id,capability,status,asset_version&order=id&limit=${limits.campaigns+1}`);
 if(drafts.length>limits.campaigns){report.limited=true;drafts.length=limits.campaigns;}
 for(const d of drafts){
  if(!available()){report.limited=true;break;}
  if(!uuid.test(d.id)||!tenants.includes(d.tenant_id)||d.capability!=='revive'||d.status!=='draft'||!Number.isInteger(d.asset_version)||d.asset_version<1)continue;
  try{
   const r=await db().rpc<any>('approve_campaign_within_envelope',{p_tenant:d.tenant_id,p_campaign:d.id,p_version:d.asset_version});
   if(r?.campaignId===d.id&&r.status==='approved'&&r.by==='envelope')report.approved++;
   else if(r?.campaignId===d.id&&r.status==='escalated')report.escalated++;
   else report.review++;
  }catch(e){
   // A concurrent edit (40001) is picked up next tick; anything else is reported, never retried here.
   if(!(e instanceof DbError&&e.body.includes('40001')))report.review++;
  }
 }
}

/** Staff entry point; background execution calls the same bounded routine without a browser token. */
export async function runReviveAutomationAdmin(req:Request,env:Env,tenantId:string) {
 await requireTenant(req,env,tenantId,'operate');
 if(!uuid.test(tenantId))return bad('Invalid client account.');
 if(env.REVIVE_AUTOMATION_ENABLED!=='true'||env.SYNTHETIC_SINK_ENABLED!=='true')return bad('Revive automation is disabled in this environment.',403);
 return json({ok:true,...await runReviveAutomation(env,{tenantId})});
}
