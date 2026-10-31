import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {brandProfile,setupBody,strategyBody,fixtureService} from './helpers/revive-setup';
import {brandSignoff} from '../src/lib/brand';
import {validSetupBody,validSetupContext} from '../src/foundation/revive-setup';
import {assessRevive} from '../src/foundation/revive';
import {asOperator,asOwner} from './helpers/access';
const actor='81111111-1111-4111-8111-111111111111',other='82222222-2222-4222-8222-222222222222';
let db:PGlite;
const q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
const rpc=(name:string,args:any[])=>fixtureService(db,name,args);
const unknown=()=>({website:null,supportedClaims:[],sourceInventory:[],relationshipSummary:null,senderName:null,senderEmail:null,ownerId:null,market:null,language:null,timezone:null,salesCapacityPerWeek:null,outcomeWindowDays:null,workingDays:null,startMinute:null,endMinute:null,dailyContactCap:null});
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,dir),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'setup-staff@example.invalid',now()),($2,'setup-viewer@example.invalid',now())`,[actor,other]);await q('update profiles set is_admin=true where id=$1',[actor]);
},30000);afterAll(async()=>db?.close());
async function fixture(withBrief=true){
 const tenant=(await q(`insert into tenants(name,slug,country,currency) values('Setup fixture',$1,'AE','AED') returning id`,[crypto.randomUUID()]))[0].id;
 await asOperator(db,{tenantId:tenant,profileId:actor});
 const body={offer:'Reviewed project recovery',industries:['construction'],markets:['AE'],roles:['owner'],needs:['project recovery'],aliases:{need:{'project recovery':['delivery recovery']}},excludedIndustries:[],maxAgeDays:30,source:{reference:'interview:reviewed',excerpt:'Reviewed current business offer',observedAt:new Date(Date.now()-86400000).toISOString()}};
 if(withBrief)await rpc('save_business_brief',[tenant,0,body,actor]);return{tenant,body};
}
const save=(tenant:string,version=0,body:any=setupBody(actor),state='reviewed',brief:number|null=1)=>rpc('save_revive_setup',[tenant,actor,version,brief,state,body]);
describe('versioned reviewed setup database contract',()=>{
 it('stores unknown draft data before a business brief without making up readiness',async()=>{
  const f=await fixture(false);expect(await save(f.tenant,0,unknown(),'draft',null)).toEqual({tenantId:f.tenant,version:1,briefVersion:null,state:'draft',ready:false,delivery:'not_sent'});
  const c=await rpc('revive_setup_context',[f.tenant,actor]);expect(validSetupContext(c,f.tenant)).toBe(true);expect(c.ready).toBe(false);expect(c.missing).toContain('current_brief_required');expect(c.setup.body).toEqual(unknown());expect(await rpc('revive_setup_current',[f.tenant,1,new Date().toISOString()])).toBe(false);
 });
 it('links a current full brief, records declared configuration and performs exact-body replay without another version',async()=>{
  const f=await fixture(),body=setupBody(actor),first=await save(f.tenant,0,body);expect(first).toMatchObject({version:1,state:'reviewed',ready:true});
  expect(await save(f.tenant,0,body)).toEqual(first);expect(await save(f.tenant,1,body)).toEqual(first);expect((await q('select count(*)::int n from revive_setups where tenant_id=$1',[f.tenant]))[0].n).toBe(1);
  const c=await rpc('revive_setup_context',[f.tenant,actor]);expect(validSetupContext(c,f.tenant)).toBe(true);expect(c.ready).toBe(true);expect(c.brief.body).toEqual(f.body);expect(c.setup.body.supportedClaims).toEqual([]);
 });
 it('prevents stale overwrites while preserving exact retries of only the latest setup',async()=>{
  const f=await fixture(),a=setupBody(actor),b={...a,dailyContactCap:4};await save(f.tenant,0,a);await save(f.tenant,1,b);await expect(save(f.tenant,0,a)).rejects.toThrow(/Setup changed/);expect((await save(f.tenant,1,b)).version).toBe(2);
 });
 it.each([{unknown:'field'},{senderEmail:'name\nBcc:injected@business.com'},{workingDays:[1,1]},{startMinute:1000,endMinute:500},{dailyContactCap:26},{language:'invalid_language'},{timezone:'Unconfigured/Zone'},{website:{url:'http://business.com',reference:'reviewed'}},{sourceInventory:[{type:'email',reference:'message',rightsReference:''}]}])('rejects invalid source/configuration shape at SQL boundary %j',async patch=>{
  const f=await fixture(),body={...setupBody(actor),...patch};expect(validSetupBody(body)).toBe(false);expect(await rpc('revive_setup_body_valid',[body])).toBe(false);await expect(save(f.tenant,0,body)).rejects.toThrow();expect(await q('select version from revive_setups where tenant_id=$1',[f.tenant])).toHaveLength(0);
 });
 it.each(['roles','offer','source','aliases'])('does not call a dated but invalid brief complete when %s is missing/invalid',async field=>{
  const f=await fixture(),broken:any={...f.body};if(field==='aliases')broken.aliases={need:{unlisted:['anything']}};else delete broken[field];await q('update business_briefs set body=$1 where tenant_id=$2',[broken,f.tenant]);
  await expect(save(f.tenant)).rejects.toThrow(/current brief/);expect(await rpc('revive_setup_brief_valid',[broken,new Date().toISOString()])).toBe(false);
 });
 it('requires completeness, current staff owner and the current brief before reviewed state',async()=>{
  const f=await fixture();await expect(save(f.tenant,0,unknown())).rejects.toThrow(/Complete setup/);await expect(save(f.tenant,0,setupBody(other))).rejects.toThrow(/authorized owner/);
  await save(f.tenant);await rpc('save_business_brief',[f.tenant,1,{...f.body,offer:'Amended reviewed offer'},actor]);expect(await rpc('revive_setup_current',[f.tenant,1,new Date().toISOString()])).toBe(false);const c=await rpc('revive_setup_context',[f.tenant,actor]);expect(c.missing).toContain('current_brief_required');expect(validSetupContext(c,f.tenant)).toBe(true);await expect(save(f.tenant,1)).rejects.toThrow(/Business brief changed/);
 });
 it('requires reviewed setup for service-role Revive activation without granting campaign authority',async()=>{
  const f=await fixture();await expect(rpc('activate_tenant_execution',[f.tenant,actor,'onboarding',0,1,'Reviewed readiness to activate'])).rejects.toThrow(/Revive setup required/);expect(await q('select tenant_id from tenant_activation_reviews where tenant_id=$1',[f.tenant])).toHaveLength(0);
  await save(f.tenant);expect(await rpc('activate_tenant_execution',[f.tenant,actor,'onboarding',0,1,'Reviewed readiness to activate'])).toMatchObject({status:'active',version:1});expect(await q('select id from campaigns where tenant_id=$1',[f.tenant])).toHaveLength(0);
 });
 it('invalidates only changed Revive authority and pending execution, preserving campaign assets and other products',async()=>{
  const f=await fixture();await save(f.tenant);await q("update tenants set status='active' where id=$1",[f.tenant]);
  const revive=(await q(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone,status,client_authority_ref,owner_authority_ref,cts_profile_ref,expires_at,max_actions) values($1,'revive',$2,'review','email','AE','UTC','approved','client','owner','profile',now()+interval '1 day',3) returning id`,[f.tenant,actor]))[0].id;
  const signal=(await q(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone,status) values($1,'signal',$2,'review','email','AE','UTC','draft') returning id`,[f.tenant,actor]))[0].id;
  const before=(await q('select approval_version from campaigns where id=$1',[revive]))[0].approval_version;
  await save(f.tenant,1,setupBody(actor));expect((await q('select status,approval_version from campaigns where id=$1',[revive]))[0]).toEqual({status:'approved',approval_version:before});
  await save(f.tenant,1,{...setupBody(actor),dailyContactCap:5});expect((await q('select status,approval_version from campaigns where id=$1',[revive]))[0]).toEqual({status:'draft',approval_version:before+1});expect((await q('select status,approval_version from campaigns where id=$1',[signal]))[0]).toEqual({status:'draft',approval_version:1});
 });
 it('cancels queued actions and holds a claimed fence when a real approved synthetic plan loses its setup version',async()=>{
  const f=await fixture();await save(f.tenant);await q("update tenants set status='active' where id=$1",[f.tenant]);
  const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[f.tenant,crypto.randomUUID()+'@example.invalid']))[0].id,observed=new Date(Date.now()-86400000).toISOString();
  const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'reviewed','fit',$3,'assessment','review:rights',true,$4,'construction AE owner project recovery',$5) returning id`,[f.tenant,lead,observed,{industry:'construction',market:'AE',role:'owner',need:'project recovery'},actor]))[0].id;
  await rpc('record_product_event',[f.tenant,lead,actor,'history','review:rights','Reviewed relationship history',observed,true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-75*86400000).toISOString(),previousInterest:'yes',stalledReason:'Client timing'}]);
  const c=await rpc('revive_review_context',[f.tenant,lead,actor]);await rpc('review_revive_candidate',[f.tenant,lead,actor,0,c.snapshot,1,'accepted','Reviewed current fit and history',assessRevive(c).expiresAt]);
  const campaign=crypto.randomUUID(),plan={product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',audience:{leadIds:[lead],confirmed:true},strategy:strategyBody(1,'project recovery','interview:reviewed'),steps:[{offsetHours:0,subject:'Reviewing the project',body:'Is this relevant?',evidenceReference:'interview:reviewed'},{offsetHours:72,subject:'Following up',body:'May we close the loop?',evidenceReference:'interview:reviewed'}]};
  await rpc('manage_campaign_plan',[f.tenant,campaign,actor,'save',0,plan]);await rpc('manage_campaign_plan',[f.tenant,campaign,actor,'approve',1,{clientAuthority:'client',ownerAuthority:'owner',ctsProfile:'profile',maxActions:3,expiresAt:new Date(Date.now()+7*86400000).toISOString()}]);await rpc('manage_campaign_plan',[f.tenant,campaign,actor,'rights',1,{leadId:lead,sourceId:source,noticeReference:'test-only'}]);
  const enrolled=await rpc('manage_campaign_plan',[f.tenant,campaign,actor,'queue',1,{leadId:lead,startAt:new Date(Date.now()+1000).toISOString()}]),token=crypto.randomUUID();
  const claim=await rpc('claim_fenced_synthetic_action',[f.tenant,enrolled.actionIds[0],token,new Date(Date.now()+2000).toISOString()]);expect(claim).not.toBeNull();
  await save(f.tenant,1,{...setupBody(actor),dailyContactCap:5});
  expect((await q('select state,error_code from outbound_actions where campaign_id=$1 order by message_step',[campaign])).map(a=>a.state)).toEqual(['review','cancelled']);
  expect((await q('select steps from campaign_assets where campaign_id=$1',[campaign]))[0].steps).toEqual(plan.steps);expect((await q('select status from campaigns where id=$1',[campaign]))[0].status).toBe('draft');
 });
 it('records an identical setup re-reviewed by a different current staff actor as a new version',async()=>{
  const f=await fixture();await save(f.tenant);await asOperator(db,{tenantId:f.tenant,profileId:other});
  try{expect(await rpc('save_revive_setup',[f.tenant,other,1,1,'reviewed',setupBody(actor)])).toMatchObject({version:2,ready:true});expect((await q('select created_by from revive_setups where tenant_id=$1 and version=2',[f.tenant]))[0].created_by).toBe(other);}finally{await q('update profiles set is_operator=false where id=$1',[other]);}
 });
 it('covers current cohort reviewer, distinct setup owner/creator and strategy reviewer in both role/auth tenant-lock predicates',async()=>{
  for(const name of ['public.lock_revive_reviewer()','ripepiper_private.lock_revive_auth_authority()']){
   const definition=(await q('select pg_get_functiondef($1::regprocedure) definition',[name]))[0].definition;
   for(const term of ['revive_reviews','reviewer_id','revive_setups','created_by','ownerId','campaign_assets','revive_strategy','reviewedBy','order by t.id for update'])expect(definition).toContain(term);
  }
  const triggers=await q(`select t.tgname,pg_get_triggerdef(t.oid) definition from pg_trigger t where t.tgname in ('revive_reviewer_lock','revive_auth_authority_lock')`);expect(triggers).toHaveLength(2);
  expect(triggers.find(t=>t.tgname==='revive_reviewer_lock').definition).toContain('DELETE');expect(triggers.find(t=>t.tgname==='revive_auth_authority_lock').definition).toContain('email_confirmed_at');
  // This is executed predicate/trigger coverage, not independent-session race proof.
 });
 it('allows a restricted Auth backend to revoke confirmation while denying API-role direct access to the private lock trigger',async()=>{
  const f=await fixture();await asOperator(db,{tenantId:f.tenant,profileId:other});await save(f.tenant,0,setupBody(other));
  await db.exec('create role fixture_auth_backend;grant usage on schema auth to fixture_auth_backend;grant select(id,email_confirmed_at),update(email_confirmed_at) on auth.users to fixture_auth_backend;set role fixture_auth_backend');
  try{await q('update auth.users set email_confirmed_at=null where id=$1',[other]);}finally{await db.exec('reset role');}
  expect(await rpc('revive_setup_current',[f.tenant,1,new Date().toISOString()])).toBe(false);
  const c=await rpc('revive_setup_context',[f.tenant,actor]);expect(c.missing).toContain('owner_unavailable');expect(validSetupContext(c,f.tenant)).toBe(true);
  for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);try{await expect(q('select ripepiper_private.lock_revive_auth_authority()')).rejects.toThrow(/permission/);}finally{await db.exec('reset role');}}
  await q('update auth.users set email_confirmed_at=now() where id=$1',[other]);await q('update profiles set is_operator=false where id=$1',[other]);
  expect(await rpc('revive_setup_current',[f.tenant,1,new Date().toISOString()])).toBe(false);
 });
 it('allows restricted Auth deletion and its real profiles FK cascade for a distinct setup owner',async()=>{
  const owner=crypto.randomUUID(),f=await fixture();await q(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[owner,owner+'@example.invalid']);await asOwner(db,{tenantId:f.tenant,profileId:owner});
  await save(f.tenant,0,setupBody(owner));
  await db.exec('create role fixture_auth_delete;grant usage on schema auth to fixture_auth_delete;grant select(id),delete on auth.users to fixture_auth_delete;set role fixture_auth_delete');
  try{await q('delete from auth.users where id=$1',[owner]);}finally{await db.exec('reset role');}
  expect(await q('select id from profiles where id=$1',[owner])).toHaveLength(0);expect(await rpc('revive_setup_current',[f.tenant,1,new Date().toISOString()])).toBe(false);
  const c=await rpc('revive_setup_context',[f.tenant,actor]);expect(c.missing).toContain('owner_unavailable');expect(validSetupContext(c,f.tenant)).toBe(true);
 });
 it('refuses mutable setup history and nonstaff/cross-role writes; tenant viewers cannot read staff setup',async()=>{
  const f=await fixture();await save(f.tenant);
  await expect(q("update revive_setups set body='{}' where tenant_id=$1",[f.tenant])).rejects.toThrow(/append only/);
  await expect(rpc('save_revive_setup',[f.tenant,other,1,1,'draft',unknown()])).rejects.toThrow(/Staff service/);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await expect(q('select save_revive_setup($1,$2,1,1,$3,$4)',[f.tenant,actor,'draft',unknown()])).rejects.toThrow(/permission/);if(role==='authenticated'){await q(`select set_config('request.jwt.sub',$1,false)`,[other]);expect(await q('select * from revive_setups where tenant_id=$1',[f.tenant])).toHaveLength(0);}}finally{await db.exec('reset role');}}
 });
});
describe('tenant brand profile in the setup body',()=>{
 const valid=async(body:any)=>(await rpc('revive_setup_body_valid',[body]));
 it('validates the old 16-key and the new 20-key bodies identically in SQL and the Worker',async()=>{
  for(const body of [setupBody(actor),setupBody(actor,'interview:fixture',brandProfile()),setupBody(actor,'interview:fixture',{replyTo:null,signature:null,booking:null,legalFooter:null}),setupBody(actor,'interview:fixture',{signature:'Only a signature'})]){
   expect(await valid(body)).toBe(true);expect(validSetupBody(body)).toBe(true);
  }
 });
 it.each([{replyTo:'a@b.com\nBcc:x@y.com'},{signature:'<b>Signer</b>'},{signature:'Hi {{need}}'},{signature:'x'.repeat(501)},{booking:{url:'http://cal.business.com/book',reference:'r'}},{booking:{url:'https://localhost/book',reference:'r'}},{booking:{url:'https://cal.business.com/book'}},
  {legalFooter:{postalAddress:'x'.repeat(301),reference:'legal'}},{legalFooter:{postalAddress:'1 [Main] St',reference:'legal'}},{logo:'https://business.com/logo.png'}])('rejects unsafe brand value %j in SQL and the Worker',async patch=>{
  const body=setupBody(actor,'interview:fixture',patch);expect(await valid(body)).toBe(false);expect(validSetupBody(body)).toBe(false);
 });
 it('rejects non-object bodies without raising',async()=>{for(const body of [1,'"x"',[],'null'])expect(await valid(body)).toBe(false);});
 it('renders the same sign-off in SQL as brandSignoff',async()=>{
  for(const [setup,name] of [[brandProfile(),'Acme'],[{senderName:'Ana',signature:null,legalFooter:null},'Acme'],[{senderName:' Ana ',signature:'  ',legalFooter:{postalAddress:' 1 Main St\nDubai '}},' Acme '],[{},'Acme']] as [any,string][])
   expect(await rpc('revive_setup_signoff',[setup,name,'Reply stop.'])).toBe(brandSignoff(setup,name,'Reply stop.'));
 });
 it('a brand edit is a new setup version that moves approved Revive campaigns back to draft',async()=>{
  const f=await fixture();await save(f.tenant);await q("update tenants set status='active' where id=$1",[f.tenant]);
  const revive=(await q(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone,status,client_authority_ref,owner_authority_ref,cts_profile_ref,expires_at,max_actions) values($1,'revive',$2,'review','email','AE','UTC','approved','client','owner','profile',now()+interval '1 day',3) returning id`,[f.tenant,actor]))[0].id;
  const before=(await q('select approval_version from campaigns where id=$1',[revive]))[0].approval_version;
  expect(await save(f.tenant,1,setupBody(actor,'interview:fixture',brandProfile()))).toMatchObject({version:2,ready:true});
  expect((await q('select status,approval_version from campaigns where id=$1',[revive]))[0]).toEqual({status:'draft',approval_version:before+1});
  const c=await rpc('revive_setup_context',[f.tenant,actor]);expect(validSetupContext(c,f.tenant)).toBe(true);expect(c.setup.body.legalFooter).toEqual(brandProfile().legalFooter);
 });
});
