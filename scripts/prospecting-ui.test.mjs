import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../site/assets/prospecting-admin.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function mount(api) {
  const nodes={},listeners={};
  function node(id){return nodes[id] ||= {value:'',textContent:'',_html:'',set innerHTML(v){this._html=v; for(const m of v.matchAll(/id="([^"]+)"/g))node(m[1]);},get innerHTML(){return this._html;}};}
  node('prospectingPanel');
  const RP={esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api};
  vm.runInNewContext(source,{window:{RP,addEventListener:(name,fn)=>listeners[name]=fn},document:{getElementById:node}});
  return {nodes,select:(id)=>{listeners['rp:tenant-selected']({detail:{id,name:'Fixture '+id}});nodes.prospectMode.value='synthetic';}};
}
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
