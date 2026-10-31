import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index';
import {runScheduled} from '../src/jobs';
import {keysetFilter,purgeDue} from '../src/foundation/offboarding';
import {connectionAad,seal} from '../src/lib/vault';
import {sealedArgs} from '../src/foundation/connections';
import type {Env} from '../src/env';
import {asOperator,asOwner} from './helpers/access';

// Real migrations in PGlite behind a PostgREST-shaped fetch bridge; Google's revoke endpoint is a stub. Synthetic data only.
let db:PGlite;
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
const KEY=btoa(String.fromCharCode(...Array.from({length:32},(_,i)=>i+1)));
const env={SUPABASE_URL:'https://db.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',SITE_URL:'https://ripepiper.example',
 CONNECTION_KEYS:JSON.stringify({k1:KEY}),CONNECTION_KEY_CURRENT:'k1'} as Env;
let signedIn='';
const revokes:string[]=[],external:string[]=[];
const arg=(v:unknown)=>v!==null&&typeof v==='object'?JSON.stringify(v):v;

async function bridge(input:string,init:RequestInit={}){
 const u=new URL(input);
 if(u.origin!==env.SUPABASE_URL){
  external.push(u.host+u.pathname);
  if(u.host==='oauth2.googleapis.com'&&u.pathname==='/revoke'){revokes.push(new URLSearchParams(String(init.body)).get('token')!);return new Response('',{status:200});}
  throw Error('Unexpected external fetch');
 }
 if(u.pathname==='/auth/v1/user')return Response.json({id:signedIn,email:'fixture@example.invalid'});
 try{
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const name=u.pathname.split('/').at(-1)!,args=JSON.parse(String(init.body));if(!/^[a-z_]+$/.test(name)||Object.keys(args).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Invalid fixture call');
   await db.exec('set role service_role');
   try{return Response.json((await q(`select public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,Object.values(args).map(arg)))[0].result);}
   finally{await db.exec('reset role');}
  }
  const table=u.pathname.split('/').at(-1)!;if(!/^[a-z_]+$/.test(table))throw Error('Invalid fixture table');
  const where:string[]=[],values:string[]=[];
  for(const [k,v] of u.searchParams){
   if(['select','order','limit'].includes(k))continue;if(!/^[a-z_]+$/.test(k))throw Error('Invalid fixture filter');
   if(v==='is.null')where.push(`${k} is null`);else if(v.startsWith('eq.')){values.push(v.slice(3));where.push(`${k}::text=$${values.length}`);}else throw Error('Invalid fixture filter');
  }
  const order=(u.searchParams.get('order')??'').split(',').filter(Boolean).map(o=>{if(!/^[a-z_]+\.asc$/.test(o))throw Error('Invalid order');return o.replace('.asc',' asc');});
  return Response.json(await q(`select * from public.${table} where ${where.join(' and ')||'true'}${order.length?' order by '+order.join(','):''} limit ${Number(u.searchParams.get('limit')??100)}`,values));
 }catch(e:any){return Response.json({code:e.code,message:e.message},{status:e.code==='40001'?409:e.code==='42501'?403:400});}
}
const call=(method:string,path:string,body?:object)=>worker.fetch(new Request(`https://api.example${path}`,{method,headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env,{} as ExecutionContext);
async function user(label:string){const id=crypto.randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${label}-${id}@fixture.invalid`]);return id;}
async function tenant(label:string){
 const id=(await q(`insert into tenants(name,slug,country,currency,status) values('Offboard fixture',$1,'AE','AED','active') returning id`,['off-'+crypto.randomUUID()]))[0].id as string;
 const owner=await user('owner'),hash=(crypto.randomUUID()+crypto.randomUUID()).replace(/-/g,'');await asOwner(db,{tenantId:id,profileId:owner});
 await q(`insert into leads(tenant_id,source,email,booking_token_hash,booking_token_expires_at) values($1,'import',$2,$3,now()+interval '1 day')`,[id,`${label}-${crypto.randomUUID()}@example.invalid`,hash]);
 await q(`insert into tenant_google_authority(tenant_id,connection_id,version,binding_hash,mailbox,calendar_id,purpose_reference,expires_at,verified_at,verified_by) values($1,$2,1,$3,$4,'cal','pilot',now()+interval '1 day',now(),$5)`,
  [id,crypto.randomUUID(),'a'.repeat(64),`${label}-pilot@example.invalid`,owner]);
 const conn=crypto.randomUUID(),sealed=await seal(env,connectionAad(id,conn,'google_workspace'),`refresh-${label}`);
 await db.exec('set role service_role');
 try{await q(`select public.register_tenant_connection($1,$2,$3,'google_workspace',$4,array['mail_send'],array[]::text[],$5,$6,$7)`,[id,owner,conn,`${label}-send@example.invalid`,...Object.values(sealedArgs(sealed))]);}
 finally{await db.exec('reset role');}
 return {id,owner,conn,hash};
}

beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
},60000);
afterAll(async()=>db?.close());
beforeEach(()=>{revokes.length=0;external.length=0;vi.stubGlobal('fetch',vi.fn(bridge));});

it('exports only the owner tenant, without token or hash fields, and audits it; a viewer and another owner get 404',async()=>{
 const a=await tenant('a'),b=await tenant('b'),viewer=await user('viewer');await q(`insert into memberships(tenant_id,user_id,role) values($1,$2,'viewer')`,[a.id,viewer]);
 signedIn=a.owner;const res=await call('GET',`/api/admin/tenants/${a.id}/export`);
 expect(res.status).toBe(200);expect(res.headers.get('Content-Disposition')).toContain(a.id);
 const text=await res.text(),data=JSON.parse(text);
 expect(data.tenantId).toBe(a.id);expect(data.tables.leads).toHaveLength(1);expect(data.tables.tenant_google_authority).toHaveLength(1);
 for(const id of [b.id,b.owner,b.conn])expect(text).not.toContain(id);
 const keys=Object.values(data.tables as Record<string,any[]>).flat().flatMap(r=>Object.keys(r));
 expect(keys.filter(k=>/token|hash|secret|ciphertext/i.test(k))).toEqual([]);expect(text).not.toContain(a.hash);
 expect(data.tables.activity_log.some((r:any)=>r.message==='Full data export downloaded')).toBe(true);
 for(const who of [viewer,b.owner]){signedIn=who;const denied=await call('GET',`/api/admin/tenants/${a.id}/export`);expect(denied.status).toBe(404);expect(await denied.json()).toEqual({ok:false,error:'Not found.'});}
});

it('offboards: one Google revoke with this tenant token, sealed secret deleted, registry revoked, then ended',async()=>{
 const a=await tenant('a'),b=await tenant('b');
 signedIn=b.owner;expect((await call('POST',`/api/admin/tenants/${a.id}/offboard`,{reason:'Client asked to stop'})).status).toBe(404);
 signedIn=a.owner;const res=await call('POST',`/api/admin/tenants/${a.id}/offboard`,{reason:'Client asked to stop'});
 const body=await res.json() as any;expect(res.status).toBe(200);
 expect(body).toMatchObject({ok:true,status:'ended',exportPath:`/api/admin/tenants/${a.id}/export`,connections:{revoked:2,providerRevoked:1}});
 expect(Date.parse(body.purgeAfter)-Date.parse(body.endedAt)).toBe(90*86400000);
 expect(revokes).toEqual(['refresh-a']);expect(external).toEqual(['oauth2.googleapis.com/revoke']);
 expect(await q('select 1 from ripepiper_private.tenant_connection_secrets where connection_id=$1',[a.conn])).toHaveLength(0);
 expect((await q('select distinct status from tenant_connections where tenant_id=$1',[a.id])).map(r=>r.status)).toEqual(['revoked']);
 expect((await q('select revoked from tenant_google_authority where tenant_id=$1',[a.id]))[0].revoked).toBe(true);
 expect((await q('select status from tenants where id=$1',[a.id]))[0].status).toBe('ended');
 expect(await q('select 1 from ripepiper_private.tenant_connection_secrets where connection_id=$1',[b.conn])).toHaveLength(1);
 // The owner can still export during the retention window.
 expect((await call('GET',`/api/admin/tenants/${a.id}/export`)).status).toBe(200);
});

it('refuses a staff-only end of a self-service account without the client reference before revoking anything',async()=>{
 const a=await tenant('a'),op=await user('operator');await q(`update tenants set ownership='client_owned' where id=$1`,[a.id]);await asOperator(db,{tenantId:a.id,profileId:op});
 signedIn=op;const res=await call('POST',`/api/admin/tenants/${a.id}/offboard`,{reason:'Contract finished early'});
 expect(res.status).toBe(400);expect(revokes).toEqual([]);expect(external).toEqual([]);
 expect(await q('select 1 from ripepiper_private.tenant_connection_secrets where connection_id=$1',[a.conn])).toHaveLength(1);
 expect((await q('select status from tenants where id=$1',[a.id]))[0].status).toBe('active');
 // An approve-only grantee cannot revoke, so it cannot start an end it could not finish.
 const ap=await user('approver');await asOperator(db,{tenantId:a.id,profileId:ap,capabilities:['approve']});signedIn=ap;
 expect((await call('POST',`/api/admin/tenants/${a.id}/offboard`,{reason:'Contract finished early',requestReference:'Email from client'})).status).toBe(404);
 expect((await q('select status from tenants where id=$1',[a.id]))[0].status).toBe('active');
 // With the reference it ends and revokes; a retry is idempotent and makes no further provider call.
 signedIn=op;expect((await call('POST',`/api/admin/tenants/${a.id}/offboard`,{reason:'Contract finished early',requestReference:'Email from client'})).status).toBe(200);
 expect(revokes).toEqual(['refresh-a']);
 const again=await call('POST',`/api/admin/tenants/${a.id}/offboard`,{reason:'Contract finished early',requestReference:'Email from client'});
 expect(again.status).toBe(200);expect(await again.json()).toMatchObject({connections:{revoked:0,providerRevoked:0}});expect(revokes).toEqual(['refresh-a']);
});

it('does nothing in the purge job while the kill switch is off',async()=>{
 const f=vi.fn(bridge);vi.stubGlobal('fetch',f);
 expect(await purgeDue(env)).toEqual({disabled:true});
 expect(await runScheduled('0 22 * * *',env)).not.toHaveProperty('purge');
 expect(f).not.toHaveBeenCalled();
});

it('builds a strict keyset filter for composite keys',()=>{
 expect(decodeURIComponent(keysetFilter(['platform','day','campaign_ref'],{platform:'meta',day:'2026-10-01',campaign_ref:'a,"b)'}))).toBe(
  'or=(platform.gt."meta",and(platform.eq."meta",day.gt."2026-10-01"),and(platform.eq."meta",day.eq."2026-10-01",campaign_ref.gt."a,\\"b)"))');
});
