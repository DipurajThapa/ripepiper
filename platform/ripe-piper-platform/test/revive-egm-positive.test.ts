import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {assessRevive} from '../src/foundation/revive';
import {seedReviveSetup} from './helpers/revive-setup';
import {asOperator} from './helpers/access';

const actor='90111111-1111-4111-8111-111111111111',viewer='90222222-2222-4222-8222-222222222222';
let db:PGlite;
const q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);
 for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,directory),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'qa-staff@example.invalid',now()),($2,'qa-viewer@example.invalid',now())`,[actor,viewer]);
 await q('update profiles set is_admin=true where id=$1',[actor]);
},30000);
afterAll(async()=>db?.close());afterEach(()=>vi.restoreAllMocks());

async function fixture(briefOverrides:Record<string,unknown>={}){
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('QA boundary',$1,'AE','AED','active') returning id`,[crypto.randomUUID()]))[0].id;
 await asOperator(db,{tenantId:tenant,profileId:actor});
 const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 const observed=new Date(Date.now()-86400000).toISOString();
 const body={offer:'Recover construction enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['quote follow-up'],excludedIndustries:[],maxAgeDays:90,source:{reference:'qa-brief',excerpt:'Approved construction offer',observedAt:observed},...briefOverrides};
 await rpc('save_business_brief',[tenant,0,body,actor]);const seeded=await seedReviveSetup(db,tenant,actor);
 await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'qa','qa-fit',$3,'review','qa-authority',true,$4,'construction AE owner quote follow-up',$5)`,[tenant,lead,observed,{industry:'construction',market:'AE',role:'owner',need:'quote follow-up'},actor]);
 await rpc('record_product_event',[tenant,lead,actor,'qa-history','qa-authority','Prior enquiry verified',observed,true,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-75*86400000).toISOString(),previousInterest:'yes',stalledReason:'Deferred previously'}]);
 return {tenant,lead,body,strategy:seeded.strategy};
}
async function accept(f:any){
 const context=await rpc('revive_review_context',[f.tenant,f.lead,actor]);const assessment=assessRevive(context);expect(assessment.eligible).toBe(true);
 return rpc('review_revive_candidate',[f.tenant,f.lead,actor,context.review?.version??0,context.snapshot,1,'accepted','QA reviewed current relationship',assessment.expiresAt]);
}
async function campaign(f:any,offset=0,approver=actor){
 const id=crypto.randomUUID();await rpc('manage_campaign_plan',[f.tenant,id,actor,'save',0,{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',strategy:f.strategy,audience:{leadIds:[f.lead],confirmed:true},steps:[{offsetHours:0,subject:'Is this relevant?',body:'May we close the loop?',evidenceReference:'qa-fit'},...(offset?[{offsetHours:offset,subject:'Follow up',body:'Reviewed step',evidenceReference:'qa-history'},{offsetHours:offset*2,subject:'Closing the loop',body:'Final reviewed step',evidenceReference:'qa-history'}]:[])]}]);
 await rpc('manage_campaign_plan',[f.tenant,id,approver,'approve',1,{clientAuthority:'qa-client',ownerAuthority:'qa-owner',ctsProfile:'qa-profile',maxActions:3,expiresAt:new Date(Date.now()+29*86400000).toISOString()}]);
 const source=(await q(`select id from lead_observations where tenant_id=$1 and external_ref='qa-fit'`,[f.tenant]))[0].id;
 await rpc('manage_campaign_plan',[f.tenant,id,actor,'rights',1,{leadId:f.lead,sourceId:source,noticeReference:'qa-notice'}]);return id;
}
async function afterDue(id:string){return new Date(Date.parse((await q('select due_at from outbound_actions where id=$1',[id]))[0].due_at)+1000).toISOString();}
const queue=(f:any,c:string)=>rpc('manage_campaign_plan',[f.tenant,c,actor,'queue',1,{leadId:f.lead,startAt:new Date(Date.now()+1000).toISOString()}]);


it('queues three future steps but claims them only in order',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f,24),ids=(await queue(f,c)).actionIds;expect(ids).toHaveLength(3);
 await db.exec('begin');expect(await rpc('claim_fenced_synthetic_action',[f.tenant,ids[1],crypto.randomUUID(),await afterDue(ids[1])])).toBeNull();await db.exec('rollback');
 for(const id of ids){const token=crypto.randomUUID(),at=await afterDue(id);expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(true);}
 expect(await q("select id from outbound_actions where campaign_id=$1 and state='tested'",[c])).toHaveLength(3);
}, 20000);
it('ignores stale conflicting facts',async()=>{
 const f=await fixture();await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'fixture','stale-fit',now()-interval '120 days','review','fixture-authority',true,'{"industry":"retail"}','retail',$3)`,[f.tenant,f.lead,actor]);await accept(f);expect(await rpc('revive_candidate_current',[f.tenant,f.lead,new Date().toISOString()])).toBe(true);
});
it('rejects a raw claim that omits the bounded attempt increment',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f),id=(await queue(f,c)).actionIds[0];
 await db.exec('set role service_role');try{await expect(q("update outbound_actions set state='claimed',lease_until=due_at+interval '2 minutes' where id=$1",[id])).rejects.toThrow('Bounded Revive claim');}finally{await db.exec('reset role');}
});
it('rejects raw completion when campaign capacity was reduced after claim',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f,24),ids=(await queue(f,c)).actionIds;
 for(const id of ids.slice(0,2)){const token=crypto.randomUUID(),at=await afterDue(id);expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});if(id===ids[0])expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(true);}
 await q('update campaigns set max_actions=1 where id=$1',[c]);
 await db.exec('set role service_role');try{await expect(q("update outbound_actions set state='tested',provider_ref='test-sink:'||id::text,acknowledged_at=due_at+interval '1 second' where id=$1",[ids[1]])).rejects.toThrow('Current Revive contact rights');}finally{await db.exec('reset role');}
});
it('ignores invalid overlength raw facts instead of allowing their trimmed conflict',async()=>{
 const f=await fixture();await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'fixture','invalid-fit',now()-interval '1 hour','review','fixture-authority',true,$3,'retail',$4)`,[f.tenant,f.lead,{industry:'retail'+' '.repeat(101)},actor]);await accept(f);expect(await rpc('revive_candidate_current',[f.tenant,f.lead,new Date().toISOString()])).toBe(true);
});

it('rejects an infinite raw claim lease with otherwise valid attempt increment',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f),id=(await queue(f,c)).actionIds[0];
 await db.exec('set role service_role');try{await expect(q("update outbound_actions set state='claimed',attempts=attempts+1,lease_until='infinity' where id=$1",[id])).rejects.toThrow('Bounded Revive claim');}finally{await db.exec('reset role');}
});

it('rejects a finite raw claim lease beyond the synthetic clock tolerance',async()=>{
 const f=await fixture();await accept(f);const c=await campaign(f),id=(await queue(f,c)).actionIds[0];
 await db.exec('set role service_role');try{await expect(q("update outbound_actions set state='claimed',attempts=attempts+1,lease_until=greatest(now(),due_at)+interval '3 minutes 1 second' where id=$1",[id])).rejects.toThrow('Bounded Revive claim');}finally{await db.exec('reset role');}
});
