import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import worker from '../src/index';
import type {Env} from '../src/env';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
const actor='33fc9a5e-f7e5-49dc-84cd-047960dba988';
let db:PGlite;
async function q(sql:string,args:any[]=[]){return (await db.query<any>(sql,args)).rows;}
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args))[0].result;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,dir),'utf8'));
 await q("insert into auth.users(id,email,email_confirmed_at) values($1,'qa-owner@example.invalid',now())",[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
},30000);
afterAll(async()=>db?.close());
async function fixture(reviewed=true){
 const tenant=(await q("insert into tenants(name,slug,country,currency,status) values('Independent setup QA',$1,'AE','AED','onboarding') returning id",[crypto.randomUUID()]))[0].id;
 const observedAt=new Date(Date.now()-3600000).toISOString(),brief={offer:'Recover reviewed enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up','pipeline visibility'],excludedIndustries:[],maxAgeDays:90,source:{reference:'qa-interview',excerpt:'Reviewed offer and construction targets',observedAt}};
 await rpc('save_business_brief',[tenant,0,brief,actor]);
 const setup={website:null,supportedClaims:[],sourceInventory:[{type:'interview',reference:'qa-interview',rightsReference:'qa-source-rights'}],relationshipSummary:{text:'Previous enquiries deferred their purchase',reference:'qa-history'},senderName:'QA owner',senderEmail:'qa-sender@example.invalid',ownerId:actor,market:'AE',language:'en',timezone:'Asia/Dubai',salesCapacityPerWeek:5,outcomeWindowDays:30,workingDays:[1,2,3,4,5],startMinute:540,endMinute:1020,dailyContactCap:2};
 if(reviewed)await rpc('save_revive_setup',[tenant,actor,0,1,'reviewed',setup]);
 return {tenant,brief,setup};
}
const activate=(f:Awaited<ReturnType<typeof fixture>>)=>rpc('activate_tenant_execution',[f.tenant,actor,'onboarding',0,1,'Reviewed exact setup and business brief']);
async function contact(f:Awaited<ReturnType<typeof fixture>>,need='lead follow-up'){
 const lead=(await q("insert into leads(tenant_id,source,email) values($1,'import',$2) returning id",[f.tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 const observedAt=new Date(Date.now()-3600000).toISOString();
 const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'staff_import',$3,$4,'review','QA rights',true,$5,$6,$7) returning id`,[f.tenant,lead,crypto.randomUUID(),observedAt,{industry:'construction',market:'AE',role:'owner',need},`construction AE owner ${need}`,actor]))[0].id;
 await rpc('record_product_event',[f.tenant,lead,actor,crypto.randomUUID(),'QA history rights','Reviewed deferred interest',observedAt,true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-80*86400000).toISOString(),previousInterest:'yes',stalledReason:'Deferred budget'}]);
 const context=await rpc('revive_review_context',[f.tenant,lead,actor]);await rpc('review_revive_candidate',[f.tenant,lead,actor,0,context.snapshot,1,'accepted','Current relationship and fit reviewed',new Date(Date.now()+20*86400000).toISOString()]);return {lead,source};
}
function strategy(){return {setupVersion:1,canonicalNeed:'lead follow-up',segment:'Construction owners in AE',relationshipRationale:'Previously interested enquiries deferred their purchase',valueProposition:'Recover reviewed enquiries',evidenceReference:'qa-interview',cta:{kind:'reply',prompt:'Is this still relevant for your team?'},goal:'qualified_conversation',confirmed:true};}
function body(leads:string[],steps=[{offsetHours:0,subject:'Reviewed enquiry',body:'Is the reviewed need still relevant?',evidenceReference:'qa-interview'}]){return {product:'revive',purpose:'reactivation',market:'AE',timezone:'Asia/Dubai',audience:{leadIds:leads,confirmed:true},strategy:strategy(),steps};}
async function plan(f:Awaited<ReturnType<typeof fixture>>,leads:string[],steps?:any[]){const id=crypto.randomUUID(),b=body(leads,steps);await rpc('manage_campaign_plan',[f.tenant,id,actor,'save',0,b]);return {id,body:b};}
const authority=()=>({clientAuthority:'QA client review',ownerAuthority:'QA owner review',ctsProfile:'QA market review',maxActions:10,expiresAt:new Date(Date.now()+25*86400000).toISOString()});
const approve=(f:Awaited<ReturnType<typeof fixture>>,id:string)=>rpc('manage_campaign_plan',[f.tenant,id,actor,'approve',1,authority()]);
async function effects(tenant:string){return (await q(`select (select count(*) from campaigns where tenant_id=$1)::int campaigns,(select count(*) from campaign_assets where tenant_id=$1)::int assets,(select count(*) from outbound_actions where tenant_id=$1)::int actions,(select count(*) from contact_rights where tenant_id=$1)::int rights`,[tenant]))[0];}
it('requires a fully reviewed setup tied to the current brief before Revive activation',async()=>{
 const f=await fixture(false);await expect(activate(f)).rejects.toThrow();await rpc('save_revive_setup',[f.tenant,actor,0,1,'draft',f.setup]);await expect(activate(f)).rejects.toThrow();
 await rpc('save_revive_setup',[f.tenant,actor,1,1,'reviewed',f.setup]);expect(await activate(f)).toMatchObject({id:f.tenant,status:'active'});expect(await effects(f.tenant)).toEqual({campaigns:0,assets:0,actions:0,rights:0});
});
it('uses append-only setup CAS and harmless same-body replay instead of duplicate versions',async()=>{
 const f=await fixture(),context=await rpc('revive_setup_context',[f.tenant,actor]);expect(context).toMatchObject({tenantId:f.tenant,ready:true,setup:{version:1,briefVersion:1,state:'reviewed'}});
 expect(await rpc('save_revive_setup',[f.tenant,actor,0,1,'reviewed',f.setup])).toMatchObject({version:1,ready:true});
 await expect(rpc('save_revive_setup',[f.tenant,actor,0,1,'reviewed',{...f.setup,salesCapacityPerWeek:6}])).rejects.toThrow();expect(await q('select version from revive_setups where tenant_id=$1',[f.tenant])).toEqual([{version:1}]);
 for(const change of [{workingDays:[]},{dailyContactCap:0},{sourceInventory:[]},{timezone:'Invalid/Timezone'},{ownerId:crypto.randomUUID()}])await expect(rpc('save_revive_setup',[f.tenant,actor,1,1,'reviewed',{...f.setup,...change}])).rejects.toThrow();
 expect(await q('select version from revive_setups where tenant_id=$1',[f.tenant])).toEqual([{version:1}]);
});
it('makes an old setup unready after a brief update rather than reusing its linked brief silently',async()=>{
 const f=await fixture();await rpc('save_business_brief',[f.tenant,1,{...f.brief,offer:'Changed reviewed offer'},actor]);const context=await rpc('revive_setup_context',[f.tenant,actor]);expect(context.ready).toBe(false);await expect(activate(f)).rejects.toThrow();expect(context.setup.briefVersion).toBe(1);
});
it('denies a strategy whose canonical need is unsupported by one selected audience member',async()=>{
 const f=await fixture();await activate(f);const a=await contact(f),b=await contact(f,'pipeline visibility'),before=await effects(f.tenant);await expect(plan(f,[a.lead,b.lead])).rejects.toThrow();expect(await effects(f.tenant)).toEqual(before);
});
it('rejects invented strategy references, stale setup versions and unconfirmed decisions atomically',async()=>{
 const f=await fixture();await activate(f);const c=await contact(f);
 for(const change of [{evidenceReference:'invented-unsupported-reference'},{setupVersion:99},{confirmed:false},{canonicalNeed:'outside approved needs'}]){const before=await effects(f.tenant);await expect(rpc('manage_campaign_plan',[f.tenant,crypto.randomUUID(),actor,'save',0,{...body([c.lead]),strategy:{...strategy(),...change}}])).rejects.toThrow();expect(await effects(f.tenant)).toEqual(before);}
});
it('requires a new asset and approval when only strategy changes, preserving prior strategy history',async()=>{
 const f=await fixture();await activate(f);const c=await contact(f),p=await plan(f,[c.lead]);await approve(f,p.id);
 expect(await rpc('manage_campaign_plan',[f.tenant,p.id,actor,'save',1,{...p.body,strategy:{...strategy(),segment:'Reviewed narrower segment'}}])).toMatchObject({status:'draft',version:2});
 await expect(rpc('manage_campaign_plan',[f.tenant,p.id,actor,'approve',1,authority()])).rejects.toThrow();expect((await q('select approved_by from campaign_assets where campaign_id=$1 and version=2',[p.id]))[0].approved_by).toBeNull();
});
it('a setup edit cancels queued work and fences claimed work without granting a new approval',async()=>{
 const f=await fixture();await activate(f);const a=await contact(f),b=await contact(f),p=await plan(f,[a.lead,b.lead]);await approve(f,p.id);
 for(const c of [a,b])await rpc('manage_campaign_plan',[f.tenant,p.id,actor,'rights',1,{leadId:c.lead,sourceId:c.source,noticeReference:'QA notice'}]);
 const preview=await rpc('preview_revive_schedule',[f.tenant,p.id,actor,1,a.lead,new Date(Date.now()+60000).toISOString()]);const start=preview.requestedStartAt;
 const first=await rpc('manage_campaign_plan',[f.tenant,p.id,actor,'queue',1,{leadId:a.lead,startAt:start}]);await rpc('manage_campaign_plan',[f.tenant,p.id,actor,'queue',1,{leadId:b.lead,startAt:start}]);
 const at=preview.steps[0].dueAt,token=crypto.randomUUID();expect(await rpc('claim_fenced_synthetic_action',[f.tenant,first.actionIds[0],token,at])).toMatchObject({token});
 await rpc('save_revive_setup',[f.tenant,actor,1,1,'reviewed',{...f.setup,dailyContactCap:1}]);
 expect((await q('select status from campaigns where id=$1',[p.id]))[0].status).toBe('draft');expect((await q('select state from outbound_actions where id=$1',[first.actionIds[0]]))[0].state).toBe('review');expect(await rpc('complete_fenced_synthetic_action',[f.tenant,first.actionIds[0],token,1,1,at])).toBe(false);
 expect((await q("select count(*)::int n from outbound_actions where campaign_id=$1 and state='cancelled'",[p.id]))[0].n).toBe(1);
});
it('uses local weekdays with inclusive opening and exclusive closing boundaries',async()=>{
 const policy={timezone:'Asia/Dubai',workingDays:[1,2,3,4,5],startMinute:540,endMinute:1020,dailyContactCap:2};
 expect(await rpc('revive_in_working_window',['2026-11-02T04:59:59Z',policy])).toBe(false);expect(await rpc('revive_in_working_window',['2026-11-02T05:00:00Z',policy])).toBe(true);
 expect(await rpc('revive_in_working_window',['2026-11-02T12:59:59Z',policy])).toBe(true);expect(await rpc('revive_in_working_window',['2026-11-02T13:00:00Z',policy])).toBe(false);expect(await rpc('revive_in_working_window',['2026-11-01T05:00:00Z',policy])).toBe(false);
});
it('finds real UTC instants across DST gaps and folds instead of inventing local clock times',async()=>{
 const gap={timezone:'America/New_York',workingDays:[7],startMinute:150,endMinute:240,dailyContactCap:2};
 expect(Date.parse(await rpc('next_revive_working_instant',['2026-03-08T06:59:30Z',gap]))).toBe(Date.parse('2026-03-08T07:00:00Z'));
 const fold={...gap,startMinute:60,endMinute:90};expect(Date.parse(await rpc('next_revive_working_instant',['2026-11-01T05:45:00Z',fold]))).toBe(Date.parse('2026-11-01T06:00:00Z'));
});
it('preview and enrolment preserve actual follow-up spacing after a Friday-close weekend shift',async()=>{
 const f=await fixture();await activate(f);const c=await contact(f),steps=[0,24,48].map(offsetHours=>({offsetHours,subject:'Reviewed follow-up',body:'Reviewed offer',evidenceReference:'qa-interview'})),p=await plan(f,[c.lead],steps);await approve(f,p.id);await rpc('manage_campaign_plan',[f.tenant,p.id,actor,'rights',1,{leadId:c.lead,sourceId:c.source,noticeReference:'QA synthetic notice'}]);
 const friday=new Date();friday.setUTCHours(13,30,0,0);while(friday<=new Date()||friday.getUTCDay()!==5)friday.setUTCDate(friday.getUTCDate()+1);
 const start=friday.toISOString(),before=await effects(f.tenant),preview=await rpc('preview_revive_schedule',[f.tenant,p.id,actor,1,c.lead,start]);expect(preview).toMatchObject({campaignId:p.id,assetVersion:1,leadId:c.lead,setupVersion:1,timezone:'Asia/Dubai',delivery:'not_sent'});expect(preview.steps).toHaveLength(3);expect(await effects(f.tenant)).toEqual(before);
 expect(new Date(preview.steps[0].dueAt).getUTCDay()).toBe(1);for(const step of preview.steps)expect(step.localTime).toBe('09:00:00');for(let i=1;i<3;i++)expect(Date.parse(preview.steps[i].dueAt)-Date.parse(preview.steps[i-1].dueAt)).toBeGreaterThanOrEqual(86400000);
 const queued=await rpc('manage_campaign_plan',[f.tenant,p.id,actor,'queue',1,{leadId:c.lead,startAt:start}]);expect(queued.actionIds).toHaveLength(3);const persisted=await q('select due_at from outbound_actions where campaign_id=$1 order by message_step',[p.id]);expect(persisted.map(x=>Date.parse(x.due_at))).toEqual(preview.steps.map((x:any)=>Date.parse(x.dueAt)));
 expect(await rpc('manage_campaign_plan',[f.tenant,p.id,actor,'queue',1,{leadId:c.lead,startAt:start}])).toMatchObject({replayed:true,actionIds:queued.actionIds});
});
it('reserves the tenant local-day contact cap across campaigns and includes uncertain work',async()=>{
 const f=await fixture();f.setup.dailyContactCap=1;await rpc('save_revive_setup',[f.tenant,actor,1,1,'reviewed',f.setup]);await activate(f);const a=await contact(f),b=await contact(f);
 const create=async(lead:string)=>{const id=crypto.randomUUID(),payload=body([lead]);payload.strategy.setupVersion=2;await rpc('manage_campaign_plan',[f.tenant,id,actor,'save',0,payload]);await approve(f,id);return id;};
 const first=await create(a.lead),second=await create(b.lead);for(const [c,id] of [[a,first],[b,second]] as const)await rpc('manage_campaign_plan',[f.tenant,id,actor,'rights',1,{leadId:c.lead,sourceId:c.source,noticeReference:'QA notice'}]);
 const start=new Date(Date.now()+60000).toISOString(),queued=await rpc('manage_campaign_plan',[f.tenant,first,actor,'queue',1,{leadId:a.lead,startAt:start}]);const before=await effects(f.tenant);
 await expect(rpc('manage_campaign_plan',[f.tenant,second,actor,'queue',1,{leadId:b.lead,startAt:start}])).rejects.toThrow();expect(await effects(f.tenant)).toEqual(before);
 await q("update outbound_actions set state='review',error_code='qa_uncertain' where id=$1",[queued.actionIds[0]]);await expect(rpc('preview_revive_schedule',[f.tenant,second,actor,1,b.lead,start])).rejects.toThrow();expect(await effects(f.tenant)).toEqual(before);
});
it('waits outside working hours and rejects a missed local date without rescheduling or acknowledging',async()=>{
 const f=await fixture();await activate(f);const c=await contact(f),p=await plan(f,[c.lead]);await approve(f,p.id);await rpc('manage_campaign_plan',[f.tenant,p.id,actor,'rights',1,{leadId:c.lead,sourceId:c.source,noticeReference:'QA notice'}]);
 const start=new Date(Date.now()+60000).toISOString(),preview=await rpc('preview_revive_schedule',[f.tenant,p.id,actor,1,c.lead,start]),queued=await rpc('manage_campaign_plan',[f.tenant,p.id,actor,'queue',1,{leadId:c.lead,startAt:start}]),action=queued.actionIds[0];
 const due=new Date(preview.steps[0].dueAt),closing=new Date(preview.steps[0].localDate+'T13:00:00Z'),nextDay=new Date(due);nextDay.setUTCDate(nextDay.getUTCDate()+1);
 expect(await rpc('revive_action_readiness',[f.tenant,action,closing.toISOString()])).toMatchObject({disposition:'wait'});expect(await rpc('claim_fenced_synthetic_action',[f.tenant,action,crypto.randomUUID(),closing.toISOString()])).toBeNull();expect((await q('select state,attempts from outbound_actions where id=$1',[action]))[0]).toEqual({state:'queued',attempts:0});
 expect(await rpc('revive_action_readiness',[f.tenant,action,nextDay.toISOString()])).toMatchObject({disposition:'expired',reason:'missed_local_day'});expect(await rpc('claim_fenced_synthetic_action',[f.tenant,action,crypto.randomUUID(),nextDay.toISOString()])).toBeNull();expect((await q('select state,acknowledged_at,due_at from outbound_actions where id=$1',[action]))[0]).toMatchObject({state:'blocked',acknowledged_at:null});expect(Date.parse((await q('select due_at from outbound_actions where id=$1',[action]))[0].due_at)).toBe(Date.parse(preview.steps[0].dueAt));
});
it('composes actual Worker setup, activation, bound strategy, preview, queue and fenced test acknowledgement',async()=>{
 const f=await fixture(false),env={SUPABASE_URL:'https://setup-e2e.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-public',SYNTHETIC_SINK_ENABLED:'true'} as Env;
 vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const url=new URL(input);if(url.origin!==env.SUPABASE_URL)throw Error('External network forbidden');
  if(url.pathname==='/auth/v1/user')return Response.json({id:actor,email:'qa-owner@example.invalid'});if(url.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);
  if(url.pathname.startsWith('/rest/v1/rpc/')){const name=url.pathname.split('/').at(-1)!,args=JSON.parse(String(init.body)),keys=Object.keys(args);if(!/^[a-z_]+$/.test(name)||keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Unexpected RPC');await db.exec('set role service_role');try{return Response.json((await q(`select public.${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')}) result`,Object.values(args)))[0].result);}catch(e:any){return Response.json({code:e.code,message:e.message},{status:400});}finally{await db.exec('reset role');}}
  const table=url.pathname.replace('/rest/v1/','');if(['tenants','outbound_actions','campaigns'].includes(table)&&(!init.method||init.method==='GET')){const values:any[]=[],where=[];for(const [key,value] of url.searchParams){if(['select','limit'].includes(key))continue;if(!/^[a-z_]+$/.test(key)||!value.startsWith('eq.'))throw Error('Unexpected read filter');values.push(value.slice(3));where.push(`${key}=$${values.length}`);}return Response.json(await q(`select * from ${table}${where.length?' where '+where.join(' and '):''}`,values));}
  throw Error('Unexpected database/provider path '+url.pathname);
 });
 const http=async(path:string,body:any)=>{const response=await worker.fetch(new Request('https://worker.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer qa-staff'},body:JSON.stringify(body)}),env,{} as ExecutionContext);const value=await response.json() as any;expect(response.status,JSON.stringify(value)).toBe(200);return value;};
 try{
  expect((await http(`/api/admin/tenants/${f.tenant}/revive-setup`,{operation:'get'})).context.ready).toBe(false);
  expect(await http(`/api/admin/tenants/${f.tenant}/revive-setup`,{operation:'save',expectedVersion:0,briefVersion:1,state:'reviewed',body:f.setup})).toMatchObject({version:1,ready:true,delivery:'not_sent'});
  await http(`/api/admin/tenants/${f.tenant}/activate`,{expected_status:'onboarding',expected_version:0,brief_version:1,reason:'Reviewed current setup and offer'});
  const c=await contact(f),campaign=crypto.randomUUID(),path=`/api/admin/tenants/${f.tenant}/campaigns`,proposal=(await http(path,{operation:'draft',body:{leadId:c.lead,sourceId:c.source,messageCount:1,senderName:f.setup.senderName}})).proposal;
  expect(proposal.draftContext).toMatchObject({setupVersion:1,canonicalNeed:'lead follow-up'});expect(proposal.draftContext.proposalId).toMatch(/^[1-9][0-9]*$/);
  const payload={...body([c.lead]),steps:proposal.steps.map((s:any)=>({...s,body:s.body+'\nOperator-reviewed edit.'})),draftContext:proposal.draftContext};await http(path,{operation:'save',campaign_id:campaign,version:0,body:payload});await http(path,{operation:'approve',campaign_id:campaign,version:1,body:authority()});await http(path,{operation:'rights',campaign_id:campaign,version:1,body:{leadId:c.lead,sourceId:c.source,noticeReference:'QA synthetic notice'}});
  const start=new Date(Date.now()+60000).toISOString(),preview=await http(path,{operation:'schedule',campaign_id:campaign,version:1,body:{leadId:c.lead,startAt:start}});expect(await q('select id from outbound_actions where tenant_id=$1',[f.tenant])).toHaveLength(0);
  const queued=await http(path,{operation:'queue',campaign_id:campaign,version:1,body:{leadId:c.lead,startAt:start}});expect(queued.actionIds).toHaveLength(1);expect(Date.parse((await q('select due_at from outbound_actions where id=$1',[queued.actionIds[0]]))[0].due_at)).toBe(Date.parse(preview.steps[0].dueAt));
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.parse(preview.steps[0].dueAt)+1000);expect(await http(`/api/admin/actions/${queued.actionIds[0]}/test`,{})).toMatchObject({ok:true,state:'tested',action_id:queued.actionIds[0]});
  expect((await q('select state,provider_ref,attempts from outbound_actions where id=$1',[queued.actionIds[0]]))[0]).toEqual({state:'tested',provider_ref:'test-sink:'+queued.actionIds[0],attempts:1});expect(await q('select id from tenants where id=$1',[f.tenant])).toHaveLength(1);expect(await q('select version from revive_setups where tenant_id=$1',[f.tenant])).toEqual([{version:1}]);
 }finally{vi.useRealTimers();vi.unstubAllGlobals();}
});
it('keeps the Auth-authority lock trigger private, non-callable and pinned to an empty search path',async()=>{
 const metadata=(await q(`select p.prosecdef,p.proconfig,n.nspname,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service,has_schema_privilege('anon',n.oid,'USAGE') anon_schema,has_schema_privilege('authenticated',n.oid,'USAGE') authenticated_schema,has_schema_privilege('service_role',n.oid,'USAGE') service_schema from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ripepiper_private' and p.proname='lock_revive_auth_authority'`))[0];
 expect(metadata).toMatchObject({prosecdef:true,nspname:'ripepiper_private',anon:false,authenticated:false,service:false,anon_schema:false,authenticated_schema:false,service_schema:true});expect(metadata.proconfig).toContain('search_path=""');
 // The Signal eligibility wrapper needs schema USAGE; Auth trigger EXECUTE stays denied.
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);try{await expect(q('select ripepiper_private.lock_revive_auth_authority()')).rejects.toThrow(/permission denied/);}finally{await db.exec('reset role');}}
 expect(await q("select tgname from pg_trigger where tgrelid='auth.users'::regclass and tgname='revive_auth_authority_lock' and tgenabled='O'")).toHaveLength(1);
});
