import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index';
import type {Env} from '../src/env';
import {seedReviveSetup,strategyBody} from './helpers/revive-setup';
import {asOperator} from './helpers/access';
// Disposable PostgreSQL and intercepted HTTP only; unexpected endpoints throw.
const staff='cd114378-1c4b-4be2-a0fa-cd1285f35229';
const env={SUPABASE_URL:'https://bindings-qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-public',SYNTHETIC_SINK_ENABLED:'true'} as Env;
let db:PGlite;
async function rows(sql:string,args:any[]=[]){return (await db.query<any>(sql,args)).rows;}
async function service(name:string,args:any[]){await db.exec('set role service_role');try{return (await rows(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) value`,args))[0].value;}finally{await db.exec('reset role');}}
function intercept(){vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
 const url=new URL(input);if(url.origin!==env.SUPABASE_URL)throw Error('External network forbidden');
 if(url.pathname==='/auth/v1/user')return Response.json({id:staff,email:'bindings-staff@example.invalid'});
 if(url.pathname==='/rest/v1/profiles')return Response.json([{id:staff,is_admin:true}]);
 if(url.pathname.startsWith('/rest/v1/rpc/')){try{const name=url.pathname.split('/').at(-1)!,args=JSON.parse(String(init.body)),keys=Object.keys(args);if(!/^[a-z_]+$/.test(name)||keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Unexpected RPC identifier');await db.exec('set role service_role');try{return Response.json((await rows(`select public.${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')}) value`,Object.values(args)))[0].value);}finally{await db.exec('reset role');}}catch(e:any){return Response.json({code:e.code,message:e.message},{status:400});}}
 const table=url.pathname.replace('/rest/v1/','');
 if(['tenants','campaigns','campaign_assets','outbound_actions'].includes(table)&&(!init.method||init.method==='GET')){
  const values:any[]=[],where:string[]=[];
  for(const [key,value] of url.searchParams){if(['select','order','limit'].includes(key))continue;if(!/^[a-z_]+$/.test(key))throw Error('Unexpected filter');const i=value.indexOf('.'),operator=({eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='} as Record<string,string>)[value.slice(0,i)];if(!operator)throw Error('Unexpected operator');values.push(value.slice(i+1));where.push(`${key}${operator}$${values.length}`);}
  const order=(url.searchParams.get('order')??'').split(',').filter(Boolean).map(part=>{if(!/^[a-z_]+(\.(asc|desc))?$/.test(part))throw Error('Unexpected ordering');return part.replace('.',' ');});
  return Response.json(await rows(`select * from ${table}${where.length?' where '+where.join(' and '):''}${order.length?' order by '+order.join(','):''} limit ${Math.min(Number(url.searchParams.get('limit')??100),1001)}`,values));
 }
 throw Error('Unexpected database/provider endpoint '+url.pathname);
});}
async function http(tenant:string,body:any){intercept();return worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${tenant}/campaigns`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer qa-staff'},body:JSON.stringify(body)}),env,{} as ExecutionContext);}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
 await rows("insert into auth.users(id,email,email_confirmed_at) values($1,'bindings-staff@example.invalid',now())",[staff]);await rows('update profiles set is_admin=true where id=$1',[staff]);intercept();
});
afterAll(async()=>{vi.unstubAllGlobals();await db.close();});
async function setup(){
 const tenant=(await rows("insert into tenants(name,slug,country,currency,status) values('QA Bindings',$1,'AE','AED','active') returning id",[crypto.randomUUID()]))[0].id;
 await asOperator(db,{tenantId:tenant,profileId:staff});
 const observedAt=new Date(Date.now()-3600000).toISOString(),brief={offer:'Reviewed enquiry follow-up',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up','pipeline visibility'],excludedIndustries:['gambling'],maxAgeDays:90,source:{reference:'qa-interview',excerpt:'Reviewed business targets',observedAt}};
 await service('save_business_brief',[tenant,0,brief,staff]);const seeded=await seedReviveSetup(db,tenant,staff,{senderName:'QA Owner'});const contacts=[] as Array<{lead:string;source:string}>;
 // Use the SAME supported need for both contacts so audience denial cannot
 // accidentally pass merely because the new strategy rejects a different need.
 for(const need of [brief.needs[0],brief.needs[0]]){
  const lead=(await rows("insert into leads(tenant_id,source,email) values($1,'import',$2) returning id",[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
  const source=(await rows(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'staff_import',$3,$4,'review','QA source rights',true,$5,$6,$7) returning id`,[tenant,lead,crypto.randomUUID(),observedAt,{industry:'construction',market:'AE',role:'owner',need},`construction AE owner ${need}`,staff]))[0].id;
  await service('record_product_event',[tenant,lead,staff,crypto.randomUUID(),'QA history rights','Reviewed previous interest',observedAt,true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-80*86400000).toISOString(),previousInterest:'yes',stalledReason:'Deferred review'}]);
  const context=await service('revive_review_context',[tenant,lead,staff]);await service('review_revive_candidate',[tenant,lead,staff,0,context.snapshot,1,'accepted','QA reviewed relationship and fit',new Date(Date.now()+86400000).toISOString()]);contacts.push({lead,source});
 }
 return {tenant,contacts,brief,setupVersion:seeded.setup.version,strategy:seeded.strategy};
}
async function draft(f:Awaited<ReturnType<typeof setup>>){const contact=f.contacts[0],response=await http(f.tenant,{operation:'draft',body:{leadId:contact.lead,sourceId:contact.source,messageCount:1,senderName:'QA Owner'}});expect(response.status).toBe(200);const data=await response.json() as any;return {campaign:crypto.randomUUID(),body:{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',strategy:f.strategy,steps:data.proposal.steps,draftContext:data.proposal.draftContext,audience:{leadIds:[contact.lead],confirmed:true}}};}
async function counts(tenant:string){return (await rows(`select (select count(*) from campaigns where tenant_id=$1)::int campaigns,(select count(*) from campaign_assets where tenant_id=$1)::int assets,(select count(*) from outbound_actions where tenant_id=$1)::int actions,(select count(*) from activity_log where tenant_id=$1)::int audit`,[tenant]))[0];}
async function ignoredSource(f:Awaited<ReturnType<typeof setup>>){return (await rows(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'staff_import',$3,now()-interval '1 minute','review','QA reviewed unrelated rights',true,'{}','Unrelated administrative note',$4) returning id`,[f.tenant,f.contacts[0].lead,crypto.randomUUID(),staff]))[0].id;}
it('Worker rejects swapping a generated source to an ignored same-contact note with zero save effects',async()=>{
 const f=await setup(),p=await draft(f),original=p.body.draftContext,other=await ignoredSource(f);expect((await service('revive_review_context',[f.tenant,f.contacts[0].lead,staff])).snapshot).toBe(original.snapshot);p.body.draftContext={...original,sourceId:other};const before=await counts(f.tenant);
 const r=await http(f.tenant,{operation:'save',campaign_id:p.campaign,version:0,body:p.body});expect(r.status).toBe(409);expect(await counts(f.tenant)).toEqual(before);
});
it('SQL rejects the source substitution when a caller bypasses Worker validation',async()=>{
 const f=await setup(),p=await draft(f);p.body.draftContext.sourceId=await ignoredSource(f);const before=await counts(f.tenant);await expect(service('save_reviewed_revive_draft',[f.tenant,p.campaign,staff,0,p.body])).rejects.toThrow();expect(await counts(f.tenant)).toEqual(before);
});
const approval=()=>({clientAuthority:'QA client authority',ownerAuthority:'QA owner authority',ctsProfile:'QA reviewed profile',maxActions:10,expiresAt:new Date(Date.now()+7*86400000).toISOString()});
async function campaign(f:Awaited<ReturnType<typeof setup>>,memberIndex=0){
 const id=crypto.randomUUID(),body={product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',strategy:strategyBody(f.setupVersion,f.brief.needs[0],f.brief.source.reference),steps:[{offsetHours:0,subject:'Reviewed lead follow-up',body:'Is the reviewed need still relevant?',evidenceReference:'qa-business-brief'}],audience:{leadIds:[f.contacts[memberIndex].lead],confirmed:true}};
 await service('manage_campaign_plan',[f.tenant,id,staff,'save',0,body]);await service('manage_campaign_plan',[f.tenant,id,staff,'approve',1,approval()]);for(const contact of f.contacts)await service('manage_campaign_plan',[f.tenant,id,staff,'rights',1,{leadId:contact.lead,sourceId:contact.source,noticeReference:'QA synthetic rights'}]);return {id,body};
}
it('rejects enrolment outside campaign audience despite global acceptance and scoped rights',async()=>{
 const f=await setup(),c=await campaign(f),before=await counts(f.tenant);await expect(service('manage_campaign_plan',[f.tenant,c.id,staff,'queue',1,{leadId:f.contacts[1].lead,startAt:new Date(Date.now()+1000).toISOString()}])).rejects.toThrow();expect(await counts(f.tenant)).toEqual(before);
});
async function dueAfter(id:string){return new Date(Date.parse((await rows('select due_at from outbound_actions where id=$1',[id]))[0].due_at)+1000).toISOString();}
async function tamper(f:Awaited<ReturnType<typeof setup>>,id:string){const other=(await rows('select * from revive_reviews where tenant_id=$1 and lead_id=$2',[f.tenant,f.contacts[1].lead]))[0];await rows('update outbound_actions set lead_id=$1,revive_review_version=$2,revive_review_snapshot=$3 where id=$4',[other.lead_id,other.version,other.snapshot,id]);}
it('rechecks campaign membership at claim for a tampered legacy row',async()=>{
 const f=await setup(),c=await campaign(f),at=new Date(Date.now()+3000).toISOString(),queued=await service('manage_campaign_plan',[f.tenant,c.id,staff,'queue',1,{leadId:f.contacts[0].lead,startAt:new Date(Date.now()+1000).toISOString()}]);
 try{await tamper(f,queued.actionIds[0]);}catch{expect((await rows('select lead_id from outbound_actions where id=$1',[queued.actionIds[0]]))[0].lead_id).toBe(f.contacts[0].lead);return;}
 expect(await service('claim_fenced_synthetic_action',[f.tenant,queued.actionIds[0],crypto.randomUUID(),await dueAfter(queued.actionIds[0])])).toBeNull();expect((await rows('select state from outbound_actions where id=$1',[queued.actionIds[0]]))[0].state).toBe('blocked');
});
it('rechecks campaign membership at completion after a successful claim',async()=>{
 const f=await setup(),c=await campaign(f),at=new Date(Date.now()+3000).toISOString(),token=crypto.randomUUID(),queued=await service('manage_campaign_plan',[f.tenant,c.id,staff,'queue',1,{leadId:f.contacts[0].lead,startAt:new Date(Date.now()+1000).toISOString()}]);expect(await service('claim_fenced_synthetic_action',[f.tenant,queued.actionIds[0],token,await dueAfter(queued.actionIds[0])])).toMatchObject({token});
 try{await tamper(f,queued.actionIds[0]);}catch{expect((await rows('select lead_id from outbound_actions where id=$1',[queued.actionIds[0]]))[0].lead_id).toBe(f.contacts[0].lead);return;}
 expect(await service('complete_fenced_synthetic_action',[f.tenant,queued.actionIds[0],token,1,1,await dueAfter(queued.actionIds[0])])).toBe(false);expect((await rows('select state from outbound_actions where id=$1',[queued.actionIds[0]]))[0].state).not.toBe('tested');
});
it('preserves positive edited draft save and replay without approval, rights or actions',async()=>{
 const f=await setup(),p=await draft(f);p.body.steps[0].body+='\nHuman-reviewed edit.';
 const saved=await http(f.tenant,{operation:'save',campaign_id:p.campaign,version:0,body:p.body});expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({status:'draft',version:1,delivery:'not_sent'});
 const before=await counts(f.tenant);expect(await service('save_reviewed_revive_draft',[f.tenant,p.campaign,staff,0,p.body])).toMatchObject({version:1,status:'draft'});expect(await counts(f.tenant)).toEqual(before);
 expect((await rows('select approved_by from campaign_assets where campaign_id=$1',[p.campaign]))[0].approved_by).toBeNull();expect(await rows('select id from contact_rights where tenant_id=$1',[f.tenant])).toHaveLength(0);expect(before.actions).toBe(0);
});
it('requires a new version and approval when only the reviewed campaign audience changes',async()=>{
 const f=await setup(),c=await campaign(f),start=new Date(Date.now()+1000).toISOString();const queued=await service('manage_campaign_plan',[f.tenant,c.id,staff,'queue',1,{leadId:f.contacts[0].lead,startAt:start}]);
 const changed={...c.body,audience:{leadIds:[f.contacts[1].lead],confirmed:true},strategy:{...c.body.strategy,canonicalNeed:f.brief.needs[0]}};
 expect(await service('manage_campaign_plan',[f.tenant,c.id,staff,'save',1,changed])).toMatchObject({id:c.id,status:'draft',version:2});
 expect((await rows('select state from outbound_actions where id=$1',[queued.actionIds[0]]))[0].state).toBe('cancelled');
 await expect(service('manage_campaign_plan',[f.tenant,c.id,staff,'queue',1,{leadId:f.contacts[0].lead,startAt:start}])).rejects.toThrow();
 expect(await service('claim_fenced_synthetic_action',[f.tenant,queued.actionIds[0],crypto.randomUUID(),new Date(Date.now()+3000).toISOString()])).toBeNull();
 const original=(await rows('select revive_audience from campaign_assets where campaign_id=$1 and version=1',[c.id]))[0].revive_audience;
 expect(original.members.map((m:any)=>m.leadId)).toEqual([f.contacts[0].lead]);
});
it('does not let review replacement or suppression revive an old audience enrolment',async()=>{
 const f=await setup(),c=await campaign(f),start=new Date(Date.now()+1000).toISOString(),queued=await service('manage_campaign_plan',[f.tenant,c.id,staff,'queue',1,{leadId:f.contacts[0].lead,startAt:start}]);
 const current=await service('revive_review_context',[f.tenant,f.contacts[0].lead,staff]);await service('review_revive_candidate',[f.tenant,f.contacts[0].lead,staff,1,current.snapshot,1,'accepted','QA new explicit review',new Date(Date.now()+86400000).toISOString()]);
 await expect(service('manage_campaign_plan',[f.tenant,c.id,staff,'queue',1,{leadId:f.contacts[0].lead,startAt:start}])).rejects.toThrow();
 expect(await service('claim_fenced_synthetic_action',[f.tenant,queued.actionIds[0],crypto.randomUUID(),new Date(Date.now()+3000).toISOString()])).toBeNull();
 const other=await setup(),d=await campaign(other),due=new Date(Date.now()+1000).toISOString(),action=(await service('manage_campaign_plan',[other.tenant,d.id,staff,'queue',1,{leadId:other.contacts[0].lead,startAt:due}])).actionIds[0],token=crypto.randomUUID(),at=new Date(Date.now()+3000).toISOString();
 expect(await service('claim_fenced_synthetic_action',[other.tenant,action,token,await dueAfter(action)])).toMatchObject({token});await rows("insert into lead_suppression(tenant_id,lead_id,reason) values($1,$2,'QA opt-out')",[other.tenant,other.contacts[0].lead]);expect(await service('complete_fenced_synthetic_action',[other.tenant,action,token,1,1,await dueAfter(action)])).toBe(false);
});
it('rejects foreign, duplicate and unconfirmed audience membership without partial saves',async()=>{
 const f=await setup(),foreign=await setup();
 for(const audience of [{leadIds:[foreign.contacts[0].lead],confirmed:true},{leadIds:[f.contacts[0].lead,f.contacts[0].lead],confirmed:true},{leadIds:[f.contacts[0].lead],confirmed:false}]){
  const c=crypto.randomUUID(),before=await counts(f.tenant);await expect(service('manage_campaign_plan',[f.tenant,c,staff,'save',0,{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'QA',body:'Reviewed copy',evidenceReference:'QA'}],audience}])).rejects.toThrow();expect(await counts(f.tenant)).toEqual(before);
 }
});
it('keeps audience-free manual Revive drafts unapproved and unqueued',async()=>{
 const f=await setup(),c=crypto.randomUUID();await service('manage_campaign_plan',[f.tenant,c,staff,'save',0,{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'QA',body:'Reviewed copy',evidenceReference:'QA'}]}]);
 await expect(service('manage_campaign_plan',[f.tenant,c,staff,'approve',1,approval()])).rejects.toThrow();expect((await rows('select status from campaigns where id=$1',[c]))[0].status).toBe('draft');
});
it('binds the exact original source even when a substitute also supports the same canonical need',async()=>{
 const f=await setup();const source=(await rows(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) select tenant_id,lead_id,source,$2,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by from lead_observations where id=$1 returning id`,[f.contacts[0].source,crypto.randomUUID()]))[0].id;
 const context=await service('revive_review_context',[f.tenant,f.contacts[0].lead,staff]);await service('review_revive_candidate',[f.tenant,f.contacts[0].lead,staff,1,context.snapshot,1,'accepted','Reviewed second equivalent source',new Date(Date.now()+86400000).toISOString()]);
 const p=await draft(f);p.body.draftContext.sourceId=source;const before=await counts(f.tenant);const response=await http(f.tenant,{operation:'save',campaign_id:p.campaign,version:0,body:p.body});expect(response.status).toBe(409);await expect(service('save_reviewed_revive_draft',[f.tenant,p.campaign,staff,0,p.body])).rejects.toThrow();expect(await counts(f.tenant)).toEqual(before);
});
it('rejects a known proposal receipt with a modified canonical need',async()=>{
 const f=await setup(),p=await draft(f);expect(p.body.draftContext.proposalId).toMatch(/^[1-9][0-9]{0,18}$/);p.body.draftContext.canonicalNeed='pipeline visibility';const before=await counts(f.tenant);await expect(service('save_reviewed_revive_draft',[f.tenant,p.campaign,staff,0,p.body])).rejects.toThrow();expect(await counts(f.tenant)).toEqual(before);
});
it('denies authenticated admin receipt forging, rewriting, relabelling and deletion',async()=>{
 const f=await setup(),p=await draft(f),receipt=(await rows("select * from activity_log where tenant_id=$1 and message::jsonb->>'kind'='revive_draft_proposed'",[f.tenant]))[0];expect(receipt).toBeTruthy();
 await db.exec('set role authenticated');await rows("select set_config('request.jwt.sub',$1,false)",[staff]);
 // Hybrid RLS is select-only for staff: the insert is refused, and updates/deletes either raise or match no row; the unchanged receipt below is the proof.
 try{await expect(rows("insert into activity_log(tenant_id,actor,kind,message,visible_to_client) values($1,$2,'note',$3,false)",[f.tenant,staff,receipt.message])).rejects.toThrow();
  for(const [sql,args] of [
  ['update activity_log set message=$1 where id=$2',[JSON.stringify({...JSON.parse(receipt.message),context:p.body.draftContext}),receipt.id]],
  ["update activity_log set message='ordinary note' where id=$1",[receipt.id]],
  ['delete from activity_log where id=$1',[receipt.id]],
 ] as Array<[string,any[]]>)await rows(sql,args).catch(()=>undefined);}finally{await db.exec('reset role');}
 expect((await rows('select message from activity_log where id=$1',[receipt.id]))[0].message).toBe(receipt.message);
});
it('does not let a subsequent campaign edit drop a persisted generated-draft binding',async()=>{
 const f=await setup(),p=await draft(f);expect((await http(f.tenant,{operation:'save',campaign_id:p.campaign,version:0,body:p.body})).status).toBe(200);
 const {draftContext,...untagged}=p.body;untagged.steps=untagged.steps.map((s:any)=>({...s,body:s.body+'\nAnother edit.'}));const before=await counts(f.tenant);
 const denied=await http(f.tenant,{operation:'save',campaign_id:p.campaign,version:1,body:untagged});expect([400,409]).toContain(denied.status);
 await expect(service('manage_campaign_plan',[f.tenant,p.campaign,staff,'save',1,untagged])).rejects.toThrow();expect(await counts(f.tenant)).toEqual(before);expect((await rows('select asset_version from campaigns where id=$1',[p.campaign]))[0].asset_version).toBe(1);
});
it('keeps proposal receipts scoped to the original account and administrator',async()=>{
 const f=await setup(),p=await draft(f),foreign=await setup(),other=crypto.randomUUID();
 await rows('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[other,other+'@example.invalid']);await rows('update profiles set is_admin=true where id=$1',[other]);
 for(const [tenant,actor] of [[foreign.tenant,staff],[f.tenant,other]]){const before=await counts(tenant);await expect(service('save_reviewed_revive_draft',[tenant,crypto.randomUUID(),actor,0,p.body])).rejects.toThrow();expect(await counts(tenant)).toEqual(before);}
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await expect(rows('select record_revive_draft_proposal($1,$2,$3)',[f.tenant,staff,p.body.draftContext])).rejects.toThrow(/permission/);await expect(rows('select build_revive_audience($1,$2,$3)',[f.tenant,staff,p.body.audience])).rejects.toThrow(/permission/);}finally{await db.exec('reset role');}}
});
it('enforces the reviewed audience on direct service inserts and preserves immutable asset membership',async()=>{
 const f=await setup(),c=await campaign(f),before=await counts(f.tenant);
 await db.exec('set role service_role');try{await expect(rows(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,message_step) values($1,$2,$3,$4,1,1,now()+interval '1 second',0)`,[f.tenant,c.id,f.contacts[1].lead,crypto.randomUUID()])).rejects.toThrow();}finally{await db.exec('reset role');}
 expect(await counts(f.tenant)).toEqual(before);const asset=(await rows('select revive_audience from campaign_assets where campaign_id=$1',[c.id]))[0].revive_audience;
 const forged={...asset,members:[{...asset.members[0],leadId:f.contacts[1].lead}]};await expect(rows('update campaign_assets set revive_audience=$1 where campaign_id=$2',[forged,c.id])).rejects.toThrow();expect((await rows('select revive_audience from campaign_assets where campaign_id=$1',[c.id]))[0].revive_audience).toEqual(asset);
});
it('actual Worker coordinator enrols only each campaign reviewed audience in the real local SQL ledger',async()=>{
 const f=await setup(),first=await campaign(f,0),second=await campaign(f,1);intercept();
 const run=()=>worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${f.tenant}/revive-run`,{method:'POST',headers:{Authorization:'Bearer qa-staff'},body:'{}'}),{...env,REVIVE_AUTOMATION_ENABLED:'true'},{} as ExecutionContext);
 const response=await run();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({enrolled:2,tested:0,review:0,delivery:'not_sent'});
 const actions=await rows('select campaign_id,lead_id,state from outbound_actions where tenant_id=$1 order by campaign_id',[f.tenant]);expect(actions).toHaveLength(2);
 expect(actions.find(a=>a.campaign_id===first.id)).toMatchObject({lead_id:f.contacts[0].lead,state:'queued'});expect(actions.find(a=>a.campaign_id===second.id)).toMatchObject({lead_id:f.contacts[1].lead,state:'queued'});
 expect(await (await run()).json()).toMatchObject({enrolled:0,tested:0,existing:2,review:0});expect(await rows('select id from outbound_actions where tenant_id=$1',[f.tenant])).toHaveLength(2);
});
