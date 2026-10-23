// Rendered-browser acceptance using the pinned development Playwright dependency,
// real admin markup/styles/script, and an explicitly synthetic API fixture. No network.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../platform/ripe-piper-platform/package.json',import.meta.url)),{chromium}=require('playwright');
const root=new URL('../',import.meta.url);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const failures=[];page.on('pageerror',e=>failures.push(e.message));
await page.route('**/*',route=>route.abort());
try {
 let html=await readFile(new URL('site/admin/index.html',root),'utf8');
 html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.route('https://fixture.example.invalid/',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.goto('https://fixture.example.invalid/');
 await page.addStyleTag({content:await readFile(new URL('site/assets/site.css',root),'utf8')});
 await page.evaluate(()=>{
  document.querySelectorAll('[hidden]').forEach(n=>n.removeAttribute('hidden'));
  const panel=document.getElementById('prospectingPanel'),plans=document.getElementById('campaignPlansPanel'),eventPanel=document.getElementById('eventOperationsPanel');document.body.replaceChildren(panel,plans,eventPanel);panel.style.display='block';plans.style.display='block';eventPanel.style.display='block';
  window.fixtureCalls=[];window.fixtureCampaigns=[];window.fixtureAssets=[];window.fixtureConversationReview={version:0,inboundSnapshot:'11111111-1111-4111-8111-111111111111',ownerId:null,ownerLabel:null,state:'unassigned'};
  window.fixtureEvent={id:'33333333-3333-4333-8333-333333333333',capability:'events',purpose:'Fixture event',status:'approved',event_version:1,event_settings:{title:'Fixture event',startsAt:'2026-11-01T12:00:00Z',endsAt:'2026-11-01T13:00:00Z',timezone:'UTC',capacity:3,open:true,noticeReference:'Event-only fixture notice'}};window.fixtureEventState='registered';
  window.RP={esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api:async(path,body)=>{
   window.fixtureCalls.push({path,body});
   if(path.endsWith('/revive-review'))return body.operation==='preview'?{assessment:{eligible:true,fitState:'candidate',historyState:'dormant_review',reasons:[],expiresAt:'2026-11-01T00:00:00Z'},snapshot:'a'.repeat(32),version:0}:{review:{state:'accepted',version:1}};
   if(path.endsWith('/revive-run'))return {enrolled:1,tested:0,blocked:0,review:0,limited:false,delivery:'not_sent'};
   if(path.endsWith('/revive-report')){
    const bucket=()=>({contacts:{enrolled:1,queued:0,replyHeld:1,requiresReview:0,testAcknowledged:1,providerAcknowledged:0},actions:{unverifiedReceipt:0},outcomes:{qualified_conversation:1,meeting_held:0,opportunity:0,won:0,lost:0},conflictingOutcomeContacts:0});
    const modes={synthetic:bucket(),business:bucket()};modes.business.contacts.testAcknowledged=0;
    return {report:{generatedAt:'2026-10-23T12:00:00Z',totals:modes,campaigns:window.fixtureCampaigns.map(c=>({id:c.id,modes})),unattributed:{synthetic:{records:1},business:{records:0}},unverifiedLinkedRecords:0,abComparison:{available:false,reason:'No recorded variant assignment.'},notes:['Live outcome collection is not connected.']}};
   }
   if(path.endsWith('/events')&&path.includes('/admin/')){
    if(body.operation==='list')return {campaigns:[window.fixtureEvent],registrations:[],registrationEnabled:true};
    window.fixtureEvent={...window.fixtureEvent,event_settings:body.settings,event_version:body.expected_version+1};return {id:body.campaign_id,version:body.expected_version+1};
   }
   if(path.startsWith('/api/events/')){window.fixtureEventState=body.operation==='cancel'?'cancelled':'registered';return {registration:{eventId:window.fixtureEvent.id,registrationId:'44444444-4444-4444-8444-444444444444',state:window.fixtureEventState,version:window.fixtureEvent.event_version,acknowledgedVersion:window.fixtureEvent.event_version,identityStatus:'unverified',attendance:'unknown',marketingPermission:'not_granted',delivery:'not_sent'}};}
   if(path.endsWith('/conversation-review')){
    if(body.operation==='owners')return {owners:[{id:'22222222-2222-4222-8222-222222222222',label:'Fixture owner'}]};
    window.fixtureConversationReview={...window.fixtureConversationReview,version:1,ownerId:body.owner_id,ownerLabel:'Fixture owner',state:body.state};return {ok:true,delivery:'not_sent',sequences:'held'};
   }
   if(path.endsWith('/connection')){
    if(body.operation==='check')return {state:'identity_verified',mailbox:'staff@example.invalid',calendarId:'calendar@example.invalid'};
    if(body.operation==='list')return {messages:{items:[{id:'message1',subject:'Fixture question',observedAt:'2026-10-22T12:00:00Z'}],moreAvailable:false,excluded:0}};
    if(body.operation==='preview')return {message:{excerpt:'<script>untrusted message</script>',digest:'reviewed-source',truncated:false}};
    return {ok:true,delivery:'not_sent'};
   }
   if(path.endsWith('/campaigns')){
    if(body.operation==='list')return {campaigns:window.fixtureCampaigns,assets:window.fixtureAssets,actions:[],draftLeads:[{id:'lead-fixture',email:'fixture@example.invalid',company:'Synthetic company'}],draftSources:[{id:'source-fixture',lead_id:'lead-fixture',external_ref:'reviewed-need-source'}]};
    if(body.operation==='draft')return {proposal:{steps:[{offsetHours:0,subject:'A question about follow-up',body:'Reviewed cohort offer. Choose a time: '+body.body.bookingUrl+'\nReply stop to opt out.',evidenceReference:'brief:v1;source:fixture'}],draftContext:{leadId:body.body.leadId,sourceId:body.body.sourceId,briefVersion:1,reviewVersion:1,businessName:'Ripe Piper',snapshot:'a'.repeat(32),expiresAt:'2026-10-24T00:00:00Z'},basis:{briefVersion:1,briefReference:'interview:fixture',sourceReference:'reviewed-need-source',sourceExcerpt:'<script>untrusted source text</script>'},strategy:'One cohort need and one next step.',bookingVerification:'supplied_reviewed_url_only'}};
    if(body.operation==='save'){
     window.fixtureCampaigns=[{id:body.campaign_id,capability:body.body.product,purpose:body.body.purpose,market:body.body.market,timezone:body.body.timezone,asset_version:1,status:'draft'}];
     window.fixtureAssets=[{campaign_id:body.campaign_id,version:1,steps:body.body.steps}];
    }
    return {ok:true,id:body.campaign_id};
   }
   if(path.endsWith('/shortlist'))return {brief:null,leads:[{id:'lead-fixture',email:'fixture@example.invalid',company:'Synthetic company'},{id:'business-fixture',email:'contact@business.example',company:'Business fixture'}],results:[{leadId:'lead-fixture',company:'Synthetic company',state:'review',nextAction:'Review',reasons:[],fields:[],products:[{product:'response',reference:'fixture-thread',state:'human',nextAction:'Review',history:[],outcomes:[],conversation:window.fixtureConversationReview}]}],synthetic:true};
   return {ok:true,results:[{row:1,state:'created'}]};
  }};
 });
 await page.addScriptTag({content:await readFile(new URL('site/assets/contact-import.js',root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('site/assets/prospecting-admin.js',root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('site/assets/campaigns-admin.js',root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('site/assets/events-admin.js',root),'utf8')});
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rp:tenant-selected',{detail:{id:'tenant-fixture',name:'Synthetic Ripe Piper'}})));
 await page.getByText('Ripe Revive cohort review',{exact:true}).click();
 await page.getByRole('button',{name:'Check current Revive eligibility',exact:true}).click();
 await page.waitForFunction(()=>!document.getElementById('reviveAccept').disabled);
 await page.fill('#reviveReason','Reviewed current fit and dormant relationship');
 await page.getByRole('button',{name:'Accept reviewed contact',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('reviveStatus').textContent.includes('Recorded accepted'));
 const cohort=await page.evaluate(()=>window.fixtureCalls.find(c=>c.path.endsWith('/revive-review')&&c.body.operation==='accept'));
 assert.equal(cohort.body.version,0);assert.equal(cohort.body.snapshot,'a'.repeat(32));assert.equal(cohort.body.lead_id,'lead-fixture');
 await page.getByText('Approved Revive automation',{exact:true}).click();
 await page.getByRole('button',{name:'Run approved Revive test cycle',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('reviveRunStatus').textContent.includes('1 enrolled'));
 assert.match(await page.locator('#reviveRunStatus').textContent(),/No email was sent/);
 await page.selectOption('#eventCampaign','33333333-3333-4333-8333-333333333333');await page.fill('#eventTitle','Reviewed fixture event');await page.check('#eventConfirmed');
 await page.getByRole('button',{name:'Save reviewed event settings',exact:true}).click();await page.waitForFunction(()=>document.getElementById('eventState').textContent.includes('version 2'));
 await page.getByText('Rehearse registration and cancellation',{exact:true}).click();await page.fill('#eventTestName','Fixture registrant');await page.fill('#eventTestEmail','event-fixture@example.invalid');await page.check('#eventConsent');
 await page.getByRole('button',{name:'Register test contact',exact:true}).click();await page.waitForFunction(()=>document.getElementById('eventRegistrationStatus').textContent.includes('registered'));
 const eventRegistration=await page.evaluate(()=>window.fixtureCalls.find(c=>c.path.startsWith('/api/events/')&&c.body.operation==='register'));
 assert.match(eventRegistration.body.capability,/^[0-9a-f]{64}$/);assert.equal(eventRegistration.body.version,2);assert.equal(eventRegistration.body.consent,true);
 await page.getByRole('button',{name:'Cancel test registration',exact:true}).click();await page.waitForFunction(()=>document.getElementById('eventRegistrationStatus').textContent.includes('cancelled'));
 await page.getByText('Product history and outcomes',{exact:true}).click();
 for(const product of ['revive','signal','response','events']) {
  await page.selectOption('#productChoice',product);
  await page.fill('#productReference','source-'+product);await page.fill('#productRights','fixture-only');await page.fill('#productObserved','2026-10-22T12:00');await page.fill('#productExcerpt','Staff-reviewed synthetic source');
  if(product==='revive'){await page.fill('#lastContact','2026-08-01T12:00');await page.fill('#stalledReason','Unknown');}
  if(product==='signal'){await page.fill('#signalRelevance','Fixture business need');await page.fill('#signalExpiry','2026-11-22T12:00');}
  if(product==='response'){await page.fill('#threadRef','fixture-thread');await page.selectOption('#disposition','interested');}
  if(product==='events'){await page.fill('#eventRef','fixture-event');await page.fill('#eventEnd','2026-10-21T12:00');await page.fill('#eventTimezone','UTC');}
  await page.getByRole('button',{name:'Record reviewed event',exact:true}).click();
  await page.waitForFunction(p=>window.fixtureCalls.some(c=>c.path.endsWith('/product-event')&&c.body.context.product===p),product);
 }
 await page.getByText('Conversation ownership and review',{exact:true}).click();
 await page.getByRole('button',{name:'Load authorized owners',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#conversationOwner option')?.textContent==='Fixture owner');
 await page.selectOption('#conversationOwner','22222222-2222-4222-8222-222222222222');await page.selectOption('#conversationState','resolved');await page.fill('#conversationReason','Handled manually; no follow-up authorized');
 await page.getByRole('button',{name:'Save conversation review',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('conversationStatus').textContent.includes('version 1'));
 const reviewCall=await page.evaluate(()=>window.fixtureCalls.find(c=>c.path.endsWith('/conversation-review')&&c.body.operation==='save'));
 assert.equal(reviewCall.body.thread_ref,'fixture-thread');assert.equal(reviewCall.body.expected_version,0);assert.equal(reviewCall.body.inbound_snapshot,'11111111-1111-4111-8111-111111111111');assert.match(reviewCall.body.request_id,/^[0-9a-f-]{36}$/);
 await page.getByText('Import permitted contacts',{exact:true}).click();
 await page.fill('#prospectImportRows','fixture@example.invalid\tFixture\tsource-import\tfixture-only\t2026-10-22');
 const beforeImport=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.path.endsWith('/prospect-import')).length);
 await page.getByRole('button',{name:'Preview and validate',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.path.endsWith('/prospect-import')).length),beforeImport);
 await page.getByRole('button',{name:'Import reviewed rows',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('prospectImportReport').textContent.includes('created'));
 const afterPaste=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.path.endsWith('/prospect-import')).length);
 await page.setInputFiles('#prospectImportFile',{name:'reviewed-contacts.csv',mimeType:'text/csv',buffer:Buffer.from('\ufeffemail,company,reference,rights_reference,observed_at\r\nfixture@example.invalid,"Trade, ""Company""",source-csv,fixture-only,2026-10-22\r\n')});
 await page.waitForFunction(()=>document.getElementById('prospectImportReport').textContent.includes('1 rows previewed'));
 assert.equal(await page.locator('#prospectImportFormat').inputValue(),'csv');
 assert.equal(await page.locator('#prospectImportHeader').isChecked(),true);
 assert.match(await page.locator('#prospectImportPreviewRows').textContent(),/Trade, "Company"/);
 assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.path.endsWith('/prospect-import')).length),afterPaste);
 const contexts=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.path.endsWith('/product-event')).map(c=>c.body.context));
 assert.equal(contexts.length,4);assert.equal(contexts[2].authority,'');assert.equal(contexts[3].attendance,'unknown');
 for(const product of ['response','events']){
  await page.selectOption('#productChoice',product);await page.selectOption('#productKind','outcome');
  await page.fill('#productReference','outcome-'+product);await page.fill('#productRights','fixture-only');await page.fill('#productObserved','2026-10-22T12:00');await page.fill('#productExcerpt','Owner verified meeting');
  await page.fill('#productReason','Verified by owner');await page.selectOption('#productOutcome','meeting_held');
  await page.fill(product==='response'?'#outcomeThread':'#outcomeEvent','fixture-'+product);
  await page.getByRole('button',{name:'Record reviewed event',exact:true}).click();
  await page.waitForFunction(p=>window.fixtureCalls.some(c=>c.path.endsWith('/product-event')&&c.body.context.product===p&&c.body.context.kind==='outcome'),product);
 }
 const scoped=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.body?.context?.kind==='outcome').map(c=>c.body.context));
 assert.equal(scoped[0].threadRef,'fixture-response');assert.equal(scoped[1].eventRef,'fixture-events');
 await page.selectOption('#productChoice','revive');await page.selectOption('#productKind','outcome');
 await page.fill('#productReference','outcome-revive');await page.fill('#productRights','fixture-only');await page.fill('#productObserved','2026-10-22T12:00');await page.fill('#productExcerpt','Synthetic reviewed outcome');await page.fill('#productReason','Rehearsal only');
 await page.fill('#outcomeCampaign','11111111-1111-4111-8111-111111111111');await page.fill('#outcomeAction','22222222-2222-4222-8222-222222222222');
 await page.getByRole('button',{name:'Record reviewed event',exact:true}).click();
 await page.waitForFunction(()=>window.fixtureCalls.some(c=>c.body?.context?.product==='revive'&&c.body.context.kind==='outcome'));
 const attributed=await page.evaluate(()=>window.fixtureCalls.find(c=>c.body?.context?.product==='revive'&&c.body.context.kind==='outcome'));
 assert.equal(attributed.body.context.actionId,'22222222-2222-4222-8222-222222222222');assert.equal(attributed.body.synthetic,true);

 await page.getByText('Prepare an evidence-based Revive draft',{exact:true}).click();
 await page.selectOption('#draftLead','lead-fixture');await page.selectOption('#draftSource','source-fixture');
 await page.fill('#draftSender','Fixture owner');await page.fill('#draftBooking','https://calendar.google.com/calendar/appointments/schedules/fixture');await page.fill('#draftBookingReference','Reviewed fixture URL');await page.check('#draftBookingReviewed');
 const savesBefore=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.body?.operation==='save'&&c.path.endsWith('/campaigns')).length);
 await page.getByRole('button',{name:'Replace message form with reviewed proposal',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('draftStatus').textContent.includes('Proposal only'));
 assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.body?.operation==='save'&&c.path.endsWith('/campaigns')).length),savesBefore);
 assert.match(await page.locator('#draftBasis').textContent(),/<script>untrusted source text/);
 assert.equal(await page.locator('#draftBasis script').count(),0);
 assert.match(await page.locator('#messageBody0').inputValue(),/https:\/\/calendar.google.com/);
 await page.fill('#campaignPurpose','Fixture reactivation');await page.fill('#campaignMarket','AE');
 await page.fill('#messageBody0',(await page.locator('#messageBody0').inputValue())+'\nOperator reviewed edit.');
 await page.getByRole('button',{name:'Save draft version',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('campaignState').textContent.includes('Version 1'));
 const savedDraft=await page.evaluate(()=>window.fixtureCalls.find(c=>c.path.endsWith('/campaigns')&&c.body.operation==='save'));
 assert.equal(savedDraft.body.body.draftContext.reviewVersion,1);assert.match(savedDraft.body.body.steps[0].body,/Operator reviewed edit/);
 await page.getByText('Revive outcomes and execution report',{exact:true}).click();
 await page.getByRole('button',{name:'Refresh Revive report',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('reviveReportStatus').textContent.includes('Selected Revive campaign'));
 assert.match(await page.locator('#reviveReportText').textContent(),/Synthetic evidence/);assert.match(await page.locator('#reviveReportText').textContent(),/recipient delivery unverified/);assert.match(await page.locator('#reviveReportText').textContent(),/A\/B comparison unavailable/);
 await page.getByText('Record approval and limits',{exact:true}).click();
 await page.fill('#campaignClientAuthority','fixture-client');await page.fill('#campaignOwnerAuthority','fixture-owner');await page.fill('#campaignCTS','fixture-cts');await page.fill('#campaignCap','3');await page.fill('#campaignExpiry','2026-11-01T12:00');
 await page.fill('#messageBody0','Unsaved changed message');
 await page.getByRole('button',{name:'Approve loaded message version',exact:true}).click();
 assert.match(await page.locator('#campaignError').textContent(),/Save your message changes/);
 assert.equal(await page.evaluate(()=>window.fixtureCalls.some(c=>c.body.operation==='approve')),false);
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Horizontal overflow at ${width}`);}

 // Review and import selected inbox evidence through the existing prospect workspace.
 await page.selectOption('#prospectMode','business');
 await page.waitForFunction(()=>document.getElementById('inboxLead').value==='business-fixture');
 await page.getByText('Read selected inbox messages',{exact:true}).click();
 await page.getByRole('button',{name:'Check inbox and calendar connection',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('inboxStatus').textContent.includes('Account identity verified'));
 await page.getByRole('button',{name:'Find recent messages for this contact',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('inboxMessage').value==='message1');
 await page.getByRole('button',{name:'Import for human review',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.fixtureCalls.some(c=>c.body.operation==='import')),false);
 await page.getByRole('button',{name:'Preview selected message',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('inboxExcerpt').textContent.includes('untrusted message'));
 assert.equal(await page.locator('#inboxExcerpt script').count(),0);
 await page.check('#inboxReviewed');
 await page.getByRole('button',{name:'Import for human review',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('inboxStatus').textContent.includes('no reply was sent'));
 assert.equal(await page.evaluate(()=>window.fixtureCalls.find(c=>c.body.operation==='import').body.digest),'reviewed-source');
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Inbox overflow at ${width}`);}
 // Exercise the real meeting admin UI and shared helpers with a synthetic database/provider boundary.
 await page.goto('https://fixture.example.invalid/');
 await page.addStyleTag({content:await readFile(new URL('site/assets/site.css',root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('site/assets/app-common.js',root),'utf8')});
 await page.evaluate(()=>{
  window.reconcileCalls=[];window.calendarReady=false;
  window.fixtureProposal={id:'55555555-5555-4555-8555-555555555555',status:'approved',client_email:'fixture@example.invalid',currency:'AED',fixed_amount:500,advance_pct:10,advance_amount:50,plan:'sprint',package:'revive',content_md:'Reviewed fixture proposal'};window.fixturePayment={id:'66666666-6666-4666-8666-666666666666',proposal_id:window.fixtureProposal.id,provider:'stripe',status:'paid'};
  window.fixtureMeeting={id:'11111111-1111-4111-8111-111111111111',start_at:'2026-11-01T08:00:00Z',end_at:'2026-11-01T08:15:00Z',attendee_email:'fixture@example.invalid',status:'booked',meet_url:null};
  window.fixtureTenant={id:'77777777-7777-4777-8777-777777777777',name:'Revive activation fixture',currency:'AED',country:'AE',plan:'engine',package:'revive',status:'onboarding',execution_version:0};
  RP.demo=false;RP.auth=ready=>{document.getElementById('app').hidden=false;ready({id:'fixture',email:'staff@example.invalid'});};
  RP.sb={from:table=>{
   const result=()=>({data:table==='profiles'?{is_admin:true}:table==='tenants'?[{...window.fixtureTenant}]:table==='business_briefs'?[{version:1}]:table==='meetings'?[{...window.fixtureMeeting}]:table==='proposals'?[window.fixtureProposal]:table==='payments'?[window.fixturePayment]:[]});
   const q={select:()=>q,is:()=>q,order:()=>q,limit:()=>q,eq:()=>q,single:()=>q,then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject)};return q;
  }};
  RP.api=async(path,body)=>{
   window.reconcileCalls.push({path,body});
   if(path.endsWith('/activate')){window.fixtureTenant.status='active';window.fixtureTenant.execution_version=body.expected_version+1;return {ok:true,tenant:{id:window.fixtureTenant.id,status:'active',version:window.fixtureTenant.execution_version,briefVersion:1},delivery:'not_sent'};}
   if(path.endsWith('/attendance')){window.fixtureMeeting.status=body.classification==='unknown'?'attendance_unknown':body.classification;window.fixtureMeeting.attendance_review_version=body.expected_version+1;window.fixtureMeeting.attendance_review={state:'reviewed',classification:body.classification,evidenceReference:body.evidence_reference,actor:'fixture-staff',reviewedAt:new Date().toISOString()};return {ok:true,review:{meetingId:window.fixtureMeeting.id,version:body.expected_version+1,classification:body.classification,replayed:false},delivery:'not_sent'};}
   if(path.endsWith('/receipt'))return {payment_id:window.fixturePayment.id,proposal_id:window.fixtureProposal.id,quote_id:null,status:'paid',settled_at:'2026-10-23T12:00:00Z',checkout_phase:'bound',review_disposition:null,notification_disposition:{state:'human_review_required',key:'billing:'+window.fixturePayment.id,client_purpose:'advance_received',client_recipient_reference:'proposal:'+window.fixtureProposal.id,admin_recipient_reference:'configured_admin',automatic_delivery:false}};
   if(!window.calendarReady)throw Error('Calendar confirmation is still unavailable.');
   window.fixtureMeeting.meet_url='https://meet.google.com/abc-defg-hij';return {ok:true,delivery:'not_sent'};
  };
 });
 await page.addScriptTag({content:await readFile(new URL('site/assets/consultation-review.js',root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('site/assets/admin.js',root),'utf8')});
 await page.locator('[data-tab="meetings"]').click();
 await page.locator('#meetingsTable tr.click').click();
 assert.match(await page.locator('#meetingDetail').textContent(),/time remains reserved/);
 await page.evaluate(()=>RP.demo=true);
 await page.getByRole('button',{name:'Check calendar confirmation',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.reconcileCalls.length),0);
 await page.evaluate(()=>RP.demo=false);
 await page.getByRole('button',{name:'Check calendar confirmation',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('calendarReview').textContent.includes('still unavailable'));
 await page.evaluate(()=>window.calendarReady=true);
 await page.getByRole('button',{name:'Check calendar confirmation',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#meetingDetail a')?.href==='https://meet.google.com/abc-defg-hij');
 assert.equal(await page.evaluate(()=>window.reconcileCalls.length),2);
 await page.evaluate(()=>{window.fixtureMeeting.start_at='2026-01-01T10:00:00Z';window.fixtureMeeting.end_at='2026-01-01T10:15:00Z';window.fixtureMeeting.status='attendance_unknown';window.fixtureMeeting.attendance_review_version=2;window.fixtureMeeting.reminder_receipts={'24h':{state:'review',reason:'delivery_uncertain'}};});
 await page.getByRole('button',{name:'Check calendar confirmation',exact:true}).click();
 await page.waitForSelector('#attendanceReviewForm');assert.match(await page.locator('#meetingDetail').textContent(),/Attendance is unverified/);assert.match(await page.locator('#meetingDetail').textContent(),/delivery_uncertain/);
 await page.selectOption('#attendanceClassification','held');await page.fill('#attendanceEvidence','Fixture authoritative attendee log');await page.fill('#attendanceReason','Staff verified intended attendee joined');await page.check('#attendanceVerified');
 await page.getByRole('button',{name:'Record staff attendance review',exact:true}).click();
 await page.waitForFunction(()=>window.fixtureMeeting.attendance_review?.classification==='held');
 const attendance=await page.evaluate(()=>window.reconcileCalls.find(c=>c.path.endsWith('/attendance')));assert.equal(attendance.body.expected_version,2);assert.equal(attendance.body.evidence_verified,true);assert.equal(attendance.body.classification,'held');assert.match(attendance.body.request_id,/^[0-9a-f-]{36}$/);

 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Meeting overflow at ${width}`);}
 await page.locator('[data-tab="proposals"]').click();await page.locator('#proposalsTable tr.click').click();
 await page.getByRole('button',{name:'Load payment records',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('propPayment').disabled);
 await page.selectOption('#propPayment','66666666-6666-4666-8666-666666666666');await page.getByRole('button',{name:'Check recorded payment',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('propPaymentReview').textContent.includes('Notification held for human review'));
 assert.equal(await page.evaluate(()=>window.reconcileCalls.filter(c=>c.path.endsWith('/receipt')).length),1);
 assert.match(await page.locator('#propPaymentReview').textContent(),/sent no notification/);
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Payment review overflow at ${width}`);}
 await page.locator('[data-tab="clients"]').click();await page.locator('#tenantsTable tr.click').click();
 await page.waitForFunction(()=>!document.getElementById('activateAccount').disabled);
 await page.fill('#activationReason','Reviewed managed account and current business brief');await page.getByRole('button',{name:'Activate account readiness',exact:true}).click();
 await page.waitForFunction(()=>window.fixtureTenant.status==='active'&&!document.getElementById('activateAccount'));
 const activation=await page.evaluate(()=>window.reconcileCalls.find(c=>c.path.endsWith('/activate')));assert.equal(activation.body.expected_status,'onboarding');assert.equal(activation.body.expected_version,0);assert.equal(activation.body.brief_version,1);
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Activation overflow at ${width}`);}
 assert.deepEqual(failures,[]);
 console.log('PASS: four rendered product forms, Revive cohort snapshot/decision, bounded test-cycle report, paired action outcome, real-mode account activation, import/report, campaign draft and dirty-approval guard, desktop/mobile overflow, inbox preview/review/import, human owner/resolution review, synthetic event configuration/registration/cancellation, meeting reconciliation/sample/error/recovery, staff attendance evidence and held reminder display, read-only held payment review, no page errors; synthetic API only.');
}finally{await browser.close();}
