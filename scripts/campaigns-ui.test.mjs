import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../site/assets/campaigns-admin.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function mount(api){
 const nodes={},listeners={};
 function node(id){return nodes[id] ||= {_value:'',options:[],get selectedOptions(){return this.options.filter(o=>o.selected);},get value(){return this._value;},set value(v){this._value=String(v??'');},textContent:'',set innerHTML(v){this._html=v;this.options=[...v.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(m=>({value:m[1],selected:/\bselected\b/.test(m[2])}));for(const m of v.matchAll(/id="([^"]+)"/g))node(m[1]);},get innerHTML(){return this._html;}};}
 node('campaignPlansPanel');
 // Behave like the DOM: bindings to missing markup return null, never fabricate nodes.
 vm.runInNewContext(source,{crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},window:{RP:{esc:s=>String(s??'').replaceAll('<','&lt;'),api},addEventListener:(name,fn)=>listeners[name]=fn},document:{getElementById:id=>nodes[id]||null}});
 return {nodes,select:id=>listeners['rp:tenant-selected']({detail:{id,name:id}})};
}
const empty=()=>({campaigns:[],assets:[],actions:[]});
test('Revive automation runs the selected tenant scope and reports only synthetic results',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return path.endsWith('/revive-run')?{enrolled:1,tested:0,blocked:2,review:0,limited:false}:empty();});
 ui.select('tenant-a');await tick();ui.nodes.reviveRun.onclick();await tick();await tick();
 assert.equal(calls.find(c=>c.path.endsWith('/revive-run')).path,'/api/admin/tenants/tenant-a/revive-run');assert.match(ui.nodes.reviveRunStatus.textContent,/1 enrolled/);assert.match(ui.nodes.reviveRunStatus.textContent,/No email was sent/);
});
test('late Revive run responses cannot update another client',async()=>{
 let finish;const ui=mount(path=>path.endsWith('/revive-run')?new Promise(r=>finish=r):Promise.resolve(empty()));ui.select('tenant-a');await tick();ui.nodes.reviveRun.onclick();ui.select('tenant-b');await tick();
 finish({enrolled:999,tested:999,blocked:0,review:0});await tick();assert.doesNotMatch(ui.nodes.reviveRunStatus.textContent,/999/);
});
test('campaign draft uses selected tenant and exact loaded content; dirty edits cannot be approved',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return body.operation==='list'?empty():{id:body.campaign_id};});
 ui.select('tenant-a');await tick();const n=ui.nodes;
 n.campaignPurpose.value='reactivation';n.campaignMarket.value='AE';n.messageSubject0.value='Fixture';n.messageBody0.value='Is this a priority?';n.messageEvidence0.value='source:fixture';
 n.campaignDraft.onsubmit({preventDefault(){}});await tick();
 const save=calls.find(c=>c.body.operation==='save');assert.equal(save.path,'/api/admin/tenants/tenant-a/campaigns');assert.equal(save.body.version,0);assert.equal(save.body.body.steps[0].body,'Is this a priority?');
 n.campaignDraft.oninput();n.campaignApprove.onsubmit({preventDefault(){}});
 assert.equal(calls.some(c=>c.body.operation==='approve'),false);assert.match(n.campaignError.textContent,/Save your message changes/);
});
test('late campaign responses cannot overwrite the newly selected tenant',async()=>{
 let finish;const ui=mount(path=>path.includes('tenant-a')?new Promise(r=>finish=r):Promise.resolve(empty()));
 ui.select('tenant-a');ui.select('tenant-b');await tick();finish({campaigns:[{id:'foreign',capability:'revive',purpose:'PRIVATE',status:'draft'}],assets:[],actions:[]});await tick();
 assert.doesNotMatch(ui.nodes.campaignSelect.innerHTML,/PRIVATE/);
});
test('failed loads cannot save or approve a campaign',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push(body);throw Error('Unconfigured preview');});ui.select('tenant-a');await tick();
 ui.nodes.campaignDraft.onsubmit({preventDefault(){}});assert.equal(calls.length,1);assert.match(ui.nodes.campaignError.textContent,/Load the current campaign/);
});

test('existing action review reads the tenant receipt without starting another test',async()=>{
 const calls=[];const fixture={campaigns:[{id:'campaign-1',capability:'revive',purpose:'fixture',status:'approved',asset_version:1}],assets:[],actions:[{id:'action-1',campaign_id:'campaign-1',state:'tested',due_at:'2026-10-23',message_step:0}]};
 const ui=mount(async(path,body)=>{calls.push({path,body});return path.endsWith('/receipt')?{state:'tested',receipt:{acknowledgedAt:'2026-10-23T12:00:00Z'},delivery:'not_sent'}:fixture;});
 ui.select('tenant-a');await tick();ui.nodes.campaignSelect.value='campaign-1';ui.nodes.campaignSelect.onchange();
 assert.match(ui.nodes.campaignActions.innerHTML,/Check test acknowledgement/);
 ui.nodes.campaignActions.onclick({target:{getAttribute:name=>name==='data-action-receipt'?'action-1':null}});await tick();
 assert.equal(calls.at(-1).path,'/api/admin/tenants/tenant-a/actions/action-1/receipt');assert.equal(calls.some(c=>c.path.endsWith('/test')),false);
 assert.match(ui.nodes.campaignReceipt.textContent,/No email was sent/);
});
test('late receipt reads cannot expose the previous tenant result',async()=>{
 let finish;const ui=mount((path)=>path.endsWith('/receipt')?new Promise(r=>finish=r):Promise.resolve(empty()));
 ui.select('tenant-a');await tick();ui.nodes.campaignActions.onclick({target:{getAttribute:name=>name==='data-action-receipt'?'action-1':null}});
 ui.select('tenant-b');await tick();finish({state:'tested',receipt:{acknowledgedAt:'PRIVATE previous tenant'}});await tick();
 assert.doesNotMatch(ui.nodes.campaignReceipt.textContent,/PRIVATE/);
});

const proposal=()=>({steps:[{offsetHours:0,subject:'Reviewed cohort subject',body:'Generic reviewed cohort copy',evidenceReference:'brief:v3;source:fixture;review:v2'}],draftContext:{leadId:'lead-a',sourceId:'source-a',briefVersion:3,reviewVersion:2,businessName:'Ripe Piper',snapshot:'fixture-snapshot',expiresAt:'2026-10-24T12:00:00Z'},basis:{briefVersion:3,briefReference:'brief:reviewed',sourceReference:'source:reviewed',sourceExcerpt:'PRIVATE staff evidence <script>never executed</script>'},strategy:'Reusable cohort copy only.',bookingVerification:'not_requested'});
const draftData=()=>({...empty(),leads:[{id:'test-a',email:'test@example.invalid'}],sources:[],draftLeads:[{id:'lead-a',email:'reviewed@business.com'}],draftSources:[{id:'source-a',lead_id:'lead-a',external_ref:'Reviewed business evidence'}]});
function chooseDraft(ui){const n=ui.nodes;n.draftLead.value='lead-a';n.draftLead.onchange();n.draftSource.value='source-a';n.draftSource.onchange();n.draftSender.value='Dipuraj';n.draftCount.value='1';return n;}
test('all draft/report controls are actually present in rendered markup before bindings run',async()=>{
 const ui=mount(async()=>draftData());ui.select('tenant-a');await tick();
 for(const id of ['draftLead','draftSource','prepareReviveDraft','draftStatus','draftBasis','loadReviveReport','reviveReportStatus','reviveReportText'])assert.match(ui.nodes.campaignPlansPanel.innerHTML,new RegExp('id="'+id+'"'));
});
test('evidence-based draft previews do not mutate a campaign until the operator explicitly saves exact edited copy',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return body.operation==='list'?draftData():body.operation==='draft'?{proposal:proposal()}:{id:body.campaign_id};});
 ui.select('tenant-a');await tick();const n=chooseDraft(ui);assert.match(n.draftLead.innerHTML,/reviewed@business.com/);assert.doesNotMatch(n.campaignLead.innerHTML,/reviewed@business.com/);
 n.prepareReviveDraft.onclick();await tick();assert.equal(n.messageBody0.value,'Generic reviewed cohort copy');assert.equal(calls.some(c=>c.body.operation==='save'),false);assert.equal(calls.some(c=>c.body.operation==='approve'),false);
 assert.match(n.draftBasis.textContent,/PRIVATE staff evidence/);assert.equal(n.draftBasis.innerHTML,undefined);
 n.campaignApprove.onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.body.operation==='approve'),false);assert.match(n.campaignError.textContent,/Save your message changes/);
 n.messageBody0.value+='\nOperator correction.';n.campaignDraft.oninput();n.campaignDraft.onsubmit({preventDefault(){}});await tick();
 const saved=calls.find(c=>c.body.operation==='save');assert.equal(saved.path,'/api/admin/tenants/tenant-a/campaigns');assert.equal(saved.body.body.steps[0].body,'Generic reviewed cohort copy\nOperator correction.');assert.equal(saved.body.body.draftContext.reviewVersion,2);assert.equal(saved.body.body.draftContext.snapshot,'fixture-snapshot');
});
test('changing draft inputs invalidates the generated proposal and cannot silently save it as untagged manual copy',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push(body);return body.operation==='list'?draftData():{proposal:proposal()};});
 ui.select('tenant-a');await tick();const n=chooseDraft(ui);n.prepareReviveDraft.onclick();await tick();n.draftSender.value='Different sender';n.draftSender.oninput();n.campaignDraft.onsubmit({preventDefault(){}});
 assert.equal(calls.some(c=>c.operation==='save'),false);assert.match(n.campaignError.textContent,/Prepare a new proposal/);
});
test('late draft responses cannot replace another account or another reviewed contact selection',async()=>{
 let finish;const ui=mount((path,body)=>body.operation==='draft'?new Promise(r=>finish=r):Promise.resolve(draftData()));
 ui.select('tenant-a');await tick();chooseDraft(ui).prepareReviveDraft.onclick();ui.select('tenant-b');await tick();finish({proposal:proposal()});await tick();assert.equal(ui.nodes.messageBody0.value,'');assert.doesNotMatch(ui.nodes.draftBasis.textContent,/PRIVATE/);
 chooseDraft(ui).prepareReviveDraft.onclick();ui.nodes.draftSource.value='different-source';ui.nodes.draftSource.onchange();finish({proposal:proposal()});await tick();assert.equal(ui.nodes.messageBody0.value,'');assert.doesNotMatch(ui.nodes.draftBasis.textContent,/PRIVATE/);
});
const bucket=()=>({contacts:{enrolled:5,queued:2,replyHeld:1,requiresReview:1,testAcknowledged:2,providerAcknowledged:0},actions:{unverifiedReceipt:0},outcomes:{qualified_conversation:1,meeting_held:1,opportunity:0,won:0,lost:0},conflictingOutcomeContacts:0});
const report=()=>({generatedAt:'2026-10-23T12:00:00Z',totals:{synthetic:bucket(),business:bucket()},campaigns:[],unattributed:{synthetic:{records:3},business:{records:2}},unverifiedLinkedRecords:1,abComparison:{available:false,reason:'No variant assignments recorded.'},notes:['Counts are cumulative.']});
test('read-only Revive report separates test/provider evidence and does not imply delivered messages or an A/B winner',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return path.endsWith('/revive-report')?{report:report()}:empty();});ui.select('tenant-a');await tick();ui.nodes.loadReviveReport.onclick();await tick();
 assert.equal(calls.at(-1).path,'/api/admin/tenants/tenant-a/revive-report');const text=ui.nodes.reviveReportText.textContent;
 assert.match(text,/Synthetic evidence/);assert.match(text,/Business evidence/);assert.match(text,/recipient delivery unverified/);assert.match(text,/held meetings: 1/);assert.match(text,/Unattributed records across this account: 3 synthetic/);assert.match(text,/A\/B comparison unavailable/);assert.equal(calls.some(c=>['save','approve','queue'].includes(c.body.operation)),false);
});
test('late read-only reports cannot leak another account result or overwrite a changed campaign selection',async()=>{
 let finish;const ui=mount(path=>path.endsWith('/revive-report')?new Promise(r=>finish=r):Promise.resolve(empty()));ui.select('tenant-a');await tick();ui.nodes.loadReviveReport.onclick();ui.select('tenant-b');await tick();const r=report();r.notes=['PRIVATE prior tenant'];finish({report:r});await tick();assert.doesNotMatch(ui.nodes.reviveReportText.textContent,/PRIVATE/);
 ui.nodes.loadReviveReport.onclick();ui.nodes.campaignSelect.value='other-campaign';ui.nodes.campaignSelect.onchange();finish({report:r});await tick();assert.doesNotMatch(ui.nodes.reviveReportText.textContent,/PRIVATE/);
});

const contactA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',contactB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const audienceData=()=>({...empty(),leads:[{id:contactA,email:'one@test.invalid'},{id:contactB,email:'two@test.invalid'}],audienceCandidates:[{leadId:contactA,email:'one@test.invalid',company:'Reviewed one'},{leadId:contactB,email:'two@test.invalid',company:'Reviewed two'}]});
function chooseAudience(n,ids){n.campaignAudience.options.forEach(o=>o.selected=ids.includes(o.value));n.campaignAudience.onchange();}
test('accepted contacts are listed but never automatically chosen or confirmed for a new campaign',async()=>{
 const calls=[],ui=mount(async(path,body)=>{calls.push(body);return body.operation==='list'?audienceData():{id:body.campaign_id};});ui.select('tenant-a');await tick();const n=ui.nodes;
 assert.equal(n.campaignAudience.selectedOptions.length,0);assert.equal(n.campaignAudienceConfirmed.checked,false);assert.match(n.campaignAudience.innerHTML,/Reviewed one/);assert.match(n.campaignAudienceStatus.textContent,/No reviewed audience/);
 assert.doesNotMatch(n.campaignLead.innerHTML,/one@test.invalid/);n.campaignDraft.onsubmit({preventDefault(){}});await tick();assert.equal(calls.find(c=>c.operation==='save').body.audience,undefined);
});
test('audience save requires explicit confirmation and sends only selected contacts on the exact asset save',async()=>{
 const calls=[],ui=mount(async(path,body)=>{calls.push(body);return body.operation==='list'?audienceData():{id:body.campaign_id};});ui.select('tenant-a');await tick();const n=ui.nodes;
 chooseAudience(n,[contactB]);n.campaignDraft.onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.operation==='save'),false);assert.match(n.campaignError.textContent,/explicitly review/);
 n.campaignAudienceConfirmed.checked=true;n.campaignAudienceConfirmed.onchange();n.campaignDraft.onsubmit({preventDefault(){}});await tick();assert.equal(JSON.stringify(calls.find(c=>c.operation==='save').body.audience),JSON.stringify({leadIds:[contactB],confirmed:true}));
});
test('changing audience, copy or scope clears confirmation while the checkbox own event remains usable',async()=>{
 const ui=mount(async()=>audienceData());ui.select('tenant-a');await tick();const n=ui.nodes;
 chooseAudience(n,[contactA]);n.campaignAudienceConfirmed.checked=true;n.campaignDraft.oninput({target:{id:'campaignAudienceConfirmed'}});assert.equal(n.campaignAudienceConfirmed.checked,true);
 n.campaignDraft.oninput({target:{id:'messageBody0'}});assert.equal(n.campaignAudienceConfirmed.checked,false);
 n.campaignAudienceConfirmed.checked=true;n.campaignDraft.oninput({target:{id:'campaignPurpose'}});assert.equal(n.campaignAudienceConfirmed.checked,false);
 n.campaignAudienceConfirmed.checked=true;chooseAudience(n,[contactB]);assert.equal(n.campaignAudienceConfirmed.checked,false);
});
test('replacing copy with a generated proposal requires another audience review without selecting its source contact',async()=>{
 const ui=mount(async(path,body)=>body.operation==='draft'?{proposal:proposal()}:{...draftData(),...audienceData()});ui.select('tenant-a');await tick();const n=chooseDraft(ui);
 chooseAudience(n,[contactB]);n.campaignAudienceConfirmed.checked=true;n.prepareReviveDraft.onclick();await tick();assert.equal(n.campaignAudienceConfirmed.checked,false);assert.deepEqual(n.campaignAudience.selectedOptions.map(o=>o.value),[contactB]);
});
test('loaded audience and generated-source receipt survive editing while queue choices remain campaign-scoped',async()=>{
 const fixture=audienceData(),context={...proposal().draftContext,proposalId:'42',canonicalNeed:'reviewed need'};
 fixture.campaigns=[{id:'campaign-one',capability:'revive',purpose:'fixture',market:'AE',timezone:'UTC',asset_version:2,status:'draft'}];
 fixture.assets=[{campaign_id:'campaign-one',version:2,steps:proposal().steps,revive_draft_context:context,revive_audience:{members:[{leadId:contactA,reviewVersion:1,snapshot:'a'.repeat(32)}]}}];
 const calls=[],ui=mount(async(path,body)=>{calls.push(body);return body.operation==='list'?fixture:{id:body.campaign_id};});ui.select('tenant-a');await tick();const n=ui.nodes;n.campaignSelect.value='campaign-one';n.campaignSelect.onchange();
 assert.deepEqual(n.campaignAudience.selectedOptions.map(o=>o.value),[contactA]);assert.equal(n.campaignAudienceConfirmed.checked,false);assert.match(n.campaignLead.innerHTML,/one@test.invalid/);assert.doesNotMatch(n.campaignLead.innerHTML,/two@test.invalid/);
 n.messageBody0.value+=' reviewed edit';n.campaignDraft.oninput({target:{id:'messageBody0'}});n.campaignAudienceConfirmed.checked=true;n.campaignDraft.onsubmit({preventDefault(){}});await tick();const saved=calls.find(c=>c.operation==='save');assert.equal(saved.version,2);assert.equal(JSON.stringify(saved.body.draftContext),JSON.stringify(context));assert.equal(JSON.stringify(saved.body.audience),JSON.stringify({leadIds:[contactA],confirmed:true}));
});
test('unavailable prior audience contacts remain visible instead of being silently removed from the next version',async()=>{
 const fixture=audienceData();fixture.audienceCandidates=[];fixture.campaigns=[{id:'campaign-old',capability:'revive',purpose:'fixture',asset_version:1,status:'approved'}];fixture.assets=[{campaign_id:'campaign-old',version:1,steps:[],revive_audience:{members:[{leadId:contactA,reviewVersion:1,snapshot:'a'.repeat(32)}]}}];
 const ui=mount(async()=>fixture);ui.select('tenant-a');await tick();ui.nodes.campaignSelect.value='campaign-old';ui.nodes.campaignSelect.onchange();assert.match(ui.nodes.campaignAudience.innerHTML,/no current accepted review/);assert.deepEqual(ui.nodes.campaignAudience.selectedOptions.map(o=>o.value),[contactA]);
});
