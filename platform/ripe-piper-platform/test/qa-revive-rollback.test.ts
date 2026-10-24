import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
it('rehearses the current Revive rollback-only acceptance packet with an explicit reviewed audience',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,directory),'utf8'));
  const result=await db.exec(readFileSync(new URL('../../../qa/staging-revive-rollback-acceptance.sql',import.meta.url),'utf8'));
  expect(JSON.stringify(result)).toContain('PASS: hosted Revive');
  for(const table of ['tenants','leads','lead_observations','campaign_assets','outbound_actions','revive_reviews','tenant_activation_reviews','activity_log','sheet_outbox','auth.users'])expect((await db.query(`select count(*)::int n from ${table}`)).rows).toEqual([{n:0}]);
 }finally{await db.close();}
},30000);
