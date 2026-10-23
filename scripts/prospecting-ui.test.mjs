import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../site/assets/prospecting-admin.js',import.meta.url),'utf8');
const importSource=await readFile(new URL('../site/assets/contact-import.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function mount(api) {
  const nodes={},listeners={};
  function node(id){return nodes[id] ||= {value:'',textContent:'',_html:'',set innerHTML(v){this._html=v; for(const m of v.matchAll(/id="([^"]+)"/g))node(m[1]);},get innerHTML(){return this._html;}};}
  node('prospectingPanel');
  const RP={esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api};
  const context={window:{RP,addEventListener:(name,fn)=>listeners[name]=fn},document:{getElementById:node},TextDecoder};
  vm.runInNewContext(importSource,context);vm.runInNewContext(source,context);
  return {nodes,select:(id)=>{listeners['rp:tenant-selected']({detail:{id,name:'Fixture '+id}});nodes.prospectMode.value='synthetic';}};
}
test('Revive cohort decision uses a current server snapshot and loaded review version',async()=>{
 const calls=[];const snapshot='a'.repeat(32);
 const ui=mount(async(path,body)=>{calls.push({path,body});if(path.endsWith('/shortlist'))return response();if(body.operation==='preview')return {assessment:{eligible:true,fitState:'candidate',historyState:'dormant_review',reasons:[],expiresAt:'2026-11-01T00:00:00Z'},snapshot,version:2};return {review:{version:3,state:'accepted'}};});
 ui.select('tenant-a');await tick();const n=ui.nodes;n.reviveLead.value='lead-a';n.reviveReason.value='Verified current need and history';
 n.reviveAccept.onclick();assert.equal(calls.some(c=>c.body.operation==='accept'),false);
 n.revivePreview.onclick();await tick();assert.equal(n.reviveAccept.disabled,false);n.reviveAccept.onclick();await tick();
 const saved=calls.find(c=>c.body.operation==='accept');assert.equal(saved.path,'/api/admin/tenants/tenant-a/revive-review');assert.deepEqual(JSON.parse(JSON.stringify(saved.body)),{operation:'accept',lead_id:'lead-a',snapshot,version:2,reason:'Verified current need and history'});
 assert.match(n.reviveStatus.textContent,/No message was sent/);assert.equal(n.reviveAccept.disabled,true);
});
test('Revive declined or malformed eligibility never enables acceptance',async()=>{
 for(const result of [{assessment:{eligible:false,fitState:'candidate',historyState:'not_interested',reasons:['not_interested']},snapshot:'a'.repeat(32),version:0},{assessment:{eligible:'true'},snapshot:'forged',version:0}]){
  const calls=[];const ui=mount(async(path,body)=>{calls.push(body);return path.endsWith('/shortlist')?response():result;});ui.select('tenant-a');await tick();ui.nodes.reviveLead.value='lead-a';ui.nodes.revivePreview.onclick();await tick();
  assert.equal(ui.nodes.reviveAccept.disabled,true);ui.nodes.reviveReason.value='Reviewed relationship';ui.nodes.reviveAccept.onclick();assert.equal(calls.some(c=>c.operation==='accept'),false);
 }
});
test('late Revive previews cannot expose another tenant or approve a changed contact',async()=>{
 let finish;const ui=mount((path,body)=>body.operation==='preview'?new Promise(r=>finish=r):Promise.resolve(response()));
 ui.select('tenant-a');await tick();ui.nodes.reviveLead.value='lead-a';ui.nodes.revivePreview.onclick();ui.select('tenant-b');await tick();
 finish({assessment:{eligible:true,fitState:'PRIVATE previous tenant',historyState:'dormant_review',reasons:[]},snapshot:'b'.repeat(32),version:1});await tick();
 assert.doesNotMatch(ui.nodes.reviveStatus.textContent,/PRIVATE/);assert.equal(ui.nodes.reviveAccept.disabled,true);
});
test('Revive outcomes submit the paired action reference without inventing delivery',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return path.endsWith('/shortlist')?response():{ok:true};});ui.select('tenant-a');await tick();const n=ui.nodes;
 n.productChoice.value='revive';n.productKind.value='outcome';n.productChoice.onchange();n.productLead.value='lead-a';n.productReference.value='reviewed-result';n.productRights.value='permitted-use';n.productExcerpt.value='Synthetic rehearsal';n.productObserved.value='2026-10-23T12:00';n.productOutcome.value='meeting_held';n.productReason.value='Synthetic fixture only';n.outcomeCampaign.value='campaign-id';n.outcomeAction.value='action-id';
 n.productForm.onsubmit({preventDefault(){}});await tick();const body=calls.find(c=>c.path.endsWith('/product-event')).body;
 assert.equal(body.context.campaignId,'campaign-id');assert.equal(body.context.actionId,'action-id');assert.equal(body.context.delivered,undefined);assert.equal(body.synthetic,true);
});
const response=(version=1)=>({brief:{version,body:{offer:'Fixture offer',industries:['construction'],markets:['AE'],roles:['owner'],needs:['dormant leads'],excludedIndustries:[],maxAgeDays:90,source:{reference:'interview:test',excerpt:'Reviewed fixture',observedAt:'2026-10-22T00:00:00Z'}}},leads:[],results:[]});
test('brief UI sends loaded version and selected tenant, then reloads',async()=>{
  const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return path.endsWith('/shortlist')?response(3):{ok:true,version:4};});
  ui.select('tenant-a');await tick();
  ui.nodes.briefOffer.value='Corrected offer';ui.nodes.briefForm.onsubmit({preventDefault(){}});await tick();
  const save=calls.find(c=>c.path.endsWith('/brief'));assert.equal(save.path,'/api/admin/tenants/tenant-a/brief');assert.equal(save.body.expected_version,3);assert.equal(save.body.brief.offer,'Corrected offer');
  assert.equal(calls.filter(c=>c.path.endsWith('/shortlist')).length,2);
});
test('late result from previous tenant cannot overwrite the current brief',async()=>{
  let finish;const ui=mount(path=>path.includes('tenant-a')?new Promise(r=>finish=r):Promise.resolve(response(2)));
  ui.select('tenant-a');ui.select('tenant-b');await tick();finish(response(9));await tick();
  assert.match(ui.nodes.briefVersion.textContent,/2$/);assert.doesNotMatch(ui.nodes.briefVersion.textContent,/9/);
});
test('failed or sample connection cannot save or report a successful review',async()=>{
  let calls=0;const ui=mount(async()=>{calls++;throw Error('Sample mode: not connected');});
  ui.select('tenant-a');await tick();ui.nodes.briefForm.onsubmit({preventDefault(){}});await tick();
  assert.equal(calls,1);assert.match(ui.nodes.prospectError.textContent,/Load the current brief/);
});
test('source excerpts and company names render as text, not active markup',async()=>{
  const r=response();r.results=[{company:'<img onerror="bad()">',state:'candidate',score:100,nextAction:'Review',reasons:[],fields:[{field:'industry',state:'match',values:['construction'],evidence:[{excerpt:'<script>bad()</script>',reference:'interview:test',observedAt:'2026-10-22'}]}]}];
  const ui=mount(async()=>r);ui.select('tenant-a');await tick();
  const html=ui.nodes.prospectResults.innerHTML;assert.doesNotMatch(html,/<script>|<img /);assert.match(html,/&lt;script&gt;/);
});
test('product form preserves tenant, mode, thread and explicit missing answers',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return path.endsWith('/shortlist')?response():{ok:true};});
 ui.select('tenant-a');await tick();
 const n=ui.nodes;n.productChoice.value='response';n.productChoice.onchange();
 n.productKind.value='evidence';n.productLead.value='lead-a';n.productReference.value='source-1';n.productRights.value='purpose-1';n.productExcerpt.value='Reviewed reply';n.productObserved.value='2026-10-22T12:00';
 n.responseKind.value='reply';n.threadRef.value='thread-1';n.disposition.value='interested';n.answerNeed.value='Faster enquiry follow-up';
 n.productForm.onsubmit({preventDefault(){}});await tick();
 const saved=calls.find(c=>c.path.endsWith('/product-event'));assert.equal(saved.path,'/api/admin/tenants/tenant-a/product-event');assert.equal(saved.body.synthetic,true);assert.equal(saved.body.context.authority,'');assert.equal(saved.body.context.threadRef,'thread-1');
});
test('import previews locally, blocks invalid batches, then sends reviewed rows and displays every server result',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return path.endsWith('/shortlist')?response():{ok:true,results:[{row:1,state:'created'},{row:2,state:'rejected',reason:'invalid_identity'}]};});
 ui.select('tenant-a');await tick();
 ui.nodes.prospectImportRows.value='fixture@example.invalid\tFixture\tsource-1\tpurpose-1\t2026-10-22\nbad';
 ui.nodes.prospectImportPreview.onclick();assert.equal(ui.nodes.prospectImportConfirm.disabled,true);assert.match(ui.nodes.prospectImportReport.textContent,/No rows will be submitted/);
 ui.nodes.prospectImportForm.onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.path.endsWith('/prospect-import')),false);
 ui.nodes.prospectImportRows.value='fixture@example.invalid\tFixture\tsource-1\tpurpose-1\t2026-10-22\nsecond@example.invalid\tSecond\tsource-2\tpurpose-1\t2026-10-22';
 ui.nodes.prospectImportPreview.onclick();assert.equal(ui.nodes.prospectImportConfirm.disabled,false);assert.equal(calls.some(c=>c.path.endsWith('/prospect-import')),false);
 ui.nodes.prospectImportForm.onsubmit({preventDefault(){}});await tick();await tick();
 const saved=calls.find(c=>c.path.endsWith('/prospect-import'));assert.equal(saved.body.rows[0].reference,'source-1');assert.equal(saved.body.rows.length,2);assert.match(ui.nodes.prospectImportReport.textContent,/Row 2: rejected/);
});

test('edited contents and changed mode or tenant invalidate an import preview',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return response();});ui.select('tenant-a');await tick();const n=ui.nodes;
 n.prospectImportRows.value='fixture@example.invalid\tFixture\tsource-1\tpurpose-1\t2026-10-22';n.prospectImportPreview.onclick();
 n.prospectImportRows.value+='edited';n.prospectImportForm.onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.path.endsWith('/prospect-import')),false);
 n.prospectImportRows.value='fixture@example.invalid\tFixture\tsource-1\tpurpose-1\t2026-10-22';n.prospectImportPreview.onclick();n.prospectMode.value='business';n.prospectImportForm.onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.path.endsWith('/prospect-import')),false);
 ui.select('tenant-b');await tick();assert.equal(n.prospectImportConfirm.disabled,true);
});
test('uncertain import retains the exact preview references and prevents duplicate in-flight requests',async()=>{
 let rejectImport;const calls=[];const ui=mount((path,body)=>{calls.push({path,body});return path.endsWith('/shortlist')?Promise.resolve(response()):new Promise((_resolve,reject)=>{rejectImport=reject;});});
 ui.select('tenant-a');await tick();const n=ui.nodes;n.prospectImportRows.value='fixture@example.invalid\tFixture\tsource-1\tpurpose-1\t2026-10-22';n.prospectImportPreview.onclick();
 n.prospectImportForm.onsubmit({preventDefault(){}});n.prospectImportForm.onsubmit({preventDefault(){}});assert.equal(calls.filter(c=>c.path.endsWith('/prospect-import')).length,1);
 rejectImport(Error('Lost response'));await tick();assert.match(n.prospectImportReport.textContent,/some rows may have been saved/);
 n.prospectImportForm.onsubmit({preventDefault(){}});const saved=calls.filter(c=>c.path.endsWith('/prospect-import'));assert.equal(saved.length,2);assert.equal(JSON.stringify(saved[0].body),JSON.stringify(saved[1].body));rejectImport(Error('Still unavailable'));await tick();
});
test('UTF-8 CSV upload previews rows, rejects invalid encoding and never leaks a late file into another tenant',async()=>{
 const ui=mount(async()=>response());ui.select('tenant-a');await tick();const n=ui.nodes;
 const text='email,company,reference,rights_reference,observed_at\r\nfixture@example.invalid,"Trade, Company",source-1,rights,2026-10-22';
 n.prospectImportFile.files=[{name:'contacts.csv',size:text.length,arrayBuffer:async()=>new TextEncoder().encode(text).buffer}];n.prospectImportFile.onchange();await tick();await tick();
 assert.equal(n.prospectImportFormat.value,'csv');assert.equal(n.prospectImportHeader.checked,true);assert.equal(n.prospectImportConfirm.disabled,false);assert.match(n.prospectImportPreviewRows.innerHTML,/Trade, Company/);
 n.prospectImportFile.files=[{name:'broken.csv',size:2,arrayBuffer:async()=>new Uint8Array([0xc3,0x28]).buffer}];n.prospectImportFile.onchange();await tick();await tick();assert.match(n.prospectImportReport.textContent,/could not be read as UTF-8/);assert.equal(n.prospectImportConfirm.disabled,true);
 let finish;n.prospectImportFile.files=[{name:'late.csv',size:text.length,arrayBuffer:()=>new Promise(r=>{finish=r;})}];n.prospectImportFile.onchange();await tick();ui.select('tenant-b');await tick();finish(new TextEncoder().encode(text.replace('Trade, Company','PRIVATE old tenant')).buffer);await tick();await tick();assert.doesNotMatch(n.prospectImportRows.value,/PRIVATE/);assert.doesNotMatch(n.prospectImportPreviewRows.innerHTML,/PRIVATE/);
});

test('inbox import requires a current preview and explicit review, passes digest and reloads existing history',async()=>{
 const calls=[];const ui=mount(async(path,body)=>{
  calls.push({path,body});if(path.endsWith('/shortlist'))return response();
  if(body.operation==='preview')return {message:{excerpt:'<script>untrusted</script>',digest:'source-digest',truncated:false}};
  return {ok:true};
 });ui.select('tenant-a');await tick();const n=ui.nodes;n.inboxLead.value='lead-a';n.inboxMessage.value='message-a';
 n.inboxImport.onclick();assert.equal(calls.some(c=>c.body.operation==='import'),false);
 n.inboxPreview.onclick();await tick();assert.equal(n.inboxExcerpt.textContent,'<script>untrusted</script>');
 n.inboxImport.onclick();assert.equal(calls.some(c=>c.body.operation==='import'),false);
 n.inboxReviewed.checked=true;n.inboxImport.onclick();await tick();await tick();
 const saved=calls.find(c=>c.body.operation==='import');assert.equal(saved.path,'/api/admin/tenants/tenant-a/connection');assert.equal(saved.body.digest,'source-digest');assert.equal(saved.body.lead_id,'lead-a');assert.match(n.inboxStatus.textContent,/no reply was sent/);
});
test('late inbox previews cannot populate a different tenant or contact',async()=>{
 let finish;const ui=mount((path,body)=>body.operation==='preview'?new Promise(r=>finish=r):Promise.resolve(response()));ui.select('tenant-a');await tick();
 ui.nodes.inboxLead.value='lead-a';ui.nodes.inboxMessage.value='message-a';ui.nodes.inboxPreview.onclick();ui.select('tenant-b');await tick();
 finish({message:{excerpt:'PRIVATE previous tenant',digest:'old'}});await tick();assert.doesNotMatch(ui.nodes.inboxExcerpt.textContent,/PRIVATE/);
 ui.nodes.inboxImport.onclick();assert.match(ui.nodes.inboxStatus.textContent,/Preview this message/);
});
test('missing tenant connection never reports an import or exposes a stale excerpt',async()=>{
 const ui=mount(async(path)=>path.endsWith('/shortlist')?response():{ok:true,state:'not_connected'});ui.select('tenant-a');await tick();ui.nodes.inboxCheck.onclick();await tick();assert.match(ui.nodes.inboxStatus.textContent,/No active tenant connection/);
});

test('outcome form carries the selected conversation or event reference',async()=>{
 for(const product of ['response','events']){
  const calls=[];const ui=mount(async(path,body)=>{calls.push({path,body});return path.endsWith('/shortlist')?response():{ok:true};});
  ui.select('tenant-a');await tick();const n=ui.nodes;
  n.productChoice.value=product;n.productKind.value='outcome';n.productChoice.onchange();
  n.productLead.value='lead-a';n.productReference.value='outcome-source';n.productRights.value='purpose';n.productExcerpt.value='Verified outcome';n.productObserved.value='2026-10-22T12:00';
  n.productOutcome.value='meeting_held';n.productReason.value='Verified by owner';
  n[product==='response'?'outcomeThread':'outcomeEvent'].value='existing-reference';
  n.productForm.onsubmit({preventDefault(){}});await tick();
  assert.equal(calls.find(c=>c.path.endsWith('/product-event')).body.context[product==='response'?'threadRef':'eventRef'],'existing-reference');
 }
});
