import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../site/assets/campaigns-admin.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const nodes={},listeners={},calls=[];
 function make(id){return nodes[id]??={id,value:'',checked:false,selectedOptions:[],textContent:'',_html:'',get innerHTML(){return this._html;},set innerHTML(text){this._html=text;for(const found of text.matchAll(/id="([^"]+)"/g))make(found[1]);}};}
 make('campaignPlansPanel');
 const context={proposalId:'123',canonicalNeed:'lead follow-up',leadId:'lead-a',sourceId:'source-a',briefVersion:1,reviewVersion:1,businessName:'QA',snapshot:'a'.repeat(32),expiresAt:'2099-01-01T00:00:00.000Z'};
 const listing={campaigns:[],assets:[],actions:[],leads:[],sources:[],draftLeads:[],draftSources:[],audienceCandidates:[{leadId:'lead-a',email:'a@example.invalid',company:'QA',reviewVersion:1,snapshot:'a'.repeat(32),expiresAt:'2099-01-01T00:00:00.000Z'}]};
 const RP={esc:value=>String(value??''),api:async(path,body)=>{calls.push({path,body});if(body.operation==='list')return listing;if(body.operation==='draft')return {proposal:{steps:[{offsetHours:0,subject:'Reviewed need',body:'Reviewed offer',evidenceReference:'QA'}],draftContext:context,basis:{briefVersion:1,briefReference:'QA',sourceReference:'source-a',sourceExcerpt:'Reviewed need'},strategy:'Reviewed cohort',bookingVerification:'not_requested'}};return {id:body.campaign_id};}};
 vm.runInNewContext(code,{crypto,window:{RP,addEventListener:(name,callback)=>listeners[name]=callback},document:{getElementById:id=>nodes[id]??null}});
 return {nodes,calls,select:()=>listeners['rp:tenant-selected']({detail:{id:'tenant-a',name:'QA'}})};
}
function selectReviewed(nodes){nodes.campaignAudience.selectedOptions=[{value:'lead-a'}];nodes.campaignAudienceConfirmed.checked=true;}
test('copy and scope edits clear exact-copy audience confirmation before save',async()=>{
 const ui=fixture();ui.select();await tick();for(const id of ['campaignAudience','campaignAudienceConfirmed','campaignAudienceGroup'])assert.ok(ui.nodes[id],id+' must be emitted');
 selectReviewed(ui.nodes);ui.nodes.messageBody0.value='Changed offer';ui.nodes.campaignDraft.oninput({target:ui.nodes.messageBody0});assert.equal(ui.nodes.campaignAudienceConfirmed.checked,false);
 selectReviewed(ui.nodes);ui.nodes.campaignPurpose.value='Changed purpose';ui.nodes.campaignDraft.oninput({target:ui.nodes.campaignPurpose});assert.equal(ui.nodes.campaignAudienceConfirmed.checked,false);
 ui.nodes.campaignAudienceConfirmed.checked=true;ui.nodes.campaignDraft.oninput({target:ui.nodes.campaignAudienceConfirmed});assert.equal(ui.nodes.campaignAudienceConfirmed.checked,true,'confirmation must not clear itself on a bubbling input');
});
test('replacing message copy with a newly generated proposal requires a fresh audience confirmation',async()=>{
 const ui=fixture();ui.select();await tick();selectReviewed(ui.nodes);Object.assign(ui.nodes.draftLead,{value:'lead-a'});ui.nodes.draftSource.value='source-a';ui.nodes.draftSender.value='QA sender';ui.nodes.draftCount.value='1';
 ui.nodes.prepareReviveDraft.onclick();await tick();assert.equal(ui.nodes.messageBody0.value,'Reviewed offer');assert.equal(ui.nodes.campaignAudienceConfirmed.checked,false);assert.equal(ui.calls.some(c=>['save','approve','rights','queue'].includes(c.body.operation)),false);
});
