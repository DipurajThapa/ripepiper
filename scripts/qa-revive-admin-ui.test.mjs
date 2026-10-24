import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../site/assets/admin.js',import.meta.url),'utf8');
const start=source.indexOf('  function tenantDetail(t)');
const end=source.indexOf('  function tenantSubmit(form)',start);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

for(const status of ['onboarding','paused'])test(`real ${status} account loads its activation brief through the configured Supabase client`,async()=>{
 const nodes={},calls=[],tenant={id:'11111111-1111-4111-8111-111111111111',name:'Synthetic QA account',status,currency:'AED'};
 const node=id=>nodes[id]??={innerHTML:'',textContent:'',value:'',disabled:true};
 const result=Promise.resolve({data:[{version:4}]});
 const chain={select(){return this;},eq(...args){calls.push(args);return this;},order(){return this;},limit(){return result;}};
 const context={t:tenant,cur:{tenant:null},$:node,RP:{demo:false,esc:String,sb:{from(table){calls.push(table);return chain;}}},window:{dispatchEvent(){}},CustomEvent:class{constructor(name,options){this.type=name;this.detail=options.detail;}}};
 assert.doesNotThrow(()=>vm.runInNewContext(source.slice(start,end)+'\ntenantDetail(t);',context));
 await tick();assert.equal(calls[0],'business_briefs');assert.deepEqual(calls[1],['tenant_id',tenant.id]);
 assert.equal(node('activationBriefVersion').value,4);assert.equal(node('activateAccount').disabled,false);
});
