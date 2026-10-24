import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
it('independently rehearses the exact hosted draft-save rollback packet and leaves no fixture rows',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(name,dir),'utf8'));
  const results=await db.exec(readFileSync(new URL('../../../qa/staging-revive-draft-rollback-acceptance.sql',import.meta.url),'utf8'));expect(JSON.stringify(results)).toContain('PASS: hosted Revive draft');
  for(const table of ['tenants','leads','lead_observations','outbound_actions','campaigns','campaign_assets','activity_log','sheet_outbox','auth.users'])expect((await db.query(`select count(*)::int n from ${table}`)).rows).toEqual([{n:0}]);
 }finally{await db.close();}
},30000);
