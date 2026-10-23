import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index';
import {eventOperations,publicEventMetadata,publicEventRegistration} from '../src/foundation/events';import {reviewProducts} from '../src/foundation/products';import type {Env} from '../src/env';
const admin='00000000-0000-4000-8000-000000000001';let db:PGlite,tenant:string,foreign:string;
const future=(hours:number)=>new Date(Date.now()+hours*3600000).toISOString();
const settings=(override:any={})=>({title:'Fixture event',startsAt:future(48),endsAt:future(49),timezone:'UTC',capacity:3,open:true,noticeReference:'Event-only fixture notice',confirmed:true,...override});
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,dir),'utf8'));
 tenant=(await db.query<any>(`insert into tenants(name,slug,country,currency,status)values('Events','events-fixture','AE','AED','active')returning id`)).rows[0].id;
 foreign=(await db.query<any>(`insert into tenants(name,slug,country,currency,status)values('Other','events-other','AE','AED','active')returning id`)).rows[0].id;
 await db.query(`insert into auth.users(id,email,email_confirmed_at)values($1,'staff@example.invalid',now())`,[admin]);await db.query('update profiles set is_admin=true where id=$1',[admin]);
 await db.query(`insert into business_briefs(tenant_id,version,body,created_by)values($1,1,$2,$3)`,[tenant,JSON.stringify({maxAgeDays:30,source:{observedAt:new Date().toISOString()}}),admin]);
});afterAll(async()=>db.close());
async function service<T>(fn:()=>Promise<T>){await db.exec('set role service_role');try{return await fn();}finally{await db.exec('reset role');}}
async function campaign(config:any={}){
 const id=(await db.query<any>(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone,status,client_authority_ref,owner_authority_ref,cts_profile_ref,expires_at,max_actions)values($1,'events',$2,'event-only','event','AE','UTC','approved','fixture-client','fixture-owner','fixture-cts',now()+interval '14 days',10)returning id`,[tenant,admin])).rows[0].id;
 await db.query(`insert into campaign_assets(tenant_id,campaign_id,version,brief_version,steps,created_by,approved_by,approved_at)values($1,$2,1,1,'[{"offsetHours":0,"subject":"Fixture","body":"Fixture","evidenceReference":"fixture"}]',$3,$3,now())`,[tenant,id,admin]);await configure(id,0,settings(config));return id;
}
const configure=(id:string,version:number,body:any,t=tenant)=>service(async()=>(await db.query<any>('select manage_event_settings($1,$2,$3,$4,$5) result',[t,id,admin,version,JSON.stringify(body)])).rows[0].result);
const register=(id:string,email:string,hash:string,version=1)=>service(async()=>(await db.query<any>('select register_synthetic_event($1,$2,$3,$4,$5) result',[id,version,email,'Fixture person',hash])).rows[0].result);
const change=(id:string,hash:string,operation='cancel',version=1)=>service(async()=>(await db.query<any>('select change_synthetic_registration($1,$2,$3,$4) result',[id,version,hash,operation])).rows[0].result);
const metadata=(id:string)=>service(async()=>(await db.query<any>('select event_public_metadata($1) result',[id])).rows[0].result);
const approve=(id:string)=>service(async()=>(await db.query<any>('select manage_campaign_plan($1,$2,$3,$4,1,$5)',[tenant,id,admin,'approve',JSON.stringify({clientAuthority:'fixture-client',ownerAuthority:'fixture-owner',ctsProfile:'fixture-cts',maxActions:10,expiresAt:future(24*14)})])).rows[0]);
const token=(n:number)=>n.toString(16).padStart(64,'0');
describe('offline Events registration lifecycle on existing records',()=>{
 it('requires current staff-reviewed event/campaign settings and records versioned private audit',async()=>{
  const id=await campaign();expect(await metadata(id)).toMatchObject({id,version:1,mode:'synthetic_only'});
  const current=(await db.query<any>('select event_settings from campaigns where id=$1',[id])).rows[0].event_settings;
  await expect(configure(id,0,settings())).rejects.toThrow('settings changed');await expect(configure(id,1,settings({confirmed:false}))).rejects.toThrow('Reviewed');
  await expect(configure(id,1,settings(),foreign)).rejects.toThrow('scope');await expect(configure(id,1,settings({timezone:'Invalid/Zone'}))).rejects.toThrow('time or capacity');
  const closed=settings({open:false});expect(await configure(id,1,closed)).toMatchObject({version:2});expect(await configure(id,1,closed)).toMatchObject({version:2,replayed:true});expect(await configure(id,2,closed)).toMatchObject({version:2,replayed:true});
  expect(await metadata(id)).toBeNull();const audit=(await db.query<any>(`select * from activity_log where tenant_id=$1 and message like $2`,[tenant,'%'+id+'%'])).rows;expect(audit).toHaveLength(2);expect(audit.every(r=>!r.visible_to_client&&r.actor===admin)).toBe(true);expect(current.open).toBe(true);
 });
 it('deduplicates exact registration, withholds another token control and never grants marketing rights or reviewed identity',async()=>{
  const id=await campaign();const hash=token(1);expect(await register(id,'one@example.invalid',hash)).toMatchObject({state:'registered',identityStatus:'unverified',attendance:'unknown',marketingPermission:'not_granted'});
  expect(await register(id,'one@example.invalid',hash)).toMatchObject({state:'registered'});
  expect(await register(id,'one@example.invalid',token(2))).toMatchObject({state:'request_received',controlAvailable:false});
  await expect(change(id,token(2))).rejects.toThrow('capability unavailable');await expect(register(id,'different@example.invalid',hash)).rejects.toThrow('reference reused');
  const rows=(await db.query<any>(`select * from lead_observations where source='event_registration' and product_context->>'eventRef'=$1`,[id])).rows;expect(rows).toHaveLength(1);expect(rows[0].assessment_reviewed_by).toBeNull();
  expect(reviewProducts(JSON.parse(JSON.stringify(rows)),Date.now(),false,'candidate').find(r=>r.product==='events')?.state).toBe('needs_evidence');
  expect((await db.query('select * from contact_rights where lead_id=$1',[rows[0].lead_id])).rows).toHaveLength(0);
  await expect(register(id,'real@business.example',token(3))).rejects.toThrow('Synthetic identity');
 });
 it('enforces atomic capacity, cancellation replay, and no resurrection from original registration replay',async()=>{
  const id=await campaign({capacity:1});const attempts=await Promise.allSettled([register(id,'capacity-a@example.invalid',token(10)),register(id,'capacity-b@example.invalid',token(11))]);
  expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(attempts.filter(r=>r.status==='rejected')).toHaveLength(1);
  const first=attempts[0].status==='fulfilled'?{email:'capacity-a@example.invalid',hash:token(10)}:{email:'capacity-b@example.invalid',hash:token(11)};
  expect(await change(id,first.hash)).toMatchObject({state:'cancelled'});expect(await change(id,first.hash)).toMatchObject({state:'cancelled'});expect(await register(id,first.email,first.hash)).toMatchObject({state:'cancelled'});
  expect(await register(id,'capacity-c@example.invalid',token(12))).toMatchObject({state:'registered'});
  expect((await db.query(`select * from lead_observations where source='event_registration_cancel' and product_context->>'eventRef'=$1`,[id])).rows).toHaveLength(1);
 });
 it('requires updated event-version acknowledgement after reschedule, keeping attendance unknown',async()=>{
  const id=await campaign();await register(id,'schedule@example.invalid',token(20));await configure(id,1,settings({startsAt:future(72),endsAt:future(73)}));await approve(id);
  expect(await register(id,'schedule@example.invalid',token(20))).toMatchObject({state:'schedule_changed',version:2,acknowledgedVersion:1});
  await expect(change(id,token(20),'acknowledge',1)).rejects.toThrow('version changed');expect(await change(id,token(20),'acknowledge',2)).toMatchObject({state:'registered',acknowledgedVersion:2,attendance:'unknown'});
  expect(await change(id,token(20),'acknowledge',2)).toMatchObject({state:'registered'});await expect(register(id,'stale@example.invalid',token(21),1)).rejects.toThrow('version unavailable');
 });
 it('invalidates the previous message approval and holds queued work after material event settings change',async()=>{
  const id=await campaign();await register(id,'changed@example.invalid',token(25));const lead=(await db.query<any>(`select id from leads where tenant_id=$1 and email='changed@example.invalid'`,[tenant])).rows[0].id;
  await db.query(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,state)values($1,$2,$3,'event-queued',1,1,now(),'queued'),($1,$2,$3,'event-claimed',1,1,now(),'claimed')`,[tenant,id,lead]);
  await configure(id,1,settings({title:'Changed event title'}));expect(await metadata(id)).toBeNull();
  expect((await db.query<any>('select status,approval_version from campaigns where id=$1',[id])).rows[0]).toMatchObject({status:'draft',approval_version:2});
  expect((await db.query<any>('select state from outbound_actions where campaign_id=$1 order by correlation_key',[id])).rows.map(r=>r.state)).toEqual(['review','cancelled']);
  expect((await db.query<any>('select approved_by from campaign_assets where campaign_id=$1',[id])).rows[0].approved_by).toBeNull();await approve(id);expect(await metadata(id)).toMatchObject({version:2});
 });
 it('fails closed for paused/expired campaigns and wrong-event capabilities while still accepting cancellation',async()=>{
  const id=await campaign(),other=await campaign();await register(id,'pause@example.invalid',token(30));await expect(change(other,token(30))).rejects.toThrow('capability unavailable');
  await db.query(`update tenants set status='paused' where id=$1`,[tenant]);expect(await metadata(id)).toBeNull();await expect(register(id,'paused@example.invalid',token(31))).rejects.toThrow('Event unavailable');expect(await change(id,token(30))).toMatchObject({state:'cancelled'});await db.query(`update tenants set status='active' where id=$1`,[tenant]);
  await db.query(`update campaigns set expires_at=now()-interval '1 hour' where id=$1`,[id]);expect(await metadata(id)).toBeNull();await expect(register(id,'expired@example.invalid',token(32))).rejects.toThrow('version unavailable');
 });
 it('expires lifecycle capabilities after the retained event window',async()=>{
  const id=await campaign();await register(id,'old-capability@example.invalid',token(45));
  await service(async()=>{await db.query(`update campaigns set event_settings=jsonb_set(event_settings,'{endsAt}',to_jsonb((now()-interval '8 days')::text)) where id=$1`,[id]);await db.query(`update lead_observations set product_context=jsonb_set(product_context,'{endsAt}',to_jsonb((now()-interval '8 days')::text)) where source='event_registration' and product_context->>'eventRef'=$1`,[id]);});
  await expect(change(id,token(45))).rejects.toThrow('capability unavailable');
  await expect(register(id,'old-capability@example.invalid',token(45))).rejects.toThrow('capability unavailable');
  await expect(service(async()=>db.query('select read_synthetic_registration($1,1,$2,$3,$4)',[id,'old-capability@example.invalid','Fixture person',token(45)]))).rejects.toThrow('capability unavailable');
  expect((await db.query(`select * from lead_observations where source='event_registration' and product_context->>'eventRef'=$1`,[id])).rows).toHaveLength(1);
 });
 it('runs actual Worker routes through a synthetic PostgREST adapter into the real lifecycle RPCs',async()=>{
  const id=await campaign();const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SITE_URL:'http://localhost:8787',EVENT_REGISTRATION_ENABLED:'true',SYNTHETIC_SINK_ENABLED:'true'} as Env;
  const signatures:Record<string,string[]>={event_public_metadata:['p_campaign'],read_synthetic_registration:['p_campaign','p_version','p_email','p_name','p_hash'],register_synthetic_event:['p_campaign','p_version','p_email','p_name','p_hash'],change_synthetic_registration:['p_campaign','p_version','p_hash','p_operation']};
  vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
   const url=new URL(input),name=url.pathname.split('/').pop()!;if(url.host!=='fixture.supabase.co'||!signatures[name])throw Error('Unexpected external access');
   const body=JSON.parse(String(init.body)),keys=signatures[name];try{const result=await service(async()=>(await db.query<any>('select '+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') result',keys.map(k=>body[k]))).rows[0].result);return Response.json(result);}catch(error:any){return Response.json({code:error.code,message:error.message},{status:409});}
  });
  const ctx={waitUntil(){}} as unknown as ExecutionContext;
  const call=(body?:any)=>worker.fetch(new Request('https://fixture.invalid/api/events/'+id,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined}),env,ctx);
  expect((await(await call()).json()as any).event.id).toBe(id);
  const body={operation:'register',version:1,email:'worker@example.invalid',name:'Worker fixture',capability:token(60),consent:true};
  const first:any=await(await call(body)).json();expect(first.registration).toMatchObject({state:'registered',eventId:id,identityStatus:'unverified'});expect(await(await call(body)).json()).toEqual(first);
  expect((await(await call({operation:'cancel',version:1,capability:token(60)})).json()as any).registration.state).toBe('cancelled');
  expect((await db.query(`select * from outbound_actions where campaign_id=$1`,[id])).rows).toHaveLength(0);
 });
 it('denies client RPCs and forged direct raw intake even for a signed-in admin',async()=>{
  const id=await campaign(),lead=(await db.query<any>(`insert into leads(tenant_id,source,email)values($1,'event','forged@example.invalid')returning id`,[tenant])).rows[0].id;
  await db.exec(`set role authenticated;select set_config('request.jwt.sub','${admin}',false)`);try{
   await expect(db.query('select register_synthetic_event($1,1,$2,$3,$4)',[id,'forged@example.invalid','Fixture',token(40)])).rejects.toThrow('permission denied');
   await expect(db.query(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,product_context)values($1,$2,'event_registration','forged',now(),'fixture',true,$3)`,[tenant,lead,JSON.stringify({product:'events',kind:'registration_intake',identityStatus:'unverified'})])).rejects.toThrow('Event intake service');
  }finally{await db.exec('reset role');}
 });
});
describe('Events HTTP boundaries and result validation',()=>{
 const event='11111111-1111-4111-8111-111111111111';const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',SITE_URL:'http://localhost:8787',SYNTHETIC_SINK_ENABLED:'true',EVENT_REGISTRATION_ENABLED:'true'} as Env;
 const body=()=>({operation:'register',version:1,email:'fixture@example.invalid',name:'Fixture',capability:token(50),consent:true});
 const request=(b:any)=>new Request('https://fixture.invalid/api',{method:'POST',headers:{Authorization:'Bearer staff'},body:JSON.stringify(b)});
 const good=()=>({eventId:event,registrationId:admin,state:'registered',version:1,acknowledgedVersion:1,identityStatus:'unverified',attendance:'unknown',marketingPermission:'not_granted',delivery:'not_sent'});
 function provider(result:any){const calls:any[]=[];vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{const u=new URL(input);calls.push({url:u.href,body:init.body&&JSON.parse(String(init.body))});if(u.pathname==='/auth/v1/user')return Response.json({id:admin,email:'staff@example.invalid'});if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);if(u.pathname==='/rest/v1/tenants')return Response.json([{id:tenant}]);return Response.json(u.pathname.endsWith('/read_synthetic_registration')?null:result);});return calls;}
 it('is off by default, rejects real addresses and missing event-only acknowledgement before persistence',async()=>{
  const calls=provider(good());expect((await publicEventRegistration(request(body()),{...env,EVENT_REGISTRATION_ENABLED:undefined},event)).status).toBe(404);expect((await publicEventMetadata(request({}),{...env,SYNTHETIC_SINK_ENABLED:'false'},event)).status).toBe(404);
  expect((await publicEventRegistration(request({...body(),email:'contact@business.example'}),env,event)).status).toBe(400);expect((await publicEventRegistration(request({...body(),consent:false}),env,event)).status).toBe(400);expect(calls).toHaveLength(0);
 });
 it('hashes the client capability and returns whitelisted validated receipt fields',async()=>{
  const calls=provider({...good(),privateUnexpected:'must not escape'});const response=await publicEventRegistration(request(body()),env,event);expect(response.status).toBe(200);expect(JSON.stringify(await response.json())).not.toContain('privateUnexpected');
  expect(calls[0].body.p_hash).toMatch(/^[0-9a-f]{64}$/);expect(calls[0].body.p_hash).not.toBe(body().capability);expect(JSON.stringify(calls)).not.toContain(body().capability);
 });
 it('recovers a validated committed receipt without repeating verification or inserting again',async()=>{
  const calls:string[]=[];vi.stubGlobal('fetch',async(input:string)=>{calls.push(input);return Response.json(good());});
  expect((await publicEventRegistration(request(body()),{...env,SITE_URL:'https://fixture.invalid',TURNSTILE_SECRET:'fixture'},event)).status).toBe(200);
  expect(calls).toHaveLength(1);expect(calls[0]).toContain('read_synthetic_registration');
 });
 it.each([null,{},false,1,'false',{...good(),identityStatus:'verified'},{...good(),acknowledgedVersion:2},{...good(),eventId:admin},{...good(),version:2}])('does not report a malformed RPC receipt as success: %j',async value=>{provider(value);expect((await publicEventRegistration(request(body()),env,event)).status).toBe(503);});
 it.each([{},false,1,{id:event,version:1}])('rejects malformed public metadata: %j',async value=>{provider(value);expect((await publicEventMetadata(request({}),env,event)).status).toBe(503);});
 it('requires Turnstile outside the local environment and does not call persistence on failed verification',async()=>{
  const calls:any[]=[];vi.stubGlobal('fetch',async(input:string)=>{calls.push(input);return Response.json(input.includes('read_synthetic_registration')?null:{success:false});});expect((await publicEventRegistration(request(body()),{...env,SITE_URL:'https://fixture.invalid',TURNSTILE_SECRET:'fixture'},event)).status).toBe(400);expect(calls.every(u=>u.includes('siteverify')||u.includes('read_synthetic_registration'))).toBe(true);
 });
 it.each([null,{},true,{id:event,version:2,replayed:false}])('rejects malformed/wrong-version settings acknowledgement: %j',async value=>{provider(value);expect((await eventOperations(request({operation:'configure',campaign_id:event,expected_version:0,settings:settings()}),env,tenant)).status).toBe(503);});
});
