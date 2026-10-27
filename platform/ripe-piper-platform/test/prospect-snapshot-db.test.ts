import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
let db:PGlite;const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(name,dir),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'staff@fixture.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
},60000);
afterAll(async()=>db.close());
async function fixture(run:(t:string,l:string)=>Promise<void>){
 await db.exec('begin');try{
 const t=(await q(`insert into tenants(name,slug,country,currency) values('Bounded review',$1,'AE','AED') returning id`,[crypto.randomUUID()]))[0].id;
 const l=(await q(`insert into leads(tenant_id,source,email) values($1,'import','contact@fixture.invalid') returning id`,[t]))[0].id;await run(t,l);
 }finally{await db.exec('rollback');}
}
async function snapshot(t:string){await db.exec('set role service_role');try{return (await q('select review_prospect_snapshot($1,$2,true) receipt',[t,actor]))[0].receipt;}finally{await db.exec('reset role');}}
const capacity=(s:any)=>expect(s).toEqual({version:1,status:'capacity'});
async function observation(t:string,l:string,bytes:number,ref='x'){
 // jsonb text {"padding": "..."} consumes 15 bytes, plus source and reference.
 await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,assessment_facts) values($1,$2,'s',$3,now(),'review',true,jsonb_build_object('padding',repeat('x',$4)))`,[t,l,ref,bytes-15-1-ref.length]);
}
it('admits exactly 100 contacts and returns only capacity at 101',()=>fixture(async(t)=>{
 await q(`insert into leads(tenant_id,source,email) select $1,'import',i||'@fixture.invalid' from generate_series(1,99)i`,[t]);expect((await snapshot(t)).leadCount).toBe(100);
 await q(`insert into leads(tenant_id,source,email) values($1,'import','overflow@fixture.invalid')`,[t]);capacity(await snapshot(t));
}));
it('admits all 999 observations, including unsupported object facts, and fails closed at 1000',()=>fixture(async(t,l)=>{
 await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,synthetic,assessment_facts) select $1,$2,'s',i::text,now(),'review',true,'{"unsupported":true}'::jsonb from generate_series(1,999)i`,[t,l]);expect((await snapshot(t)).observationCount).toBe(999);
 await observation(t,l,100,'overflow');capacity(await snapshot(t));
}));
it('gates highly compressible observations using stored uncompressed UTF8 bytes at 65536/65537',()=>fixture(async(t,l)=>{
 await observation(t,l,65536);expect((await q('select prospect_review_bytes::int bytes from lead_observations where tenant_id=$1',[t]))[0].bytes).toBe(65536);expect((await snapshot(t)).status).toBe('complete');
 await q(`update lead_observations set assessment_facts=jsonb_build_object('padding',repeat('x',65520)) where tenant_id=$1`,[t]);capacity(await snapshot(t));
}));
it('gates lead projected bytes at 8192/8193 without truncating company',()=>fixture(async(t,l)=>{
 await q(`update leads set company=repeat('x',8192-octet_length(email)-octet_length(status)) where id=$1`,[l]);expect((await snapshot(t)).leads[0].company.length).toBeGreaterThan(8000);
 await q(`update leads set company=company||'x' where id=$1`,[l]);capacity(await snapshot(t));
}));
it('gates latest brief bytes at 262144/262145',()=>fixture(async(t)=>{
 await q(`insert into business_briefs(tenant_id,version,body,created_by) values($1,1,jsonb_build_object('padding',repeat('x',262129)),$2)`,[t,actor]);expect((await snapshot(t)).status).toBe('complete');
 await q(`insert into business_briefs(tenant_id,version,body,created_by) values($1,2,jsonb_build_object('padding',repeat('x',262130)),$2)`,[t,actor]);capacity(await snapshot(t));
}));
it('gates profile projected bytes at 4096/4097 before owner label truncation',()=>fixture(async(t)=>{
 await q(`update profiles set full_name=repeat('x',4096-octet_length(email)) where id=$1`,[actor]);expect((await snapshot(t)).owners[0].label).toHaveLength(320);
 await q(`update profiles set full_name=full_name||'x' where id=$1`,[actor]);capacity(await snapshot(t));
}));
it('admits exactly one MiB combined raw payload and rejects one extra byte',()=>fixture(async(t,l)=>{
 for(let i=0;i<15;i++)await observation(t,l,65536,'row-'+i);
 const used=(await q(`select (select sum(prospect_review_bytes) from leads where tenant_id=$1)+(select sum(prospect_review_bytes) from lead_observations where tenant_id=$1)+(select prospect_review_bytes from profiles where id=$2) bytes`,[t,actor]))[0].bytes;
 await observation(t,l,1048576-Number(used),'last');expect((await snapshot(t)).status).toBe('complete');
 await q(`update leads set company='x' where id=$1`,[l]);capacity(await snapshot(t));
}));
it('stored metadata cannot be directly overwritten',()=>fixture(async(t,l)=>{
 await expect(q('update leads set prospect_review_bytes=0 where id=$1',[l])).rejects.toThrow();
}));
