import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../site/assets/campaigns-admin.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const listing=()=>({campaigns:[],assets:[],actions:[],leads:[],sources:[],draftLeads:[],draftSources:[]});
function mount(handler){
 const nodes={},listeners={},calls=[];
 function make(id){return nodes[id]??={_value:'',get value(){return this._value;},set value(v){this._value=String(v??'');},checked:false,textContent:'',_html:'',set innerHTML(html){this._html=html;for(const match of html.matchAll(/id="([^"]+)"/g))make(match[1]);},get innerHTML(){return this._html;}};}
 make('campaignPlansPanel');
 const RP={esc:v=>String(v??'').replaceAll('<','&lt;'),api:async(path,body)=>{calls.push({path,body});return body.operation==='list'?listing():handler(path,body);}};
 vm.runInNewContext(source,{crypto,window:{RP,addEventListener:(event,fn)=>listeners[event]=fn},document:{getElementById:id=>nodes[id]??null}});
 return{nodes,calls,select:id=>listeners['rp:tenant-selected']({detail:{id,name:'QA '+id}})};
}
const draftContext={leadId:'qa-lead',sourceId:'qa-source',reviewVersion:3,briefVersion:2,businessName:'QA tenant-a',snapshot:'a'.repeat(32),expiresAt:'2026-10-24T00:00:00Z'};
const proposal=()=>({draftContext,steps:[{offsetHours:0,subject:'Reviewed proposal',body:'Reviewed cohort offer',evidenceReference:'qa-source'}],basis:{briefVersion:2,briefReference:'qa-brief',sourceReference:'qa-source',sourceExcerpt:'<img src=x onerror=bad()>'},strategy:'Human reviewed cohort copy',bookingVerification:'not_requested'});
function fields(nodes){nodes.draftLead.value='qa-lead';nodes.draftSource.value='qa-source';nodes.draftSender.value='QA sender';nodes.campaignPurpose.value='reactivation';nodes.campaignMarket.value='AE';}
test('independent strict DOM bindings require actual draft/report markup and preparation cannot save or approve',async()=>{
 const ui=mount(async()=>({proposal:proposal()}));assert.doesNotThrow(()=>ui.select('tenant-a'));await tick();
 for(const id of ['prepareReviveDraft','draftLead','draftSource','loadReviveReport','reviveReportText','reviveRun'])assert.ok(ui.nodes[id],id+' must exist in emitted markup');
 fields(ui.nodes);ui.nodes.prepareReviveDraft.onclick();await tick();
 assert.deepEqual(ui.calls.map(c=>c.body.operation),['list','draft']);assert.equal(ui.nodes.messageBody0.value,'Reviewed cohort offer');assert.equal(ui.nodes.draftBasis.textContent.includes('<img src=x'),true);assert.match(ui.nodes.draftStatus.textContent,/Proposal only/);
});
test('independent UI preserves exact provenance and operator edits on explicit existing save, with no authority grant',async()=>{
 const ui=mount(async(_path,body)=>body.operation==='draft'?{proposal:proposal()}:{id:body.campaign_id});ui.select('tenant-a');await tick();fields(ui.nodes);ui.nodes.prepareReviveDraft.onclick();await tick();ui.nodes.messageBody0.value='Human corrected final text';ui.nodes.campaignDraft.oninput();ui.nodes.campaignDraft.onsubmit({preventDefault(){}});await tick();
 const save=ui.calls.find(c=>c.body.operation==='save');assert.ok(save);assert.equal(save.body.body.steps[0].body,'Human corrected final text');assert.equal(JSON.stringify(save.body.body.draftContext),JSON.stringify(draftContext));assert.equal(ui.calls.some(c=>['approve','rights','queue'].includes(c.body.operation)),false);
});
test('independent draft setting change cannot silently drop generated provenance and save stale proposal',async()=>{
 const ui=mount(async()=>({proposal:proposal()}));ui.select('tenant-a');await tick();fields(ui.nodes);ui.nodes.prepareReviveDraft.onclick();await tick();ui.nodes.draftSender.value='Changed sender';ui.nodes.draftSender.oninput();ui.nodes.campaignDraft.onsubmit({preventDefault(){}});await tick();assert.equal(ui.calls.some(c=>c.body.operation==='save'),false);assert.match(ui.nodes.campaignError.textContent,/Prepare a new proposal/);
});
test('independent delayed report cannot populate another tenant and initiates no campaign operation',async()=>{
 let finish;const ui=mount(()=>new Promise(resolve=>finish=resolve));ui.select('tenant-a');await tick();ui.nodes.loadReviveReport.onclick();ui.select('tenant-b');await tick();finish({report:{generatedAt:'PRIVATE_OLD_ACCOUNT'}});await tick();assert.doesNotMatch(ui.nodes.reviveReportStatus.textContent,/PRIVATE/);assert.equal(ui.nodes.reviveReportText.textContent,'');assert.equal(ui.calls.some(c=>['save','approve','rights','queue'].includes(c.body.operation)),false);
});
