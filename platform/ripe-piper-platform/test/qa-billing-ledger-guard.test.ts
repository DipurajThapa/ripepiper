import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
let db:PGlite;const admin='fa500000-0000-4000-8000-000000000001';
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,dir),'utf8'));
 await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'guard@example.invalid',now())",[admin]);await db.query('update profiles set is_admin=true where id=$1',[admin]);
});
afterAll(async()=>db.close());
async function tracked(){
 const p=(await db.query<any>("insert into proposals(kind,plan,package,currency,fixed_amount,content_md,status,client_email)values('pre','sprint','revive','AED',5000,'QA','sent','fixture@example.invalid')returning id")).rows[0].id,attempt=crypto.randomUUID(),ref='cs_'+attempt.replaceAll('-','');
 await db.exec('set role service_role');try{
  const reservation=(await db.query<any>("select reserve_payment_checkout($1,null,'stripe',50000,'AED',null,$2) result",[p,attempt])).rows[0].result;
  await db.query("select register_payment_checkout($1,null,'stripe',$2,50000,'AED',null,$3)",[p,ref,attempt]);return reservation.paymentId;
 }finally{await db.exec('reset role');}
}
async function asAdmin(fn:()=>Promise<any>){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`);try{return await fn();}finally{await db.exec('reset role');}}
it('authenticated platform admin cannot forge a provider settlement on a service-tracked checkout',async()=>{
 const id=await tracked();
 await expect(asAdmin(()=>db.query("update payments set status='paid',settled_at=now(),raw=raw||'{\"billing\":{\"receipt\":{\"disposition\":\"applied\"}}}' where id=$1",[id]))).rejects.toThrow();
});
it('authenticated platform admin cannot remove an uncertain checkout to permit a replacement create',async()=>{
 const id=await tracked();await expect(asAdmin(()=>db.query('delete from payments where id=$1',[id]))).rejects.toThrow();
});
