import {afterAll,beforeAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {asOwner} from './helpers/access';

// Isolated PGlite with the real migrations; synthetic tenants and reserved .example/.invalid domains only.
let db:PGlite;let admin:string;
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}finally{await db.exec('reset role');}}
async function as<T>(role:'anon'|'authenticated',sub:string,f:()=>Promise<T>){await db.exec(`set role ${role};select set_config('request.jwt.sub','${sub}',false)`);try{return await f();}finally{await db.exec(`reset role;select set_config('request.jwt.sub','',false)`);}}
async function user(label:string,isAdmin=false){const id=crypto.randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${label}-${id}@fixture.invalid`]);if(isAdmin)await q('update profiles set is_admin=true where id=$1',[id]);return id;}
async function tenant(){return (await q(`insert into tenants(name,slug,country,currency,status) values('Reference fixture',$1,'AE','AED','active') returning id`,['ref-'+crypto.randomUUID()]))[0].id as string;}
const lead=async(t:string,website:string,email=`${crypto.randomUUID()}@fixture.invalid`)=>(await q(`insert into leads(tenant_id,source,email,website,country) values($1,'import',$2,$3,'GB') returning id`,[t,email,website]))[0].id as string;
const body=(over:Record<string,unknown>={})=>({domain:'acme.example',legalName:'Acme Fixture Ltd',industryCode:'4120',industryScheme:'UK SIC 2007',country:'gb',source:'fixture registry',licenceReference:'fixture licence',permittedPurposes:['prospect_research','icp_matching'],...over});
const invalid=expect.objectContaining({code:'22023'}),denied=expect.objectContaining({code:'42501'});

beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
 admin=await user('admin',true);
},60000);
afterAll(async()=>db?.close());

it('accepts only allowlisted, licensed company facts from a platform admin and deduplicates by normalised domain',async()=>{
 for(const b of [body({domain:'gmail.com'}),body({domain:'https://www.yahoo.co.uk/'}),body({licenceReference:undefined}),body({licenceReference:' '}),body({permittedPurposes:[]}),body({permittedPurposes:['marketing']}),body({email:'person@acme.example'}),body({contactName:'Fixture Person'}),body({domain:'localhost'}),body({verifiedAt:'2020-01-01T00:00:00Z'})])
  await expect(rpc('upsert_reference_company',[admin,b])).rejects.toEqual(invalid);
 await expect(rpc('upsert_reference_company',[await user('member'),body()])).rejects.toEqual(denied);
 expect(await rpc('upsert_reference_company',[admin,body({domain:'https://WWW.Acme.example.'})])).toBe('acme.example');
 expect(await rpc('upsert_reference_company',[admin,body({domain:'acme.example/about',legalName:'Acme Fixture Group'})])).toBe('acme.example');
 const rows=await q(`select domain,legal_name,country,correction_status,expires_at-verified_at as validity from reference_companies where domain like '%acme.example'`);
 expect(rows).toEqual([{domain:'acme.example',legal_name:'Acme Fixture Group',country:'GB',correction_status:'none',validity:'180 days'}]);
});

it('keeps the shared store free of tenant and person fields and closed to browser roles',async()=>{
 const columns=(await q(`select column_name from information_schema.columns where table_schema='public' and table_name='reference_companies'`)).map(r=>r.column_name);
 expect(columns.filter(c=>/tenant|lead|email|phone|person|contact|name$/.test(c)&&c!=='legal_name')).toEqual([]);
 const view=(await q(`select column_name from information_schema.columns where table_schema='public' and table_name='learning_outcomes_by_segment'`)).map(r=>r.column_name);
 expect(view.sort()).toEqual(['channel','contacts','industry_code','market','meeting_rate','meetings_booked','month']);
 expect((await q(`select is_nullable from information_schema.columns where table_name='build_usage' and column_name='tenant_id'`))[0].is_nullable).toBe('YES');
 const member=await user('browser');
 for(const role of ['anon','authenticated'] as const)for(const sql of ['select * from reference_companies',`insert into reference_companies(domain,source,licence_reference,permitted_purposes,verified_at,expires_at) values('x.example','s','l','{icp_matching}',now(),now()+interval '1 day')`,`update reference_companies set source='x'`,'select * from learning_outcomes_by_segment'])
  await expect(as(role,member,()=>q(sql))).rejects.toEqual(denied);
 for(const fn of ['upsert_reference_company','correct_reference_company','tenant_reference_facts'])
  expect((await q(`select has_function_privilege('authenticated',oid,'execute') a,has_function_privilege('anon',oid,'execute') b from pg_proc where proname=$1`,[fn]))[0]).toEqual({a:false,b:false});
});

it('lets two tenants share one reference row without seeing each other, and drops expired, withdrawn and disputed rows',async()=>{
 await rpc('upsert_reference_company',[admin,body({domain:'shared.example'})]);
 const [a,b]=[await tenant(),await tenant()],[ownerA,ownerB,viewerA]=[await user('owner-a'),await user('owner-b'),await user('viewer-a')];
 await asOwner(db,{tenantId:a,profileId:ownerA});await asOwner(db,{tenantId:b,profileId:ownerB});
 await q(`insert into memberships(tenant_id,user_id,role) values($1,$2,'viewer')`,[a,viewerA]);
 await lead(a,'https://www.Shared.example/contact');const leadB=await lead(b,'shared.example');
 const factsA=await rpc('tenant_reference_facts',[a,ownerA]),factsB=await rpc('tenant_reference_facts',[b,ownerB]);
 expect(factsA).toEqual(factsB);expect(factsA).toHaveLength(1);
 expect(factsA[0]).toMatchObject({domain:'shared.example',source:'fixture registry',licence_reference:'fixture licence'});expect(factsA[0]).not.toHaveProperty('tenant_id');
 await expect(rpc('tenant_reference_facts',[b,ownerA])).rejects.toEqual(denied);
 expect(await as('authenticated',ownerA,()=>q('select id from leads where id=$1',[leadB]))).toEqual([]);
 expect(await q(`select count(*)::int n from reference_companies where domain='shared.example'`)).toEqual([{n:1}]);

 // A tenant member may only dispute a current row its own leads link to; the platform admin sets any status.
 const outsider=await tenant(),outsiderOwner=await user('outsider');await asOwner(db,{tenantId:outsider,profileId:outsiderOwner});
 await expect(rpc('correct_reference_company',[outsiderOwner,outsider,'shared.example','disputed','Not our company'])).rejects.toEqual(denied);
 await expect(rpc('correct_reference_company',[viewerA,a,'shared.example','withdrawn','Wrong industry'])).rejects.toEqual(denied);
 await expect(rpc('correct_reference_company',[viewerA,a,'shared.example','disputed',''])).rejects.toEqual(invalid);
 await rpc('correct_reference_company',[viewerA,a,'shared.example','disputed','Wrong industry']);
 expect(await rpc('tenant_reference_facts',[a,ownerA])).toEqual([]);
 await expect(rpc('correct_reference_company',[ownerB,b,'shared.example','disputed','Again'])).rejects.toEqual(denied);
 await rpc('correct_reference_company',[admin,null,'shared.example','corrected','Checked against the register']);
 expect(await rpc('tenant_reference_facts',[b,ownerB])).toHaveLength(1);
 await rpc('correct_reference_company',[admin,null,'https://shared.example/','withdrawn','Licence ended']);
 expect(await rpc('tenant_reference_facts',[b,ownerB])).toEqual([]);
 expect(await q(`select tenant_id,visible_to_client,message from activity_log where message like 'Reference company shared.example%' order by id`)).toEqual([
  {tenant_id:null,visible_to_client:false,message:'Reference company shared.example set to disputed: Wrong industry'},
  {tenant_id:null,visible_to_client:false,message:'Reference company shared.example set to corrected: Checked against the register'},
  {tenant_id:null,visible_to_client:false,message:'Reference company shared.example set to withdrawn: Licence ended'}]);

 await rpc('upsert_reference_company',[admin,body({domain:'stale.example'})]);await lead(a,'stale.example');
 expect((await rpc('tenant_reference_facts',[a,ownerA])).map((f:any)=>f.domain)).toEqual(['stale.example']);
 await q(`update reference_companies set verified_at=now()-interval '181 days',expires_at=now()-interval '1 day' where domain='stale.example'`);
 expect(await rpc('tenant_reference_facts',[a,ownerA])).toEqual([]);
 await rpc('upsert_reference_company',[admin,body({domain:'icp-only.example',permittedPurposes:['icp_matching']})]);await lead(a,'icp-only.example');
 expect(await rpc('tenant_reference_facts',[a,ownerA])).toEqual([]);
});

/** One isolated segment (its own industry code): `counts[i]` delivered contacts for tenant i. */
async function segment(code:string,counts:number[],email=()=>`${crypto.randomUUID()}@leads.example`){
 const domain=`seg-${code.toLowerCase()}.example`;await rpc('upsert_reference_company',[admin,body({domain,industryCode:code})]);
 const operator=await user('seg-operator');
 await db.exec(`set session_replication_role=replica`);
 try{for(const n of counts){
  const t=await tenant(),c=(await q(`insert into campaigns(tenant_id,capability,operator_id,purpose,channel,market,timezone) values($1,'revive',$2,'fixture','email','GB','UTC') returning id`,[t,operator]))[0].id;
  for(let i=0;i<n;i++){const l=await lead(t,`https://${domain}/`,email());
   await q(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at,state) values($1,$2,$3,$4,1,1,now(),'delivered')`,[t,c,l,crypto.randomUUID()]);
   if(i===0)await q(`update leads set status='meeting_booked' where id=$1`,[l]);}
 }}finally{await db.exec(`set session_replication_role=origin`);}
 await db.exec('set role service_role');try{return await q('select * from learning_outcomes_by_segment where industry_code=$1',[code]);}finally{await db.exec('reset role');}
}
it('returns a learning cell only at 5 tenants and 50 contacts, never for synthetic contacts',async()=>{
 expect(await segment('K4',[13,13,13,13])).toEqual([]);
 expect(await segment('K49',[10,10,10,10,9])).toEqual([]);
 expect(await segment('KSYN',[10,10,10,10,10],()=>`${crypto.randomUUID()}@fixture.invalid`)).toEqual([]);
 const rows=await segment('K50',[10,10,10,10,10]);
 expect(rows).toEqual([expect.objectContaining({industry_code:'K50',market:'GB',channel:'email',contacts:50,meetings_booked:5})]);
 expect(Number(rows[0].meeting_rate)).toBe(0.1);
},60000);
