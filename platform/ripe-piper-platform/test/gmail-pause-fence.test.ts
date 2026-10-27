import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
it('fences selected Gmail persistence against pause, reactivation and expiry',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
  const actor='11111111-1111-4111-8111-111111111111';await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'admin@example.invalid',now())`,[actor]);await db.query('update profiles set is_admin=true where id=$1',[actor]);
  const tenant=(await db.query<any>(`insert into tenants(name,slug,country,currency,status) values('Fixture','fixture','AE','AED','active') returning id,execution_version`)).rows[0];
  const lead=(await db.query<any>(`insert into leads(tenant_id,source,email) values($1,'import','contact@business.example') returning id`,[tenant.id])).rows[0].id;
  const args=[tenant.execution_version,new Date(Date.now()+600000).toISOString(),tenant.id,lead,actor,'gmail:fixture:message','approved-source','Reviewed message',new Date(Date.now()-10000).toISOString(),false,JSON.stringify({product:'response',kind:'reply',threadRef:'gmail:fixture:thread',disposition:'human'})];
  const sql='select public.record_gmail_product_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id';
  await db.exec('set role service_role');
  const id=(await db.query<any>(sql,args)).rows[0].id;expect((await db.query<any>(sql,args)).rows[0].id).toBe(id);
  await db.query(`select public.pause_tenant_execution($1,'pause fixture')`,[tenant.id]);
  await expect(db.query(sql,[...args.slice(0,5),'gmail:fixture:afterpause',...args.slice(6)])).rejects.toThrow('authority changed');
  await db.exec('reset role');await db.query(`update tenants set status='active' where id=$1`,[tenant.id]);await db.exec('set role service_role');
  await expect(db.query(sql,[...args.slice(0,5),'gmail:fixture:afterresume',...args.slice(6)])).rejects.toThrow('authority changed');
  const current=(await db.query<any>('select execution_version from tenants where id=$1',[tenant.id])).rows[0].execution_version;
  await expect(db.query(sql,[current,new Date(Date.now()-1000).toISOString(),...args.slice(2,5),'gmail:fixture:expired',...args.slice(6)])).rejects.toThrow('authority changed');
  expect((await db.query<any>('select count(*)::int n from lead_observations where tenant_id=$1',[tenant.id])).rows[0].n).toBe(1);
 }finally{await db.close();}
});


