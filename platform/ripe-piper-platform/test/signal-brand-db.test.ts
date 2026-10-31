import {beforeAll,afterAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {brandProfile,seedReviveSetup,fixtureService} from './helpers/revive-setup';
import {buildSignalProposal} from '../src/foundation/signal-strategy';
import {asOperator} from './helpers/access';
// SQL signal_binding_valid must accept exactly the branded copy buildSignalProposal prepares (synthetic only).
const actor='00000000-0000-4000-8000-000000000041';
let db:PGlite,tenant:string,body:any;
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
const rpc=(name:string,args:any[])=>fixtureService(db,name,args);
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,directory),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'staff@example.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
 tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('Branded Signal Client','signal-brand','AE','AED','active') returning id`))[0].id;
 await asOperator(db,{tenantId:tenant,profileId:actor});
 const observedAt=new Date(Date.now()-3600000).toISOString(),expiresAt=new Date(Date.now()+86400000).toISOString();
 await rpc('save_business_brief',[tenant,0,{offer:'Map workflow ownership',industries:['construction'],markets:['AE'],roles:['COO'],needs:['workflow ownership'],excludedIndustries:[],maxAgeDays:30,source:{reference:'interview:fixture',excerpt:'Reviewed business brief',observedAt}},actor]);
 await seedReviveSetup(db,tenant,actor,brandProfile());
 const lead=(await q(`insert into leads(tenant_id,email,company,status,source) values($1,'buyer@example.invalid','Fictional Buyer','new','import') returning id`,[tenant]))[0].id;
 await db.exec('set role service_role');
 await q(`insert into lead_observations(original_purpose,tenant_id,lead_id,source,external_ref,observed_at,assessment_facts,assessment_excerpt,assessment_reviewed_by,synthetic,rights_reference) values('fixture-only',$1,$2,'interview','fit:fixture',$3,$4,'A construction company in AE with COO workflow ownership needs.',$5,true,'fixture-only')`,[tenant,lead,observedAt,{industry:'construction',market:'AE',role:'COO',need:'workflow ownership'},actor]);
 const signal=(await q(`insert into lead_observations(original_purpose,tenant_id,lead_id,source,external_ref,observed_at,assessment_facts,assessment_excerpt,assessment_reviewed_by,synthetic,rights_reference,product_context) values('fixture-only',$1,$2,'website','signal:fixture',$3,'{}','New branch opening',$4,true,'fixture-only',$5) returning id`,[tenant,lead,observedAt,actor,{product:'signal',kind:'trigger',relevance:'Review workflow relevance',expiresAt}]))[0].id;await db.exec('reset role');
 const snapshot=await rpc('signal_strategy_context',[tenant,lead,actor]);const proposal=buildSignalProposal(tenant,{leadId:lead,signalId:signal,synthetic:true},snapshot);delete (proposal as any).preparedAt;
 body={product:'signal',purpose:'synthetic Signal review',market:'AE',timezone:'UTC',steps:[{offsetHours:0,...proposal.message,evidenceReference:`signal:${signal}`}],signalStrategy:{proposal,sourceSnapshot:snapshot,reviewedBy:actor,reviewed:true}};
},30000);
afterAll(async()=>db?.close());
const save=(plan:any)=>rpc('manage_campaign_plan',[tenant,crypto.randomUUID(),actor,'save',0,plan]);

it('accepts the branded Signal copy and booking call to action built by the Worker',async()=>{
 expect(body.steps[0].body).toContain('choose a time to discuss it: https://calendar.google.com/calendar/appointments/schedules/fixture\n\nFixture owner\nHead of Sales\n\n1 Fixture Street, Dubai, AE\n\nReply stop');
 expect(await save(body)).toMatchObject({version:1,status:'draft'});
});
it('rejects copy without the tenant sign-off or with the generic call to action',async()=>{
 const unsigned=structuredClone(body);unsigned.steps[0].body=unsigned.steps[0].body.replace('Fixture owner\nHead of Sales\n\n1 Fixture Street, Dubai, AE','Fixture owner');unsigned.signalStrategy.proposal.message.body=unsigned.steps[0].body;
 await expect(save(unsigned)).rejects.toThrow();
 const generic=structuredClone(body);generic.signalStrategy.proposal.strategy.cta='Would a conversation about workflow ownership be useful?';
 await expect(save(generic)).rejects.toThrow();
});
