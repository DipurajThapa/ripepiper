/** Anvukta pilot rehearsal. Fictional contacts, isolated SQL, intercepted network only.
 * The Signal journey ends at reviewed qualification/draft; provider tests are separate
 * shared-component simulations and do not establish tenant send/booking capability.
 */
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import worker from '../src/index';
import type {Env} from '../src/env';
import {busyTimes,calendarEventId,createMeetEvent,reconcileMeetEvent,sendEmail} from '../src/lib/google';
import {assessProspect,type Observation,type BusinessBrief} from '../src/foundation/prospecting';
import {reviewProducts} from '../src/foundation/products';
import {seedReviveSetup} from './helpers/revive-setup';
import {tenantGoogleConnection} from '../src/foundation/connections';
import {asOperator} from './helpers/access';

const actor='00000000-0000-4000-8000-000000000081';
const contact='coo@cedar.example.invalid';
const meeting={id:'00000000-0000-4000-8000-000000000082',start:'2026-11-02T06:00:00Z',end:'2026-11-02T06:15:00Z',email:contact,name:'Fictional Cedar COO',summary:'Anvukta workflow ownership review — synthetic',description:'Fixture-only handoff review; no actual booking.'};
const sender='Anvukta test <pilot@example.invalid>';
const subject='Cedar Works: project handoff ownership';
const message='Your reviewed interview identifies workflow ownership gaps. Anvukta can help map workflow ownership across project and office teams. Is a 15-minute handoff review useful? Reply stop to end this conversation. Synthetic draft only.';
const providerEnv=()=>({GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_REFRESH_TOKEN:'synthetic-refresh',GOOGLE_CALENDAR_ID:'anvukta-pilot@example.invalid',MAIL_FROM:sender} as Env);
const calendarPath='/calendar/v3/calendars/anvukta-pilot%40example.invalid/events';
const event=()=>({id:calendarEventId(meeting.id),status:'confirmed',extendedProperties:{private:{ripe_meeting_id:meeting.id}},start:{dateTime:meeting.start},end:{dateTime:meeting.end},attendees:[{email:contact}],hangoutLink:'https://meet.google.com/abc-defg-hij'});
afterEach(()=>vi.unstubAllGlobals());

it('rehearses two configured clients through isolated Signal discovery, qualification, drafts and outcomes while execution remains held',async()=>{
 const db=new PGlite({extensions:{btree_gist}}),q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,directory),'utf8'));
  await q(`insert into auth.users(id,email,email_confirmed_at) values($1,'pilot-staff@example.invalid',now())`,[actor]);
  await q('update profiles set is_admin=true where id=$1',[actor]);
  const tenant=(await q(`insert into tenants(name,slug,country,currency,status) values('Anvukta — synthetic pilot','anvukta-synthetic-pilot','AE','AED','active') returning id`))[0].id;
  const otherTenant=(await q(`insert into tenants(name,slug,country,currency,status) values('Northstar Safety — fictional client','northstar-synthetic-pilot','AE','AED','active') returning id`))[0].id;
  for(const t of [tenant,otherTenant])await asOperator(db,{tenantId:t,profileId:actor});
  const observedAt=new Date(Date.now()-3600000).toISOString(),expiresAt=new Date(Date.now()+7*86400000).toISOString();
  const source={id:crypto.randomUUID(),tenantId:tenant,url:'https://signals.example.com/anvukta-pilot.json',purposeReference:'synthetic-fixture-source-review-only',expiresAt,enabled:true,synthetic:true};
  const items=[
   {id:'cedar-project-expansion',company:'Cedar Works (fictional)',email:contact,sourceUrl:'https://cedar.example.com/news',observedAt,expiresAt,summary:'Fictional construction company added a second project team in AE.',relevance:'Assess project handoffs and workflow ownership; expansion alone does not prove need.'},
   {id:'dune-new-office',company:'Dune Build (fictional)',email:'owner@dune.example.invalid',sourceUrl:'https://dune.example.com/news',observedAt,expiresAt,summary:'Fictional company announced an office opening.',relevance:'Review current fit; office opening alone does not prove a buying need.'},
  ];
  const otherSource={...source,id:crypto.randomUUID(),tenantId:otherTenant,url:'https://signals.example.com/northstar-pilot.json',purposeReference:'northstar-synthetic-source-review-only'};
  const otherItems=[{...items[0],summary:'Fictional Cedar Works announced a new site induction programme.',relevance:'Review site safety onboarding fit; the announcement alone is insufficient.'}];
  const env={SUPABASE_URL:'https://anvukta-pilot-db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',SYNTHETIC_SINK_ENABLED:'true',SIGNAL_SOURCE_CONNECTIONS:JSON.stringify([source,otherSource])} as Env;
  const requests:{url:string;method:string}[]=[],rpcNames:string[]=[];
  let sourceItems=items;
  // Small PostgREST transport bridge: actual SQL, predicates and RPCs, never canned app results.
  vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
   const u=new URL(input),method=init.method??'GET';requests.push({url:u.href,method});
   if(u.href===source.url||u.href===otherSource.url){expect(method).toBe('GET');expect(init.redirect).toBe('error');return Response.json({items:u.href===source.url?sourceItems:otherItems});}
   if(u.origin!==env.SUPABASE_URL)throw Error('Unexpected external request in isolated Signal pilot');
   if(u.pathname==='/auth/v1/user'){expect(method).toBe('GET');return Response.json({id:actor,email:'pilot-staff@example.invalid'});}
   if(u.pathname.startsWith('/rest/v1/rpc/')){
    expect(method).toBe('POST');const name=u.pathname.split('/').at(-1)!;
    if(!['tenant_access','save_business_brief','import_review_lead','record_product_event','manage_campaign_plan','revive_setup_context','review_prospect_snapshot'].includes(name))throw Error('Unexpected RPC');
    if(name!=='tenant_access')rpcNames.push(name);const b=JSON.parse(String(init.body));
    if(Object.keys(b).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Unexpected RPC argument');
    await db.exec('set role service_role');
    try{return Response.json((await q(`select public.${name}(${Object.keys(b).map((k,i)=>k+'=> $'+(i+1)).join(',')}) value`,Object.values(b)))[0].value);}
    catch(e:any){return Response.json({code:e.code,message:e.message},{status:400});}
    finally{await db.exec('reset role');}
   }
   const table=u.pathname.replace('/rest/v1/','');
   if(!['profiles','tenants','leads','business_briefs','lead_observations','lead_suppression','suppression','campaigns'].includes(table))throw Error('Unexpected table');
   if(method==='POST'){
    if(table!=='lead_observations')throw Error('Unexpected table mutation');
    const body=JSON.parse(String(init.body)),keys=Object.keys(body);
    if(keys.some(k=>!/^[_a-z]+$/.test(k)))throw Error('Unexpected column');
    await db.exec('set role service_role');
    try{return Response.json(await q(`insert into lead_observations(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(body)),{status:201});}
    finally{await db.exec('reset role');}
   }
   expect(method).toBe('GET');const where:string[]=[],values:any[]=[];
   for(const [key,value] of u.searchParams){
    if(['select','limit','order'].includes(key))continue;
    const m=/^([a-z_]+)(?:->>([a-zA-Z]+))?$/.exec(key);if(!m)throw Error('Unexpected filter');
    const field=m[2]?`${m[1]}->>'${m[2]}'`:m[1];
    if(value==='not.is.null'){where.push(field+' is not null');continue;}
    if(value.startsWith('in.(')){values.push(value.slice(4,-1).split(',').map(v=>v.replace(/^"|"$/g,'')));where.push(field+`::text=any($${values.length}::text[])`);continue;}
    const dot=value.indexOf('.'),operator=({eq:'=',lte:'<='} as Record<string,string>)[value.slice(0,dot)];if(!operator)throw Error('Unexpected operator');
    const raw=value.slice(dot+1);values.push(key==='synthetic'?raw==='true':raw);where.push(field+operator+'$'+values.length);
   }
   const order=(u.searchParams.get('order')||'').split(',').filter(Boolean).map(v=>{if(!/^[a-z_]+(?:\.(?:asc|desc))?$/.test(v))throw Error('Unexpected order');return v.replace('.',' ');});
   const limit=Number(u.searchParams.get('limit')||1001);if(!Number.isInteger(limit)||limit<1||limit>1001)throw Error('Unexpected limit');
   return Response.json(await q(`select * from ${table}${where.length?' where '+where.join(' and '):''}${order.length?' order by '+order.join(','):''} limit ${limit}`,values));
  });
  const call=(action:string,body:any,client=tenant)=>worker.fetch(new Request(`https://anvukta-pilot.invalid/api/admin/tenants/${client}/${action}`,{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)}),env,{} as ExecutionContext);
  const read=async(action:string,body:any,status=200,client=tenant)=>{const r=await call(action,body,client);expect(r.status).toBe(status);return await r.json() as any;};
  const brief={offer:'Map and improve workflow ownership across UAE construction project and office teams.',industries:['construction'],markets:['AE'],roles:['COO','owner'],needs:['workflow ownership'],excludedIndustries:['retail'],maxAgeDays:30,source:{reference:'anvukta-pilot-strategy-v1',excerpt:'Synthetic pilot hypothesis based on Anvukta business operations services; this target segment is unvalidated.',observedAt}};
  expect(await read('brief',{expected_version:0,brief})).toMatchObject({ok:true,version:1});
  const preview=await read('signal-source',{operation:'preview'});expect(preview.items).toHaveLength(2);expect(preview.sourceId).toBe(source.id);
  expect(await q('select id from leads where tenant_id=$1',[tenant])).toHaveLength(0);
  const request={operation:'import',item_id:items[0].id,digest:preview.items[0].digest,reviewed:true};
  await read('signal-source',{...request,reviewed:false},400);
  sourceItems=[{...items[0],summary:'Changed since the operator preview'},items[1]];
  await read('signal-source',request,409);expect(await q('select id from leads where tenant_id=$1',[tenant])).toHaveLength(0);sourceItems=items;
  const imported=await read('signal-source',request);
  expect(imported).toMatchObject({ok:true,tenantId:tenant,sourceId:source.id,itemId:items[0].id,digest:preview.items[0].digest,synthetic:true,state:'created',contactAllowed:false,delivery:'not_sent'});
  const replay=await read('signal-source',request);expect(replay).toMatchObject({lead_id:imported.lead_id,observation_id:imported.observation_id,state:'duplicate'});
  const second=await read('signal-source',{operation:'import',item_id:items[1].id,digest:preview.items[1].digest,reviewed:true});
  expect(await q('select id from leads where tenant_id=$1',[tenant])).toHaveLength(2);
  let shortlist=await read('shortlist',{synthetic:true});expect(shortlist.results.every((r:any)=>r.state==='unknown')).toBe(true);
  expect(shortlist.results.find((r:any)=>r.leadId===imported.lead_id).products.find((p:any)=>p.product==='signal')).toMatchObject({state:'qualify_fit',reference:imported.observation_id,contactAllowed:false});
  const evidence={lead_id:imported.lead_id,source:'synthetic-client-interview',reference:'cedar-reviewed-needs-v1',rights_reference:'synthetic-interview-review-only',observed_at:observedAt,synthetic:true,facts:{industry:'construction',market:'AE',role:'COO',need:'workflow ownership'},excerpt:'Cedar operates in construction in AE. The COO confirmed workflow ownership gaps across project and office teams.'};
  await read('prospect-evidence',{...evidence,reference:'unsupported-fact',facts:{...evidence.facts,need:'budget approved'}},400);
  const fact=await read('prospect-evidence',evidence,201);expect(fact.id).toMatch(/^[0-9a-f-]{36}$/);
  shortlist=await read('shortlist',{synthetic:true});
  const qualified=shortlist.results.find((r:any)=>r.leadId===imported.lead_id),unknown=shortlist.results.find((r:any)=>r.leadId===second.lead_id);
  expect(qualified).toMatchObject({state:'candidate',fitPoints:90,score:null,contactAllowed:false,readiness:'unknown',engagement:'unknown'});
  expect(qualified.fields.every((f:any)=>f.state==='match'&&f.evidence.some((e:any)=>e.id===fact.id))).toBe(true);
  expect(qualified.products.find((p:any)=>p.product==='signal')).toMatchObject({state:'prioritise_review',reference:imported.observation_id});expect(unknown.state).toBe('unknown');
  const campaign=crypto.randomUUID(),body={product:'signal',purpose:'appointment',market:'AE',timezone:'Asia/Dubai',steps:[{offsetHours:0,subject,body:message,evidenceReference:evidence.reference}]};
  expect(await read('campaigns',{operation:'save',campaign_id:campaign,version:0,body})).toMatchObject({ok:true,id:campaign,version:1,status:'draft',delivery:'not_sent'});
  const beforeQueue=rpcNames.length;
  await read('campaigns',{operation:'queue',campaign_id:campaign,version:1,body:{leadId:imported.lead_id,startAt:new Date(Date.now()+3600000).toISOString()}},409);
  expect(rpcNames).toHaveLength(beforeQueue+1);expect(rpcNames.at(-1)).toBe('manage_campaign_plan');expect(await q('select id from outbound_actions where campaign_id=$1',[campaign])).toHaveLength(0);
  const outcome={lead_id:imported.lead_id,reference:'cedar-signal-review-v1',rights_reference:'synthetic-operator-review',excerpt:'Operator accepted this trigger for additional review; no prospect was contacted.',observed_at:new Date().toISOString(),synthetic:true,context:{product:'signal',kind:'outcome',outcome:'accepted',reason:'Reviewed matching industry, market, role and need evidence.',signalId:imported.observation_id}};
  await read('product-event',{...outcome,context:{...outcome.context,signalId:second.observation_id}},409);
  const receipt=await read('product-event',outcome,201);expect(await read('product-event',outcome,201)).toMatchObject({id:receipt.id,delivery:'not_sent'});
  const final=await read('shortlist',{synthetic:true}),group=final.results.find((r:any)=>r.leadId===imported.lead_id).products.find((p:any)=>p.product==='signal');
  expect(group).toMatchObject({outcomeScope:'signal_reference',reference:imported.observation_id,contactAllowed:false});expect(group.outcomes).toHaveLength(1);expect(group.outcomes[0]).toMatchObject({outcome:'accepted',signalId:imported.observation_id,deliveryEstablished:false});
  // A second client uses the same handlers and SQL through configuration only.
  // The same contact can belong to distinct client lead records; no evidence is shared.
  const otherBrief={...brief,offer:'Site safety onboarding for construction teams.',needs:['site safety onboarding'],source:{...brief.source,reference:'northstar-pilot-strategy-v1',excerpt:'Fictional Northstar client-approved pilot hypothesis; no Anvukta business configuration.'}};
  expect(await read('brief',{expected_version:0,brief:otherBrief},200,otherTenant)).toMatchObject({ok:true,version:1});
  const otherPreview=await read('signal-source',{operation:'preview'},200,otherTenant);
  expect(otherPreview).toMatchObject({sourceId:otherSource.id,synthetic:true,contactAllowed:false});expect(otherPreview.items).toHaveLength(1);
  expect(otherPreview.items[0].id).toBe(items[0].id);expect(otherPreview.items[0].digest).not.toBe(preview.items[0].digest);
  await read('signal-source',request,409,otherTenant); // Same item ID, wrong client's reviewed digest.
  expect(await q('select id from leads where tenant_id=$1',[otherTenant])).toHaveLength(0);
  const otherImport=await read('signal-source',{...request,digest:otherPreview.items[0].digest},200,otherTenant);
  expect(otherImport).toMatchObject({tenantId:otherTenant,sourceId:otherSource.id,state:'created',delivery:'not_sent'});
  expect(otherImport.lead_id).not.toBe(imported.lead_id);expect(otherImport.observation_id).not.toBe(imported.observation_id);
  expect((await q('select email from leads where id=$1',[otherImport.lead_id]))[0].email).toBe(contact);
  const otherBefore=await read('shortlist',{synthetic:true},200,otherTenant);
  expect(otherBefore.results).toHaveLength(1);expect(otherBefore.results[0]).toMatchObject({leadId:otherImport.lead_id,state:'unknown',contactAllowed:false});
  expect(otherBefore.brief.body.offer).toBe(otherBrief.offer);
  expect(JSON.stringify(otherBefore)).not.toContain(tenant);expect(JSON.stringify(otherBefore)).not.toContain('workflow ownership');
  await read('prospect-evidence',{...evidence,reference:'foreign-client-evidence'},404,otherTenant);
  const otherEvidence={...evidence,lead_id:otherImport.lead_id,reference:'cedar-safety-needs-v1',rights_reference:'northstar-synthetic-interview-only',facts:{...evidence.facts,need:'site safety onboarding'},excerpt:'Cedar operates in construction in AE. The COO confirmed a site safety onboarding need.'};
  const otherFact=await read('prospect-evidence',otherEvidence,201,otherTenant);
  const otherQualified=await read('shortlist',{synthetic:true},200,otherTenant);
  expect(otherQualified.results[0]).toMatchObject({leadId:otherImport.lead_id,state:'candidate',fitPoints:90,score:null,contactAllowed:false});
  expect(otherQualified.results[0].fields.find((f:any)=>f.field==='need')).toMatchObject({values:['site safety onboarding'],evidence:[{id:otherFact.id}]});
  // The same Worker handler prepares both clients from actual SQL, without save authority.
  const proposalRequest=(leadId:string,signalId:string)=>({operation:'signal-proposal',body:{leadId,signalId,synthetic:true}});
  await read('campaigns',proposalRequest(imported.lead_id,imported.observation_id),409);
  await seedReviveSetup(db,tenant,actor,{senderName:'Anvukta reviewer',relationshipSummary:{text:'No prior relationship is known.',reference:'cold-pilot'}});
  await seedReviveSetup(db,otherTenant,actor,{senderName:'Northstar reviewer',relationshipSummary:{text:'No prior relationship is known.',reference:'cold-pilot'}});
  const effectCounts=()=>q('select (select count(*) from campaigns) campaigns,(select count(*) from campaign_assets) assets,(select count(*) from outbound_actions) actions,(select count(*) from contact_rights) rights,(select count(*) from meetings) meetings');
  const beforePreparation=await effectCounts();
  const prepared=await read('campaigns',proposalRequest(imported.lead_id,imported.observation_id));
  const otherPrepared=await read('campaigns',proposalRequest(otherImport.lead_id,otherImport.observation_id),200,otherTenant);
  expect(prepared).toMatchObject({delivery:'not_sent',contactAllowed:false,proposal:{tenantId:tenant,leadId:imported.lead_id,recipient:contact,reviewRequired:true,persisted:false,strategy:{canonicalNeed:'workflow ownership'},sender:{name:'Anvukta reviewer'}}});
  expect(otherPrepared).toMatchObject({delivery:'not_sent',contactAllowed:false,proposal:{tenantId:otherTenant,leadId:otherImport.lead_id,recipient:contact,strategy:{canonicalNeed:'site safety onboarding'},sender:{name:'Northstar reviewer'}}});
  expect(JSON.stringify(prepared)).not.toContain('Northstar');expect(JSON.stringify(otherPrepared)).not.toContain('workflow ownership');
  expect(prepared.proposal.claimSources.canonicalNeed).toEqual([fact.id]);expect(otherPrepared.proposal.claimSources.canonicalNeed).toEqual([otherFact.id]);
  await read('campaigns',proposalRequest(imported.lead_id,imported.observation_id),404,otherTenant);
  await read('campaigns',proposalRequest(otherImport.lead_id,imported.observation_id),409,otherTenant);
  await read('campaigns',{operation:'signal-proposal',body:{leadId:imported.lead_id,signalId:imported.observation_id,synthetic:false}},409);
  expect(await effectCounts()).toEqual(beforePreparation);
  const otherCampaign=crypto.randomUUID(),otherBody={...body,steps:[{offsetHours:0,subject:'Cedar: site safety onboarding',body:'Northstar Safety proposes a review of the site safety onboarding need in the reviewed interview. Fictional draft only.',evidenceReference:otherEvidence.reference}]};
  expect(await read('campaigns',{operation:'save',campaign_id:otherCampaign,version:0,body:otherBody},200,otherTenant)).toMatchObject({ok:true,id:otherCampaign,status:'draft',delivery:'not_sent'});
  const firstAsset=(await q('select steps from campaign_assets where tenant_id=$1 and campaign_id=$2',[tenant,campaign]))[0];
  await read('campaigns',{operation:'save',campaign_id:campaign,version:1,body:otherBody},400,otherTenant); // SQL rejects a foreign existing campaign as invalid scope.
  expect((await q('select steps from campaign_assets where tenant_id=$1 and campaign_id=$2',[tenant,campaign]))[0]).toEqual(firstAsset);
  await read('campaigns',{operation:'queue',campaign_id:campaign,version:1,body:{leadId:otherImport.lead_id,startAt:new Date(Date.now()+3600000).toISOString()}},404,otherTenant);
  await read('campaigns',{operation:'queue',campaign_id:otherCampaign,version:1,body:{leadId:otherImport.lead_id,startAt:new Date(Date.now()+3600000).toISOString()}},409,otherTenant);
  await read('product-event',{...outcome,lead_id:otherImport.lead_id},409,otherTenant);
  const otherOutcome={...outcome,lead_id:otherImport.lead_id,reference:'northstar-signal-review-v1',rights_reference:'northstar-synthetic-review',context:{...outcome.context,reason:'Northstar reviewed its own site safety onboarding evidence.',signalId:otherImport.observation_id}};
  const otherReceipt=await read('product-event',otherOutcome,201,otherTenant);
  expect(await read('product-event',otherOutcome,201,otherTenant)).toMatchObject({id:otherReceipt.id,delivery:'not_sent'});
  const otherFinal=await read('shortlist',{synthetic:true},200,otherTenant),otherGroup=otherFinal.results[0].products.find((p:any)=>p.product==='signal');
  expect(otherGroup.outcomes).toHaveLength(1);expect(otherGroup.outcomes[0]).toMatchObject({signalId:otherImport.observation_id,deliveryEstablished:false});
  const unchanged=await read('shortlist',{synthetic:true});
  expect(unchanged.brief.body).toEqual(brief);expect(unchanged.results).toHaveLength(2);
  expect(JSON.stringify(unchanged)).not.toContain(otherTenant);expect(JSON.stringify(unchanged)).not.toContain('site safety onboarding');
  expect(unchanged.results.find((r:any)=>r.leadId===imported.lead_id).products.find((p:any)=>p.product==='signal').outcomes).toEqual(group.outcomes);
  // Ordinary replies hold only this tenant. Existing objections additionally create a
  // conservative platform email stop; preserve that safety policy without sharing history.
  const reply={...otherOutcome,reference:'northstar-reply-v1',excerpt:'Fictional prospect asks a question about the onboarding review.',context:{product:'response',kind:'reply',threadRef:'northstar-thread',disposition:'human',need:'site safety onboarding',authority:'',timing:''}};
  await read('product-event',reply,201,otherTenant);
  await read('campaigns',proposalRequest(otherImport.lead_id,otherImport.observation_id),409,otherTenant);
  const replied=await read('shortlist',{synthetic:true},200,otherTenant);
  expect(replied.results[0].products.find((p:any)=>p.product==='signal').state).toBe('reply_hold');
  expect((await read('shortlist',{synthetic:true})).results.find((r:any)=>r.leadId===imported.lead_id).products.find((p:any)=>p.product==='signal').state).toBe('prioritise_review');
  await read('product-event',{...reply,reference:'northstar-unsubscribe-v1',excerpt:'Fictional prospect requests no further contact from Northstar.',context:{...reply.context,disposition:'opt_out'}},201,otherTenant);
  const stopped=await read('shortlist',{synthetic:true},200,otherTenant);
  expect(stopped.results[0]).toMatchObject({state:'excluded',contactAllowed:false});expect(stopped.results[0].reasons).toContain('suppressed');
  // New objections are tenant-scoped: the other client retains its independent review.
  expect((await read('campaigns',proposalRequest(imported.lead_id,imported.observation_id))).proposal.claimSources.canonicalNeed).toEqual([fact.id]);
  const otherClientAfterStop=await read('shortlist',{synthetic:true});
  expect(otherClientAfterStop.results.find((r:any)=>r.leadId===imported.lead_id)).toMatchObject({state:'candidate',fitPoints:90,contactAllowed:false});
  expect(otherClientAfterStop.results.find((r:any)=>r.leadId===imported.lead_id).reasons).not.toContain('suppressed');
  expect(JSON.stringify(otherClientAfterStop)).not.toContain(otherTenant);expect(JSON.stringify(otherClientAfterStop)).not.toContain('northstar-thread');
  expect(JSON.stringify(otherClientAfterStop)).not.toContain('site safety onboarding');
  expect(await q('select lead_id from lead_suppression where tenant_id=$1',[tenant])).toHaveLength(0);
  expect(await q('select lead_id from lead_suppression where tenant_id=$1',[otherTenant])).toEqual([{lead_id:otherImport.lead_id}]);
  expect(await q('select email from suppression where email=$1',[contact])).toEqual([]);
  for(const client of [tenant,otherTenant]){
   expect(await q('select id from contact_rights where tenant_id=$1',[client])).toHaveLength(0);
   expect(await q('select id from outbound_actions where tenant_id=$1',[client])).toHaveLength(0);
   expect(await q('select id from meetings where tenant_id=$1',[client])).toHaveLength(0);
  }
  expect(requests.every(r=>new URL(r.url).origin===env.SUPABASE_URL||[source.url,otherSource.url].includes(r.url))).toBe(true);
 }finally{await db.close();}
},20000);

it('isolates two clients read-only Google bindings and never falls back to platform credentials',()=>{
 const expiresAt=new Date(Date.now()+86400000).toISOString();
 const a={id:'00000000-0000-4000-8000-000000000101',tenantId:'00000000-0000-4000-8000-000000000102',mailbox:'anvukta@example.invalid',calendarId:'anvukta-calendar@example.invalid',purposeReference:'anvukta-read-only-fixture',expiresAt,enabled:true,clientId:'a-client',clientSecret:'a-secret',refreshToken:'a-refresh'};
 const b={...a,id:'00000000-0000-4000-8000-000000000103',tenantId:'00000000-0000-4000-8000-000000000104',mailbox:'northstar@example.invalid',calendarId:'northstar-calendar@example.invalid',purposeReference:'northstar-read-only-fixture',clientId:'b-client',clientSecret:'b-secret',refreshToken:'b-refresh'};
 const env={...providerEnv(),GOOGLE_TENANT_CONNECTIONS:JSON.stringify([a,b])} as Env;
 const first=tenantGoogleConnection(env,a.tenantId)!,second=tenantGoogleConnection(env,b.tenantId)!;
 expect(first.connection).toEqual(a);expect(second.connection).toEqual(b);expect(first.provider).not.toBe(second.provider);
 expect(first.provider).toMatchObject({GOOGLE_CLIENT_ID:a.clientId,GOOGLE_CLIENT_SECRET:a.clientSecret,GOOGLE_REFRESH_TOKEN:a.refreshToken,GOOGLE_CALENDAR_ID:a.calendarId});
 expect(second.provider).toMatchObject({GOOGLE_CLIENT_ID:b.clientId,GOOGLE_CLIENT_SECRET:b.clientSecret,GOOGLE_REFRESH_TOKEN:b.refreshToken,GOOGLE_CALENDAR_ID:b.calendarId});
 expect(tenantGoogleConnection(env,'00000000-0000-4000-8000-000000000105')).toBeNull();
 env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([a,{...b,enabled:false}]);
 expect(tenantGoogleConnection(env,b.tenantId)).toBeNull();expect(tenantGoogleConnection(env,a.tenantId)!.connection).toEqual(a);
 env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([a,{...b,expiresAt:new Date(Date.now()-1000).toISOString()}]);
 expect(tenantGoogleConnection(env,b.tenantId)).toBeNull();
 expect(()=>tenantGoogleConnection({...env,GOOGLE_TENANT_CONNECTIONS:JSON.stringify([a,{...b,calendarId:a.calendarId}])},b.tenantId)).toThrow('Invalid tenant connection configuration');
});

/** Exact provider allowlist. A request escaping these intercepted paths fails the test. */
function providers(handler:(u:URL,init:RequestInit)=>Response|Promise<Response>,tokenStatus=200){
 const calls:{url:URL;init:RequestInit}[]=[];
 vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const u=new URL(input);calls.push({url:u,init});
  expect(init.signal).toBeInstanceOf(AbortSignal);
  if(u.href==='https://oauth2.googleapis.com/token'){
   expect(init.method).toBe('POST');const body=new URLSearchParams(String(init.body));expect(body.get('refresh_token')).toBe('synthetic-refresh');
   return tokenStatus===200?Response.json({access_token:'synthetic-access',expires_in:3600}):new Response('fixture rejection',{status:tokenStatus});
  }
  const allowed=(u.origin==='https://gmail.googleapis.com'&&u.pathname==='/gmail/v1/users/me/messages/send'&&init.method==='POST')||
   (u.origin==='https://www.googleapis.com'&&((u.pathname==='/calendar/v3/freeBusy'&&init.method==='POST')||(u.pathname===calendarPath&&init.method==='POST')||(u.pathname===calendarPath+'/'+calendarEventId(meeting.id)&&(init.method??'GET')==='GET')));
  if(!allowed)throw Error('Unexpected provider request in synthetic pilot');
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-access');return handler(u,init);
 });return calls;
}

it('simulates the shared email adapter with exact fictional MIME and a verified provider receipt, separately from Signal',async()=>{
 const calls=providers((u,init)=>{
  expect(u.origin).toBe('https://gmail.googleapis.com');
  const raw=JSON.parse(String(init.body)).raw,decoded=Buffer.from(raw,'base64url').toString('utf8');
  expect(decoded).toContain('From: '+sender+'\r\n');expect(decoded).toContain('To: '+contact+'\r\n');
  const encoded=decoded.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)![1];expect(Buffer.from(encoded,'base64').toString()).toBe(subject);expect(decoded.endsWith(message)).toBe(true);
  return Response.json({id:'synthetic_anvukta_message'});
 });
 expect(await sendEmail(providerEnv(),contact,subject,message)).toEqual({messageId:'synthetic_anvukta_message'});
 expect(calls.map(c=>c.url.host)).toEqual(['oauth2.googleapis.com','gmail.googleapis.com']);
});
it.each([{}, {id:'invalid receipt with spaces'}])('rejects uncertain Gmail acknowledgements without retry: %j',async receipt=>{
 const calls=providers(()=>Response.json(receipt));await expect(sendEmail(providerEnv(),contact,subject,message)).rejects.toThrow('acknowledgement is uncertain');
 expect(calls.filter(c=>c.url.host==='gmail.googleapis.com')).toHaveLength(1);
});
it('blocks missing/revoked credentials and a final send preflight without a Gmail mutation',async()=>{
 const calls=providers(()=>{throw Error('Provider mutation must not run');},400),env=providerEnv();
 await expect(sendEmail({...env,GOOGLE_REFRESH_TOKEN:''},contact,subject,message)).rejects.toThrow('not configured');expect(calls).toHaveLength(0);
 await expect(sendEmail(env,contact,subject,message)).rejects.toThrow('token refresh failed (400)');expect(calls).toHaveLength(1);
 const refreshed=providers(()=>{throw Error('Suppressed send must not run');});
 await expect(sendEmail(providerEnv(),contact,subject,message,undefined,async()=>{throw Error('Synthetic suppression changed before send');})).rejects.toThrow('suppression changed');
 expect(refreshed.map(c=>c.url.host)).toEqual(['oauth2.googleapis.com']);
});
it('simulates shared calendar availability and a confirmed stable meeting for the same fictional contact',async()=>{
 const env=providerEnv(),calls=providers((u,init)=>{
  const b=JSON.parse(String(init.body));
  if(u.pathname==='/calendar/v3/freeBusy'){expect(b).toMatchObject({timeMin:new Date(meeting.start).toISOString(),timeMax:new Date(meeting.end).toISOString(),items:[{id:env.GOOGLE_CALENDAR_ID}]});return Response.json({calendars:{[env.GOOGLE_CALENDAR_ID]:{busy:[]}}});}
  expect(b).toMatchObject({id:calendarEventId(meeting.id),attendees:[{email:contact,displayName:meeting.name}],start:{dateTime:meeting.start},end:{dateTime:meeting.end},extendedProperties:{private:{ripe_meeting_id:meeting.id}}});
  expect(u.searchParams.get('sendUpdates')).toBe('all');expect(u.searchParams.get('conferenceDataVersion')).toBe('1');return Response.json(event());
 });
 expect(await busyTimes(env,new Date(meeting.start),new Date(meeting.end))).toEqual([]);
 expect(await createMeetEvent(env,meeting)).toEqual({eventId:calendarEventId(meeting.id),meetUrl:'https://meet.google.com/abc-defg-hij',meetCode:'abc-defg-hij'});
 expect(calls.filter(c=>c.url.pathname===calendarPath)).toHaveLength(1);
});
it('reconciles an uncertain calendar insertion by reading the same event without a second invitation',async()=>{
 const calls=providers((_u,init)=>{if(init.method==='POST')throw Error('Simulated response lost after creation');return Response.json(event());});
 expect((await createMeetEvent(providerEnv(),meeting)).eventId).toBe(calendarEventId(meeting.id));
 expect(calls.filter(c=>c.url.pathname===calendarPath&&c.init.method==='POST')).toHaveLength(1);
 expect(calls.filter(c=>c.url.pathname===calendarPath+'/'+calendarEventId(meeting.id))).toHaveLength(1);
});
it.each(['identity','attendee','time','unsafe-link','cancelled'])('rejects mismatched calendar evidence: %s',async kind=>{
 const result=event();if(kind==='identity')result.extendedProperties.private.ripe_meeting_id=crypto.randomUUID();
 if(kind==='attendee')result.attendees=[{email:'unrelated@example.invalid'}];if(kind==='time')result.start.dateTime=meeting.end;
 if(kind==='unsafe-link')result.hangoutLink='https://untrusted.example.invalid/meeting';if(kind==='cancelled')result.status='cancelled';
 const calls=providers(()=>Response.json(result));await expect(reconcileMeetEvent(providerEnv(),meeting)).rejects.toThrow();
 expect(calls.filter(c=>c.url.pathname.startsWith(calendarPath))).toHaveLength(1);expect(calls.at(-1)!.init.method??'GET').toBe('GET');
});
it('does not retry a definitively rejected calendar invitation',async()=>{
 const calls=providers(()=>new Response('Fixture calendar denied',{status:403}));
 await expect(createMeetEvent(providerEnv(),meeting)).rejects.toThrow('(403)');
 expect(calls.filter(c=>c.url.pathname.startsWith(calendarPath))).toHaveLength(1);
});


it.each([
 ['matched', 'candidate', 'prioritise_review'],
 ['outside-market', 'excluded', 'excluded'],
 ['ambiguous', 'review', 'qualify_fit'],
 ['conflicting', 'review', 'qualify_fit'],
 ['suppressed', 'excluded', 'suppressed'],
 ['stale-trigger', 'candidate', 'stale'],
 ['reply-hold', 'candidate', 'reply_hold'],
])('checks Anvukta prospect strategy control %s using existing assessment and product rules', (variant,fitState,signalState)=>{
 const now=Date.parse('2026-10-24T12:00:00Z'),fresh=new Date(now-3600000).toISOString();
 const brief:BusinessBrief={offer:'Workflow ownership across construction teams',industries:['construction'],markets:['AE'],roles:['COO','owner'],needs:['workflow ownership'],excludedIndustries:['retail'],maxAgeDays:30,source:{reference:'pilot-reviewed-brief',excerpt:'Synthetic Anvukta pilot hypothesis',observedAt:fresh}};
 const facts:Observation={id:'00000000-0000-4000-8000-000000000091',tenant_id:'00000000-0000-4000-8000-000000000092',lead_id:'00000000-0000-4000-8000-000000000093',source:'synthetic-interview',external_ref:'cedar-current-fit',observed_at:fresh,synthetic:true,assessment_reviewed_by:actor,assessment_facts:{industry:'construction',market:'AE',role:'COO',need:'workflow ownership'},assessment_excerpt:'The construction company in AE has a COO who confirmed workflow ownership gaps.'};
 const trigger:Observation={...facts,id:'00000000-0000-4000-8000-000000000094',external_ref:'cedar-expansion',assessment_facts:{},assessment_excerpt:'Cedar added a project team; need requires separate evidence.',product_context:{product:'signal',kind:'trigger',relevance:'Review project handoffs',expiresAt:new Date(now+86400000).toISOString()}};
 const observations=[facts,trigger];
 if(variant==='outside-market'){facts.assessment_facts.market='GB';facts.assessment_excerpt=facts.assessment_excerpt!.replace('AE','GB');}
 if(variant==='ambiguous')facts.assessment_excerpt='The construction company in AE has a COO who might need workflow ownership.';
 if(variant==='conflicting')observations.push({...facts,id:crypto.randomUUID(),external_ref:'cedar-conflicting-market',assessment_facts:{market:'GB'},assessment_excerpt:'The current operating market is GB.'});
 if(variant==='stale-trigger')trigger.observed_at=new Date(now-31*86400000).toISOString();
 if(variant==='reply-hold')observations.push({...facts,id:crypto.randomUUID(),external_ref:'cedar-reply',assessment_facts:{},product_context:{product:'response',kind:'reply',threadRef:'synthetic-thread',disposition:'interested',need:'workflow ownership',authority:'',timing:''}});
 const suppressed=variant==='suppressed',assessment=assessProspect(facts.tenant_id,facts.lead_id,brief,observations,{now,synthetic:true,suppressed});
 expect(assessment).toMatchObject({state:fitState,score:null,readiness:'unknown',engagement:'unknown',contactAllowed:false});
 const signal=reviewProducts(observations,now,suppressed,assessment.state).find(p=>p.product==='signal');
 expect(signal).toMatchObject({state:signalState,reference:trigger.id,contactAllowed:false,bookingAvailable:false});
 const expiresAt=(trigger.product_context as {expiresAt:string}).expiresAt;
 expect(signal!.validUntil).toBe(new Date(Math.min(Date.parse(expiresAt),Date.parse(trigger.observed_at)+30*86400000)).toISOString());
 if(['excluded','stale','suppressed','reply_hold'].includes(signalState))expect(signal!.question).toBeNull();
});
