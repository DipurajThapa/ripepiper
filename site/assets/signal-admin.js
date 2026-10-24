/* One approved source per managed client; source text remains inert evidence. */
(function(){
 'use strict';
 var RP=window.RP,panel=document.getElementById('signalSourcesPanel'),tenant,generation=0,items=[],selected=null,connection=null,busy=false,review=null;
 if(!panel)return;
 var el=function(id){return document.getElementById(id);},uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 function path(id){return '/api/admin/tenants/'+id+'/signal-source';}
 function note(message){el('signalSourceStatus').textContent=message;}
 function controls(){el('signalSourcePreview').disabled=busy||!connection;el('signalSourceItem').disabled=busy;el('signalSourceReviewed').disabled=busy;el('signalSourceImport').disabled=busy||!selected;}
 function clear(){items=[];selected=null;el('signalSourceItem').innerHTML='';el('signalSourceExcerpt').textContent='';el('signalSourceReviewed').checked=false;controls();}
 function validConnection(j){return j&&j.ok===true&&j.state==='configured_unverified'&&uuid.test(j.sourceId)&&typeof j.synthetic==='boolean'&&j.contactAllowed===false;}
 function validItem(i){return i&&typeof i.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(i.id)&&typeof i.digest==='string'&&/^[a-f0-9]{64}$/.test(i.digest)&&['company','email','sourceUrl','summary','relevance','observedAt','expiresAt'].every(function(k){return typeof i[k]==='string'&&!!i[k].trim()&&i[k].length<=2000;})&&Number.isFinite(Date.parse(i.observedAt))&&Number.isFinite(Date.parse(i.expiresAt))&&i.email.toLowerCase().endsWith('.invalid')===connection.synthetic;}
 function render(){
  connection=null;busy=false;review=null;
  panel.innerHTML='<h3>Ripe Signal: sources and review</h3><p class="hint">Review recent business changes, establish fit, and record outcomes against the exact signal. A change is not buying intent or permission to contact. Signal campaign execution is held until evidence-bound outreach is implemented.</p><p id="signalSourceStatus" role="status">Checking approved source…</p><button class="btn btn-line" id="signalSourcePreview" type="button">Preview approved source</button><label for="signalSourceItem">Source item</label><select id="signalSourceItem" style="min-width:0;max-width:100%"></select><pre id="signalSourceExcerpt" style="white-space:pre-wrap;overflow-wrap:anywhere;min-width:0"></pre><label><input id="signalSourceReviewed" type="checkbox"> I reviewed this source, contact identity and permitted use.</label><button class="btn btn-line" id="signalSourceImport" type="button">Import reviewed Signal</button><button class="btn btn-line" id="signalSourceRefresh" type="button">Refresh client review</button><p class="hint">Import keeps source evidence. Add separately verified industry, market, buyer role and need in Brief &amp; evidence before assessing fit.</p><div id="signalReview" aria-live="polite"><p>Client review is loading. Manual Signal evidence is available in Brief &amp; evidence.</p></div>';
  el('signalSourcePreview').onclick=preview;el('signalSourceItem').onchange=choose;el('signalSourceImport').onclick=save;
  el('signalSourceRefresh').onclick=function(){window.dispatchEvent(new CustomEvent('rp:prospect-review-refresh',{detail:{tenantId:tenant.id}}));};
  clear();var ticket=generation;
  RP.api(path(tenant.id),{operation:'status'}).then(function(j){if(ticket!==generation)return;connection=validConnection(j)?{id:j.sourceId,synthetic:j.synthetic}:null;note(connection?'Approved source configured; preview before importing.':'No verified active source configuration is available. Manual Signal evidence remains available.');controls();}).catch(function(e){if(ticket===generation){note(e.message);controls();}});
 }
 function choose(){selected=items.find(function(i){return i.id===el('signalSourceItem').value;})||null;el('signalSourceReviewed').checked=false;el('signalSourceExcerpt').textContent=selected?'Company: '+selected.company+'\nContact: '+selected.email+'\nSource: '+selected.sourceUrl+'\nObserved: '+selected.observedAt+'\nExpires: '+selected.expiresAt+'\n'+selected.summary+'\nBusiness relevance: '+selected.relevance:'';controls();}
 function preview(){
  if(busy)return;if(!connection){note('An active approved source must be configured before previewing.');return;}
  var id=tenant.id,ticket=generation;clear();busy=true;controls();
  RP.api(path(id),{operation:'preview'}).then(function(j){
   if(ticket!==generation)return;
   if(!j||j.ok!==true||j.sourceId!==connection.id||j.synthetic!==connection.synthetic||j.contactAllowed!==false||!Array.isArray(j.items)||j.items.length>20||!Number.isInteger(j.excluded)||j.excluded<0||j.excluded+j.items.length>20||j.items.some(function(i){return !validItem(i);})||new Set(j.items.map(function(i){return i.id;})).size!==j.items.length)throw Error('Source response could not be verified. Preview again; no import was requested.');
   items=j.items;el('signalSourceItem').innerHTML=items.map(function(i){return '<option value="'+RP.esc(i.id)+'">'+RP.esc(i.company)+' · '+RP.esc(i.observedAt)+'</option>';}).join('');el('signalSourceItem').value=items[0]?items[0].id:'';choose();note(items.length+' source item(s) ready for review; '+j.excluded+' invalid or stale item(s) excluded.');
  }).catch(function(e){if(ticket===generation){clear();note(e.message);}}).finally(function(){if(ticket===generation){busy=false;controls();}});
 }
 function save(){
  if(busy)return;if(!connection||!selected||!el('signalSourceReviewed').checked){note('Preview and review the selected source and contact first.');return;}
  var id=tenant.id,ticket=generation,body={operation:'import',item_id:selected.id,digest:selected.digest,reviewed:true};busy=true;controls();
  RP.api(path(id),body).then(function(j){
   if(ticket!==generation)return;
   if(!j||j.ok!==true||typeof j.lead_id!=='string'||!uuid.test(j.lead_id)||typeof j.observation_id!=='string'||!uuid.test(j.observation_id)||['created','linked','duplicate'].indexOf(j.state)===-1||j.contactAllowed!==false||j.delivery!=='not_sent'||j.tenantId!==id||j.sourceId!==connection.id||j.itemId!==body.item_id||j.digest!==body.digest||j.synthetic!==connection.synthetic)throw Error('Import receipt is uncertain. Some evidence may have been saved. Retry the unchanged source item and reference; do not invent a new item.');
   el('signalSourceReviewed').checked=false;note('Signal evidence imported. No contact permission was granted and no message was sent. Refresh client review to inspect its history.');
  }).catch(function(e){if(ticket===generation){el('signalSourceReviewed').checked=false;note(e.message);}}).finally(function(){if(ticket===generation){busy=false;controls();}});
 }
 function reviewBoard(j){
  review=null;
  if(!j||!Array.isArray(j.results)||typeof j.synthetic!=='boolean'){el('signalReview').textContent='Client review is unavailable. Refresh before making decisions.';return;}
  review=j;var groups=[];
  j.results.forEach(function(r){(r.products||[]).forEach(function(p){if(p.product==='signal'&&p.history&&p.history.length)groups.push({lead:r,p:p});});});
  el('signalReview').innerHTML='<h3>Signal review</h3><p class="hint">'+(j.synthetic?'Synthetic test evidence':'Business evidence')+' · '+groups.filter(function(g){return g.p.reference;}).length+' signals · '+(j.brief?'Brief version '+RP.esc(j.brief.version):'Business brief required')+'. Freshness and fit are separate from contact authority. Recorded outcomes do not establish causality.</p>'+(groups.length?groups.map(function(g,index){var p=g.p,r=g.lead;return '<section class="crm-card" style="margin-top:12px;overflow-wrap:anywhere"><h4>'+RP.esc(r.company)+' · '+RP.esc(p.state)+'</h4><p>'+RP.esc(p.reference?'Signal ID: '+p.reference:'Unattributed historical outcomes')+'</p><p>Business fit: '+RP.esc(r.state)+' · '+RP.esc((r.reasons||[]).join(', '))+'</p><p>'+RP.esc(p.nextAction)+'</p>'+(p.validUntil?'<p>Signal valid until '+RP.esc(p.validUntil)+'</p>':'')+(p.history||[]).map(function(h){return '<blockquote>'+RP.esc(h.excerpt)+'<br><small>'+RP.esc(h.reference)+' · '+RP.esc(h.observedAt)+'</small></blockquote>';}).join('')+(p.outcomes||[]).map(function(o){return '<p>Recorded outcome: '+RP.esc(o.outcome)+' · '+RP.esc(o.reason)+'</p>';}).join('')+'<button type="button" class="btn btn-line" data-workspace="brief" data-signal-review="'+index+'">Review qualification evidence</button>'+(p.reference?'<button type="button" class="btn btn-line" data-workspace="brief" data-signal-outcome="'+index+'">Record outcome for this signal</button>':'')+'</section>';}).join(''):'<p>No reviewed Signal history in this evidence set. Import an approved source or add manual evidence in Brief &amp; evidence.</p>');
  el('signalReview').querySelectorAll('[data-signal-review],[data-signal-outcome]').forEach(function(button){button.onclick=function(){var outcome=button.hasAttribute('data-signal-outcome'),g=groups[Number(outcome?button.dataset.signalOutcome:button.dataset.signalReview)];window.dispatchEvent(new CustomEvent('rp:signal-review-focus',{detail:{tenantId:tenant.id,leadId:g.lead.leadId,signalId:outcome?g.p.reference:null,synthetic:j.synthetic}}));};});
 }
 window.addEventListener('rp:tenant-selected',function(e){generation++;tenant=e.detail;render();});
 window.addEventListener('rp:prospect-review-state',function(e){if(!tenant||e.detail.tenantId!==tenant.id)return;if(e.detail.snapshot)reviewBoard(e.detail.snapshot);else{review=null;el('signalReview').textContent=e.detail.message||'Client review is loading…';}});
})();
