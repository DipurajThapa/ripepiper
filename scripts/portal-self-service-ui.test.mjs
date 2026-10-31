import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const sources=await Promise.all(['revive-setup-admin.js','campaigns-admin.js','portal.js'].map(f=>readFile(new URL('../site/assets/'+f,import.meta.url),'utf8')));
const tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const TENANT='11111111-1111-4111-8111-111111111111';
// Boots the real portal with the real shared modules over a fake DOM, a stubbed Supabase client and a recording API.
async function boot({role,ownership}){
 const nodes={},calls=[],events=[],listeners={},docListeners={};
 const node=id=>nodes[id]??={id,_html:'',textContent:'',value:'',hidden:false,checked:false,dataset:{},set innerHTML(v){this._html=v;for(const m of v.matchAll(/id="([^"]+)"/g))node(m[1]);},get innerHTML(){return this._html;}};
 const ownerTabs=[{dataset:{tab:'account'},hidden:true},{dataset:{tab:'workspace'},hidden:true}];
 const tenant={id:TENANT,name:'Fixture Co',currency:'AED',plan:'engine',package:'revive',ownership,status:'active'};
 const query=table=>{const q={select:()=>q,eq:()=>q,order:()=>q,gte:()=>q,limit:()=>q,then:(ok,no)=>Promise.resolve(table==='memberships'?{data:[{role,tenants:{...tenant}}]}:{data:table==='v_tenant_monthly'?[{month:'2026-10-01'}]:[]}).then(ok,no)};return q;};
 const RP={demo:false,sb:{from:query},esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),badge:String,money:String,num:String,pct:String,date:String,icon:()=>'',monthLabel:String,table:()=>'',tabs(){},
  auth:ready=>setImmediate(()=>ready({id:'user-1',email:'owner@example.test'})),
  api:async(path,body)=>{calls.push({path,body});if(path.endsWith('/onboarding'))return {ok:true,steps:[],connectors:[],next:null,liveSending:false};if(body?.operation==='list')return {ok:true,grants:[],campaigns:[],assets:[],actions:[]};if(body?.operation==='connections')return {ok:true,connections:[]};if(body?.operation==='status')return {ok:true,tenantId:TENANT,ownership,envelope:null,problems:['envelope_missing']};return {ok:true};}};
 const window={RP,addEventListener:(n,f)=>(listeners[n]??=[]).push(f),dispatchEvent:e=>{events.push(e);(listeners[e.type]??[]).forEach(f=>f(e));}};
 const document={getElementById:node,querySelectorAll:s=>s==='[data-owner]'?ownerTabs:[],addEventListener:(t,f)=>(docListeners[t]??=[]).push(f)};
 const ctx={window,document,CustomEvent:class{constructor(type,o){this.type=type;this.detail=o.detail;}},crypto:{randomUUID:()=>TENANT},URL,Blob};
 vm.createContext(ctx);for(const s of sources)vm.runInContext(s,ctx);
 await tick();
 return {nodes,calls,events,ownerTabs};
}
const tenantCalls=calls=>calls.filter(c=>c.path.startsWith('/api/admin/tenants/'));
test('a self-service owner gets the account controls and the panel modules fixed to their own company',async()=>{
 const ui=await boot({role:'owner',ownership:'client_owned'});
 const account=ui.nodes.ownerAccount.innerHTML;
 for(const id of ['grantSave','grantEmail','modeSwitch','endService'])assert.match(account,new RegExp('id="'+id+'"'));
 assert.match(account,/Switch to managed/);assert.equal(ui.nodes.downloadJson.hidden,false);assert.deepEqual(ui.ownerTabs.map(t=>t.hidden),[false,false]);
 assert.equal(ui.events.length,1);assert.equal(ui.events[0].type,'rp:tenant-selected');assert.equal(ui.events[0].detail.id,TENANT);
 assert.match(ui.nodes.campaignPlansPanel.innerHTML,/id="envLoad"/);assert.match(ui.nodes.reviveSetupPanel.innerHTML,/id="connectionsList"/);
 assert.ok(tenantCalls(ui.calls).length>=3);
 for(const c of tenantCalls(ui.calls))assert.ok(c.path.startsWith('/api/admin/tenants/'+TENANT+'/'),c.path);
});
test('a managed owner gets grants, mode, envelope, connections and export without the self-service panels',async()=>{
 const ui=await boot({role:'owner',ownership:'managed'});
 const account=ui.nodes.ownerAccount.innerHTML;
 for(const id of ['grantSave','modeSwitch','envApprove','connectionsList','channelsSave','endService'])assert.match(account,new RegExp('id="'+id+'"'));
 assert.match(account,/Switch to self-service/);assert.equal(ui.nodes.downloadJson.hidden,false);assert.deepEqual(ui.ownerTabs.map(t=>t.hidden),[false,true]);
 assert.equal(ui.events.length,0);assert.equal(ui.nodes.campaignPlansPanel.innerHTML,'');
 assert.deepEqual(tenantCalls(ui.calls).map(c=>c.path.slice(c.path.lastIndexOf('/')+1)).sort(),['connection','envelope','onboarding','operator-grants']);
 for(const c of tenantCalls(ui.calls))assert.ok(c.path.startsWith('/api/admin/tenants/'+TENANT+'/'),c.path);
});
test('a viewer keeps the read-only dashboard: no owner controls, panels or tenant API calls',async()=>{
 for(const ownership of ['managed','client_owned']){
  const ui=await boot({role:'viewer',ownership});
  assert.equal(ui.nodes.ownerAccount.innerHTML,'');assert.equal(ui.nodes.downloadJson.hidden,true);assert.deepEqual(ui.ownerTabs.map(t=>t.hidden),[true,true]);
  assert.equal(ui.events.length,0);assert.equal(tenantCalls(ui.calls).length,0);assert.equal(ui.nodes.campaignPlansPanel.innerHTML,'');
 }
});
test('the portal page carries the owner sections and loads the shared panel modules before portal.js',async()=>{
 const html=await readFile(new URL('../site/portal/index.html',import.meta.url),'utf8');
 for(const id of ['ownerAccount','downloadJson','campaignPlansPanel','reviveSetupPanel','prospectingPanel'])assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1,id);
 for(const f of ['revive-setup-admin.js','campaigns-admin.js','prospecting-admin.js'])assert.ok(html.indexOf(f)>0&&html.indexOf(f)<html.indexOf('src="../assets/portal.js"'),f);
});
