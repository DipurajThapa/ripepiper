import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index';
import {runScheduled} from '../src/jobs';
import {Db} from '../src/lib/db';
import {connectionAad,open,seal} from '../src/lib/vault';
import {reserveAI} from '../src/lib/build-budget';
import {sealedArgs,tenantConnection} from '../src/foundation/connections';
import {executeSyntheticAction} from '../src/foundation/action-reliability';
import {loadTenantSend,tenantMeeting} from '../src/foundation/tenant-send';
import {validProspectSnapshot} from '../src/foundation/prospect-snapshot';
import {proposeReviveDraft} from '../src/foundation/revive-draft';
import type {Env} from '../src/env';
import {seedReviveSetup,strategyBody} from './helpers/revive-setup';
import {asOwner} from './helpers/access';

// The seven owner acceptance tests: real migrations in PGlite behind a PostgREST-shaped bridge, real Worker handlers,
// provider endpoints stubbed, synthetic .invalid/.example data, delivery never leaves the synthetic sink.
let db:PGlite;
const KEY=btoa(String.fromCharCode(...Array.from({length:32},(_,i)=>i+7)));
const env={SUPABASE_URL:'https://db.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',SITE_URL:'https://ripepiper.example',MAIL_FROM:'Ripe Piper <hello@ripepiper.example>',
 OAUTH_ENABLED:'true',GOOGLE_CLIENT_ID:'g-client',GOOGLE_CLIENT_SECRET:'g-secret',MS_CLIENT_ID:'m-client',MS_CLIENT_SECRET:'m-secret',
 CONNECTION_KEYS:JSON.stringify({k1:KEY}),CONNECTION_KEY_CURRENT:'k1',SYNTHETIC_SINK_ENABLED:'true'} as Env;
const denied=expect.objectContaining({code:'42501'}),notFound={status:404,body:{ok:false,error:'Not found.'}};
const days=(n:number)=>new Date(Date.now()+n*86400000).toISOString(),sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

// One PGlite connection: role switches and queries are serialised so concurrent Worker calls never interleave.
let lock:Promise<unknown>=Promise.resolve();
function serial<T>(f:()=>Promise<T>):Promise<T>{const p=lock.then(f);lock=p.catch(()=>{});return p;}
const q=(sql:string,args:any[]=[])=>serial(async()=>(await db.query<any>(sql,args)).rows);
const arg=(v:unknown)=>v!==null&&typeof v==='object'&&!(Array.isArray(v)&&v.every(x=>typeof x!=='object'))?JSON.stringify(v):v;
async function asRole<T>(role:string,sql:string,args:any[]=[],sub=''):Promise<T[]>{
 return serial(async()=>{await db.exec(`set role ${role}`);await db.query("select set_config('request.jwt.sub',$1,false)",[sub]);
  try{return (await db.query<any>(sql,args)).rows;}finally{await db.exec("reset role;select set_config('request.jwt.sub','',false)");}});
}
const rpc=async(name:string,args:any[])=>(await asRole<any>('service_role',`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args.map(arg)))[0].result;

type Provider={identity:string;scope:string;refresh:string};
let provider:Provider;
const rpcLog:{name:string;args:any}[]=[],tokens:string[]=[],external:{url:URL;init:RequestInit}[]=[];
const OPS:Record<string,string>={eq:'=',neq:'<>',lte:'<=',lt:'<',gte:'>=',gt:'>'};
function where(params:URLSearchParams,values:unknown[]){
 const out:string[]=[];
 for(const [k,v] of params){
  if(['select','order','limit'].includes(k))continue;if(!/^[a-z_]+$/.test(k))throw Error('Invalid fixture filter');
  if(v==='is.null'||v==='not.is.null')out.push(`${k} is ${v==='is.null'?'':'not '}null`);
  else if(v.startsWith('in.(')){values.push(`{${v.slice(4,-1)}}`);out.push(`${k}::text=any($${values.length}::text[])`);}
  else{const [op,...rest]=v.split('.');if(!OPS[op])throw Error('Invalid fixture filter');values.push(decodeURIComponent(rest.join('.')));out.push(op==='eq'||op==='neq'?`${k}::text${OPS[op]}$${values.length}`:`${k}${OPS[op]}$${values.length}`);}
 }
 return out.join(' and ')||'true';
}
async function bridge(input:string,init:RequestInit={}){
 const u=new URL(input),auth=new Headers(init.headers).get('Authorization')??'';
 if(u.origin!==env.SUPABASE_URL){
  external.push({url:u,init});
  const form=new URLSearchParams(String(init.body??''));
  if(u.host==='oauth2.googleapis.com'||u.host==='login.microsoftonline.com'){
   if(form.get('grant_type')==='refresh_token')return Response.json({access_token:'at:'+form.get('refresh_token'),expires_in:3600});
   if(!form.get('code_verifier'))return new Response('{}',{status:400});
   return Response.json({access_token:'access-fixture',refresh_token:provider.refresh,scope:provider.scope,expires_in:3600});
  }
  if(u.host==='openidconnect.googleapis.com')return Response.json({email:provider.identity,email_verified:true});
  if(u.host==='graph.microsoft.com')return Response.json({mail:provider.identity});
  if(u.host==='www.googleapis.com'&&u.pathname.includes('/calendar/v3/calendars/'))return Response.json({...JSON.parse(String(init.body)),status:'confirmed',conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}]}});
  throw Error('Unexpected external fetch '+u.host);
 }
 if(u.pathname==='/auth/v1/user'){const id=auth.replace(/^Bearer\s+/i,'');tokens.push(id);return Response.json({id,email:`${id}@fixture.invalid`});}
 try{
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const name=u.pathname.split('/').at(-1)!,args=JSON.parse(String(init.body));if(!/^[a-z_]+$/.test(name)||Object.keys(args).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Invalid fixture call');
   rpcLog.push({name,args});
   return Response.json((await asRole<any>('service_role',`select public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,Object.values(args).map(arg)))[0].result);
  }
  const table=u.pathname.split('/').at(-1)!,values:unknown[]=[];if(!/^[a-z_]+$/.test(table))throw Error('Invalid fixture table');
  const filter=where(u.searchParams,values);
  if(init.method==='PATCH'){
   const patch=JSON.parse(String(init.body)),set=Object.keys(patch).map(k=>{if(!/^[a-z_]+$/.test(k))throw Error('Invalid patch');values.push(arg(patch[k]));return `${k}=$${values.length}`;});
   return Response.json(await asRole("service_role",`update public.${table} set ${set.join(',')} where ${filter} returning *`,values));
  }
  if(init.method&&init.method!=='GET')throw Error('Unexpected fixture write');
  const select=u.searchParams.get('select')??'*',order=(u.searchParams.get('order')??'').split(',').filter(Boolean).map(o=>{const m=/^([a-z_]+)(?:\.(asc|desc))?$/.exec(o);if(!m)throw Error('Invalid order');return `${m[1]} ${m[2]??'asc'}`;});
  return Response.json(await asRole("service_role",`select ${/^[a-z_,]+$/.test(select)?select:'*'} from public.${table} where ${filter}${order.length?' order by '+order.join(','):''} limit ${Number(u.searchParams.get('limit')??100)}`,values));
 }catch(e:any){return Response.json({code:e.code,message:e.message},{status:e.code==='40001'?409:e.code==='42501'?403:400});}
}
let jar='';// One browser: keeps the OAuth binding cookie like a real one.
async function call(as:string,method:string,path:string,body?:object){
 const res=await worker.fetch(new Request(`https://api.example${path}`,{method,headers:{Authorization:`Bearer ${as}`,'Content-Type':'application/json',...(jar?{Cookie:jar}:{})},body:body?JSON.stringify(body):undefined}),env,{} as ExecutionContext);
 const set=res.headers.get('Set-Cookie');if(set)jar=set.split(';')[0];
 const text=await res.text();let json:any=text;try{json=JSON.parse(text);}catch{}
 return {status:res.status,body:json};
}
const post=(as:string,path:string,body:object={})=>call(as,'POST',path,body);

async function migrated(){
 const d=new PGlite({extensions:{btree_gist}});
 await d.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await d.exec(readFileSync(new URL(f,dir),'utf8'));
 return d;
}
beforeAll(async()=>{db=await migrated();},90000);
afterAll(async()=>db?.close());
beforeEach(()=>{vi.stubGlobal('fetch',bridge);rpcLog.length=0;tokens.length=0;external.length=0;});

// ---------------------------------------------------------------- synthetic fixtures
async function user(label:string,flags:{admin?:boolean;operator?:boolean}={}){
 const id=crypto.randomUUID(),email=`${label}-${id.slice(0,8)}@fixture.invalid`;await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);
 await q('update profiles set is_admin=$2,is_operator=$3 where id=$1',[id,!!flags.admin,!!flags.operator]);return {id,email};
}
async function client(ownership:'managed'|'client_owned',name='Fixture Works '+crypto.randomUUID().slice(0,8)){
 const id=(await q(`insert into tenants(name,slug,country,currency,status,ownership) values($1,$2,'AE','AED','active',$3) returning id`,[name,'acc-'+crypto.randomUUID(),ownership]))[0].id as string;
 const owner=await user('owner');await serial(()=>asOwner(db,{tenantId:id,profileId:owner.id}));return {id,name,owner:owner.id};
}
const brief=()=>({offer:'Recover dormant enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up'],excludedIndustries:[],maxAgeDays:30,source:{reference:'audience-brief',excerpt:'Reviewed construction offer',observedAt:new Date(Date.now()-3600000).toISOString()}});
const setup=(t:string,actor:string,brand:Record<string,unknown>={})=>serial(()=>seedReviveSetup(db,t,actor,brand));
/** Reviewed, accepted dormant contacts with a synthetic source each. */
async function contacts(t:string,actor:string,n:number){
 const out:{lead:string;source:string}[]=[];
 for(let i=0;i<n;i++){
  const lead=(await q(`insert into leads(tenant_id,source,email,company) values($1,'import',$2,'Reviewed construction business') returning id`,[t,crypto.randomUUID()+'@example.invalid']))[0].id;
  const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by,product_context) values($1,$2,'fixture',$3,now()-interval '1 hour','audience review','fixture use authority',true,'{"industry":"construction","market":"AE","role":"owner","need":"lead follow-up"}','construction AE owner lead follow-up',$4,$5) returning id`,
   [t,lead,crypto.randomUUID(),actor,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-60*86400000).toISOString(),previousInterest:'yes',stalledReason:'Project deferred'}]))[0].id;
  const snapshot=(await q('select revive_input_snapshot($1,$2) snapshot',[t,lead]))[0].snapshot;
  await rpc('review_revive_candidate',[t,lead,actor,0,snapshot,1,'accepted','Reviewed relevant dormant business contact',days(7)]);
  out.push({lead,source});
 }
 return out;
}
/** Copy exactly as the Worker drafts it from the reviewed setup (envelope templates match it). */
async function drafted(c:{id:string;name:string},actor:string,body:any,contact:{lead:string;source:string}){
 const context=await rpc('revive_review_context',[c.id,contact.lead,actor]);
 return proposeReviveDraft(context,c.name,{leadId:contact.lead,sourceId:contact.source,messageCount:2,senderName:body.senderName},Date.now(),body).steps;
}
const plan=(leadIds:string[],steps:any[],timezone='UTC',setupVersion=1)=>({product:'revive',purpose:'reactivation',market:'AE',timezone,steps,audience:{leadIds,confirmed:true},strategy:strategyBody(setupVersion,'lead follow-up','audience-brief')});
const manualSteps=[{offsetHours:0,subject:'First',body:'Is this still relevant?',evidenceReference:'audience-brief'}];
const approval=()=>({clientAuthority:'client reviewed',ownerAuthority:'owner reviewed',ctsProfile:'fixture compliance review',maxActions:4,expiresAt:days(3)});
const campaigns=(as:string,t:string,operation:string,campaign_id:string,version:number,body?:object)=>post(as,`/api/admin/tenants/${t}/campaigns`,{operation,campaign_id,version,body});
/** Synthetic rights, one enrolment and the synthetic-sink test of its first step, all through the Worker. */
async function sinkTest(as:string,t:string,id:string,version:number,c:{lead:string;source:string}){
 expect((await campaigns(as,t,'rights',id,version,{leadId:c.lead,sourceId:c.source,noticeReference:'synthetic'})).status).toBe(200);
 const queued=await campaigns(as,t,'queue',id,version,{leadId:c.lead,startAt:new Date(Date.now()+1200).toISOString()});expect(queued.status).toBe(200);
 await sleep(1500);
 return {actions:queued.body.actionIds as string[],test:await post(as,`/api/admin/actions/${queued.body.actionIds[0]}/test`)};
}
const TEMPLATES=[
 {offsetHours:0,subject:'A question about {{need}}',body:"Hello,\n\nI'm {{sender}} from {{business}}. Our offer is {{offer}}.\n\n{{cta}}"},
 {offsetHours:72,subject:'Following up on {{need}}',body:'Hello,\n\nA brief follow-up on {{need}}. At {{business}}, our offer is {{offer}}.\n\n{{cta}}'},
 {offsetHours:168,subject:'Closing the loop on {{need}}',body:"Hello,\n\nI'm closing the loop on {{need}}.\n\n{{cta}}"},
];
const envelope={capabilities:['revive'],purposes:['reactivation'],channels:['email'],
 legalBasis:[{channel:'email',market:'AE',purpose:'reactivation',basis:'legitimate_interest',noticeReference:'notice:fixture'}],needs:['lead follow-up'],templates:TEMPLATES,bookingUrl:null,
 prohibitedTerms:['guaranteed'],limits:{perCampaignMaxActions:10,totalActions:100,maxActiveCampaigns:3,maxAudience:5,maxCampaignDays:30},budget:{currency:'AED',maxMinor:0},
 stopConditions:{minSample:5,maxOptOutPct:10,maxReviewActions:2,maxReplies:0}};
async function approveEnvelope(as:string,t:string){
 const p=await post(as,`/api/admin/tenants/${t}/envelope`,{operation:'propose',version:0,body:envelope,expires_at:days(60)});expect(p.status).toBe(200);
 const a=await post(as,`/api/admin/tenants/${t}/envelope`,{operation:'approve',version:p.body.version,digest:p.body.digest});expect(a.status).toBe(200);
 return a.body;
}
/** Owner-started OAuth with PKCE + single-use state; the provider endpoints are stubs. */
async function connect(as:string,t:string,slug:'google'|'microsoft',purposes:string[],p:Provider){
 provider=p;const start=await post(as,`/api/admin/tenants/${t}/connections/${slug}/authorize`,{purposes});expect(start.status).toBe(200);
 const done=await call(as,'GET',`/api/oauth/${slug}/callback?state=${new URL(start.body.url).searchParams.get('state')}&code=code-fixture`);expect(done.status).toBe(200);
 return (await q(`select id,version from tenant_connections where tenant_id=$1 and status='connected'`,[t]))[0] as {id:string;version:number};
}
const receipts=async(t:string,kind:string)=>(await q('select message,visible_to_client from activity_log where tenant_id=$1 order by id',[t])).filter(r=>r.message.startsWith('{')).map(r=>({...JSON.parse(r.message),visible:r.visible_to_client})).filter(r=>r.kind===kind);
const campaign=async(id:string)=>(await q('select status,envelope_version,client_authority_ref from campaigns where id=$1',[id]))[0];
const grantBody=(email:string)=>({operation:'grant',operator_email:email,capabilities:['read','operate','approve'],expires_at:days(30)});

describe('1. managed client operated by authorised staff',()=>{
 it('runs brief to synthetic send only under a client-granted operator; revoke and expiry close it, and the client sees both',async()=>{
  const c=await client('managed'),x=await user('operator',{operator:true}),base=`/api/admin/tenants/${c.id}`;
  expect(await post(x.id,`${base}/brief`,{brief:brief(),expected_version:0})).toEqual(notFound);
  const grant=await post(c.owner,`${base}/operator-grants`,grantBody(x.email));expect(grant).toMatchObject({status:201,body:{authority:'client_admin'}});
  expect((await post(x.id,`${base}/brief`,{brief:brief(),expected_version:0})).body).toEqual({ok:true,version:1});
  await setup(c.id,x.id);const [k]=await contacts(c.id,x.id,1),id=crypto.randomUUID();
  expect((await campaigns(x.id,c.id,'save',id,0,plan([k.lead],manualSteps))).body).toMatchObject({ok:true,version:1,status:'draft'});
  expect((await campaigns(x.id,c.id,'approve',id,1,approval())).body).toMatchObject({ok:true,status:'approved'});
  const run=await sinkTest(x.id,c.id,id,1,k);expect(run.test).toEqual({status:200,body:{ok:true,state:'tested',action_id:run.actions[0]}});
  expect((await q('select approved_by from campaign_assets where campaign_id=$1',[id]))[0].approved_by).toBe(x.id);
  expect((await post(c.owner,`${base}/operator-grants`,{operation:'revoke',grant_id:grant.body.id})).status).toBe(200);
  expect(await post(x.id,`${base}/brief`,{brief:brief(),expected_version:1})).toEqual(notFound);
  await expect(rpc('save_business_brief',[c.id,1,brief(),x.id])).rejects.toEqual(denied);
  // A fresh grant works until it expires; expiry alone closes it again.
  const again=await post(c.owner,`${base}/operator-grants`,grantBody(x.email));expect((await post(x.id,`${base}/shortlist`,{synthetic:true})).status).not.toBe(404);
  await q('alter table operator_grants disable trigger operator_grant_guard');await q(`update operator_grants set starts_at=now()-interval '2 days',expires_at=now()-interval '1 second' where id=$1`,[again.body.id]);await q('alter table operator_grants enable trigger operator_grant_guard');
  expect(await post(x.id,`${base}/shortlist`,{synthetic:true})).toEqual(notFound);
  const log=await q(`select message,visible_to_client from activity_log where tenant_id=$1 and message like 'Operator access%' order by id`,[c.id]);
  expect(log.map(r=>[r.message.split(' ').slice(0,3).join(' '),r.visible_to_client])).toEqual([['Operator access granted',true],['Operator access revoked',true],['Operator access granted',true]]);
 },60000);
});

describe('2. self-service client alone',()=>{
 it('connects mail, approves an envelope and runs a campaign to the synthetic sink with no staff identity anywhere',async()=>{
  const c=await client('client_owned'),base=`/api/admin/tenants/${c.id}`;
  expect((await post(c.owner,`${base}/brief`,{brief:brief(),expected_version:0})).status).toBe(200);
  expect((await post(c.owner,`${base}/connection`,{operation:'select_channels',channels:{email:'google'}})).status).toBe(200);
  await connect(c.owner,c.id,'google',['mail_send'],{identity:'owner@self.example',scope:'openid email https://www.googleapis.com/auth/gmail.send',refresh:'refresh-self'});
  const {body}=await setup(c.id,c.owner,{senderEmail:'owner@self.example'});const [k]=await contacts(c.id,c.owner,1);
  expect(await approveEnvelope(c.owner,c.id)).toMatchObject({party:'client',effective:true});
  const id=crypto.randomUUID(),saved=await campaigns(c.owner,c.id,'save',id,0,plan([k.lead],await drafted(c,c.owner,body,k)));
  expect(saved.body).toMatchObject({status:'approved',envelope:{status:'approved',by:'envelope',envelopeVersion:1}});
  const run=await sinkTest(c.owner,c.id,id,1,k);expect(run.test.body).toMatchObject({state:'tested'});
  const connections=(await post(c.owner,`${base}/connection`,{operation:'connections'})).body.connections;
  expect(connections).toEqual([expect.objectContaining({provider:'google_workspace',identity:'owner@self.example',canSend:true,senderVerified:true})]);
  const actors=new Set([...tokens,...rpcLog.flatMap(r=>[r.args.p_actor,r.args.p_actor_id].filter(Boolean))]);
  expect([...actors]).toEqual([c.owner]);
  expect((await q('select is_admin,is_operator from profiles where id=$1',[c.owner]))[0]).toEqual({is_admin:false,is_operator:false});
  expect(await q('select 1 from operator_grants where tenant_id=$1',[c.id])).toEqual([]);
 },60000);
});

describe('3. switching operating mode without loss',()=>{
 it('keeps every tenant row and the sealed credential bytes when moving managed -> self-service -> managed',async()=>{
  const c=await client('managed'),x=await user('operator',{operator:true}),base=`/api/admin/tenants/${c.id}`;
  const grant=await post(c.owner,`${base}/operator-grants`,grantBody(x.email));
  expect((await post(x.id,`${base}/brief`,{brief:brief(),expected_version:0})).status).toBe(200);
  await setup(c.id,x.id);const [k]=await contacts(c.id,x.id,1),id=crypto.randomUUID();
  await campaigns(x.id,c.id,'save',id,0,plan([k.lead],manualSteps));await campaigns(x.id,c.id,'approve',id,1,approval());
  await connect(x.id,c.id,'google',['mail_send'],{identity:'sales@managed.example',scope:'https://www.googleapis.com/auth/gmail.send',refresh:'refresh-managed'});
  const tables=(await q(`select table_name from information_schema.columns where table_schema='public' and column_name='tenant_id' and table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE') and table_name<>'activity_log' order by 1`)).map(r=>r.table_name);
  const counts=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await q(`select count(*)::int n from public.${t} where tenant_id=$1`,[c.id]))[0].n])));
  const sealed=async()=>(await q(`select s.key_id,encode(s.iv,'hex') iv,encode(s.ciphertext,'hex') ct from ripepiper_private.tenant_connection_secrets s join tenant_connections c on c.id=s.connection_id where c.tenant_id=$1`,[c.id]));
  const before=await counts(),bytes=await sealed();expect(bytes).toHaveLength(1);expect(before.leads).toBe(1);
  expect((await post(c.owner,`${base}/mode`,{expected:'managed',to:'client_owned',reason:'Client team takes over'})).body).toEqual({ok:true,ownership:'client_owned'});
  expect((await post(c.owner,`${base}/operator-grants`,{operation:'revoke',grant_id:grant.body.id})).status).toBe(200);
  expect(await counts()).toEqual(before);expect(await sealed()).toEqual(bytes);
  expect((await campaigns(x.id,c.id,'save',id,1,plan([k.lead],manualSteps))).status).toBe(404);
  // The owner continues the same campaign. Setup and reviews owned by someone who lost authority are no longer current, so the owner re-confirms both first.
  await setup(c.id,c.owner);
  await rpc('review_revive_candidate',[c.id,k.lead,c.owner,1,(await q('select revive_input_snapshot($1,$2) s',[c.id,k.lead]))[0].s,1,'accepted','Owner re-confirmed the dormant contact',days(7)]);
  expect((await campaigns(c.owner,c.id,'save',id,1,plan([k.lead],manualSteps,'UTC',2))).body).toMatchObject({version:2,status:'draft'});
  expect((await campaigns(c.owner,c.id,'approve',id,2,approval())).body).toMatchObject({status:'approved'});
  expect((await q('select count(*)::int n from campaigns where tenant_id=$1',[c.id]))[0].n).toBe(1);
  expect((await post(c.owner,`${base}/mode`,{expected:'client_owned',to:'managed',reason:'Back to the managed service'})).status).toBe(200);
  expect((await post(c.owner,`${base}/operator-grants`,grantBody(x.email))).status).toBe(201);
  expect((await post(x.id,`${base}/brief`,{brief:brief(),expected_version:1})).status).toBe(200);
  expect(await sealed()).toEqual(bytes);
 },60000);
});

describe('4. concurrent clients with their own brand, integration and channels',()=>{
 it('sends each client through its own connection, sender, signature and calendar only',async()=>{
  const a=await client('client_owned','Alpha Trading'),b=await client('client_owned','Beta Logistics');
  const brand=(n:string,email:string,tz:string)=>({senderName:`${n} Sales`,senderEmail:email,timezone:tz,signature:`${n} Sales\n${n} Head Office`,legalFooter:{postalAddress:`1 ${n} Street, Dubai, AE`,reference:`legal:${n.toLowerCase()}`}});
  for(const t of [a,b])expect((await post(t.owner,`/api/admin/tenants/${t.id}/brief`,{brief:brief(),expected_version:0})).status).toBe(200);
  const ca=await connect(a.owner,a.id,'google',['mail_send','calendar'],{identity:'owner@alpha.example',scope:'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy',refresh:'refresh-alpha'});
  const cb=await connect(b.owner,b.id,'microsoft',['mail_send'],{identity:'sales@beta.example',scope:'Mail.Send offline_access',refresh:'refresh-beta'});
  const sa=(await setup(a.id,a.owner,brand('Alpha','owner@alpha.example','Asia/Dubai'))).body,sb=(await setup(b.id,b.owner,brand('Beta','sales@beta.example','Asia/Kolkata'))).body;
  // Two contacts each: the first goes through the sink, the second shows the message the live adapter would build.
  const run=async(t:typeof a,tz:string)=>{const k=await contacts(t.id,t.owner,2),id=crypto.randomUUID();
   await campaigns(t.owner,t.id,'save',id,0,plan(k.map(x=>x.lead),manualSteps,tz));await campaigns(t.owner,t.id,'approve',id,1,approval());
   const out:string[]=[];
   for(const x of k){await campaigns(t.owner,t.id,'rights',id,1,{leadId:x.lead,sourceId:x.source,noticeReference:'synthetic'});
    out.push((await campaigns(t.owner,t.id,'queue',id,1,{leadId:x.lead,startAt:new Date(Date.now()+1200).toISOString()})).body.actionIds[0]);}
   return out;};
  const [[actionA,nextA],[actionB,nextB]]=[await run(a,'Asia/Dubai'),await run(b,'Asia/Kolkata')];await sleep(1500);
  // TENANT_SEND_ENABLED is off: each dispatch snapshots its own connection, passes the sender gate and ends in the synthetic sink.
  external.length=0;const d=new Db(env),results=await Promise.all([executeSyntheticAction(d,env,actionA,a.id,tenantConnection as any),executeSyntheticAction(d,env,actionB,b.id,tenantConnection as any)]);
  expect(results.map(r=>r.status)).toEqual([200,200]);
  expect(await q('select tenant_id,state,connection_id,connection_version from outbound_actions where id=any($1) order by tenant_id=$2 desc',[[actionA,actionB],a.id])).toEqual([
   {tenant_id:a.id,state:'tested',connection_id:ca.id,connection_version:ca.version},{tenant_id:b.id,state:'tested',connection_id:cb.id,connection_version:cb.version}]);
  expect(external.filter(e=>/gmail|graph/.test(e.url.host))).toEqual([]);
  const mail=async(t:typeof a,action:string)=>{const row=(await q('select * from outbound_actions where id=$1',[action]))[0];return (await loadTenantSend(d,env,(await tenantConnection(env,d,t.id,'mail_send'))!,row)).mail;};
  const [ma,mb]=[await mail(a,nextA),await mail(b,nextB)];
  expect(ma.from).toContain('<owner@alpha.example>');expect(ma.text).toContain('Alpha Sales\nAlpha Head Office');expect(ma.text).toContain('1 Alpha Street');
  expect(mb.from).toContain('<sales@beta.example>');expect(mb.text).toContain('Beta Sales\nBeta Head Office');
  for(const leak of ['Beta','beta.example'])expect(JSON.stringify(ma)).not.toContain(leak);
  for(const leak of ['Alpha','alpha.example'])expect(JSON.stringify(mb)).not.toContain(leak);
  // Channels differ: A books on its own Google calendar in its own timezone; B chose email only.
  expect(await tenantConnection(env,d,b.id,'calendar')).toBeNull();
  const cal=(await tenantConnection(env,d,a.id,'calendar'))!;external.length=0;
  await tenantMeeting({...env,TENANT_SEND_ENABLED:'true'},cal as any,sa as any,{id:crypto.randomUUID(),start:'2026-11-02T05:00:00Z',end:'2026-11-02T05:30:00Z',email:'buyer@prospect.example',name:'Buyer',summary:'Alpha Trading: project review',description:'Synthetic'});
  const insert=external.find(e=>e.url.host==='www.googleapis.com')!;
  expect(JSON.parse(String(insert.init.body)).start.timeZone).toBe('Asia/Dubai');expect((insert.init.headers as any).Authorization).toBe('Bearer at:refresh-alpha');
  expect(sb.timezone).toBe('Asia/Kolkata');
 },60000);
});

describe('5. no cross-tenant access',()=>{
 it('denies credentials, AI context, campaign data, contacts and communications of another client',async()=>{
  const a=await client('managed'),b=await client('client_owned'),x=await user('operator',{operator:true}),admin=await user('platform',{admin:true,operator:true});
  expect((await post(a.owner,`/api/admin/tenants/${a.id}/operator-grants`,grantBody(x.email))).status).toBe(201);
  for(const t of [a,b]){await post(t.owner,`/api/admin/tenants/${t.id}/brief`,{brief:brief(),expected_version:0});await setup(t.id,t.owner);}
  const [kb]=await contacts(b.id,b.owner,1),idB=crypto.randomUUID();await campaigns(b.owner,b.id,'save',idB,0,plan([kb.lead],manualSteps));
  const connB=crypto.randomUUID(),sealedB=await seal(env,connectionAad(b.id,connB,'google_workspace'),'refresh-b');
  await rpc('register_tenant_connection',[b.id,b.owner,connB,'google_workspace','owner@b.example',['mail_send'],['https://www.googleapis.com/auth/gmail.send'],...Object.values(sealedArgs(sealedB))]);
  await q(`insert into activity_log(tenant_id,actor,kind,message,visible_to_client) values($1,$2,'note','Synthetic reply from a B contact',true)`,[b.id,b.owner]);
  const base=`/api/admin/tenants/${b.id}`;
  const routes:[string,string,object?][]=[['POST','/brief',{brief:brief(),expected_version:1}],['POST','/campaigns',{operation:'list'}],['POST','/envelope',{operation:'status'}],['POST','/connection',{operation:'connections'}],
   ['POST','/shortlist',{synthetic:true}],['POST','/revive-run',{}],['POST','/operator-grants',{operation:'list'}],['POST','/mode',{expected:'client_owned',to:'managed',reason:'Cross-tenant attempt'}],
   ['GET','/export'],['POST',`/leads/${kb.lead}/unsubscribe`,{reason:'Cross-tenant attempt'}],['POST','/conversation-review',{}]];
  for(const who of [a.owner,x.id,admin.id])for(const [method,path,body] of routes){
   if(who===admin.id&&['/operator-grants','/mode'].includes(path))continue;// platform admin administers access, never content
   expect([who===admin.id?'admin':who===x.id?'operator':'owner',path,await call(who,method,base+path,body)]).toEqual([expect.anything(),path,notFound]);
  }
  for(const who of [a.owner,x.id,admin.id]){
   for(const [name,args] of [['save_business_brief',[b.id,1,brief(),who]],['manage_campaign_plan',[b.id,idB,who,'pause',1,{}]],['manage_operating_envelope',[b.id,who,'status',0,{}]],
    ['revoke_tenant_connection',[b.id,who,connB,1]],['tenant_reference_facts',[b.id,who]],['record_tenant_unsubscribe',[b.id,kb.lead,who,'Cross-tenant attempt']]] as [string,any[]][])
    await expect(rpc(name,args)).rejects.toEqual(denied);
  }
  // Credentials: B's secret is unreachable from A, and its ciphertext does not open under A's binding.
  const d=new Db(env);expect(await tenantConnection(env,d,a.id,'mail_send')).toBeNull();
  expect(await rpc('tenant_connection_current',[a.id,connB,1,1,'mail_send'])).toBe(false);
  await expect(open(env,connectionAad(a.id,connB,'google_workspace'),sealedB)).rejects.toThrow();
  // Platform admin JWT without a grant: no confidential rows and no secret table.
  for(const table of ['leads','campaigns','campaign_assets','activity_log','tenant_connection_status'])
   expect(await asRole('authenticated',`select count(*)::int n from public.${table} where tenant_id=$1`,[b.id],admin.id)).toEqual([{n:0}]);
  await expect(asRole('authenticated','select * from ripepiper_private.tenant_connection_secrets',[],admin.id)).rejects.toThrow('permission denied');
  // AI context: a snapshot of B never validates as A's prompt input, and paid usage is attributed to one tenant.
  const snapshot=await rpc('review_prospect_snapshot',[b.id,b.owner,true]);
  expect(validProspectSnapshot(snapshot,b.id,true,Date.now())).toBe(true);expect(validProspectSnapshot(snapshot,a.id,true,Date.now())).toBe(false);
  await asRole('service_role',`select authorize_build_budget($1,17000000,'pricing-v1','owner-fixture',now()+interval '1 day')`,[admin.id]);
  const ai={...env,AI_MODEL:'fixture-model',PAID_AI_ENABLED:'true',AI_COST_POLICY:JSON.stringify({model:'fixture-model',reference:'pricing-v1',expiresAt:'2099-01-01T00:00:00Z',inputMicroPerMillion:1000000,outputMicroPerMillion:2000000})} as Env;
  const reservation=await reserveAI(ai,'system','synthetic tenant A prompt',100,{tenantId:a.id});
  expect(await q('select tenant_id from build_usage where id=$1',[reservation.id])).toEqual([{tenant_id:a.id}]);
  expect(external).toEqual([]);
 },60000);
});

describe('6. autonomous execution inside one approval, pausing at its bounds',()=>{
 // Own database, so the real cron tick sees only this client.
 let outer:PGlite;
 beforeAll(async()=>{outer=db;db=await migrated();},90000);
 afterAll(async()=>{await db.close();db=outer;});
 const tick=async()=>(await runScheduled('*/5 * * * *',{...env,REVIVE_AUTOMATION_ENABLED:'true'}) as any).revive;
 it('runs later in-bounds campaigns from the cron with no human step; escalates, stops, revokes and audits overrides',async()=>{
  const c=await client('client_owned'),base=`/api/admin/tenants/${c.id}`;
  await post(c.owner,`${base}/brief`,{brief:brief(),expected_version:0});const {body}=await setup(c.id,c.owner);const k=await contacts(c.id,c.owner,7);
  const steps=await drafted(c,c.owner,body,k[0]);
  expect(await approveEnvelope(c.owner,c.id)).toMatchObject({effective:true});
  const [c1,c2,c3]=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  expect((await campaigns(c.owner,c.id,'save',c1,0,plan(k.slice(0,5).map(x=>x.lead),[steps[0]]))).body.envelope).toMatchObject({status:'approved'});
  expect((await campaigns(c.owner,c.id,'save',c2,0,plan(k.slice(5).map(x=>x.lead),steps))).body.envelope).toMatchObject({status:'approved'});
  // Synthetic stand-in for contact rights, recorded once at onboarding (autonomous rights recording is deferred to RP-013).
  for(const x of k)expect((await campaigns(c.owner,c.id,'rights',c1,1,{leadId:x.lead,sourceId:x.source,noticeReference:'synthetic'})).status).toBe(200);
  rpcLog.length=0;tokens.length=0;
  expect(await tick()).toMatchObject({enabled:true,enrolled:7,tested:0});
  await sleep(5500);
  expect(await tick()).toMatchObject({tested:7,stopped:0});
  expect(tokens).toEqual([]);// no signed-in human on the cron path
  expect((await q(`select count(*)::int n from outbound_actions where tenant_id=$1 and state='tested'`,[c.id]))[0].n).toBe(7);
  for(const id of [c1,c2])expect(await campaign(id)).toMatchObject({status:'approved',envelope_version:1,client_authority_ref:`envelope:v1:client:${c.owner}`});
  expect(await receipts(c.id,'campaign_override_approved')).toEqual([]);
  // Out of bounds: edited copy escalates and stays in draft through the cron.
  const edited=[{...steps[0],body:steps[0].body+'\nEdited.'}];
  expect((await campaigns(c.owner,c.id,'save',c3,0,plan([k[5].lead],edited))).body.envelope).toEqual({status:'escalated',reasons:['content_not_from_template']});
  await tick();expect((await campaign(c3)).status).toBe('draft');
  expect(await receipts(c.id,'campaign_escalated')).toEqual([expect.objectContaining({campaignId:c3,reasons:['content_not_from_template'],visible:true})]);
  // Opt-out threshold after the minimum sample: the cron pauses c1 and never resumes it.
  await rpc('record_tenant_unsubscribe',[c.id,k[0].lead,c.owner,'Verified objection #1']);
  expect(await tick()).toMatchObject({stopped:1});expect((await campaign(c1)).status).toBe('paused');
  expect(await receipts(c.id,'campaign_stop_condition')).toEqual([expect.objectContaining({campaignId:c1,reasons:['opt_out_rate'],visible:true})]);
  // A human override is audited.
  expect((await campaigns(c.owner,c.id,'approve',c3,1,approval())).body).toMatchObject({status:'approved'});
  expect(await receipts(c.id,'campaign_override_approved')).toEqual([expect.objectContaining({campaignId:c3,reasons:['content_not_from_template'],visible:true})]);
  // Revocation pauses envelope campaigns and cancels their queued follow-ups.
  expect((await post(c.owner,`${base}/envelope`,{operation:'revoke',version:1,reason:'Client paused outreach'})).status).toBe(200);
  expect((await campaign(c2)).status).toBe('paused');
  expect(await q(`select distinct state,error_code from outbound_actions where campaign_id=$1 and message_step=1`,[c2])).toEqual([{state:'cancelled',error_code:'campaign_paused'}]);
  expect(await tick()).toMatchObject({approved:0,tested:0});
  expect(await receipts(c.id,'envelope_revoked')).toHaveLength(1);
 },90000);
});

describe('7. shared reference intelligence without tenant data',()=>{
 it('resolves one domain-keyed row for two clients while each sees only its own leads',async()=>{
  const admin=await user('platform',{admin:true}),a=await client('client_owned'),b=await client('client_owned');
  expect(await rpc('upsert_reference_company',[admin.id,{domain:'acme.example',legalName:'Acme Fixture Ltd',industryCode:'4120',industryScheme:'UK SIC 2007',country:'gb',source:'fixture registry',licenceReference:'fixture licence',permittedPurposes:['prospect_research','icp_matching']}])).toBe('acme.example');
  const lead=async(t:string)=>(await q(`insert into leads(tenant_id,source,email,website,country) values($1,'import',$2,'https://www.acme.example/contact','GB') returning id`,[t,`${crypto.randomUUID()}@fixture.invalid`]))[0].id as string;
  const [la,lb]=[await lead(a.id),await lead(b.id)];
  const fa=await rpc('tenant_reference_facts',[a.id,a.owner]),fb=await rpc('tenant_reference_facts',[b.id,b.owner]);
  expect(fa).toEqual(fb);expect(fa).toEqual([expect.objectContaining({domain:'acme.example',legal_name:'Acme Fixture Ltd'})]);
  await expect(rpc('tenant_reference_facts',[b.id,a.owner])).rejects.toEqual(denied);
  expect(await post(a.owner,`/api/admin/tenants/${b.id}/shortlist`,{synthetic:true})).toEqual(notFound);
  expect(await asRole('authenticated','select id from leads where id=any($1)',[[la,lb]],a.owner)).toEqual([{id:la}]);
  expect(await asRole('authenticated','select id from leads where id=any($1)',[[la,lb]],b.owner)).toEqual([{id:lb}]);
  const columns=(await q(`select column_name from information_schema.columns where table_schema='public' and table_name='reference_companies'`)).map(r=>r.column_name);
  expect(columns.filter(c=>/tenant|lead|email|phone|person|contact/.test(c))).toEqual([]);
  const row=JSON.stringify(await q(`select * from reference_companies where domain='acme.example'`));
  for(const id of [a.id,b.id,a.owner,b.owner,la,lb])expect(row).not.toContain(id);
  expect(await asRole('service_role','select * from learning_outcomes_by_segment where industry_code=$1',['4120'])).toEqual([]);
 },60000);
});
