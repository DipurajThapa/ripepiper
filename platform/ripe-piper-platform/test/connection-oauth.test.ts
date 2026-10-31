import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index';
import {tenantConnection,connectionCurrent} from '../src/foundation/connections';
import {Db} from '../src/lib/db';
import {connectionAad,open} from '../src/lib/vault';
import type {Env} from '../src/env';
import {asOwner} from './helpers/access';

// Real migrations in PGlite behind a PostgREST-shaped fetch bridge; provider token and identity endpoints are stubs.
let db:PGlite;
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
const KEY=btoa(String.fromCharCode(...Array.from({length:32},(_,i)=>i+1)));
const env={SUPABASE_URL:'https://db.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',SITE_URL:'https://ripepiper.example',
 OAUTH_ENABLED:'true',GOOGLE_CLIENT_ID:'g-client',GOOGLE_CLIENT_SECRET:'g-secret',MS_CLIENT_ID:'m-client',MS_CLIENT_SECRET:'m-secret',
 CONNECTION_KEYS:JSON.stringify({k1:KEY}),CONNECTION_KEY_CURRENT:'k1'} as Env;
type Provider={identity:string;scope:string;refresh:string};
let signedIn='',provider:Provider,tokenCalls=0;
const external:string[]=[];

async function bridge(input:string,init:RequestInit={}){
 const u=new URL(input);
 if(u.origin!==env.SUPABASE_URL){
  external.push(u.host+u.pathname);
  if(u.host==='oauth2.googleapis.com'||u.host==='login.microsoftonline.com'){tokenCalls++;const body=new URLSearchParams(String(init.body));
   if(!body.get('code_verifier'))return new Response('{}',{status:400});return Response.json({access_token:'access-fixture',refresh_token:provider.refresh,scope:provider.scope,expires_in:3600});}
  if(u.host==='openidconnect.googleapis.com')return Response.json({email:provider.identity,email_verified:true});
  if(u.host==='graph.microsoft.com')return Response.json({mail:provider.identity});
  throw Error('Unexpected external fetch');
 }
 if(u.pathname==='/auth/v1/user')return Response.json({id:signedIn,email:'fixture@example.invalid'});
 try{
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const name=u.pathname.split('/').at(-1)!,args=JSON.parse(String(init.body));if(!/^[a-z_]+$/.test(name)||Object.keys(args).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Invalid fixture call');
   await db.exec('set role service_role');
   try{return Response.json((await q(`select public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,Object.values(args).map(v=>v!==null&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):Array.isArray(v)&&v.some(x=>typeof x==='object')?JSON.stringify(v):v)))[0].result);}
   finally{await db.exec('reset role');}
  }
  const table=u.pathname.split('/').at(-1)!;if(!['profiles','tenants','tenant_connections','revive_setups'].includes(table))throw Error('Invalid fixture table');
  const where:string[]=[],values:string[]=[];
  for(const [k,v] of u.searchParams){
   if(['select','order','limit'].includes(k))continue;if(!/^[a-z_]+$/.test(k))throw Error('Invalid fixture filter');
   if(v==='is.null')where.push(`${k} is null`);else if(v.startsWith('eq.')||v.startsWith('neq.')){values.push(v.slice(v.indexOf('.')+1));where.push(`${k}${v.startsWith('eq.')?'=':'<>'}$${values.length}`);}else throw Error('Invalid fixture filter');
  }
  return Response.json(await q(`select ${u.searchParams.get('select')??'*'} from public.${table} where ${where.join(' and ')||'true'} limit ${Number(u.searchParams.get('limit')??100)}`,values));
 }catch(e:any){return Response.json({code:e.code,message:e.message},{status:e.code==='40001'?409:e.code==='42501'?403:400});}
}
const call=(method:string,path:string,body?:object)=>worker.fetch(new Request(`https://api.example${path}`,{method,headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env,{} as ExecutionContext);
async function user(label:string){const id=crypto.randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${label}-${id}@fixture.invalid`]);return id;}
async function tenant(){
 const id=(await q(`insert into tenants(name,slug,country,currency,status) values('OAuth fixture',$1,'AE','AED','active') returning id`,['oauth-'+crypto.randomUUID()]))[0].id as string;
 const owner=await user('owner');await asOwner(db,{tenantId:id,profileId:owner});return {id,owner};
}
async function authorize(t:{id:string;owner:string},slug='google',body:object={purposes:['mail_send']}){
 signedIn=t.owner;const res=await call('POST',`/api/admin/tenants/${t.id}/connections/${slug}/authorize`,body);
 return {res,url:res.status===200?new URL((await res.json() as any).url):null};
}

beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
},60000);
beforeEach(()=>{vi.stubGlobal('fetch',bridge);});
afterEach(()=>{tokenCalls=0;external.length=0;});
afterAll(async()=>db?.close());

it('is off by default: both routes are the plain 404 with no database or provider call',async()=>{
 const t=await tenant(),off={...env,OAUTH_ENABLED:undefined} as Env;signedIn=t.owner;
 const spy=vi.fn(bridge);vi.stubGlobal('fetch',spy);
 {
  expect((await worker.fetch(new Request(`https://api.example/api/admin/tenants/${t.id}/connections/google/authorize`,{method:'POST',body:'{"purposes":["mail_send"]}'}),off,{} as ExecutionContext)).status).toBe(404);
  expect((await worker.fetch(new Request('https://api.example/api/oauth/google/callback?state=x&code=y'),off,{} as ExecutionContext)).status).toBe(404);
  expect(spy).not.toHaveBeenCalled();
 }
});

it('binds tenant from the single-use hashed state (never the query), seals with tenant AAD and resolves only for that tenant',async()=>{
 const a=await tenant(),b=await tenant();provider={identity:'Owner@Client-A.example',scope:'openid email https://www.googleapis.com/auth/gmail.send',refresh:'refresh-token-a'};
 const {url}=await authorize(a);const state=url!.searchParams.get('state')!;
 expect(url!.host).toBe('accounts.google.com');expect(url!.searchParams.get('code_challenge_method')).toBe('S256');expect(url!.searchParams.get('access_type')).toBe('offline');
 const stored=await q('select state_hash,tenant_id from ripepiper_private.oauth_states where tenant_id=$1',[a.id]);expect(stored).toHaveLength(1);expect(stored[0].state_hash).not.toBe(state);
 // A tenant (and anything else) in the query is ignored.
 const res=await call('GET',`/api/oauth/google/callback?state=${state}&code=code-a&tenant=${b.id}&tenant_id=${b.id}`);
 expect(res.status).toBe(200);expect(await res.text()).toContain('owner@client-a.example');
 expect(await q('select 1 from tenant_connections where tenant_id=$1',[b.id])).toHaveLength(0);
 const row=(await q(`select c.id,c.account_identity,c.status,c.consented_by,s.key_id,s.iv,s.ciphertext from tenant_connections c join ripepiper_private.tenant_connection_secrets s on s.connection_id=c.id where c.tenant_id=$1`,[a.id]))[0];
 expect(row).toMatchObject({account_identity:'owner@client-a.example',status:'connected',consented_by:a.owner,key_id:'k1'});
 const sealed={keyId:row.key_id,iv:new Uint8Array(row.iv),ciphertext:new Uint8Array(row.ciphertext)};
 expect(await open(env,connectionAad(a.id,row.id,'google_workspace'),sealed)).toBe('refresh-token-a');
 await expect(open(env,connectionAad(b.id,row.id,'google_workspace'),sealed)).rejects.toThrow();
 // Replay of the same state: refused before any token exchange.
 const calls=tokenCalls;expect((await call('GET',`/api/oauth/google/callback?state=${state}&code=code-a`)).status).toBe(400);expect(tokenCalls).toBe(calls);
 const d=new Db(env),c=await tenantConnection(env,d,a.id,'mail_send');
 expect(c).toMatchObject({provider:'google_workspace',connectionId:row.id,identity:'owner@client-a.example',version:1});
 expect(c!.provider==='google_workspace'&&c!.env.GOOGLE_REFRESH_TOKEN).toBe('refresh-token-a');await connectionCurrent(d,c!);
 expect(await tenantConnection(env,d,b.id,'mail_send')).toBeNull();expect(await tenantConnection(env,d,a.id,'calendar')).toBeNull();
 signedIn=a.owner;expect((await call('POST',`/api/admin/tenants/${a.id}/connection`,{operation:'revoke',connectionId:row.id,expectedVersion:1})).status).toBe(200);
 await expect(connectionCurrent(d,c!)).rejects.toThrow();expect(await tenantConnection(env,d,a.id,'mail_send')).toBeNull();
});

it('rejects an expired state and a viewer start, with no token exchange',async()=>{
 const t=await tenant();provider={identity:'owner@client.example',scope:'https://www.googleapis.com/auth/gmail.send',refresh:'r'};
 const {url}=await authorize(t);
 await q(`update ripepiper_private.oauth_states set created_at=now()-interval '20 minutes',expires_at=now()-interval '11 minutes' where tenant_id=$1`,[t.id]);
 expect((await call('GET',`/api/oauth/google/callback?state=${url!.searchParams.get('state')}&code=c`)).status).toBe(400);expect(tokenCalls).toBe(0);
 expect(await q('select 1 from ripepiper_private.oauth_states where tenant_id=$1',[t.id])).toHaveLength(0);
 const viewer=await user('viewer');await q(`insert into memberships(tenant_id,user_id,role) values($1,$2,'viewer')`,[t.id,viewer]);
 const denied=await authorize({id:t.id,owner:viewer});expect(denied.res.status).toBe(404);expect(await denied.res.json()).toEqual({ok:false,error:'Not found.'});
});

it('rejects a signed-in mailbox that differs from the requested one, registering nothing',async()=>{
 const t=await tenant();provider={identity:'someone-else@client.example',scope:'https://www.googleapis.com/auth/gmail.send',refresh:'r'};
 const {url}=await authorize(t,'google',{purposes:['mail_send'],account:'Owner@Client.example'});expect(url!.searchParams.get('login_hint')).toBe('owner@client.example');
 expect((await call('GET',`/api/oauth/google/callback?state=${url!.searchParams.get('state')}&code=c`)).status).toBe(409);
 expect(await q('select 1 from tenant_connections where tenant_id=$1',[t.id])).toHaveLength(0);
});

it('derives canSend from granted scopes (Microsoft without Mail.Send stays off) and never returns credential material',async()=>{
 const t=await tenant();signedIn=t.owner;
 expect((await call('POST',`/api/admin/tenants/${t.id}/connection`,{operation:'select_channels',channels:{email:'microsoft',calendar:true,sms:true}})).status).toBe(200);
 provider={identity:'owner@client.example',scope:'openid email offline_access User.Read Calendars.ReadWrite',refresh:'ms-refresh-secret'};
 const {url}=await authorize(t,'microsoft',{purposes:['mail_send','calendar']});expect(url!.host).toBe('login.microsoftonline.com');
 const done=await call('GET',`/api/oauth/microsoft/callback?state=${url!.searchParams.get('state')}&code=c`);expect(done.status).toBe(200);expect(await done.text()).toContain('was not granted');
 const listed=await call('POST',`/api/admin/tenants/${t.id}/connection`,{operation:'connections'}),text=await listed.text(),list=JSON.parse(text).connections;
 const ms=list.find((c:any)=>c.provider==='microsoft_365'),sms=list.find((c:any)=>c.provider==='sms');
 expect(ms).toMatchObject({identity:'owner@client.example',status:'connected',canSend:false,canBook:true});expect(sms).toMatchObject({status:'pending_consent',canSend:false});
 const status=await (await call('POST',`/api/admin/tenants/${t.id}/connection`,{operation:'status'})).text();
 for(const body of [text,status])for(const secret of ['ms-refresh-secret','refresh_token','ciphertext','key_id','keyId','"iv"'])expect(body).not.toContain(secret);
 expect(await tenantConnection(env,new Db(env),t.id,'mail_send')).toBeNull();
 // Reconnecting with Mail.Send granted turns sending on for the same row.
 provider={...provider,scope:'Mail.Send Calendars.ReadWrite offline_access'};
 const again=await authorize(t,'microsoft',{purposes:['mail_send','calendar']});expect((await call('GET',`/api/oauth/microsoft/callback?state=${again.url!.searchParams.get('state')}&code=c`)).status).toBe(200);
 const c=await tenantConnection(env,new Db(env),t.id,'mail_send');expect(c).toMatchObject({provider:'microsoft_365',connectionId:ms.id,version:ms.version+1});
 expect(c!.provider==='microsoft_365'&&c!.account.refreshToken).toBe('ms-refresh-secret');
});
