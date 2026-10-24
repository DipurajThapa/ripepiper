import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';

// Local rehearsal of the hosted SQL packet; no hosted execution is implied.
// PGlite executes against template1 despite its database option. Keep the hosted
// target guard unchanged in the packet; verify it rejects here, then adapt only
// that expected local database name while preserving every behavioral assertion.
it('rehearses the current shared staging rollback packet with the accepted Revive cohort and audience fences',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
   create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
  // Model the hosted API table privilege; owner isolation is still enforced by RLS.
  await db.exec('grant select on public.leads to authenticated');
  const packet=readFileSync(new URL('../../../qa/staging-rollback-acceptance.sql',import.meta.url),'utf8');
  await expect(db.exec(packet)).rejects.toThrow('Unexpected database');await db.exec('rollback');
  expect((await db.query<any>('select current_database() name')).rows[0].name).toBe('template1');
  const localPacket=packet.replace("current_database()<>'postgres'","current_database()<>'template1'");
  expect(localPacket).not.toBe(packet);
  expect(JSON.stringify(await db.exec(localPacket))).toContain('PASS: hosted SQL role/RLS/FK/fence/replay/response-CAS/global-budget');
  for(const table of ['tenants','leads','auth.users','revive_reviews','campaign_assets','outbound_actions','activity_log','build_usage'])
   expect((await db.query('select * from '+table)).rows).toHaveLength(0);
 }finally{await db.close();}
});
