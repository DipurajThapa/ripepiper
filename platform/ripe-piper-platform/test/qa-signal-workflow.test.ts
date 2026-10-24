/** Independent SQL acceptance for Signal qualification/dispatch boundaries. No external calls. */
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import worker from '../src/index';
import type {Env} from '../src/env';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
const actor='00000000-0000-4000-8000-000000000001';
const directory=new URL('../supabase/migrations/',import.meta.url);
let db:PGlite,legacy:any,claimed:any;
const q=async(sql:string,args:any[]=[])=> (await db.query<any>(sql,args)).rows;
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args))[0].value;}finally{await db.exec('reset role');}}
async function fixture(product='signal'){
 const tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('QA Signal',$1,'AE','AED','active') returning id`,[crypto.randomUUID()]))[0].id;
 const lead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[tenant,crypto.randomUUID()+'@example.invalid']))[0].id;
 const observed=new Date(Date.now()-86400000).toISOString();
 const brief={offer:'Reviewed client service',industries:['construction'],markets:['AE'],roles:['owner'],needs:['lead follow-up'],excludedIndustries:[],maxAgeDays:90,source:{reference:'qa-brief',excerpt:'Reviewed construction offer for AE owners',observedAt:observed}};
 await rpc('save_business_brief',[tenant,0,brief,actor]);
 const source=(await q(`insert into lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_facts,assessment_excerpt,assessment_reviewed_by) values($1,$2,'fixture','qa-permitted-contact',$3,'review','fixture-purpose-only',true,'{}','Contact identity only; no qualified Signal trigger',$4) returning id`,[tenant,lead,observed,actor]))[0].id;
 const campaign=crypto.randomUUID();
 await rpc('manage_campaign_plan',[tenant,campaign,actor,'save',0,{product,purpose:'appointment',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'Fixture message',body:'Fixture-only review',evidenceReference:'qa-permitted-contact'}]}]);
 await rpc('manage_campaign_plan',[tenant,campaign,actor,'approve',1,{clientAuthority:'fixture-client',ownerAuthority:'fixture-owner',ctsProfile:'fixture-review',maxActions:3,expiresAt:new Date(Date.now()+7*86400000).toISOString()}]);
 await rpc('manage_campaign_plan',[tenant,campaign,actor,'rights',1,{leadId:lead,sourceId:source,noticeReference:'fixture-only'}]);
 return {tenant,lead,campaign,source};
}
const queue=(f:any,start=new Date(Date.now()+1000).toISOString())=>rpc('manage_campaign_plan',[f.tenant,f.campaign,actor,'queue',1,{leadId:f.lead,startAt:start}]);
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const files=readdirSync(directory).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files.filter(f=>f<='20261024162439_revive_strategy_schedule.sql'))await db.exec(readFileSync(new URL(f,directory),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'qa-staff@example.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
 legacy=await fixture();legacy.at=new Date(Date.now()+1000).toISOString();legacy.id=(await queue(legacy,legacy.at)).actionIds[0];
 claimed=await fixture();claimed.at=new Date(Date.now()+1000).toISOString();claimed.id=(await queue(claimed,claimed.at)).actionIds[0];claimed.token=crypto.randomUUID();
 expect(await rpc('claim_fenced_synthetic_action',[claimed.tenant,claimed.id,claimed.token,claimed.at])).toMatchObject({token:claimed.token});
 for(const f of files.filter(f=>f>'20261024162439_revive_strategy_schedule.sql'))await db.exec(readFileSync(new URL(f,directory),'utf8'));
});
afterAll(async()=>{await db.close();});
it('blocks new Signal enrolment without a qualified trigger-bound strategy',async()=>{const f=await fixture();await expect(queue(f)).rejects.toThrow();expect((await q('select count(*)::int n from outbound_actions where campaign_id=$1',[f.campaign]))[0].n).toBe(0);});
it('blocks claims of historical Signal actions without qualification',async()=>{expect(await rpc('synthetic_action_allowed',[legacy.id,legacy.at])).toBe(false);expect(await rpc('claim_fenced_synthetic_action',[legacy.tenant,legacy.id,crypto.randomUUID(),legacy.at])).toBeNull();});
it('blocks completion of a Signal claim obtained before the new guard',async()=>{expect(await rpc('complete_fenced_synthetic_action',[claimed.tenant,claimed.id,claimed.token,1,1,claimed.at])).toBe(false);expect((await q('select acknowledged_at from outbound_actions where id=$1',[claimed.id]))[0].acknowledged_at).toBeNull();});
it('keeps the existing non-Signal synthetic lifecycle available',async()=>{const f=await fixture('events'),at=new Date(Date.now()+1000).toISOString(),id=(await queue(f,at)).actionIds[0],token=crypto.randomUUID();expect(await rpc('claim_fenced_synthetic_action',[f.tenant,id,token,at])).toMatchObject({token});expect(await rpc('complete_fenced_synthetic_action',[f.tenant,id,token,1,1,at])).toBe(true);});
async function trigger(f:any,patch:any={}){return rpc('record_product_event',[f.tenant,f.lead,actor,'trigger:'+crypto.randomUUID(),'qa-source-rights','A reviewed business change',new Date(Date.now()-86400000).toISOString(),true,{product:'signal',kind:'trigger',relevance:'Review this business change against the offer',expiresAt:new Date(Date.now()+86400000).toISOString(),...patch}]);}
async function result(f:any,signalId:any,patch:any={}){return rpc('record_product_event',[f.tenant,f.lead,actor,'outcome:'+crypto.randomUUID(),'qa-source-rights','Staff outcome evidence for one trigger',new Date(Date.now()-1000).toISOString(),true,{product:'signal',kind:'outcome',outcome:'accepted',reason:'Staff reviewed the particular business trigger',signalId,...patch}]);}
it('links and idempotently replays one reviewed outcome without duplicating the trigger',async()=>{const f=await fixture(),id=await trigger(f),reference='exact-outcome:'+crypto.randomUUID(),at=new Date(Date.now()-1000).toISOString(),args=[f.tenant,f.lead,actor,reference,'qa-source-rights','Staff outcome evidence',at,true,{product:'signal',kind:'outcome',outcome:'meeting_held',reason:'Verified staff outcome record',signalId:id}];const first=await rpc('record_product_event',args);expect(await rpc('record_product_event',args)).toBe(first);expect((await q(`select count(*)::int n from lead_observations where tenant_id=$1 and product_context->>'signalId'=$2`,[f.tenant,id]))[0].n).toBe(1);await expect(rpc('record_product_event',[...args.slice(0,-1),{...args.at(-1) as any,signalId:crypto.randomUUID()}])).rejects.toThrow();});
it.each([undefined,null,true,'wrong-id'])('requires a valid exact Signal identity at the direct SQL boundary: %s',async signalId=>{const f=await fixture();await expect(result(f,signalId)).rejects.toThrow();});
it('rejects cross-tenant, wrong-lead, non-trigger and future-source attribution',async()=>{const f=await fixture(),other=await fixture(),foreign=await trigger(other);await expect(result(f,foreign)).rejects.toThrow();await expect(result(f,f.source)).rejects.toThrow();const secondLead=(await q(`insert into leads(tenant_id,source,email) values($1,'import',$2) returning id`,[f.tenant,crypto.randomUUID()+'@example.invalid']))[0].id;const wrongLead=await trigger({...f,lead:secondLead});await expect(result(f,wrongLead)).rejects.toThrow();const valid=await trigger(f);await expect(rpc('record_product_event',[f.tenant,f.lead,actor,'too-early:'+crypto.randomUUID(),'qa-rights','Earlier than trigger',new Date(Date.now()-2*86400000).toISOString(),true,{product:'signal',kind:'outcome',outcome:'accepted',reason:'Outcome before source is invalid',signalId:valid}])).rejects.toThrow();});
it('does not permit rewriting the referenced Signal or its attributed outcome',async()=>{const f=await fixture(),id=await trigger(f),outcomeId=await result(f,id);await db.exec('set role service_role');try{await expect(q(`update lead_observations set assessment_excerpt='Changed signal' where id=$1`,[id])).rejects.toThrow();await expect(q(`update lead_observations set product_context=jsonb_set(product_context,'{signalId}',to_jsonb($2::text)) where id=$1`,[outcomeId,crypto.randomUUID()])).rejects.toThrow();}finally{await db.exec('reset role');}});
it('prevents non-service callers from recording or executing Signal workflows',async()=>{const f=await fixture(),id=await trigger(f);for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await expect(q('select record_product_event($1,$2,$3,$4,$5,$6,$7,$8,$9)',[f.tenant,f.lead,actor,'denied-'+role,'qa-rights','Denied role',new Date(Date.now()-1000).toISOString(),true,{product:'signal',kind:'outcome',outcome:'accepted',reason:'Unauthorized',signalId:id}])).rejects.toThrow();await expect(q('select synthetic_action_allowed($1,now())',[legacy.id])).rejects.toThrow();}finally{await db.exec('reset role');}}});
it('composes actual Worker source import, SQL provenance, shortlist and trigger-scoped outcome without delivery',async()=>{
 const f=await fixture(),contact=(await q('select email from leads where id=$1',[f.lead]))[0];
 const connection={id:crypto.randomUUID(),tenantId:f.tenant,url:'https://signals.example.com/qa-worker.json',purposeReference:'qa-approved-source-rights',expiresAt:new Date(Date.now()+86400000).toISOString(),enabled:true,synthetic:true};
 const item={id:'worker-office-change',company:'QA Signal',email:contact.email,sourceUrl:'https://company.example.com/news',observedAt:new Date(Date.now()-3600000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),summary:'Opened an office; actual need remains unverified.',relevance:'Review fit with the recorded offer.'};
 const env={SUPABASE_URL:'https://qa-worker-db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',SUPABASE_ANON_KEY:'fixture-public',SIGNAL_SOURCE_CONNECTIONS:JSON.stringify([connection])} as Env;
 const beforeRights=(await q('select count(*)::int n from contact_rights where tenant_id=$1',[f.tenant]))[0].n;
 const requests:string[]=[];
 vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const u=new URL(input);requests.push(u.pathname);
  if(u.href===connection.url)return Response.json({items:[item]});
  if(u.origin!==env.SUPABASE_URL)throw Error('QA rejects external provider requests');
  if(u.pathname==='/auth/v1/user')return Response.json({id:actor,email:'qa-staff@example.invalid'});
  if(u.pathname==='/rest/v1/profiles')return Response.json([{id:actor,is_admin:true}]);
  if(u.pathname.startsWith('/rest/v1/rpc/')){const name=u.pathname.split('/').at(-1)!;if(!['import_review_lead','record_product_event'].includes(name))throw Error('Unexpected RPC');const b=JSON.parse(String(init.body));if(Object.keys(b).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Unexpected RPC argument');try{await db.exec('set role service_role');return Response.json((await q(`select public.${name}(${Object.keys(b).map((k,i)=>k+'=> $'+(i+1)).join(',')}) value`,Object.values(b)))[0].value);}catch(e:any){return Response.json({code:e.code,message:e.message},{status:400});}finally{await db.exec('reset role');}}
  const table=u.pathname.replace('/rest/v1/','');if(!['tenants','leads','business_briefs','lead_observations','lead_suppression','suppression'].includes(table))throw Error('Unexpected table');
  const where:string[]=[],values:any[]=[];
  for(const [key,value] of u.searchParams){if(['select','limit','order'].includes(key))continue;const m=/^([a-z_]+)(?:->>([a-zA-Z]+))?$/.exec(key);if(!m)throw Error('Unexpected filter');const field=m[2]?`${m[1]}->>'${m[2]}'`:m[1];if(value==='not.is.null'){where.push(field+' is not null');continue;}if(value.startsWith('in.(')){values.push(value.slice(4,-1).split(',').map(v=>v.replace(/^"|"$/g,'')));where.push(field+`::text=any($${values.length}::text[])`);continue;}const dot=value.indexOf('.'),operator={eq:'=',lte:'<='}[value.slice(0,dot)];if(!operator)throw Error('Unexpected operator');const raw=value.slice(dot+1);values.push(key==='synthetic'?raw==='true':raw);where.push(field+operator+'$'+values.length);}
  const order=(u.searchParams.get('order')||'').split(',').filter(Boolean).map(v=>{if(!/^[a-z_]+(?:\.(?:asc|desc))?$/.test(v))throw Error('Unexpected order');return v.replace('.',' ');});
  return Response.json(await q(`select * from ${table}${where.length?' where '+where.join(' and '):''}${order.length?' order by '+order.join(','):''} limit ${Math.min(1001,Number(u.searchParams.get('limit')||1001))}`,values));
 });
 const call=(action:string,body:any)=>worker.fetch(new Request(`https://qa-worker.invalid/api/admin/tenants/${f.tenant}/${action}`,{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)}),env,{} as ExecutionContext);
 try{
  const previewResponse=await call('signal-source',{operation:'preview'});expect(previewResponse.status).toBe(200);const preview:any=await previewResponse.json();
  const request={operation:'import',item_id:item.id,digest:preview.items[0].digest,reviewed:true};const importedResponse=await call('signal-source',request);expect(importedResponse.status).toBe(200);const imported:any=await importedResponse.json();expect(imported).toMatchObject({tenantId:f.tenant,sourceId:connection.id,itemId:item.id,digest:preview.items[0].digest,synthetic:true,lead_id:f.lead,delivery:'not_sent',contactAllowed:false});
  const replay:any=await(await call('signal-source',request)).json();expect(replay).toMatchObject({lead_id:f.lead,observation_id:imported.observation_id,state:'duplicate'});
  const shortlistResponse=await call('shortlist',{synthetic:true});expect(shortlistResponse.status).toBe(200);const shortlist:any=await shortlistResponse.json();const signal=shortlist.results[0].products.find((p:any)=>p.product==='signal');expect(signal).toMatchObject({reference:imported.observation_id,state:'qualify_fit',contactAllowed:false,outcomes:[]});
  const outcomeBody={lead_id:f.lead,reference:'qa-worker-outcome',rights_reference:'qa-reviewed-outcome',excerpt:'Owner accepted this particular trigger for further qualification.',observed_at:new Date(Date.now()-1000).toISOString(),synthetic:true,context:{product:'signal',kind:'outcome',outcome:'accepted',reason:'Reviewed this exact office change',signalId:imported.observation_id}};
  expect((await call('product-event',{...outcomeBody,context:{...outcomeBody.context,signalId:crypto.randomUUID()}})).status).toBe(409);
  expect((await call('product-event',outcomeBody)).status).toBe(201);
  const final:any=await(await call('shortlist',{synthetic:true})).json();const reviewed=final.results[0].products.find((p:any)=>p.product==='signal');expect(reviewed.outcomes).toHaveLength(1);expect(reviewed).toMatchObject({reference:imported.observation_id,outcomeScope:'signal_reference',contactAllowed:false});expect(reviewed.outcomes[0]).toMatchObject({signalId:imported.observation_id,outcome:'accepted',attributionScope:'signal_reference',deliveryEstablished:false});
  expect((await q('select count(*)::int n from contact_rights where tenant_id=$1',[f.tenant]))[0].n).toBe(beforeRights);expect(await q('select id from outbound_actions where tenant_id=$1',[f.tenant])).toHaveLength(0);expect(requests.every(p=>p==='/qa-worker.json'||p.startsWith('/auth/v1/')||p.startsWith('/rest/v1/'))).toBe(true);
 }finally{vi.unstubAllGlobals();}
});
