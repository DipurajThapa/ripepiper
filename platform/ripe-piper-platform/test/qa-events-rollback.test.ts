import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
it('independently rehearses the exact hosted Events rollback acceptance script',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try {
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(file,dir),'utf8'));
  const script=readFileSync(new URL('../../../qa/staging-events-rollback-acceptance.sql',import.meta.url),'utf8');
  const result=await db.exec(script);
  expect(JSON.stringify(result)).toContain('PASS: hosted Events');
  expect((await db.query('select id from tenants')).rows).toHaveLength(0);
  expect((await db.query('select id from auth.users')).rows).toHaveLength(0);
 } finally {await db.close();}
});
