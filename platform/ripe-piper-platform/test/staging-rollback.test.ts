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
 {name:'historical audit sheet scope, reservation, preferences and Gmail fences (migration 35 checkpoint)',checkpoint:'20261027190653_safe_bounded_prospect_snapshot.sql',file:'staging-audit-rollback-acceptance.sql',pass:'PASS: hosted audit sheet-scope/reservation-atomicity/preference-scope/Gmail-fence/role-denials'},
 {name:'current durable authority and tenant unsubscribe rollback acceptance',file:'staging-authority-rollback-acceptance.sql',pass:'PASS: authority registration/CAS/revoke/namespace/history/tenant-unsubscribe privacy/replay'},
])('rehearses $name',async({file,pass,checkpoint})=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
   create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  // The immutable historical audit packet exercises the legacy Gmail RPC. Its
  // migration-35 checkpoint remains reproducible; the new packet exercises the
  // current chain where that RPC must reject. This is not a weakened old assertion.
  const migrations=readdirSync(dir).filter(f=>f.endsWith('.sql')&&(!checkpoint||f<=checkpoint)).sort();
  if(checkpoint){expect(migrations).toHaveLength(35);expect(migrations.at(-1)).toBe(checkpoint);}
  for(const f of migrations)await db.exec(readFileSync(new URL(f,dir),'utf8'));
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
  const tables=(await db.query<{schemaname:string;tablename:string}>("select schemaname,tablename from pg_tables where schemaname in ('public','ripepiper_private') and tablename not in ('build_budget','fx_rates') order by schemaname,tablename")).rows;
  for(const {schemaname,tablename} of tables){
   const quoted='"'+tablename.replaceAll('"','""')+'"';
   expect((await db.query<{n:number}>('select count(*)::int n from '+schemaname+'.'+quoted)).rows,tablename).toEqual([{n:0}]);
  }
  expect((await db.query<{n:number}>('select count(*)::int n from auth.users')).rows).toEqual([{n:0}]);
  expect((await db.query<{enabled:boolean,prior_micro:number|null}>('select enabled,prior_micro from public.build_budget')).rows).toEqual([{enabled:false,prior_micro:null}]);
 }finally{await db.close();}
},30000);
