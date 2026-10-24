import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {seedReviveSetup,strategyBody} from './helpers/revive-setup';
import {reviveStrategyError} from '../src/foundation/revive-strategy';
const actor='00111111-1111-4111-8111-111111111111';let db:PGlite;
const q=async(sql:string,args:any[]=[])=> (await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return(await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid()to anon,authenticated;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,directory),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at)values($1,'strategy-staff@test.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
},30000);
afterAll(async()=>db?.close());
async function contact(tenant:string,need='lead follow-up'){
 const lead=(await q(`insert into leads(tenant_id,source,email)values($1,'import',$2)returning id`,[tenant,crypto.randomUUID()+'@strategy.invalid']))[0].id;
 const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_reviewed_by,assessment_facts,assessment_excerpt,product_context)values($1,$2,'fixture',$3,now()-interval '1 hour','review','fixture permitted use',true,$4,$5,$6,$7)returning id`,[tenant,lead,crypto.randomUUID(),actor,{industry:'construction',market:'AE',role:'owner',need},'construction AE owner '+need,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-60*86400000).toISOString(),previousInterest:'yes',stalledReason:'Deferred project'}]))[0].id;
 await rpc('review_revive_candidate',[tenant,lead,actor,0,(await q('select revive_input_snapshot($1,$2) s',[tenant,lead]))[0].s,1,'accepted','Reviewed current business need and relationship',new Date(Date.now()+28*86400000).toISOString()]);return {tenant,lead,source};
}
async function fixture(overrides:Record<string,unknown>={},needs=['lead follow-up']){
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status)values('Strategy fixture',$1,'AE','AED','active')returning id`,['strategy-'+crypto.randomUUID()]))[0].id;
 await rpc('save_business_brief',[tenant,0,{offer:'Recover reviewed enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs,excludedIndustries:['gambling'],maxAgeDays:90,source:{reference:'strategy-brief',excerpt:'Reviewed construction offer',observedAt:new Date(Date.now()-3600000).toISOString()}},actor]);
 const setup=await seedReviveSetup(db,tenant,actor,overrides),c=await contact(tenant),id=crypto.randomUUID();return {...c,id,setup,strategy:setup.strategy};
}
function plan(f:any,ids=[f.lead],strategy:any=f.strategy,offsets=[0]){return {product:'revive',purpose:'reactivation',market:'AE',timezone:f.setup.body.timezone,audience:{leadIds:ids,confirmed:true},...(strategy?{strategy}:{}),steps:offsets.map(offsetHours=>({offsetHours,subject:'Reviewed reactivation',body:'Is this still relevant?',evidenceReference:'strategy-brief'}))};}
const save=(f:any,b=plan(f),version=0)=>rpc('manage_campaign_plan',[f.tenant,f.id,actor,'save',version,b]);
async function authorize(f:any,version=1){await rpc('manage_campaign_plan',[f.tenant,f.id,actor,'approve',version,{clientAuthority:'fixture client',ownerAuthority:'fixture owner',ctsProfile:'fixture compliance',maxActions:25,expiresAt:new Date(Date.now()+29*86400000).toISOString()}]);await rpc('manage_campaign_plan',[f.tenant,f.id,actor,'rights',version,{leadId:f.lead,sourceId:f.source,noticeReference:'synthetic fixture'}]);}
const preview=(f:any,start:string,version=1)=>rpc('preview_revive_schedule',[f.tenant,f.id,actor,version,f.lead,start]);
const queue=(f:any,start:string,version=1)=>rpc('manage_campaign_plan',[f.tenant,f.id,actor,'queue',version,{leadId:f.lead,startAt:start}]);
function nextDay(weekday:number,hour:number,minute=0){const d=new Date();d.setUTCHours(hour,minute,0,0);let delta=(weekday-d.getUTCDay()+7)%7;if(!delta&&d.getTime()<=Date.now()+60000)delta=7;d.setUTCDate(d.getUTCDate()+delta);return d.toISOString();}

it('validates one CTA and rejects unknown strategy keys, malformed versions and private booking hosts',()=>{
 const good=strategyBody(1);expect(reviveStrategyError(good)).toBeNull();expect(reviveStrategyError({...good,cta:{kind:'booking',url:'https://calendar.business.com/meet',reference:'calendar review',reviewed:true}})).toBeNull();
 for(const value of [{...good,confirmed:'true'},{...good,setupVersion:0},{...good,hiddenTool:'send'},{...good,cta:{kind:'reply',prompt:'Reply',url:'https://calendar.business.com'}},{...good,cta:{kind:'booking',url:'https://localhost/meet',reference:'review',reviewed:true}}])expect(reviveStrategyError(value)).not.toBeNull();
});
it('binds strategy to the current setup, cited source, owner and exact audience; strategy-only edits create another version',async()=>{
 const f=await fixture();await save(f);const stored=(await q('select revive_strategy from campaign_assets where campaign_id=$1',[f.id]))[0].revive_strategy;
 expect(stored).toMatchObject({setupVersion:1,ownerId:actor,schedule:{timezone:'UTC',dailyContactCap:25},exclusions:['gambling']});expect(stored.stopRules).toContain('reply');
 expect(await save(f,plan(f),1)).toMatchObject({version:1});
 expect(await save(f,plan(f,[f.lead],{...f.strategy,valueProposition:'A newly reviewed value statement.'}),1)).toMatchObject({version:2,status:'draft'});
 await expect(q('update campaign_assets set revive_strategy=null where campaign_id=$1',[f.id])).rejects.toThrow('new asset version');
});
it('rejects wrong setup, invented evidence, foreign market and an audience member with a different cited need',async()=>{
 const f=await fixture({},['lead follow-up','meeting planning']);
 for(const strategy of [{...f.strategy,setupVersion:2},{...f.strategy,evidenceReference:'invented source'},{...f.strategy,canonicalNeed:'fictional need'}])await expect(save(f,plan(f,[f.lead],strategy))).rejects.toThrow();
 await expect(save(f,{...plan(f),market:'US'})).rejects.toThrow('market and timezone');
 const other=await contact(f.tenant,'meeting planning');await expect(save(f,plan(f,[f.lead,other.lead]))).rejects.toThrow('Every audience contact');
});
it('previews draft planning without rights or actions, then queue uses identical approved due times and stable requested-start replay',async()=>{
 const f=await fixture();await save(f);const start=new Date(Date.now()+30000).toISOString(),draft=await preview(f,start);
 expect(draft).toMatchObject({approvalStatus:'draft',authorityStatus:'not_approved',delivery:'not_sent'});expect(await q('select id from outbound_actions where tenant_id=$1',[f.tenant])).toHaveLength(0);expect(await q('select id from contact_rights where tenant_id=$1',[f.tenant])).toHaveLength(0);
 await expect(queue(f,start)).rejects.toThrow('Approved current plan');await authorize(f);const approved=await preview(f,start);expect(approved.steps).toEqual(draft.steps);expect(approved).toMatchObject({approvalStatus:'approved',authorityStatus:'current'});
 const queued=await queue(f,start);expect((await q('select due_at,schedule_requested_at from outbound_actions where id=$1',[queued.actionIds[0]]))[0].due_at.toISOString()).toBe(new Date(approved.steps[0].dueAt).toISOString());expect(await queue(f,start)).toMatchObject({replayed:true,actionIds:queued.actionIds});
});
it('rolls weekend follow-ups forward and preserves actual 24-hour spacing after each shift',async()=>{
 const f=await fixture({workingDays:[1,2,3,4,5],startMinute:540,endMinute:1020});await save(f,plan(f,[f.lead],f.strategy,[0,24,48]));const p=await preview(f,nextDay(5,16,30));
 expect(p.steps.map((s:any)=>new Date(s.dueAt).getUTCDay())).toEqual([5,1,2]);expect(p.steps[1].localTime).toBe('09:00:00');expect(p.steps[2].localTime).toBe('09:00:00');
 for(let i=1;i<p.steps.length;i++)expect(Date.parse(p.steps[i].dueAt)-Date.parse(p.steps[i-1].dueAt)).toBeGreaterThanOrEqual(86400000);
});
it('uses actual UTC minutes through DST gaps and both folded local hours',async()=>{
 const policy={timezone:'America/New_York',workingDays:[7],startMinute:150,endMinute:210};
 expect(new Date(await rpc('next_revive_working_instant',['2027-03-14T06:59:30Z',policy])).toISOString()).toBe('2027-03-14T07:00:00.000Z');
 const fold={...policy,startMinute:90,endMinute:150};
 expect(new Date(await rpc('next_revive_working_instant',['2026-11-01T05:00:00Z',fold])).toISOString()).toBe('2026-11-01T05:30:00.000Z');
 expect(new Date(await rpc('next_revive_working_instant',['2026-11-01T06:00:00Z',fold])).toISOString()).toBe('2026-11-01T06:30:00.000Z');
});
it('enforces [start,end) window boundaries, waits without claiming, and blocks a missed local-day action',async()=>{
 const f=await fixture({workingDays:[1,2,3,4,5,6,7],startMinute:540,endMinute:1020});await save(f);await authorize(f);const start=nextDay((new Date().getUTCDay()+1)%7,9),queued=await queue(f,start),id=queued.actionIds[0],at=new Date(start);
 at.setUTCHours(8,59,0,0);expect(await rpc('revive_action_readiness',[f.tenant,id,at.toISOString()])).toMatchObject({disposition:'wait'});
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,crypto.randomUUID(),at.toISOString()])).toBeNull();expect((await q('select attempts,state from outbound_actions where id=$1',[id]))[0]).toEqual({attempts:0,state:'queued'});
 at.setUTCHours(9,0,0,0);expect(await rpc('revive_action_readiness',[f.tenant,id,at.toISOString()])).toMatchObject({disposition:'ready'});
 at.setUTCHours(17,0,0,0);expect(await rpc('revive_action_readiness',[f.tenant,id,at.toISOString()])).toMatchObject({disposition:'wait',reason:'outside_working_window'});
 at.setUTCDate(at.getUTCDate()+1);at.setUTCHours(9);expect(await rpc('revive_action_readiness',[f.tenant,id,at.toISOString()])).toMatchObject({disposition:'expired',reason:'missed_local_day'});
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,crypto.randomUUID(),at.toISOString()])).toBeNull();expect((await q('select state from outbound_actions where id=$1',[id]))[0].state).toBe('blocked');
});
it('rechecks the working window at completion without acknowledging after closing time',async()=>{
 const f=await fixture({workingDays:[1,2,3,4,5,6,7],startMinute:540,endMinute:1020});await save(f);await authorize(f);const start=nextDay((new Date().getUTCDay()+1)%7,16,59),id=(await queue(f,start)).actionIds[0],token=crypto.randomUUID();
 expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,start])).toMatchObject({token});const end=new Date(Date.parse(start)+60000).toISOString();expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,end])).toBe(false);expect((await q('select acknowledged_at from outbound_actions where id=$1',[id]))[0].acknowledged_at).toBeNull();
});
it('reserves distinct tenant-local-day contacts across campaigns and frees cancelled reservations',async()=>{
 const f=await fixture({dailyContactCap:1}),second={...await contact(f.tenant),id:crypto.randomUUID(),setup:f.setup,strategy:f.strategy};await save(f);await authorize(f);await save(second);await authorize(second);const start=new Date(Date.now()+60000).toISOString();const first=await queue(f,start);
 await expect(preview(second,start)).rejects.toThrow('Daily contact capacity');await expect(queue(second,start)).rejects.toThrow('Daily contact capacity');
 await q(`update outbound_actions set state='cancelled' where id=$1`,[first.actionIds[0]]);expect((await preview(second,start)).steps).toHaveLength(1);expect((await queue(second,start)).actionIds).toHaveLength(1);
});
it('checks rights expiry on every step, not only the first immediate action',async()=>{
 const f=await fixture();await save(f,plan(f,[f.lead],f.strategy,[0,24]));await authorize(f);await q(`update contact_rights set expires_at=now()+interval '12 hours' where tenant_id=$1`,[f.tenant]);await expect(preview(f,new Date(Date.now()+30000).toISOString())).rejects.toThrow('expiry');expect(await q('select id from outbound_actions where tenant_id=$1',[f.tenant])).toHaveLength(0);
});
it('binds the approved execution owner and rejects owner revocation and later setup drift',async()=>{
 const owner=crypto.randomUUID();await q(`insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())`,[owner,owner+'@owner.invalid']);await q('update profiles set is_admin=true where id=$1',[owner]);
 const f=await fixture({ownerId:owner});await save(f);await authorize(f);expect((await q('select operator_id from campaigns where id=$1',[f.id]))[0].operator_id).toBe(owner);
 await q('update profiles set is_admin=false where id=$1',[owner]);await expect(preview(f,new Date(Date.now()+30000).toISOString())).rejects.toThrow();await q('update profiles set is_admin=true where id=$1',[owner]);
 await seedReviveSetup(db,f.tenant,actor,{ownerId:owner,senderName:'Changed reviewed sender'});expect((await q('select status from campaigns where id=$1',[f.id]))[0].status).toBe('draft');expect(await rpc('revive_campaign_strategy_current',[f.tenant,f.id,1,f.lead,new Date().toISOString()])).toBe(false);
});
