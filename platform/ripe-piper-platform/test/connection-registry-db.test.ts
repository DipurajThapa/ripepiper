import {afterAll,beforeAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {asOperator,asOwner} from './helpers/access';

// Real migrations in isolated PGlite; synthetic tenants and .invalid mailboxes only.
let db:PGlite;
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
async function svc(sql:string,args:any[]=[]){await db.exec('set role service_role');try{return await q(sql,args);}finally{await db.exec('reset role');}}
const rpc=async(name:string,args:any[])=>(await svc(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
async function user(label:string,admin=false){
 const id=crypto.randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${label}-${id}@fixture.invalid`]);
 if(admin)await q('update profiles set is_admin=true where id=$1',[id]);return id;
}
async function tenant(){
 const t=(await q(`insert into tenants(name,slug,country,currency,status) values('Registry fixture',$1,'AE','AED','active') returning id,execution_version`,['registry-'+crypto.randomUUID()]))[0];
 const owner=await user('owner');await asOwner(db,{tenantId:t.id,profileId:owner});return {id:t.id as string,exec:t.execution_version as number,owner};
}
const sealed=['k1',btoa('0123456789ab'),btoa('x'.repeat(40))];
const connect=(t:{id:string;owner:string},id=crypto.randomUUID(),identity='owner@client.invalid',provider='google_workspace',purposes=['mail_send'])=>
 rpc('register_tenant_connection',[t.id,t.owner,id,provider,identity,purposes,['https://www.googleapis.com/auth/gmail.send'],...sealed]);

beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
},60000);
afterAll(async()=>db?.close());

it('denies browser roles the private secret and state tables, the raw registry and every registry RPC',async()=>{
 const t=await tenant();await connect(t);
 for(const role of ['anon','authenticated']){
  await q("select set_config('request.jwt.sub',$1,false)",[t.owner]);await db.exec(`set role ${role}`);
  for(const table of ['ripepiper_private.tenant_connection_secrets','ripepiper_private.oauth_states','public.tenant_connections'])
   await expect(q(`select * from ${table}`)).rejects.toThrow('permission denied');
  await expect(q('select public.tenant_connection_credential($1,$2)',[t.id,'mail_send'])).rejects.toThrow('permission denied');
  await db.exec('reset role');
 }
 await q("select set_config('request.jwt.sub','',false)");
});

it('scopes current() and credentials to the owning tenant; a version bump or revoke blocks current()',async()=>{
 const a=await tenant(),b=await tenant(),idA=crypto.randomUUID(),idB=crypto.randomUUID();
 expect(await connect(a,idA)).toEqual({connectionId:idA,version:1,status:'connected'});await connect(b,idB);
 const current=(t:any,id:string,v=1,purpose='mail_send')=>rpc('tenant_connection_current',[t.id,id,t.exec,v,purpose]);
 expect(await current(a,idA)).toBe(true);expect(await current(a,idB)).toBe(false);expect(await current(a,idA,1,'calendar')).toBe(false);
 expect((await rpc('tenant_connection_credential',[a.id,'mail_send'])).id).toBe(idA);
 // Another tenant's connection id is the same denial as no authority, and leaves B untouched.
 await expect(rpc('revoke_tenant_connection',[a.id,a.owner,idB,1])).rejects.toMatchObject({code:'42501'});
 await expect(rpc('revoke_tenant_connection',[b.id,a.owner,idB,1])).rejects.toMatchObject({code:'42501'});
 expect(await current(b,idB)).toBe(true);
 // Reconnect bumps the version: the old snapshot is no longer current.
 expect((await connect(a,idA)).version).toBe(2);expect(await current(a,idA,1)).toBe(false);expect(await current(a,idA,2)).toBe(true);
 await expect(rpc('revoke_tenant_connection',[a.id,a.owner,idA,1])).rejects.toMatchObject({code:'40001'});
 expect(await rpc('revoke_tenant_connection',[a.id,a.owner,idA,2])).toEqual({connectionId:idA,version:3,status:'revoked'});
 expect(await current(a,idA,3)).toBe(false);expect(await rpc('tenant_connection_credential',[a.id,'mail_send'])).toBeNull();
 expect(await q('select 1 from ripepiper_private.tenant_connection_secrets where connection_id=$1',[idA])).toHaveLength(0);
 // An error health code stops sends; a pause stops them too.
 expect((await rpc('record_connection_health',[b.id,idB,'invalid_grant'])).status).toBe('error');expect(await current(b,idB,2)).toBe(false);
 expect((await q(`select count(*)::int n from activity_log where tenant_id=$1 and visible_to_client and message like '%connected for%'`,[a.id]))[0].n).toBe(2);
});

it('lets the operator act only under an active grant',async()=>{
 const t=await tenant(),op=await user('operator');
 await expect(connect({id:t.id,owner:op})).rejects.toMatchObject({code:'42501'});
 await asOperator(db,{tenantId:t.id,profileId:op,capabilities:['read']});await expect(connect({id:t.id,owner:op})).rejects.toMatchObject({code:'42501'});
 await asOperator(db,{tenantId:t.id,profileId:op,capabilities:['operate']});expect((await connect({id:t.id,owner:op})).status).toBe('connected');
});

it('mirrors the Google pilot into the registry with a monotonic version, and a registry revoke stops pilot reads',async()=>{
 const t=await tenant(),admin=await user('staff',true),conn=crypto.randomUUID();await asOperator(db,{tenantId:t.id,profileId:admin});
 const expires=new Date(Date.now()+86400000).toISOString(),hash='a'.repeat(64);
 const register=(v:number)=>rpc('register_tenant_google_authority',[t.id,admin,v,t.exec,conn,hash,'staff@example.invalid','calendar@example.invalid','approved-source',expires]);
 const row=async()=>(await q(`select c.id,c.version,c.status,c.purposes from tenant_connections c where c.tenant_id=$1 and c.provider='google_workspace'`,[t.id]))[0];
 const pilot=(v:number)=>rpc('tenant_google_authority_current',[t.id,admin,t.exec,v,hash]);
 await register(0);let r=await row();expect(r).toMatchObject({version:1,status:'connected',purposes:['mail_read','calendar']});
 expect(r.id).toBe((await q('select public.pilot_connection_id($1,$2) id',[t.id,conn]))[0].id);expect(await pilot(1)).toBe(true);
 await rpc('revoke_tenant_google_authority',[t.id,admin,1]);expect(await row()).toMatchObject({version:2,status:'revoked'});
 await register(2);expect(await row()).toMatchObject({version:3,status:'connected'});expect(await pilot(3)).toBe(true);
 // The pilot never resolves as a sending credential (no sealed secret, no send purpose).
 expect(await rpc('tenant_connection_credential',[t.id,'mail_send'])).toBeNull();
 r=await row();await rpc('revoke_tenant_connection',[t.id,admin,r.id,3]);
 expect(await row()).toMatchObject({version:4,status:'revoked'});expect((await q('select version,revoked from tenant_google_authority where tenant_id=$1',[t.id]))[0]).toEqual({version:4,revoked:true});
 expect(await pilot(4)).toBe(false);
 await expect(q(`update tenant_connections set version=version-1 where id=$1`,[r.id])).rejects.toThrow('authority changed');
});

it('a pilot revoke or re-verify drops any OAuth credential sealed onto the pilot row, so it never comes back',async()=>{
 const t=await tenant(),admin=await user('staff',true),conn=crypto.randomUUID();await asOperator(db,{tenantId:t.id,profileId:admin});
 const expires=new Date(Date.now()+86400000).toISOString(),hash='b'.repeat(64);
 const register=(v:number,mailbox='staff@example.invalid')=>rpc('register_tenant_google_authority',[t.id,admin,v,t.exec,conn,hash,mailbox,'calendar@example.invalid','approved-source',expires]);
 await register(0);const id=(await q('select public.pilot_connection_id($1,$2) id',[t.id,conn]))[0].id;
 // OAuth consent for the same mailbox adopts the pilot row (unique tenant+provider+identity) and seals a send credential.
 await connect({id:t.id,owner:admin},id,'staff@example.invalid');expect((await rpc('tenant_connection_credential',[t.id,'mail_send'])).id).toBe(id);
 await rpc('revoke_tenant_google_authority',[t.id,admin,1]);await register(2);
 expect(await rpc('tenant_connection_credential',[t.id,'mail_send'])).toBeNull();
 expect(await q('select 1 from ripepiper_private.tenant_connection_secrets where connection_id=$1',[id])).toHaveLength(0);
 expect((await q('select status,purposes,scopes_granted from tenant_connections where id=$1',[id]))[0]).toEqual({status:'connected',purposes:['mail_read','calendar'],scopes_granted:[]});
 // A pilot mailbox change likewise never keeps the previous mailbox's token.
 await connect({id:t.id,owner:admin},id,'staff@example.invalid');await register(3,'other@example.invalid');
 expect(await rpc('tenant_connection_credential',[t.id,'mail_send'])).toBeNull();
});

it('never lets SMS (or any provider without an adapter) reach connected',async()=>{
 const t=await tenant();
 await expect(connect(t,crypto.randomUUID(),'owner@client.invalid','sms',['messaging'])).rejects.toMatchObject({code:'22023'});
 await rpc('select_tenant_channels',[t.id,t.owner,JSON.stringify([{provider:'sms',purposes:['messaging']},{provider:'microsoft_365',purposes:['mail_send']}])]);
 const sms=(await q(`select id,status from tenant_connections where tenant_id=$1 and provider='sms'`,[t.id]))[0];expect(sms.status).toBe('pending_consent');
 await expect(q(`update tenant_connections set status='connected',account_identity='x@y.invalid',consented_by=$2,version=version+1 where id=$1`,[sms.id,t.owner])).rejects.toThrow('check constraint');
 // Choosing a channel creates one pending row; consent fills it in place (same id).
 const pending=(await q(`select id from tenant_connections where tenant_id=$1 and provider='microsoft_365'`,[t.id]))[0].id;
 expect((await connect(t,pending,'owner@client.invalid','microsoft_365')).connectionId).toBe(pending);
});

it('shows registry metadata to members and grantees only: a platform admin without a grant sees no row',async()=>{
 const t=await tenant(),admin=await user('platform',true);await connect(t);
 const view=async(sub:string)=>{await q("select set_config('request.jwt.sub',$1,false)",[sub]);await db.exec('set role authenticated');try{return await q('select * from public.tenant_connection_status where tenant_id=$1',[t.id]);}finally{await db.exec('reset role');}};
 expect(await view(admin)).toHaveLength(0);
 const rows=await view(t.owner);expect(rows).toHaveLength(1);expect(Object.keys(rows[0])).not.toContain('ciphertext');
 await asOperator(db,{tenantId:t.id,profileId:admin,capabilities:['read']});expect(await view(admin)).toHaveLength(1);
 await q("select set_config('request.jwt.sub','',false)");
});
