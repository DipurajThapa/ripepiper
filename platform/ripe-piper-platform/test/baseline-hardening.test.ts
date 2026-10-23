import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
const dir=new URL('../supabase/migrations/',import.meta.url);
it('removes public trigger entry points while preserving authenticated tenant RLS and trigger updates',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
  const admin='11111111-1111-4111-8111-111111111111';
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'admin@example.invalid',now());`,[admin]);
  await db.query(`update profiles set is_admin=true where id=$1`,[admin]);
  const privileges=(await db.query<any>(`select p.proname,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') client,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('touch_updated_at','enqueue_sheet_sync','handle_new_user','guard_tenant_execution_status','is_admin','is_member','is_owner')`)).rows;
  expect(privileges.every(p=>p.anon===false)).toBe(true);
  expect(privileges.filter(p=>!p.proname.startsWith('is_')).every(p=>p.client===false)).toBe(true);
  expect(privileges.find(p=>p.proname==='touch_updated_at').proconfig).toEqual(['search_path=""']);
  expect((await db.query<any>(`select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='btree_gist'`)).rows[0].nspname).toBe('extensions');
  await db.query(`select set_config('request.jwt.sub',$1,false)`,[admin]);await db.exec('set role authenticated');
  expect((await db.query<any>('select public.is_admin() ok')).rows[0].ok).toBe(true);
  await db.exec('reset role');
  // Trigger function execution remains valid even though direct RPC execute was removed.
  const lead=(await db.query<any>(`insert into leads(source,email) values('import','lead@example.invalid') returning id`)).rows[0].id;
  await db.query('update leads set name=$1 where id=$2',['Fixture',lead]);
  expect((await db.query('select id from sheet_outbox')).rows.length).toBeGreaterThan(0);
 }finally{await db.close();}
});
