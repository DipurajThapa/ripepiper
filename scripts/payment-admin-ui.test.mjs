import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../site/assets/admin.js',import.meta.url),'utf8');
const start=source.indexOf('  function proposalDetail(p)'),end=source.indexOf('  function addQuoteItem()',start);
const proposal='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',payment='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tick=()=>new Promise(r=>setImmediate(r));
const row=(id=payment,p=proposal)=>({id,proposal_id:p,provider:'stripe',status:'paid'});
const receipt=(id=payment,p=proposal)=>({payment_id:id,proposal_id:p,quote_id:null,status:'paid',settled_at:'2026-10-23T12:00:00Z',checkout_phase:'bound',review_disposition:null,notification_disposition:{state:'human_review_required',key:'billing:'+id,client_purpose:'advance_received',client_recipient_reference:'proposal:'+p,admin_recipient_reference:'configured_admin',automatic_delivery:false}});
function mount({list=async()=>({data:[row()],error:null}),api=async()=>receipt(),demo=false}={}){
 const nodes={},calls=[];
 function node(id){return nodes[id]??= {id,value:'',disabled:false,textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},click(){return this.listeners.click?.();},change(){return this.listeners.change?.();},set innerHTML(html){this.html=html;for(const match of html.matchAll(/id="([^"]+)"/g))nodes[match[1]]=nodeBase(match[1]);},get innerHTML(){return this.html??'';}};}
 function nodeBase(id){delete nodes[id];return node(id);}
 const sb={from(table){const call={table};calls.push(call);return {select(columns){call.columns=columns;return this;},eq(key,value){call.filter={key,value};return this;},order(key,value){call.order={key,value};return this;},limit(n){call.limit=n;return Promise.resolve().then(()=>list(call));}};}};
 const RP={demo,sb,esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),money:String,badge:String,markdown:String,api:(path,body)=>{calls.push({path,body});return api(path,body);}};
 const ctx={cur:{proposal:null},RP,$:node,addQuoteItem(){}};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const choose=id=>ctx.proposalDetail({id,status:'approved',client_email:'fixture@example.invalid',currency:'AED',fixed_amount:500,advance_amount:50,advance_pct:10,content_md:'Fixture'});
 choose(proposal);return{nodes,calls,choose,RP};
}
test('existing proposal payment review is scoped/bounded and reads held references without execution',async()=>{
 const ui=mount();ui.nodes.propPaymentsLoad.click();await tick();assert.deepEqual(ui.calls[0].filter,{key:'proposal_id',value:proposal});assert.equal(ui.calls[0].table,'payments');assert.equal(ui.calls[0].columns,'id,proposal_id,provider,status');assert.equal(ui.calls[0].limit,20);
 ui.nodes.propPayment.value=payment;ui.nodes.propPayment.change();ui.nodes.propPaymentInspect.click();await tick();assert.equal(ui.calls.at(-1).path,'/api/admin/payments/'+payment+'/receipt');assert.equal(JSON.stringify(ui.calls.at(-1).body),'{}');assert.match(ui.nodes.propPaymentReview.textContent,/Notification held for human review/);assert.match(ui.nodes.propPaymentReview.textContent,new RegExp('billing:'+payment));assert.match(ui.nodes.propPaymentReview.textContent,/before any replacement/);assert.equal(ui.calls.some(c=>c.path&&!c.path.endsWith('/receipt')),false);
});
test('late payment lists and receipts cannot populate a different or rerendered proposal',async()=>{
 let finish;const listUi=mount({list:()=>new Promise(resolve=>finish=resolve)});listUi.nodes.propPaymentsLoad.click();await tick();listUi.choose(other);finish({data:[row()],error:null});await tick();assert.doesNotMatch(listUi.nodes.propPayment.innerHTML,/aaaa/);
 for(const target of [other,proposal]){let done;const ui=mount({api:()=>new Promise(resolve=>done=resolve)});ui.nodes.propPaymentsLoad.click();await tick();ui.nodes.propPayment.value=payment;ui.nodes.propPayment.change();ui.nodes.propPaymentInspect.click();ui.choose(target);done(receipt());await tick();assert.equal(ui.nodes.propPaymentReview.textContent,'');}
});
test('switching selected payment rejects the previous receipt result',async()=>{
 let finish;const ui=mount({list:async()=>({data:[row(),row(second)],error:null}),api:()=>new Promise(resolve=>finish=resolve)});ui.nodes.propPaymentsLoad.click();await tick();ui.nodes.propPayment.value=payment;ui.nodes.propPayment.change();ui.nodes.propPaymentInspect.click();ui.nodes.propPayment.value=second;ui.nodes.propPayment.change();finish(receipt());await tick();assert.equal(ui.nodes.propPaymentReview.textContent,'');
});
test('foreign/malformed or failed loads disable inspection without an API call',async()=>{
 for(const list of [async()=>({data:[row(payment,other)]}),async()=>({data:[{...row(),provider:'<img src=x onerror=alert(1)>'}]}),async()=>({data:[row(),row()]}),async()=>({error:{message:'PRIVATE'},data:null}),async()=>{throw Error('PRIVATE');}]){
  const ui=mount({list});ui.nodes.propPaymentsLoad.click();await tick();assert.equal(ui.nodes.propPaymentInspect.disabled,true);assert.equal(ui.nodes.propPayment.disabled,true);ui.nodes.propPaymentInspect.click();assert.equal(ui.calls.filter(c=>c.path).length,0);assert.doesNotMatch(ui.nodes.propPaymentReview.textContent,/PRIVATE|<img/);
 }
});
test('malformed/foreign receipt and transport errors never claim notification success or leave an enabled action',async()=>{
 for(const api of [async()=>({}),async()=>receipt(payment,other),async()=>({...receipt(),notification_disposition:{...receipt().notification_disposition,automatic_delivery:true}}),async()=>({...receipt(),checkout_phase:'<script>PRIVATE</script>'}),async()=>{throw Error('PRIVATE');}]){
  const ui=mount({api});ui.nodes.propPaymentsLoad.click();await tick();ui.nodes.propPayment.value=payment;ui.nodes.propPayment.change();ui.nodes.propPaymentInspect.click();await tick();assert.equal(ui.nodes.propPaymentInspect.disabled,true);assert.equal(ui.nodes.propPayment.disabled,true);assert.match(ui.nodes.propPaymentReview.textContent,/could not be verified/);assert.doesNotMatch(ui.nodes.propPaymentReview.textContent,/PRIVATE|<script>|Notification held/);
 }
});
test('creating, legacy and rejected records display safe operator guidance with exact reference',async()=>{
 for(const checkout_phase of ['creating','legacy_requires_review']){const ui=mount({api:async()=>({...receipt(),status:'pending',settled_at:null,checkout_phase,notification_disposition:null,review_disposition:{state:'human_review_required',reason:'target_not_open'}})});ui.nodes.propPaymentsLoad.click();await tick();ui.nodes.propPayment.value=payment;ui.nodes.propPayment.change();ui.nodes.propPaymentInspect.click();await tick();assert.match(ui.nodes.propPaymentReview.textContent,/Rejected event held for human review/);assert.match(ui.nodes.propPaymentReview.textContent,new RegExp(payment));assert.match(ui.nodes.propPaymentReview.textContent,/Check the existing provider checkout/);}
});
test('sample mode blocks payment reads and receipt calls even if handlers are invoked',async()=>{const ui=mount({demo:true});assert.equal(ui.nodes.propPaymentsLoad.disabled,true);ui.nodes.propPaymentsLoad.click();ui.nodes.propPayment.value=payment;ui.nodes.propPayment.change();ui.nodes.propPaymentInspect.click();await tick();assert.equal(ui.calls.length,0);assert.match(ui.nodes.propPaymentReview.textContent,/Sample mode|^$/);});
