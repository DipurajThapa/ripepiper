import {afterAll,beforeAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {seedReviveSetup,strategyBody} from './helpers/revive-setup';
const actor='11111111-1111-4111-8111-111111111111';
let db:PGlite;
const q=async(sql:string,args:any[]=[])=>(await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'staff@example.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
},30000);
afterAll(async()=>db?.close());
async function fixture(offsets:number[]){
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('Resume',$1,'AE','AED','active') returning id`,['resume-'+crypto.randomUUID()]))[0].id;
 await rpc('save_business_brief',[tenant,0,{offer:'Recover dormant enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up'],excludedIndustries:[],maxAgeDays:30,source:{reference:'audience-brief',excerpt:'Reviewed construction offer',observedAt:new Date(Date.now()-3600000).toISOString()}},actor]);
 await seedReviveSetup(db,tenant,actor);
 const lead=(await q(`insert into leads(tenant_id,source,email,company) values($1,'import',$2,'Reviewed construction business') returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by,product_context) values($1,$2,'fixture',$3,now()-interval '1 hour','audience review','fixture use authority',true,'{"industry":"construction","market":"AE","role":"owner","need":"lead follow-up"}','construction AE owner lead follow-up',$4,$5) returning id`,
  [tenant,lead,crypto.randomUUID(),actor,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-60*86400000).toISOString(),previousInterest:'yes',stalledReason:'Project deferred'}]))[0].id;
 const snapshot=(await q('select revive_input_snapshot($1,$2) snapshot',[tenant,lead]))[0].snapshot;
 await rpc('review_revive_candidate',[tenant,lead,actor,0,snapshot,1,'accepted','Reviewed relevant dormant business contact',new Date(Date.now()+7*86400000).toISOString()]);
 const id=crypto.randomUUID();
 const body=(subject:string)=>({product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:offsets.map(offsetHours=>({offsetHours,subject,body:'Is this still relevant?',evidenceReference:'audience-brief'})),audience:{leadIds:[lead],confirmed:true},strategy:strategyBody(1,'lead follow-up','audience-brief')});
 const plan=(op:string,version:number,b:any)=>rpc('manage_campaign_plan',[tenant,id,actor,op,version,b]);
 const approval={clientAuthority:'client reviewed',ownerAuthority:'owner reviewed',ctsProfile:'fixture compliance review',maxActions:4,expiresAt:new Date(Date.now()+3*86400000).toISOString()};
 await plan('save',0,body('First'));await plan('approve',1,approval);await plan('rights',1,{leadId:lead,sourceId:source,noticeReference:'synthetic'});
 const v1=await plan('queue',1,{leadId:lead,startAt:new Date(Date.now()+60000).toISOString()});
 const edit=async()=>{await plan('pause',1,{});await plan('save',1,body('Edited'));await plan('approve',2,approval);};
 return {tenant,id,lead,plan,v1,edit};
}
async function test(tenant:string,action:string){
 const due=(await q('select due_at from outbound_actions where id=$1',[action]))[0].due_at.toISOString(),token=crypto.randomUUID();
 expect(await rpc('claim_fenced_synthetic_action',[tenant,action,token,due])).toMatchObject({token});
 expect(await rpc('complete_fenced_synthetic_action',[tenant,action,token,2,2,due])).toBe(true);
}
it('pause, edit and re-approve resumes the paused contact on the new version without spending capacity',async()=>{
 const f=await fixture([0,24]);await f.edit();
 expect(await q('select state,error_code,asset_version from outbound_actions where campaign_id=$1',[f.id])).toEqual([{state:'cancelled',error_code:'campaign_paused',asset_version:1},{state:'cancelled',error_code:'campaign_paused',asset_version:1}]);
 const v2=await f.plan('queue',2,{leadId:f.lead,startAt:new Date(Date.now()+60000).toISOString()});expect(v2).toMatchObject({replayed:false});expect(v2.actionIds).toHaveLength(2);
 expect((await q("select correlation_key from outbound_actions where campaign_id=$1 and asset_version=2 order by message_step",[f.id])).map(r=>r.correlation_key)).toEqual([0,1].map(i=>`plan:${f.id}:v2:${f.lead}:${i}`));
 // Earlier steps of the cancelled version never block the resumed sequence.
 await test(f.tenant,v2.actionIds[0]);
 const second=(await q('select due_at from outbound_actions where id=$1',[v2.actionIds[1]]))[0].due_at.toISOString();
 await db.exec('set role service_role');try{expect((await q('select synthetic_action_allowed($1,$2) ok',[v2.actionIds[1],second]))[0].ok).toBe(true);}finally{await db.exec('reset role');}
});
it('never restarts a contact whose older version was already sent',async()=>{
 const f=await fixture([0]);
 const due=(await q('select due_at from outbound_actions where id=$1',[f.v1.actionIds[0]]))[0].due_at.toISOString(),token=crypto.randomUUID();
 await rpc('claim_fenced_synthetic_action',[f.tenant,f.v1.actionIds[0],token,due]);expect(await rpc('complete_fenced_synthetic_action',[f.tenant,f.v1.actionIds[0],token,1,1,due])).toBe(true);
 await f.edit();
 await expect(f.plan('queue',2,{leadId:f.lead,startAt:new Date(Date.now()+60000).toISOString()})).rejects.toThrow('cannot restart');
 expect(await q('select state,asset_version from outbound_actions where campaign_id=$1',[f.id])).toEqual([{state:'tested',asset_version:1}]);
});
