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
