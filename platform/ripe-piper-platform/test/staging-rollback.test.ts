import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';

// Local rehearsal of hosted SQL packets; no hosted execution is implied.
// PGlite executes against template1 despite its database option. Keep each hosted
// target guard unchanged, verify rejection, then adapt only the expected local
// database name while preserving every behavioral assertion.
it.each([
 {name:'shared Revive cohort, audience and execution fences',file:'staging-rollback-acceptance.sql',pass:'PASS: hosted SQL role/RLS/FK/fence/replay/response-CAS/global-budget'},
 {name:'audit sheet scope, reservation, preferences and Gmail fences',file:'staging-audit-rollback-acceptance.sql',pass:'PASS: hosted audit sheet-scope/reservation-atomicity/preference-scope/Gmail-fence/role-denials'},
])('rehearses $name with the full migration chain',async({file,pass})=>{
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
  const packet=readFileSync(new URL('../../../qa/'+file,import.meta.url),'utf8');
  await expect(db.exec(packet)).rejects.toThrow('Unexpected database');await db.exec('rollback');
  expect((await db.query<{name:string}>('select current_database() name')).rows[0].name).toBe('template1');
  const localPacket=packet.replace("current_database()<>'postgres'","current_database()<>'template1'");
  expect(localPacket).not.toBe(packet);
  expect(localPacket.replace("current_database()<>'template1'","current_database()<>'postgres'")).toBe(packet);
  expect(JSON.stringify(await db.exec(localPacket))).toContain(pass);
  // Include the original shared-fixture assertions and every other operational
  // table so a new trigger cannot silently leave fixture data behind.
  const tables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename not in ('build_budget','fx_rates') order by tablename")).rows;
  for(const {tablename} of tables){
   const quoted='"'+tablename.replaceAll('"','""')+'"';
   expect((await db.query<{n:number}>('select count(*)::int n from public.'+quoted)).rows,tablename).toEqual([{n:0}]);
  }
  expect((await db.query<{n:number}>('select count(*)::int n from auth.users')).rows).toEqual([{n:0}]);
  expect((await db.query<{enabled:boolean,prior_micro:number|null}>('select enabled,prior_micro from public.build_budget')).rows).toEqual([{enabled:false,prior_micro:null}]);
 }finally{await db.close();}
});
