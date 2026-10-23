import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../site/assets/campaigns-admin.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function mount(api){
 const nodes={},listeners={};
 function node(id){return nodes[id] ||= {_value:'',get value(){return this._value;},set value(v){this._value=String(v??'');},textContent:'',set innerHTML(v){this._html=v;for(const m of v.matchAll(/id="([^"]+)"/g))node(m[1]);},get innerHTML(){return this._html;}};}
 node('campaignPlansPanel');
 vm.runInNewContext(source,{crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},window:{RP:{esc:s=>String(s??'').replaceAll('<','&lt;'),api},addEventListener:(name,fn)=>listeners[name]=fn},document:{getElementById:node}});
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
