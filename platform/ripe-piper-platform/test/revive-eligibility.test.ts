import {seedReviveSetup} from './helpers/revive-setup';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index';
import {assessRevive,type ReviveContext} from '../src/foundation/revive';
import type {Env} from '../src/env';
const actor='00000000-0000-4000-8000-000000000001';
const env={SUPABASE_URL:'https://revive-db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',SUPABASE_ANON_KEY:'fixture-public',SYNTHETIC_SINK_ENABLED:'true'} as Env;
let db:PGlite;
const q=async(sql:string,args:any[]=[])=> (await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;}finally{await db.exec('reset role');}}
function mockApi(){vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
 const u=new URL(input);if(u.origin!==env.SUPABASE_URL)throw Error('External network forbidden');
 if(u.pathname==='/auth/v1/user')return Response.json({id:actor,email:'staff@example.invalid'});
 if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);
 if(u.pathname.startsWith('/rest/v1/rpc/')){const name=u.pathname.split('/').at(-1)!;try{return Response.json(await (async()=>{const b=JSON.parse(String(init.body));await db.exec('set role service_role');try{return (await q(`select public.${name}(${Object.keys(b).map((k,i)=>k+'=> $'+(i+1)).join(',')}) value`,Object.values(b)))[0].value;}finally{await db.exec('reset role');}})());}catch(e:any){return Response.json({code:e.code,message:e.message},{status:400});}}
 const table=u.pathname.replace('/rest/v1/','');
 if(['campaigns','tenants','outbound_actions','revive_reviews','leads','campaign_assets'].includes(table)&&(!init.method||init.method==='GET')){
  const values:any[]=[],where:string[]=[];
  for(const [field,value] of u.searchParams){
   if(['select','order','limit'].includes(field))continue;
   if(!/^[a-z_]+$/.test(field))throw Error('Unexpected fixture query');
   const i=value.indexOf('.'),operator={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[value.slice(0,i)];
   if(!operator)throw Error('Unexpected fixture operator');values.push(value.slice(i+1));where.push(`${field}${operator}$${values.length}`);
  }
  const order=(u.searchParams.get('order')??'').split(',').filter(Boolean).map(term=>{if(!/^[a-z_]+(\.(asc|desc))?$/.test(term))throw Error('Unexpected fixture order');return term.replace('.',' ');});
  return Response.json(await q(`select * from ${table}${where.length?' where '+where.join(' and '):''}${order.length?' order by '+order.join(','):''} limit ${Math.min(Number(u.searchParams.get('limit')??100),1001)}`,values));
 }
 throw Error('Unexpected database/provider endpoint');
});}
const call=async(tenant:string,body:any,token='fixture-staff')=>worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${tenant}/revive-review`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}),env,{} as ExecutionContext);
async function fixture(){
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('Revive fixture',$1,'AE','AED','active') returning id`,[crypto.randomUUID()]))[0].id;
 const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 const date=new Date(Date.now()-86400000).toISOString();
 const brief={offer:'Recover reviewed enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up'],excludedIndustries:['gambling'],maxAgeDays:90,source:{reference:'interview:fixture',excerpt:'Approved construction offer for AE owners',observedAt:date}};
 await rpc('save_business_brief',[tenant,0,brief,actor]);
 await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'fixture','fit',$3,'review','permitted fixture source',true,$4,'construction AE owner lead follow-up',$5)`,[tenant,lead,date,{industry:'construction',market:'AE',role:'owner',need:'lead follow-up'},actor]);
 await rpc('record_product_event',[tenant,lead,actor,'history','fixture rights','Reviewed past interest',date,true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-75*86400000).toISOString(),previousInterest:'yes',stalledReason:'Budget review deferred'}]);
 const setup=await seedReviveSetup(db,tenant,actor);
 return {tenant,lead,brief,strategy:setup.strategy};
}
async function accept(f:{tenant:string;lead:string}){
 mockApi();const preview=await (await call(f.tenant,{operation:'preview',lead_id:f.lead})).json() as any;
 expect(preview.assessment.eligible).toBe(true);
 const response=await call(f.tenant,{operation:'accept',lead_id:f.lead,version:preview.version,snapshot:preview.snapshot,reason:'Reviewed current need and relationship evidence'});
 expect(response.status).toBe(200);return preview;
}
async function plan(f:{tenant:string;lead:string;strategy:any}){
 const campaign=crypto.randomUUID();
 await rpc('manage_campaign_plan',[f.tenant,campaign,actor,'save',0,{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',audience:{leadIds:[f.lead],confirmed:true},strategy:f.strategy,steps:[{offsetHours:0,subject:'Reviewing your enquiry',body:'Is this still relevant?',evidenceReference:'fit'}]}]);
 await rpc('manage_campaign_plan',[f.tenant,campaign,actor,'approve',1,{clientAuthority:'fixture-client',ownerAuthority:'fixture-owner',ctsProfile:'fixture-review',maxActions:3,expiresAt:new Date(Date.now()+7*86400000).toISOString()}]);
 const source=(await q(`select id from lead_observations where tenant_id=$1 and lead_id=$2 and external_ref='fit'`,[f.tenant,f.lead]))[0].id;
 await rpc('manage_campaign_plan',[f.tenant,campaign,actor,'rights',1,{leadId:f.lead,sourceId:source,noticeReference:'fixture-notice'}]);
 return campaign;
}
const queue=(f:{tenant:string;lead:string},campaign:string,start=new Date(Date.now()+1000).toISOString())=>rpc('manage_campaign_plan',[f.tenant,campaign,actor,'queue',1,{leadId:f.lead,startAt:start}]);
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'staff@example.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
});
afterAll(async()=>{await db.close();});

async function reviewedDraftFixture(){
 const f=await fixture();await accept(f);
 const context=await rpc('revive_review_context',[f.tenant,f.lead,actor]);
 const source=context.observations.find((o:any)=>o.external_ref==='fit');
 const draftResponse=await worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${f.tenant}/campaigns`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-staff'},body:JSON.stringify({operation:'draft',body:{leadId:f.lead,sourceId:source.id,messageCount:1,senderName:'Fixture owner'}})}),env,{} as ExecutionContext);
 expect(draftResponse.status).toBe(200);const {proposal}=await draftResponse.json() as any;
 return {...f,context,campaign:crypto.randomUUID(),body:{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:proposal.steps,draftContext:proposal.draftContext}};
}
it('saves cited proposals through the existing campaign transaction and audits exact provenance once on replay',async()=>{
 const f=await reviewedDraftFixture();
 const savedResponse=await worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${f.tenant}/campaigns`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-staff'},body:JSON.stringify({operation:'save',campaign_id:f.campaign,version:0,body:f.body})}),env,{} as ExecutionContext);
 expect(savedResponse.status).toBe(200);const {ok,delivery,...saved}=await savedResponse.json() as any;
 expect(ok).toBe(true);expect(delivery).toBe('not_sent');
 expect(saved).toMatchObject({id:f.campaign,status:'draft',version:1});
 expect(await rpc('save_reviewed_revive_draft',[f.tenant,f.campaign,actor,0,f.body])).toEqual(saved);
 expect((await q('select steps,brief_version,approved_by from campaign_assets where campaign_id=$1',[f.campaign]))[0]).toEqual({steps:f.body.steps,brief_version:1,approved_by:null});
 const logs=await q("select message from activity_log where tenant_id=$1 and message::jsonb->>'kind'='revive_draft_saved'",[f.tenant]);
 expect(logs).toHaveLength(1);expect(JSON.parse(logs[0].message).provenance).toEqual(f.body.draftContext);
 expect(await q('select id from outbound_actions where campaign_id=$1',[f.campaign])).toHaveLength(0);
});
it.each(['brief','review','source','business','expiry','foreign'])('rejects changed draft %s at the database save boundary without creating a campaign',async(change)=>{
 const f=await reviewedDraftFixture();
 if(change==='brief')await rpc('save_business_brief',[f.tenant,1,{...f.brief,offer:'New reviewed offer'},actor]);
 if(change==='review')await rpc('review_revive_candidate',[f.tenant,f.lead,actor,1,f.context.snapshot,1,'accepted','Same facts reviewed again',new Date(Date.now()+86400000).toISOString()]);
 if(change==='source')await q("update lead_observations set rights_reference='Revised source rights' where tenant_id=$1 and external_ref='fit'",[f.tenant]);
 if(change==='business')await q("update tenants set name='Renamed business' where id=$1",[f.tenant]);
 if(change==='expiry')f.body.draftContext.expiresAt=new Date(Date.now()-1000).toISOString();
 if(change==='foreign')f.body.draftContext.sourceId=crypto.randomUUID();
 await expect(rpc('save_reviewed_revive_draft',[f.tenant,f.campaign,actor,0,f.body])).rejects.toThrow();
 expect(await q('select id from campaigns where id=$1',[f.campaign])).toHaveLength(0);
});
it('draft save denies anonymous/authenticated execution and nonstaff service actors',async()=>{
 const f=await reviewedDraftFixture();
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  try{await expect(q('select save_reviewed_revive_draft($1,$2,$3,0,$4)',[f.tenant,f.campaign,actor,f.body])).rejects.toThrow(/permission/);}
  finally{await db.exec('reset role');}
 }
 await expect(rpc('save_reviewed_revive_draft',[f.tenant,f.campaign,crypto.randomUUID(),0,f.body])).rejects.toThrow(/Staff/);
});

it('composes actual Worker review, PostgreSQL CAS, campaign enrolment and fenced sink completion',async()=>{
 const f=await fixture();
 await expect(plan(f)).rejects.toThrow();
 await accept(f);const campaign=await plan(f);
 const start=new Date(Date.now()+1000).toISOString(),enrolled=await queue(f,campaign,start);
 expect(enrolled.actionIds).toHaveLength(1);expect((await queue(f,campaign,start)).actionIds).toEqual(enrolled.actionIds);
 const id=enrolled.actionIds[0],token=crypto.randomUUID(),at=new Date(Date.now()+2000).toISOString();
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});
 expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(true);
 expect((await q('select state,attempts from outbound_actions where id=$1',[id]))[0]).toEqual({state:'tested',attempts:1});
});
it('runs the composed approved Revive journey through Worker automation into a source-linked synthetic outcome',async()=>{
 const f=await fixture();await accept(f);const campaign=await plan(f);mockApi();
 const run=()=>worker.fetch(new Request(`https://worker.invalid/api/admin/tenants/${f.tenant}/revive-run`,{method:'POST',headers:{Authorization:'Bearer fixture-staff'}}),{...env,REVIVE_AUTOMATION_ENABLED:'true'},{} as ExecutionContext);
 const first=await (await run()).json() as any;expect(first).toMatchObject({enrolled:1,tested:0,review:0,delivery:'not_sent'});
 try{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+7000);
  const second=await (await run()).json() as any;expect(second).toMatchObject({enrolled:0,tested:1,review:0,delivery:'not_sent'});
  const action=(await q('select * from outbound_actions where campaign_id=$1',[campaign]))[0];
  expect(await rpc('record_product_event',[f.tenant,f.lead,actor,'rehearsed-outcome','fixture-rights','Synthetic reviewed result',new Date().toISOString(),true,{product:'revive',kind:'outcome',outcome:'qualified_conversation',reason:'Synthetic rehearsal only',campaignId:campaign,actionId:action.id}])).toMatch(/^[a-f0-9-]{36}$/);
  const third=await (await run()).json() as any;expect(third).toMatchObject({enrolled:0,tested:0,existing:1,review:0});
  expect((await q('select attempts,state from outbound_actions where id=$1',[action.id]))[0]).toEqual({attempts:1,state:'tested'});
 }finally{vi.useRealTimers();}
});
it.each(['history','fit','identity','brief','suppression','expiry','revoked_reviewer'])('rejects a changed %s at dispatch after enrolment',async change=>{
 const f=await fixture();await accept(f);const campaign=await plan(f);const id=(await queue(f,campaign)).actionIds[0];
 if(change==='history')await rpc('record_product_event',[f.tenant,f.lead,actor,'new-history','rights','Later reviewed decline',new Date().toISOString(),true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-80*86400000).toISOString(),previousInterest:'no',stalledReason:'Declined'}]);
 if(change==='fit')await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'fixture','new-fit',now(),'review','rights',true,'{"industry":"retail"}','retail',$3)`,[f.tenant,f.lead,actor]);
 if(change==='identity')await q('update leads set email=$1 where id=$2',[crypto.randomUUID()+'@example.invalid',f.lead]);
 if(change==='brief')await rpc('save_business_brief',[f.tenant,1,{...f.brief,offer:'Changed offer'},actor]);
 if(change==='suppression')await q(`insert into lead_suppression(tenant_id,lead_id,reason) values($1,$2,'objection')`,[f.tenant,f.lead]);
 if(change==='expiry')await q(`update revive_reviews set expires_at=now()-interval '1 second' where tenant_id=$1`,[f.tenant]);
 if(change==='revoked_reviewer')await q('update profiles set is_admin=false where id=$1',[actor]);
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,crypto.randomUUID(),new Date(Date.now()+3000).toISOString()])).toBeNull();
 expect((await q('select state from outbound_actions where id=$1',[id]))[0].state).toBe('blocked');
 if(change==='revoked_reviewer')await q('update profiles set is_admin=true where id=$1',[actor]);
});
it('rechecks evidence during an already claimed action and rejects completion',async()=>{
 const f=await fixture();await accept(f);const campaign=await plan(f);const id=(await queue(f,campaign)).actionIds[0],token=crypto.randomUUID(),at=new Date(Date.now()+3000).toISOString();
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});
 await q(`update leads set company='Changed identity' where id=$1`,[f.lead]);
 expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(false);
});
it('requires fresh preview, denies stale review versions and never trusts client eligible=true',async()=>{
 const f=await fixture();const preview=await accept(f);
 expect((await call(f.tenant,{operation:'accept',lead_id:f.lead,version:0,snapshot:preview.snapshot,reason:'Stale repeated decision'})).status).toBe(409);
 await q(`update lead_observations set assessment_facts='{}' where tenant_id=$1 and external_ref='fit'`,[f.tenant]);
 expect((await call(f.tenant,{operation:'accept',lead_id:f.lead,version:1,snapshot:preview.snapshot,eligible:true,reason:'Untrusted caller verdict'})).status).toBe(409);
});
it('denies anonymous, foreign contact and direct authenticated cohort writes',async()=>{
 const f=await fixture(),foreign=await fixture();mockApi();
 expect((await call(f.tenant,{operation:'preview',lead_id:f.lead},'')).status).toBe(401);
 expect((await call(f.tenant,{operation:'preview',lead_id:foreign.lead})).status).toBe(404);
 await db.exec('set role authenticated');
 try{await expect(q(`insert into revive_reviews(tenant_id,lead_id,version,brief_version,snapshot,state,reviewer_id,reason,expires_at) values($1,$2,1,1,repeat('a',32),'accepted',$3,'Forged approval',now()+interval '1 day')`,[f.tenant,f.lead,actor])).rejects.toThrow();
  await expect(q('select review_revive_candidate($1,$2,$3,0,repeat(\'a\',32),1,\'accepted\',\'Forged review\',now()+interval \'1 day\')',[f.tenant,f.lead,actor])).rejects.toThrow();
 }finally{await db.exec('reset role');}
});
it.each([['yes',29,'recent_contact'],['yes',30,'dormant_review'],['no',1,'not_interested'],['no',75,'not_interested'],['unknown',75,'review']])('keeps history boundary %s / %s days conservative',async(interest,days,state)=>{
 const f=await fixture(),context=await rpc('revive_review_context',[f.tenant,f.lead,actor]) as ReviveContext;
 const now=Date.now(),h=context.observations.find(o=>o.product_context?.kind==='history')!;
 Object.assign(h.product_context!,{lastContactAt:new Date(now-Number(days)*86400000).toISOString(),previousInterest:interest});h.observed_at=new Date(now).toISOString();
 const result=assessRevive(context,now);expect(result.historyState).toBe(state);expect(result.eligible).toBe(state==='dormant_review');
});
