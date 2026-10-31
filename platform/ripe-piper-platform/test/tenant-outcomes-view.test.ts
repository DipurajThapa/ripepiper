import {afterAll,beforeAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
const staff='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
let db:PGlite;let tenant='',other='';
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
async function as(user:string,sql:string){await db.exec(`set role authenticated;select set_config('request.jwt.sub','${user}',false);`);try{return await q(sql);}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
 for(const [id,email] of [[staff,'staff@example.invalid'],[member,'member@example.invalid'],[outsider,'outsider@example.invalid']])await q(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[id,email]);
 await q('update profiles set is_admin=true where id=$1',[staff]);
 [tenant,other]=await Promise.all(['a','b'].map(async s=>(await q(`insert into tenants(name,slug,country,currency) values('Outcomes',$1,'AE','AED') returning id`,['outcomes-'+s+crypto.randomUUID()]))[0].id));
 await q(`insert into memberships(tenant_id,user_id,role) values($1,$2,'viewer')`,[tenant,member]);
 const lead=async(t:string)=>(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[t,crypto.randomUUID()+'@business.example']))[0].id;
 const outcome=(t:string,l:string,value:string,{synthetic=false,at='2026-10-15T10:00:00Z'}={})=>q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_excerpt,assessment_reviewed_by,product_context) values($1,$2,'fixture',$3,$4,'outcome review','private rights reference',$5,'private excerpt',$6,$7)`,
  [t,l,crypto.randomUUID(),at,synthetic,staff,{product:'revive',kind:'outcome',outcome:value,reason:'Reviewed outcome'}]);
 const a=await lead(tenant),b=await lead(tenant),c=await lead(other);
 // Same contact twice counts once; synthetic records never count (the table already rejects unreviewed outcomes).
 await outcome(tenant,a,'opportunity');await outcome(tenant,a,'opportunity');await outcome(tenant,b,'opportunity');await outcome(tenant,a,'meeting_held');
 await outcome(tenant,b,'won',{synthetic:true});await outcome(tenant,b,'won',{at:'2026-09-03T10:00:00Z'});
 await outcome(other,c,'won');
},30000);
afterAll(async()=>db?.close());
it('a member sees only their own tenant reviewed outcome counts, de-duplicated by contact',async()=>{
 const rows=await as(member,'select * from v_tenant_outcomes_monthly order by month');
 expect(rows.map(r=>({...r,month:r.month.toISOString().slice(0,10)}))).toEqual([
  {tenant_id:tenant,month:'2026-09-01',qualified_conversation:0,meeting_held:0,opportunity:0,won:1,lost:0},
  {tenant_id:tenant,month:'2026-10-01',qualified_conversation:0,meeting_held:1,opportunity:2,won:0,lost:0}]);
 expect(Object.keys(rows[0])).not.toContain('assessment_excerpt');
});
it('a non-member and anonymous callers see nothing',async()=>{
 expect(await as(outsider,'select * from v_tenant_outcomes_monthly')).toEqual([]);
 await db.exec('set role anon');try{await expect(q('select * from v_tenant_outcomes_monthly')).rejects.toThrow('permission denied');}finally{await db.exec('reset role');}
});
