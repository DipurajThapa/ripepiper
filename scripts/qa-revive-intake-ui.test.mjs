import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const parser=readFileSync(new URL('../site/assets/contact-import.js',import.meta.url),'utf8');
const source=readFileSync(new URL('../site/assets/prospecting-admin.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const csv='email,company,reference,rights_reference,observed_at\r\nqa@example.invalid,"QA, company",qa-source,qa-rights,2026-10-22\r\n';
function mount(importer=async body=>({results:body.rows.map((_,i)=>({row:i+1,state:'created'}))})){
 const nodes={},listeners={},calls=[];
 const node=id=>nodes[id]??={value:'',checked:false,disabled:true,textContent:'',files:[],_html:'',set innerHTML(value){this._html=value;for(const match of value.matchAll(/id="([^"]+)"/g))node(match[1]);},get innerHTML(){return this._html;}};
 const RP={esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api:async(path,body)=>{calls.push({path,body});return path.endsWith('/shortlist')?{brief:null,leads:[],results:[]}:importer(body);}};
 const context={window:{RP,addEventListener:(event,fn)=>listeners[event]=fn},document:{getElementById:node},TextDecoder};
 vm.runInNewContext(parser,context);vm.runInNewContext(source,context);
 return{nodes,calls,select:id=>{listeners['rp:tenant-selected']({detail:{id,name:'QA tenant '+id}});node('prospectMode').value='synthetic';},preview(){node('prospectImportRows').value=csv;node('prospectImportFormat').value='csv';node('prospectImportHeader').checked=true;node('prospectImportPreview').onclick();},submit(){node('prospectImportForm').onsubmit({preventDefault(){}});}};
}
test('independent actual UI preview makes no persistence call and explicit commit preserves exact source references',async()=>{
 const ui=mount();ui.select('tenant-a');await tick();ui.preview();assert.equal(ui.calls.length,1);assert.equal(ui.nodes.prospectImportConfirm.disabled,false);assert.match(ui.nodes.prospectImportReport.textContent,/No data has been saved/);
 ui.submit();await tick();const write=ui.calls.find(c=>c.path.endsWith('/prospect-import'));assert.equal(write.path,'/api/admin/tenants/tenant-a/prospect-import');assert.equal(write.body.rows[0].reference,'qa-source');assert.equal(write.body.rows[0].rights_reference,'qa-rights');assert.equal(ui.calls.filter(c=>c.path.endsWith('/prospect-import')).length,1);
});
test('independent UI cannot submit a changed textarea, separator or header using an older valid preview',async()=>{
 for(const change of [n=>n.prospectImportRows.value+='\n',n=>n.prospectImportFormat.value='tsv',n=>n.prospectImportHeader.checked=false]){const ui=mount();ui.select('tenant-a');await tick();ui.preview();change(ui.nodes);ui.submit();await tick();assert.equal(ui.calls.some(c=>c.path.endsWith('/prospect-import')),false);assert.equal(ui.nodes.prospectImportConfirm.disabled,true);}
});
test('independent UI rejects invalid UTF-8 file without repair, preview or writes',async()=>{
 const ui=mount();ui.select('tenant-a');await tick();ui.nodes.prospectImportFile.files=[{name:'qa.csv',size:1,arrayBuffer:async()=>Uint8Array.of(255).buffer}];ui.nodes.prospectImportFile.onchange();await tick();assert.match(ui.nodes.prospectImportReport.textContent,/could not be read as UTF-8/);assert.equal(ui.nodes.prospectImportConfirm.disabled,true);assert.equal(ui.calls.length,1);
});
test('independent UI rejects a large file before invoking its file reader',async()=>{
 const ui=mount();ui.select('tenant-a');await tick();let reads=0;ui.nodes.prospectImportFile.files=[{name:'qa.csv',size:65537,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);}}];ui.nodes.prospectImportFile.onchange();await tick();assert.equal(reads,0);assert.equal(ui.nodes.prospectImportConfirm.disabled,true);
});
test('independent stale file completion cannot overwrite a newly selected tenant',async()=>{
 const ui=mount();ui.select('tenant-a');await tick();let finish;ui.nodes.prospectImportFile.files=[{name:'private.csv',size:100,arrayBuffer:()=>new Promise(resolve=>finish=resolve)}];ui.nodes.prospectImportFile.onchange();await tick();ui.select('tenant-b');await tick();finish(new TextEncoder().encode(csv.replace('QA, company','PRIVATE_OLD_ACCOUNT')).buffer);await tick();assert.doesNotMatch(ui.nodes.prospectImportRows.value,/PRIVATE_OLD_ACCOUNT/);assert.equal(ui.nodes.prospectImportConfirm.disabled,true);assert.equal(ui.calls.some(c=>c.path.endsWith('/prospect-import')),false);
});
test('independent uncertain commit retains the exact unchanged batch for safe retry and never claims success',async()=>{
 let first=true;const ui=mount(async body=>{if(first){first=false;throw Error('Synthetic lost receipt');}return{results:body.rows.map((_,i)=>({row:i+1,state:'duplicate'}))};});ui.select('tenant-a');await tick();ui.preview();ui.submit();await tick();assert.match(ui.nodes.prospectImportReport.textContent,/some rows may have been saved/);assert.equal(ui.nodes.prospectImportConfirm.disabled,false);ui.submit();await tick();const writes=ui.calls.filter(c=>c.path.endsWith('/prospect-import'));assert.equal(writes.length,2);assert.equal(JSON.stringify(writes[0].body),JSON.stringify(writes[1].body));assert.match(ui.nodes.prospectImportReport.textContent,/duplicate/);
});
test('independent malformed row receipt remains uncertain rather than clearing the reviewed batch',async()=>{
 const ui=mount(async()=>({results:[{row:999,state:'created'}]}));ui.select('tenant-a');await tick();ui.preview();ui.submit();await tick();assert.match(ui.nodes.prospectImportReport.textContent,/uncertain/);assert.equal(ui.nodes.prospectImportConfirm.disabled,false);
});
