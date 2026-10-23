/* One approved source per managed client; source text never becomes active markup. */
(function(){
 'use strict';
 var RP=window.RP,panel=document.getElementById('signalSourcesPanel'),tenant,generation=0,items=[],selected=null,ready=false;
 if(!panel)return;
 var el=function(id){return document.getElementById(id);};
 function path(id){return '/api/admin/tenants/'+id+'/signal-source';}
 function note(message){el('signalSourceStatus').textContent=message;}
 function render(){
  items=[];selected=null;ready=false;
  panel.innerHTML='<h3>Approved Signal source</h3><p class="hint">Acquire up to 20 recent changes from the source configured for this client. Review source claims, contact identity and permitted use before import. A change is not buying intent or permission to contact.</p><p id="signalSourceStatus" role="status"></p><button class="btn btn-line" id="signalSourcePreview" type="button">Preview approved source</button><label for="signalSourceItem">Source item</label><select id="signalSourceItem" style="min-width:0;max-width:100%"></select><pre id="signalSourceExcerpt" style="white-space:pre-wrap;overflow-wrap:anywhere;min-width:0"></pre><label><input id="signalSourceReviewed" type="checkbox"> I reviewed this source, contact identity and permitted use.</label><button class="btn btn-line" id="signalSourceImport" type="button">Import reviewed Signal</button><button class="btn btn-line" id="signalSourceRefresh" type="button">Refresh client review</button>';
  el('signalSourcePreview').onclick=preview;el('signalSourceItem').onchange=choose;el('signalSourceImport').onclick=save;
  el('signalSourceRefresh').onclick=function(){window.dispatchEvent(new CustomEvent('rp:tenant-selected',{detail:tenant}));};
  var ticket=generation;
  RP.api(path(tenant.id),{operation:'status'}).then(function(j){if(ticket!==generation)return;ready=j.state==='configured_unverified';note(ready?'Approved source configured; preview before importing.':'No active approved source is connected. Manual Signal evidence remains available.');}).catch(function(e){if(ticket===generation)note(e.message);});
 }
 function choose(){selected=items.find(function(i){return i.id===el('signalSourceItem').value;})||null;el('signalSourceReviewed').checked=false;el('signalSourceExcerpt').textContent=selected?'Company: '+selected.company+'\nContact: '+selected.email+'\nSource: '+selected.sourceUrl+'\nObserved: '+selected.observedAt+'\nExpires: '+selected.expiresAt+'\n'+selected.summary+'\nBusiness relevance: '+selected.relevance:'';}
 function preview(){
  if(!ready){note('An active approved source must be configured before previewing.');return;}
  var id=tenant.id,ticket=generation;ready=false;selected=null;items=[];el('signalSourceExcerpt').textContent='';el('signalSourceReviewed').checked=false;
  RP.api(path(id),{operation:'preview'}).then(function(j){if(ticket!==generation)return;if(!Array.isArray(j.items)){note('Source unavailable; no Signal was imported.');return;}items=j.items;ready=true;el('signalSourceItem').innerHTML=items.map(function(i){return '<option value="'+RP.esc(i.id)+'">'+RP.esc(i.company)+' · '+RP.esc(i.observedAt)+'</option>';}).join('');el('signalSourceItem').value=items[0]?items[0].id:'';choose();note(items.length+' source item(s) ready for review; '+j.excluded+' invalid or stale item(s) excluded.');}).catch(function(e){if(ticket===generation){ready=true;note(e.message);}});
 }
 function save(){
  if(!ready||!selected||!el('signalSourceReviewed').checked){note('Preview and review the selected source and contact first.');return;}
  var id=tenant.id,ticket=generation,body={operation:'import',item_id:selected.id,digest:selected.digest,reviewed:true};ready=false;
  RP.api(path(id),body).then(function(j){if(ticket!==generation)return;ready=true;el('signalSourceReviewed').checked=false;if(j.ok&&j.lead_id){note('Signal evidence imported. No contact permission was granted and no message was sent. Refresh client review to inspect its history.');}else{note('Import was not confirmed; preview the source again.');}}).catch(function(e){if(ticket===generation){ready=true;note(e.message);}});
 }
 window.addEventListener('rp:tenant-selected',function(e){generation++;tenant=e.detail;render();});
})();
