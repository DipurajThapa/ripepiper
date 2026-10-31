import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
const db=new PGlite();const admin='11111111-1111-4111-8111-111111111111';
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table public.profiles(id uuid primary key,is_admin boolean);insert into profiles values('${admin}',true);grant select on profiles to service_role;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261023094148_build_budget_control.sql',import.meta.url),'utf8'));
});afterAll(async()=>{await db.close();});
const reserve=(id:string,amount:number)=>db.query<any>(`select reserve_build_usage($1,'fixture','pricing-v1',$2) ok`,[id,amount]).then(r=>r.rows[0].ok);
it('fails closed until prior usage and scoped authority are recorded; limits total across concurrent operations',async()=>{
 await db.exec('set role service_role');
 expect(await reserve(crypto.randomUUID(),100)).toBe(false);
 await db.query(`select authorize_build_budget($1,17000000,'pricing-v1','owner-fixture',now()+interval '1 day')`,[admin]);
 const first=crypto.randomUUID(),second=crypto.randomUUID();
 const results=await Promise.all([reserve(first,700000),reserve(second,700000)]);expect(results.filter(Boolean)).toHaveLength(1);
 const id=results[0]?first:second;
 expect(await reserve(id,1)).toBe(false);
 expect(await reserve(crypto.randomUUID(),400000)).toBe(false);
 expect((await db.query<any>('select settle_build_usage($1,200000) ok',[id])).rows[0].ok).toBe(true);
 expect((await db.query<any>('select settle_build_usage($1,200000) ok',[id])).rows[0].ok).toBe(true);
 expect((await db.query<any>('select settle_build_usage($1,100000) ok',[id])).rows[0].ok).toBe(false);
 expect(await reserve(crypto.randomUUID(),700000)).toBe(true);
 await db.exec('reset role');
});
it('freezes on exceeded bound and prevents unprivileged reads, arming and spend reservations',async()=>{
 await db.exec('set role service_role');
 const id=crypto.randomUUID();expect(await reserve(id,1000)).toBe(true);
 expect((await db.query<any>('select settle_build_usage($1,1001) ok',[id])).rows[0].ok).toBe(false);
 expect(await reserve(crypto.randomUUID(),1)).toBe(false);
 await db.exec('reset role');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await expect(db.query('select * from build_usage')).rejects.toThrow();
  await expect(reserve(crypto.randomUUID(),1)).rejects.toThrow();
  await expect(db.query(`select authorize_build_budget($1,0,'p','x',now()+interval '1 day')`,[admin])).rejects.toThrow();
  await db.exec('reset role');
 }
});
it('writes the tenant scope to build_usage.tenant_id the way reserveAI attributes it, and clears it if the tenant is deleted',async()=>{
 // The column ships in the shared-reference migration; apply only that statement so this test stays independent of the rest.
 const dir=new URL('../supabase/migrations/',import.meta.url);
 const ddl=readdirSync(dir).sort().map(f=>readFileSync(new URL(f,dir),'utf8').match(/alter table (public.)?build_usage add column[^;]*tenant_id[^;]*;/i)?.[0]).find(Boolean);
 expect(ddl).toBeTruthy();
 await db.exec('create table public.tenants(id uuid primary key);'+ddl);
 const tenant='22222222-2222-4222-8222-222222222222';await db.query('insert into tenants values($1)',[tenant]);
 await db.query(`update build_budget set enabled=true where id='ripepiper-build'`);
 await db.exec('set role service_role');
 const scoped=crypto.randomUUID(),agency=crypto.randomUUID();expect(await reserve(scoped,1)).toBe(true);expect(await reserve(agency,1)).toBe(true);
 expect((await db.query<any>('update build_usage set tenant_id=$1 where id=$2 and tenant_id is null returning id',[tenant,scoped])).rows).toHaveLength(1);
 expect((await db.query<any>('select id,tenant_id from build_usage where id in ($1,$2) order by tenant_id nulls last',[scoped,agency])).rows).toEqual([{id:scoped,tenant_id:tenant},{id:agency,tenant_id:null}]);
 await db.exec('reset role');
 await db.query('delete from tenants where id=$1',[tenant]);
 expect((await db.query<any>('select tenant_id from build_usage where id=$1',[scoped])).rows[0].tenant_id).toBeNull();
});
