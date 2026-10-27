import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
let db:PGlite;
const actor='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',connection='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(name,dir),'utf8'));
 await q("insert into auth.users(id,email,email_confirmed_at) values($1,'qa@fixture.invalid',now())",[actor]);
 await q('update profiles set is_admin=true where id=$1',[actor]);
},60000);
afterAll(async()=>db?.close());
async function fixture(){
 await db.exec('reset role');
 const tenant=(await q("insert into tenants(name,slug,country,currency,status) values('QA',$1,'AE','AED','active') returning id",[crypto.randomUUID()]))[0].id;
 const lead=(await q("insert into leads(tenant_id,source,email) values($1,'import','qa@business.example') returning id",[tenant]))[0].id;
 return {tenant,lead};
}
it('browser roles cannot execute any new authority RPC or core even when a verified admin is signed in',async()=>{
 const a=await fixture();
 await q("select set_config('request.jwt.sub',$1,false)",[actor]);
 const functions=await q("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('google_authority_admin','tenant_google_probe_current','tenant_google_authority_current','register_tenant_google_authority','revoke_tenant_google_authority','record_product_event_authorized_core','record_authorized_gmail_event','record_gmail_product_event','record_product_event')");
 expect(functions).toHaveLength(9);
 for(const role of ['anon','authenticated']){
  for(const f of functions)expect((await q("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,f.signature]))[0].allowed).toBe(false);
  await db.exec('set role '+role);
  await expect(q('select * from tenant_google_authority where tenant_id=$1',[a.tenant])).rejects.toThrow();
  await db.exec('reset role');
 }
});
it('partial null authority arguments cannot downgrade core Gmail persistence to manual evidence',async()=>{
 const a=await fixture();await db.exec('set role service_role');
 const context=JSON.stringify({product:'response',kind:'reply',threadRef:'gmail:'+connection+':thread',disposition:'human',need:'',authority:'',timing:''});
 const first=[a.tenant,a.lead,actor,'gmail:'+connection+':message','reviewed purpose','synthetic test excerpt',new Date(Date.now()-1000).toISOString(),false,context];
 const variants=[[null,null,null,null],[1,null,null,null],[null,1,null,null],[null,null,'a'.repeat(64),null],[null,null,null,new Date(Date.now()+10000).toISOString()]];
 for(const suffix of variants)await expect(q('select public.record_product_event_authorized_core($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[...first,...suffix])).rejects.toThrow();
 expect(await q('select id from lead_observations where tenant_id=$1',[a.tenant])).toHaveLength(0);
 await db.exec('reset role');
});
it('direct authenticated observation writes cannot fabricate reserved Gmail reviewed evidence',async()=>{
 const a=await fixture();await q("select set_config('request.jwt.sub',$1,false)",[actor]);await db.exec('set role authenticated');
 try{
  expect((await q('select public.is_admin() allowed'))[0].allowed).toBe(true);
  await expect(q("insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_excerpt,assessment_reviewed_by,product_context) values($1,$2,'product_review',$3,now(),'outreach','manual claim',false,'Forged remote evidence',$4,$5)",[a.tenant,a.lead,'gmail:'+connection+':forged',actor,JSON.stringify({product:'response',kind:'reply',threadRef:'gmail:'+connection+':forged-thread',disposition:'human',need:'',authority:'',timing:''})])).rejects.toMatchObject({code:'42501',message:'permission denied for table outbound_actions'});
 }finally{await db.exec('reset role');}
 expect(await q('select id from lead_observations where tenant_id=$1',[a.tenant])).toHaveLength(0);
});



