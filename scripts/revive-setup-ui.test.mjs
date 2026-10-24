import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../site/assets/revive-setup-admin.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function mount(api){
 const nodes={},listeners={},events=[];
 function node(id){return nodes[id]||=( {_value:'',get value(){return this._value;},set value(v){this._value=String(v??'');},textContent:'',set innerHTML(v){this._html=v;for(const m of v.matchAll(/id="([^"]+)"/g))node(m[1]);},get innerHTML(){return this._html;}});}
 node('reviveSetupPanel');
 const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const window={RP:{esc,api},addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent:e=>events.push(e)};
 vm.runInNewContext(source,{window,document:{getElementById:id=>nodes[id]||null},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
 return {nodes,events,emit:(name,detail)=>listeners[name]({detail}),select:id=>listeners['rp:tenant-selected']({detail:{id,name:'Fixture '+id}})};
}
const emptyBody=()=>({website:null,supportedClaims:[],sourceInventory:[],relationshipSummary:null,senderName:null,senderEmail:null,ownerId:null,market:null,language:null,timezone:null,salesCapacityPerWeek:null,outcomeWindowDays:null,workingDays:null,startMinute:null,endMinute:null,dailyContactCap:null});
const body=()=>({...emptyBody(),website:{url:'https://client.example.test',reference:'site:reviewed'},sourceInventory:[{type:'interview',reference:'interview:reviewed',rightsReference:'rights:reviewed'}],senderName:'Declared sender',senderEmail:'sender@example.test',ownerId:'staff-id',market:'AE',language:'en-AE',timezone:'Asia/Dubai',salesCapacityPerWeek:5,outcomeWindowDays:30,workingDays:[1,2,3,4,5],startMinute:540,endMinute:1020,dailyContactCap:5});
const context=(tenant='tenant-a',setup=null,brief=1)=>({ok:true,context:{tenantId:tenant,setup,currentBriefVersion:brief,ready:setup?.state==='reviewed',missing:setup?.state==='reviewed'?[]:['reviewed_setup_required'],owners:[{id:'staff-id',label:'Reviewed staff'}],brief:brief?{version:brief,body:{offer:'Existing offer lives only in brief'}}:null},delivery:'not_sent'});
const setup=(b=body(),state='draft')=>({version:2,briefVersion:1,state,body:b,createdBy:'staff-id',createdAt:'2026-10-24T12:00:00Z'});
test('existing admin contains one managed setup panel and loads its module before admin event bindings',async()=>{
 const html=await readFile(new URL('../site/admin/index.html',import.meta.url),'utf8');
 assert.equal([...html.matchAll(/id="reviveSetupPanel"/g)].length,1);assert.equal([...html.matchAll(/src="\.\.\/assets\/revive-setup-admin.js"/g)].length,1);
 assert.ok(html.indexOf('revive-setup-admin.js')<html.indexOf('src="../assets/admin.js"'));
});
test('a pre-brief draft preserves unknowns as null and does not create duplicate offer or buyer fields',async()=>{
 const calls=[];let saved;
 const ui=mount(async(path,payload)=>{calls.push({path,payload});if(payload.operation==='get')return context('tenant-a',saved||null,null);saved={version:1,briefVersion:null,state:'draft',body:payload.body};return {ok:true,tenantId:'tenant-a',version:1,briefVersion:null,state:'draft',ready:false,delivery:'not_sent'};});
 ui.select('tenant-a');await tick();ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});await tick();
 const write=calls.find(c=>c.payload.operation==='save');assert.equal(write.path,'/api/admin/tenants/tenant-a/revive-setup');
 assert.deepEqual(JSON.parse(JSON.stringify(write.payload)),{operation:'save',expectedVersion:0,briefVersion:null,state:'draft',body:emptyBody()});
 assert.doesNotMatch(ui.nodes.reviveSetupPanel.innerHTML,/id="setupOffer|id="setupBuyers/);assert.match(ui.nodes.reviveSetupPanel.innerHTML,/#prospectingPanel/);
 assert.equal(ui.events.length,1);assert.equal(ui.events[0].type,'rp:revive-setup-changed');
 assert.equal(calls.some(c=>/activate|campaigns|revive-run|\/test$/.test(c.path)),false);
});
test('reviewed setup sends its exact loaded version/current brief only after explicit review',async()=>{
 const calls=[],ui=mount(async(path,payload)=>{calls.push(payload);return payload.operation==='get'?context('tenant-a',setup()):{ok:true,tenantId:'tenant-a',version:3,briefVersion:1,state:'reviewed',ready:true,delivery:'not_sent'};});
 ui.select('tenant-a');await tick();const n=ui.nodes;n.setupSaveReviewed.onclick();assert.equal(calls.some(c=>c.operation==='save'),false);assert.match(n.reviveSetupStatus.textContent,/review confirmation/);
 n.setupReviewed.checked=true;n.reviveSetupForm.oninput({target:{id:'setupSenderName'}});assert.equal(n.setupReviewed.checked,false);
 n.setupReviewed.checked=true;n.reviveSetupForm.oninput({target:{id:'setupReviewed'}});assert.equal(n.setupReviewed.checked,true);
 n.setupSaveReviewed.onclick();await tick();const write=calls.find(c=>c.operation==='save');assert.equal(write.expectedVersion,2);assert.equal(write.briefVersion,1);assert.equal(write.state,'reviewed');assert.equal(write.body.startMinute,540);assert.equal(write.body.endMinute,1020);assert.deepEqual(JSON.parse(JSON.stringify(write.body.workingDays)),[1,2,3,4,5]);
});
test('all ten loaded source and claim rows survive a subsequent save without truncation',async()=>{
 const b=body();b.sourceInventory=Array.from({length:10},(_,i)=>({type:'file',reference:'file:'+i,rightsReference:'rights:'+i}));b.supportedClaims=Array.from({length:10},(_,i)=>({text:'Supported claim '+i,reference:'claim:'+i}));
 const calls=[],ui=mount(async(path,payload)=>{calls.push(payload);return payload.operation==='get'?context('tenant-a',setup(b)):{ok:true,tenantId:'tenant-a',version:3,briefVersion:1,state:'draft',ready:false,delivery:'not_sent'};});
 ui.select('tenant-a');await tick();assert.equal(ui.nodes.setupSourceRow9.hidden,false);assert.equal(ui.nodes.setupClaimRow9.hidden,false);ui.nodes.setupSourceAdd.onclick();ui.nodes.setupClaimAdd.onclick();ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});await tick();
 const saved=calls.find(c=>c.operation==='save').body;assert.deepEqual(JSON.parse(JSON.stringify(saved.sourceInventory)),b.sourceInventory);assert.deepEqual(JSON.parse(JSON.stringify(saved.supportedClaims)),b.supportedClaims);
});
test('row removal is deliberate, clears only the last row and invalidates review confirmation',async()=>{
 const b=body();b.sourceInventory.push({type:'email',reference:'second',rightsReference:'second-rights'});
 const calls=[],ui=mount(async(path,payload)=>{calls.push(payload);return payload.operation==='get'?context('tenant-a',setup(b)):{ok:true,tenantId:'tenant-a',version:3,briefVersion:1,state:'draft',ready:false,delivery:'not_sent'};});
 ui.select('tenant-a');await tick();const n=ui.nodes;n.setupReviewed.checked=true;n.setupSourceRemove.onclick();assert.equal(n.setupReviewed.checked,false);assert.equal(n.setupSourceRow1.hidden,true);assert.equal(n.setupSourceReference1.value,'');n.reviveSetupForm.onsubmit({preventDefault(){}});await tick();assert.equal(calls.find(c=>c.operation==='save').body.sourceInventory.length,1);
});
test('late loads and saves cannot expose or modify a different selected tenant',async()=>{
 let finishGet,finishSave;const calls=[];
 const ui=mount((path,payload)=>{calls.push({path,payload});if(path.includes('tenant-a')&&payload.operation==='get')return new Promise(r=>finishGet=r);if(payload.operation==='save')return new Promise(r=>finishSave=r);return Promise.resolve(context('tenant-b',setup()));});
 ui.select('tenant-a');ui.select('tenant-b');await tick();const privateBody=body();privateBody.senderName='PRIVATE previous tenant';finishGet(context('tenant-a',setup(privateBody)));await tick();assert.equal(ui.nodes.setupSenderName.value,'Declared sender');
 ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});ui.select('tenant-c');await tick();finishSave({ok:true,tenantId:'tenant-b',version:3,briefVersion:1,state:'draft',ready:false,delivery:'not_sent'});await tick();assert.equal(ui.events.length,0);assert.doesNotMatch(ui.nodes.reviveSetupStatus.textContent,/PRIVATE/);
});
test('malformed read receipts, oversized arrays and failed connections cannot enable writes',async()=>{
 const malformed=[{},context('foreign'),context('tenant-a',setup({...body(),supportedClaims:'not-an-array'})),context('tenant-a',setup({...body(),sourceInventory:Array.from({length:11},()=>body().sourceInventory[0])}))];
 for(const response of malformed){const calls=[],ui=mount(async(path,payload)=>{calls.push(payload);return response;});ui.select('tenant-a');await tick();ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.operation==='save'),false);assert.equal(ui.nodes.reviveSetupFields.disabled,true);}
 const ui=mount(async()=>{throw Error('Sample mode is not connected');});ui.select('tenant-a');await tick();assert.match(ui.nodes.reviveSetupStatus.textContent,/Sample mode/);assert.equal(ui.nodes.setupSaveDraft.disabled,true);
});
test('uncertain or changed save acknowledgement requires reload and never emits a successful setup change',async()=>{
 for(const receipt of [{},{tenantId:'tenant-a',version:9,briefVersion:1,state:'draft',ready:false,delivery:'not_sent'},{tenantId:'tenant-a',version:3,briefVersion:1,state:'draft',ready:'false',delivery:'not_sent'}]){
  const calls=[],ui=mount(async(path,payload)=>{calls.push(payload);return payload.operation==='get'?context('tenant-a',setup()):receipt;});ui.select('tenant-a');await tick();ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});await tick();ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});assert.equal(calls.filter(c=>c.operation==='save').length,1);assert.equal(ui.events.length,0);assert.equal(ui.nodes.reviveSetupFields.disabled,true);
 }
});
test('business brief changes invalidate the loaded setup before another save',async()=>{
 const calls=[],ui=mount(async(path,payload)=>{calls.push(payload);return context('tenant-a',setup());});ui.select('tenant-a');await tick();ui.emit('rp:business-brief-changed',{tenantId:'tenant-a'});ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.operation==='save'),false);assert.equal(ui.nodes.reviveSetupFields.disabled,true);
});
test('a late setup load cannot restore readiness after a business brief change',async()=>{
 let finish;const calls=[],ui=mount((path,payload)=>{calls.push(payload);return new Promise(resolve=>finish=resolve);});ui.select('tenant-a');ui.emit('rp:business-brief-changed',{tenantId:'tenant-a'});finish(context('tenant-a',setup(body(),'reviewed')));await tick();assert.equal(ui.nodes.reviveSetupFields.disabled,true);assert.equal(ui.nodes.setupSenderName.value,'');assert.match(ui.nodes.reviveSetupStatus.textContent,/business brief changed/);ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.operation==='save'),false);
});
test('a late setup save receipt cannot unlock or publish success after a business brief change',async()=>{
 let finish;const calls=[],ui=mount((path,payload)=>{calls.push(payload);return payload.operation==='get'?Promise.resolve(context('tenant-a',setup())):new Promise(resolve=>finish=resolve);});ui.select('tenant-a');await tick();ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});ui.emit('rp:business-brief-changed',{tenantId:'tenant-a'});finish({ok:true,tenantId:'tenant-a',version:3,briefVersion:1,state:'draft',ready:false,delivery:'not_sent'});await tick();assert.equal(ui.nodes.reviveSetupFields.disabled,true);assert.equal(ui.events.length,0);assert.equal(calls.filter(c=>c.operation==='get').length,1);assert.match(ui.nodes.reviveSetupStatus.textContent,/business brief changed/);
});
test('an unchanged same-version save receipt is accepted without retrying the write',async()=>{
 const calls=[],ui=mount(async(path,payload)=>{calls.push(payload);return payload.operation==='get'?context('tenant-a',setup()):{ok:true,tenantId:'tenant-a',version:2,briefVersion:1,state:'draft',ready:false,delivery:'not_sent'};});ui.select('tenant-a');await tick();ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});await tick();assert.equal(ui.events.length,1);assert.equal(calls.filter(c=>c.operation==='save').length,1);assert.equal(ui.nodes.setupSaveDraft.disabled,false);
});
test('partial source provenance is kept in the form with a clear error instead of submitted or silently removed',async()=>{
 const calls=[],ui=mount(async(path,payload)=>{calls.push(payload);return context();});ui.select('tenant-a');await tick();ui.nodes.setupSourceReference0.value='known-source';ui.nodes.reviveSetupForm.onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.operation==='save'),false);assert.equal(ui.nodes.setupSourceReference0.value,'known-source');assert.match(ui.nodes.reviveSetupStatus.textContent,/Source row 1 needs both/);
});
test('untrusted client names, owner labels and saved values are escaped or assigned as text values',async()=>{
 const b=body();b.senderName='<script>PRIVATE</script>';const c=context('tenant-a',setup(b));c.context.owners[0].label='Owner <img onerror="bad()">';
 const ui=mount(async()=>c);ui.select('<img onerror="bad()">');c.context.tenantId='<img onerror="bad()">';await tick();
 assert.doesNotMatch(ui.nodes.reviveSetupPanel.innerHTML,/<img /);assert.doesNotMatch(ui.nodes.setupOwner.innerHTML,/<img /);assert.equal(ui.nodes.setupSenderName.value,'<script>PRIVATE</script>');
});
