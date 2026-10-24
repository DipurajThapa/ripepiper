import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
const actor='11111111-1111-4111-8111-111111111111';
let db:PGlite;
const q=async(sql:string,args:any[]=[])=> (await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return(await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);
 for(const f of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,directory),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at)values($1,'audience-staff@test.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
},30000);
afterAll(async()=>db?.close());
async function contact(tenant?:string){
 if(!tenant){
  tenant=(await q(`insert into tenants(name,slug,country,currency,status)values('Audience fixture',$1,'AE','AED','active')returning id`,['audience-'+crypto.randomUUID()]))[0].id;
  await rpc('save_business_brief',[tenant,0,{offer:'Recover dormant enquiries',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up'],excludedIndustries:[],maxAgeDays:30,source:{reference:'audience-brief',excerpt:'Reviewed construction offer',observedAt:new Date(Date.now()-3600000).toISOString()}},actor]);
 }
 const lead=(await q(`insert into leads(tenant_id,source,email,company)values($1,'import',$2,'Reviewed construction business')returning id`,[tenant,crypto.randomUUID()+'@audience.invalid']))[0].id;
 const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by,product_context)
 values($1,$2,'fixture',$3,now()-interval '1 hour','audience review','fixture use authority',true,'{"industry":"construction","market":"AE","role":"owner","need":"lead follow-up"}','construction AE owner lead follow-up',$4,$5)returning id`,
 [tenant,lead,crypto.randomUUID(),actor,{product:'revive',kind:'history',lastContactAt:new Date(Date.now()-60*86400000).toISOString(),previousInterest:'yes',stalledReason:'Project deferred'}]))[0].id;
 const snapshot=(await q('select revive_input_snapshot($1,$2) snapshot',[tenant,lead]))[0].snapshot;
 await rpc('review_revive_candidate',[tenant,lead,actor,0,snapshot,1,'accepted','Reviewed relevant dormant business contact',new Date(Date.now()+7*86400000).toISOString()]);
 return {tenant:tenant!,lead,source};
}
function body(ids?:string[]){return{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'Reviewed enquiry',body:'Is this still relevant?',evidenceReference:'audience-brief'}],...(ids?{audience:{leadIds:ids,confirmed:true}}:{})};}
const save=(f:{tenant:string},id:string,version:number,b:any)=>rpc('manage_campaign_plan',[f.tenant,id,actor,'save',version,b]);
const approval=()=>({clientAuthority:'client reviewed',ownerAuthority:'owner reviewed',ctsProfile:'fixture compliance review',maxActions:10,expiresAt:new Date(Date.now()+86400000).toISOString()});
const approve=(f:{tenant:string},id:string,version=1,b=approval())=>rpc('manage_campaign_plan',[f.tenant,id,actor,'approve',version,b]);
const rights=(f:{tenant:string;lead:string;source:string},id:string,version=1)=>rpc('manage_campaign_plan',[f.tenant,id,actor,'rights',version,{leadId:f.lead,sourceId:f.source,noticeReference:'synthetic fixture only'}]);
const queue=(f:{tenant:string;lead:string},id:string,version=1)=>rpc('manage_campaign_plan',[f.tenant,id,actor,'queue',version,{leadId:f.lead,startAt:new Date(Date.now()+1000).toISOString()}]);

it('stores only the explicitly reviewed current audience, in canonical order, with no implicit rights or action',async()=>{
 const f=await contact(),second=await contact(f.tenant),id=crypto.randomUUID();
 expect(await save(f,id,0,body([second.lead,f.lead]))).toMatchObject({version:1,status:'draft'});
 const asset=(await q('select revive_audience from campaign_assets where campaign_id=$1',[id]))[0];
 expect(asset.revive_audience.reviewedBy).toBe(actor);expect(asset.revive_audience.members.map((m:any)=>m.leadId)).toEqual([f.lead,second.lead].sort());
 expect(asset.revive_audience.members.every((m:any)=>m.reviewVersion===1&&/^[a-f0-9]{32}$/.test(m.snapshot))).toBe(true);
 expect(await save(f,id,1,body([f.lead,second.lead]))).toMatchObject({version:1,status:'draft'});
 expect(await q('select id from outbound_actions where campaign_id=$1',[id])).toHaveLength(0);expect(await q('select id from contact_rights where tenant_id=$1',[f.tenant])).toHaveLength(0);
});
it('lists only current accepted contacts within the selected tenant',async()=>{
 const f=await contact(),suppressed=await contact(f.tenant),foreign=await contact();
 await q(`insert into lead_suppression(tenant_id,lead_id,reason)values($1,$2,'fixture stop')`,[f.tenant,suppressed.lead]);
 const candidates=await rpc('revive_audience_candidates',[f.tenant,actor]);
 expect(candidates.map((c:any)=>c.leadId)).toEqual([f.lead]);expect(candidates[0]).toMatchObject({reviewVersion:1});expect(JSON.stringify(candidates)).not.toContain(foreign.lead);
});
it('records a new version for a different audience reviewer rather than retaining the old review identity',async()=>{
 const f=await contact(),id=crypto.randomUUID(),next=crypto.randomUUID();await save(f,id,0,body([f.lead]));
 await q(`insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())`,[next,next+'@staff.invalid']);await q('update profiles set is_admin=true where id=$1',[next]);
 expect(await rpc('manage_campaign_plan',[f.tenant,id,next,'save',1,body([f.lead])])).toMatchObject({version:2,status:'draft'});
 expect((await q('select revive_audience from campaign_assets where campaign_id=$1 and version=2',[id]))[0].revive_audience.reviewedBy).toBe(next);
});
it('keeps missing-audience manual plans in draft and blocks legacy approval, queue and direct insert',async()=>{
 const f=await contact(),id=crypto.randomUUID();await save(f,id,0,body());
 await expect(approve(f,id)).rejects.toThrow('reviewed Revive audience');
 await q(`update campaigns set status='approved',client_authority_ref='client',owner_authority_ref='owner',cts_profile_ref='fixture',expires_at=now()+interval '1 day',max_actions=10 where id=$1`,[id]);
 await q('update campaign_assets set approved_by=$2 where campaign_id=$1',[id,actor]);
 await expect(queue(f,id)).rejects.toThrow('reviewed campaign audience');
 await expect(q(`insert into outbound_actions(tenant_id,campaign_id,lead_id,correlation_key,approval_version,asset_version,due_at)values($1,$2,$3,'legacy-unbound',1,1,now())`,[f.tenant,id,f.lead])).rejects.toThrow('reviewed campaign audience');
 expect(await save(f,id,1,body())).toMatchObject({version:2,status:'draft'});
});
it('does not enrol a globally accepted contact outside this campaign, despite scoped rights',async()=>{
 const f=await contact(),outside=await contact(f.tenant),id=crypto.randomUUID();await save(f,id,0,body([f.lead]));await approve(f,id);await rights(f,id);await rights(outside,id);
 await expect(queue(outside,id)).rejects.toThrow('reviewed campaign audience');
 expect((await queue(f,id)).actionIds).toHaveLength(1);
});
it.each(['foreign','duplicate','empty','unconfirmed','oversize','unaccepted'])('rejects %s audience without saving a partial campaign',async change=>{
 const f=await contact(),id=crypto.randomUUID(),b:any=body([f.lead]);
 if(change==='foreign')b.audience.leadIds=[(await contact()).lead];
 if(change==='duplicate')b.audience.leadIds=[f.lead,f.lead.toUpperCase()];
 if(change==='empty')b.audience.leadIds=[];
 if(change==='unconfirmed')b.audience.confirmed='true';
 if(change==='oversize')b.audience.leadIds=Array.from({length:26},()=>crypto.randomUUID());
 if(change==='unaccepted')await q(`update revive_reviews set state='rejected' where tenant_id=$1 and lead_id=$2`,[f.tenant,f.lead]);
 await expect(save(f,id,0,b)).rejects.toThrow();expect(await q('select id from campaigns where id=$1',[id])).toHaveLength(0);
});
it('version-controls audience-only changes and cancels old queued work before a new approval',async()=>{
 const f=await contact(),second=await contact(f.tenant),id=crypto.randomUUID();await save(f,id,0,body([f.lead]));await approve(f,id);await rights(f,id);const queued=await queue(f,id);
 expect(await save(f,id,1,body([second.lead]))).toMatchObject({version:2,status:'draft'});
 expect((await q('select state,error_code from outbound_actions where id=$1',[queued.actionIds[0]]))[0]).toEqual({state:'cancelled',error_code:'message_version_changed'});
 await expect(approve(f,id,1)).rejects.toThrow('changed');await expect(queue(second,id,2)).rejects.toThrow('Approved current plan');
 expect((await q('select revive_audience from campaign_assets where campaign_id=$1 and version=1',[id]))[0].revive_audience.members[0].leadId).toBe(f.lead);
});
it('rejects a stale accepted-review binding on approval replay, queue and completion',async()=>{
 const f=await contact(),id=crypto.randomUUID();await save(f,id,0,body([f.lead]));const authority=approval();await approve(f,id,1,authority);await rights(f,id);const queued=await queue(f,id);
 const token=crypto.randomUUID(),at=new Date(Date.now()+2000).toISOString();expect(await rpc('claim_fenced_synthetic_action',[f.tenant,queued.actionIds[0],token,at])).toMatchObject({token});
 const snapshot=(await q('select snapshot from revive_reviews where tenant_id=$1 and lead_id=$2',[f.tenant,f.lead]))[0].snapshot;
 await rpc('review_revive_candidate',[f.tenant,f.lead,actor,1,snapshot,1,'accepted','Explicitly reviewed relationship again',new Date(Date.now()+7*86400000).toISOString()]);
 await expect(approve(f,id,1,authority)).rejects.toThrow('reviewed Revive audience');await expect(queue(f,id)).rejects.toThrow('reviewed campaign audience');
 expect(await rpc('complete_fenced_synthetic_action',[f.tenant,queued.actionIds[0],token,1,1,at])).toBe(false);
});
it('denies direct mutation of stored audience and public audience RPCs',async()=>{
 const f=await contact(),id=crypto.randomUUID();await save(f,id,0,body([f.lead]));
 await expect(q('update campaign_assets set revive_audience=null where campaign_id=$1',[id])).rejects.toThrow('new asset version');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await expect(q('select revive_audience_candidates($1,$2)',[f.tenant,actor])).rejects.toThrow('permission');}finally{await db.exec('reset role');}}
});
it('leaves another product manual plan and approval unchanged',async()=>{
 const f=await contact(),id=crypto.randomUUID();await save(f,id,0,{...body(),product:'signal'});expect(await approve(f,id)).toMatchObject({status:'approved',version:1});
});
