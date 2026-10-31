import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {tenantUnsubscribe,confirmTenantUnsubscribe,hashUnsubscribeToken} from '../src/foundation/tenant-unsubscribe';
import type {Env} from '../src/env';
import {asOperator} from './helpers/access';
let db:PGlite;const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
const env={SUPABASE_URL:'https://fixture.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',SITE_URL:'https://fixture.invalid'} as Env;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return(await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) receipt`,args))[0].receipt;}finally{await db.exec('reset role');}}
async function fixture(name='Stop fixture'){const t=(await q(`insert into tenants(name,slug,country,currency,status) values($2,$1,'AE','AED','onboarding') returning id`,[crypto.randomUUID(),name]))[0].id;const l=(await q(`insert into leads(tenant_id,source,email) values($1,'import','shared@fixture.invalid') returning id`,[t]))[0].id;await asOperator(db,{tenantId:t,profileId:actor});return {t,l};}
const hash=(n:number)=>n.toString(16).padStart(64,'0');
const issue=(t:string,l:string,n=1)=>rpc('issue_tenant_unsubscribe',[t,l,actor,hash(n)]);
const confirm=(n=1)=>rpc('confirm_tenant_unsubscribe',[hash(n)]);
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(name,dir),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'staff@fixture.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
},60000);
afterAll(async()=>db.close());
beforeEach(()=>vi.restoreAllMocks());
it('scopes an explicit stop, freezes queued/claimed actions, preserves terminal receipts and denies late completion',async()=>{
 const a=await fixture(),b=await fixture();
 const observation=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose) values($1,$2,'fixture','objection-source',now(),'outreach') returning id`,[a.t,a.l]))[0].id;
 await q(`insert into contact_rights(tenant_id,lead_id,source_id,purpose,channel,market) values($1,$2,$3,'outreach','email','AE')`,[a.t,a.l,observation]);
 const campaign=(await q(`insert into campaigns(tenant_id,operator_id,capability,purpose,channel,market,timezone) values($1,$2,'events','outreach','email','AE','UTC') returning id`,[a.t,actor]))[0].id;
 const token=crypto.randomUUID();
 for(const state of ['queued','claimed','tested'])await q(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,state,lease_until,dispatch_token,provider_ref,acknowledged_at) values($1,$2,$3,$4,1,1,now(),$4,now()+interval '1 hour',$5,'receipt-fixture',now())`,[a.t,campaign,a.l,state,token]);
 const before=(await q(`select status from leads where id=$1`,[a.l]))[0];
 expect(await rpc('record_tenant_unsubscribe',[a.t,a.l,actor,'Verified objection #1'])).toEqual({version:1,status:'stopped',tenantId:a.t,leadId:a.l,alreadyStopped:false});
 expect(await rpc('record_tenant_unsubscribe',[a.t,a.l,actor,'Verified objection #1'])).toMatchObject({alreadyStopped:true});
 expect(await q('select * from lead_suppression where tenant_id=$1',[b.t])).toHaveLength(0);
 expect(await q('select * from suppression where email=$1',['shared@fixture.invalid'])).toHaveLength(0);
 expect((await q(`select decision,version,objected_at from contact_rights where lead_id=$1`,[a.l]))[0]).toMatchObject({decision:'denied',version:2});
 expect((await q('select status from leads where id=$1',[a.l]))[0]).toEqual(before);
 const actions=await q('select * from outbound_actions where tenant_id=$1 order by correlation_key',[a.t]);
 expect(actions.find(x=>x.correlation_key==='queued')).toMatchObject({state:'cancelled',lease_until:null,dispatch_token:token,provider_ref:'receipt-fixture'});
 const claimed=actions.find(x=>x.correlation_key==='claimed');expect(claimed).toMatchObject({state:'review',lease_until:null,dispatch_token:token,provider_ref:'receipt-fixture'});
 expect(actions.find(x=>x.correlation_key==='tested')).toMatchObject({state:'tested',dispatch_token:token,provider_ref:'receipt-fixture'});
 expect(await rpc('complete_fenced_synthetic_action',[a.t,claimed.id,token,1,1,new Date().toISOString()])).toBe(false);
 expect(await rpc('claim_fenced_synthetic_action',[a.t,claimed.id,crypto.randomUUID(),new Date().toISOString()])).toBeNull();
 const logs=await q(`select message from activity_log where tenant_id=$1 and message like '%tenant_contact_stop%'`,[a.t]);expect(logs).toHaveLength(1);expect(logs[0].message).not.toContain('Verified objection');expect(logs[0].message).not.toContain('@');
 expect(await issue(a.t,a.l,11)).toEqual({version:1,status:'stopped'});
},30000);
it('replaces objection trigger behavior without deleting historical global rows',async()=>{
 const a=await fixture(),b=await fixture();await q(`insert into suppression(email,reason) values('historical@fixture.invalid','objection')`);
 await q(`insert into subject_requests(tenant_id,lead_id,kind) values($1,$2,'object')`,[a.t,a.l]);
 expect(await q('select * from lead_suppression where tenant_id=$1',[a.t])).toHaveLength(1);expect(await q('select * from lead_suppression where tenant_id=$1',[b.t])).toHaveLength(0);
 expect(await q(`select * from suppression where email='historical@fixture.invalid'`)).toHaveLength(1);expect(await q(`select * from suppression where email='shared@fixture.invalid'`)).toHaveLength(0);
});
it('enforces hash-only scope, 90 days, one per minute, cap20, cleanup and unchanged older links',async()=>{
 const a=await fixture('Alpha Stops'),b=await fixture('Beta Stops');
 const first=await issue(a.t,a.l,20);expect(first.status).toBe('issued');
 const token=(await q('select * from ripepiper_private.tenant_unsubscribe_tokens where token_hash=$1',[hash(20)]))[0];expect(Date.parse(token.expires_at)-Date.parse(token.created_at)).toBe(90*86400000);
 expect(await issue(a.t,a.l,21)).toEqual({version:1,status:'limited'});
 await q(`update ripepiper_private.tenant_unsubscribe_tokens set created_at=clock_timestamp()-interval '61 seconds' where token_hash=$1`,[hash(20)]);
 expect((await issue(a.t,a.l,21)).status).toBe('issued');
 await q(`update ripepiper_private.tenant_unsubscribe_tokens set created_at=clock_timestamp()-interval '61 seconds' where tenant_id=$1`,[a.t]);
 for(let n=22;n<40;n++)await q(`insert into ripepiper_private.tenant_unsubscribe_tokens values($1,$2,$3,'shared@fixture.invalid',$4,now()-interval '2 minutes',now()+interval '90 days',null)`,[hash(n),a.t,a.l,actor]);
 expect(await issue(a.t,a.l,40)).toEqual({version:1,status:'limited'});
 await q(`update ripepiper_private.tenant_unsubscribe_tokens set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where token_hash=$1`,[hash(39)]);
 await q(`insert into ripepiper_private.tenant_unsubscribe_tokens values($1,$2,$3,'shared@fixture.invalid',$4,now()-interval '2 days',now()-interval '1 day',null)`,[hash(41),b.t,b.l,actor]);
 expect((await issue(a.t,a.l,40)).status).toBe('issued');
 expect(await q('select * from ripepiper_private.tenant_unsubscribe_tokens where token_hash=$1',[hash(39)])).toHaveLength(0);
 expect(await q('select * from ripepiper_private.tenant_unsubscribe_tokens where token_hash=$1',[hash(41)])).toHaveLength(1);
 expect(await confirm(20)).toEqual({version:1,status:'confirmed',businessName:'Alpha Stops'});
 expect(await q('select * from lead_suppression where tenant_id=$1',[b.t])).toHaveLength(0);
},30000);
it('denies unknown, expiry and changed address but historical replay precedes both with no mutation',async()=>{
 const a=await fixture();await issue(a.t,a.l,50);expect(await confirm(9999)).toEqual({version:1,status:'invalid'});
 await q(`update leads set email='replacement@fixture.invalid' where id=$1`,[a.l]);expect(await confirm(50)).toEqual({version:1,status:'invalid'});
 await q(`update leads set email='shared@fixture.invalid' where id=$1`,[a.l]);
 await q(`update ripepiper_private.tenant_unsubscribe_tokens set created_at=now()-interval '91 days',expires_at=clock_timestamp() where token_hash=$1`,[hash(50)]);expect(await confirm(50)).toEqual({version:1,status:'invalid'});
 await q(`update ripepiper_private.tenant_unsubscribe_tokens set expires_at=now()+interval '1 day' where token_hash=$1`,[hash(50)]);expect(await confirm(50)).toEqual({version:1,status:'confirmed',businessName:'Stop fixture'});
 await q(`update ripepiper_private.tenant_unsubscribe_tokens set expires_at=now()-interval '1 day' where token_hash=$1`,[hash(50)]);await q(`update leads set email='replacement@fixture.invalid' where id=$1`,[a.l]);
 const before=await q('select * from lead_suppression where tenant_id=$1',[a.t]);const receipt=await q('select * from ripepiper_private.tenant_unsubscribe_tokens where token_hash=$1',[hash(50)]);
 expect(await confirm(50)).toEqual({version:1,status:'confirmed',businessName:'Stop fixture'});expect(await q('select * from lead_suppression where tenant_id=$1',[a.t])).toEqual(before);expect(await q('select * from ripepiper_private.tenant_unsubscribe_tokens where token_hash=$1',[hash(50)])).toEqual(receipt);
});
it('denies foreign leads, unverified/mismatched/nonadmin actors and direct browser access',async()=>{
 const a=await fixture(),b=await fixture();
 await expect(rpc('record_tenant_unsubscribe',[a.t,b.l,actor,'Verified fixture'])).rejects.toThrow('Contact not found');expect(await q('select * from lead_suppression where tenant_id=$1',[a.t])).toHaveLength(0);
 for(const mode of ['email','verification','operator']){
  if(mode==='email')await q(`update profiles set email='mismatch@fixture.invalid' where id=$1`,[actor]);if(mode==='verification')await q('update auth.users set email_confirmed_at=null where id=$1',[actor]);if(mode==='operator')await q('update profiles set is_operator=false where id=$1',[actor]);
  await expect(issue(a.t,a.l,60)).rejects.toThrow('Verified staff required');await expect(rpc('record_tenant_unsubscribe',[a.t,a.l,actor,'Verified fixture'])).rejects.toThrow('Verified staff required');
  await q(`update profiles set email='staff@fixture.invalid',is_operator=true where id=$1`,[actor]);await q('update auth.users set email_confirmed_at=now() where id=$1',[actor]);
 }
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{for(const sql of [`select * from ripepiper_private.tenant_unsubscribe_tokens`,`select public.confirm_tenant_unsubscribe('${hash(60)}')`,`select public.issue_tenant_unsubscribe('${a.t}','${a.l}','${actor}','${hash(60)}')`,`select public.record_tenant_unsubscribe('${a.t}','${a.l}','${actor}','Verified fixture')`,`select ripepiper_private.apply_tenant_contact_stop('${a.t}','${a.l}')`])await expect(q(sql)).rejects.toThrow();}finally{await db.exec('reset role');}}
 expect((await q(`select relrowsecurity from pg_class where oid='ripepiper_private.tenant_unsubscribe_tokens'::regclass`))[0].relrowsecurity).toBe(true);
},30000);
it('runs Worker issuance and confirmation against real SQL receipts without provider calls',async()=>{
 const a=await fixture();const calls:string[]=[];
 vi.stubGlobal('fetch',async(input:any,init:any={})=>{
  const url=new URL(String(input));calls.push(url.pathname);
  if(url.pathname==='/auth/v1/user')return Response.json({id:actor,email:'staff@fixture.invalid'});
  if(url.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);
  const name=url.pathname.split('/').at(-1)!;const b=JSON.parse(init.body);let value;
  if(name==='issue_tenant_unsubscribe')value=await rpc(name,[b.p_tenant,b.p_lead,b.p_actor,b.p_hash]);else if(name==='confirm_tenant_unsubscribe')value=await rpc(name,[b.p_hash]);else if(name==='tenant_access')value=await rpc(name,[b.p_tenant,b.p_actor,b.p_capability]);else throw Error('Unexpected request');
  return Response.json(value);
 });
 const req=(body:any)=>new Request('https://untrusted.invalid/api',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)});
 const issued=await tenantUnsubscribe(req({operation:'issue_link'}),env,a.t,a.l);expect(issued.status).toBe(201);const receipt:any=await issued.json();expect(receipt.url).toMatch(/^https:\/\/fixture.invalid\/unsubscribe.html#token=[0-9a-f]{64}$/);expect(receipt.delivery).toBe('not_sent');
 const raw=new URL(receipt.url).hash.slice(7);expect((await q('select token_hash from ripepiper_private.tenant_unsubscribe_tokens where tenant_id=$1',[a.t]))[0].token_hash).toBe(await hashUnsubscribeToken(raw));
 const confirmed=await confirmTenantUnsubscribe(req({token:raw}),env);expect(await confirmed.json()).toEqual({version:1,status:'confirmed',businessName:'Stop fixture'});expect(confirmed.headers.get('Referrer-Policy')).toBe('no-referrer');expect(calls).toEqual(['/auth/v1/user','/rest/v1/profiles','/rest/v1/rpc/tenant_access','/rest/v1/rpc/issue_tenant_unsubscribe','/rest/v1/rpc/confirm_tenant_unsubscribe']);
 vi.unstubAllGlobals();
},30000);
it('Response opt-out evidence uses the same scoped stop and preserves other tenants sharing its email',async()=>{
 const a=await fixture(),b=await fixture();
 await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,assessment_reviewed_by,product_context) values($1,$2,'fixture','response-stop',now(),'response',$3,'{"product":"response","kind":"reply","disposition":"opt_out","threadRef":"fixture-thread"}')`,[a.t,a.l,actor]);
 expect(await q('select * from lead_suppression where tenant_id=$1 and lead_id=$2',[a.t,a.l])).toHaveLength(1);
 expect(await q('select * from lead_suppression where tenant_id=$1',[b.t])).toHaveLength(0);
 expect(await q(`select * from suppression where email='shared@fixture.invalid'`)).toHaveLength(0);
 expect(await q(`select * from subject_requests where tenant_id=$1 and lead_id=$2 and kind='object'`,[a.t,a.l])).toHaveLength(1);
});
