/* Shared prospect review in the existing Clients panel. All persistence uses staff APIs. */
(function () {
  "use strict";
  var RP = window.RP, panel = document.getElementById("prospectingPanel"), tenant, generation = 0, version = 0, ready = false, snapshot = null;
  var fields = ["industries", "markets", "roles", "needs", "excludedIndustries"];
  var labels = ["Target industries", "Target markets", "Buyer roles", "Needs we address", "Excluded industries"];
  var esc = RP.esc, el = function(id) { return document.getElementById(id); };
  function error(message) { el("prospectError").textContent = message; }
  function input(id,label,type) { return '<div class="field"><label for="'+id+'">'+label+'</label><input id="'+id+'" type="'+(type||'text')+'"></div>'; }
  function render() {
    ready = false; version = 0; snapshot = null;
    panel.innerHTML = '<h3>Business brief and prospect review: '+esc(tenant.name)+'</h3><p class="hint">Review sourced facts before recording them. Qualification dimensions are shown separately. Buying readiness and contact rights need their own evidence. This review does not send messages.</p>'+
      '<label for="prospectMode">Evidence set</label><select id="prospectMode"><option value="synthetic">Synthetic test contacts</option><option value="business">Existing business contacts</option></select><button class="btn btn-line" type="button" id="prospectRefresh">Refresh review</button><p id="prospectError" class="err" role="alert"></p><p id="briefVersion" role="status">Loading brief…</p>'+
      '<details><summary>Import permitted contacts</summary><form id="prospectImportForm" class="stack"><label for="prospectImportRows">Paste up to 50 spreadsheet rows, without a header: email, company, source reference, permitted-use reference, observed date (YYYY-MM-DD). Separate columns with tabs.</label><textarea id="prospectImportRows" rows="6" required></textarea><button class="btn btn-line" type="submit">Validate and import</button><p id="prospectImportReport" role="status"></p></form></details><button id="prospectExport" class="btn btn-line" type="button">Download internal review</button><p id="productMetrics" role="status"></p><details><summary>Business brief</summary><form id="briefForm" class="stack"><div class="field"><label for="briefOffer">Offer and problem solved</label><textarea id="briefOffer" maxlength="500" required></textarea></div><div class="form-grid">'+
      fields.map(function(f,i){return input('brief_'+f,labels[i]+' (comma-separated)');}).join('')+ ['industry','market','role','need'].map(function(f){return input('alias_'+f,f+' aliases: target = alias; target = alias');}).join('')+input('briefAge','Evidence validity in days','number')+input('briefReference','Brief source reference')+input('briefObserved','Source date','date')+'</div><div class="field"><label for="briefExcerpt">Supporting source excerpt or interview note</label><textarea id="briefExcerpt" maxlength="2000" required></textarea></div><button class="btn btn-dark" type="submit">Save reviewed brief version</button></form></details>'+
      '<details><summary>Add reviewed prospect evidence</summary><form id="evidenceForm" class="stack"><div class="field"><label for="evidenceLead">Existing lead</label><select id="evidenceLead"></select></div><div class="form-grid">'+input('evidenceSource','Source type, e.g. client interview')+input('evidenceReference','Unique dated source reference')+input('evidenceRights','Permitted-use reference')+input('evidenceObserved','Observation date','date')+
      ['industry','market','role','need'].map(function(f){return input('evidence_'+f,f.charAt(0).toUpperCase()+f.slice(1)+' (leave unknown blank)');}).join('')+'</div><div class="field"><label for="evidenceExcerpt">Source excerpt containing the recorded values</label><textarea id="evidenceExcerpt" maxlength="2000" required></textarea></div><button class="btn btn-line" type="submit">Record reviewed evidence</button></form></details>'+conversationForm()+productForm()+inboxForm()+'<div id="prospectResults" aria-live="polite"></div>';
    el('inboxCheck').onclick=checkInbox;
    el('inboxList').onclick=listInbox;
    el('inboxPreview').onclick=previewInbox;
    el('inboxImport').onclick=importInbox;
    el('inboxMessage').onchange=function(){inboxSelection=null;el('inboxExcerpt').textContent='';el('inboxReviewed').checked=false;};
    el('briefAge').value = '90';
    el('prospectImportForm').onsubmit=importLeads;
    el('prospectExport').onclick=exportReview;
    el('conversationOwners').onclick=loadConversationOwners;
    el('conversationChoice').onchange=showConversation;
    el('conversationForm').onsubmit=saveConversation;
    el('productChoice').value='revive';
    el('productChoice').onchange=renderProductFields;
    el('productKind').onchange=renderProductFields;
    el('productForm').onsubmit=saveProduct;
    renderProductFields();
    el('briefForm').onsubmit = saveBrief;
    el('evidenceForm').onsubmit = saveEvidence;
    el('prospectRefresh').onclick = load;
    el('prospectMode').onchange = load;
    load();
  }
  function path(action,id) { return '/api/admin/tenants/'+(id||tenant.id)+'/'+action; }
  function load() {
    var ticket = ++generation, synthetic = el('prospectMode').value === 'synthetic';
    ready = false; snapshot=null; inboxSelection=null; error('');
    el('inboxMessage').innerHTML='';el('inboxExcerpt').textContent='';el('inboxReviewed').checked=false;
    el('prospectResults').textContent = 'Loading current evidence…';
    return RP.api(path('shortlist'), {synthetic:synthetic}).then(function(j){
      if(ticket !== generation) return;
      version = j.brief ? j.brief.version : 0;
      var b = j.brief ? j.brief.body : null;
      el('briefVersion').textContent = version ? 'Current brief version: '+version : 'No brief saved yet. Enter a reviewed offer and audience.';
      el('briefOffer').value = b ? b.offer : '';
      fields.forEach(function(f){el('brief_'+f).value=b ? b[f].join(', ') : '';});
      el('briefAge').value = b ? b.maxAgeDays : 90;
      ['industry','market','role','need'].forEach(function(f){var a=b && b.aliases ? b.aliases[f]||{} : {};el('alias_'+f).value=Object.keys(a).flatMap(function(k){return a[k].map(function(v){return k+' = '+v;});}).join('; ');});
      el('briefReference').value = b ? b.source.reference : '';
      el('briefObserved').value = b ? b.source.observedAt.slice(0,10) : '';
      el('briefExcerpt').value = b ? b.source.excerpt : '';
      el('evidenceLead').innerHTML = j.leads.filter(function(l){return synthetic === l.email.toLowerCase().endsWith('.invalid');}).map(function(l){return '<option value="'+esc(l.id)+'">'+esc(l.company || l.email)+'</option>';}).join('');
      el('productLead').innerHTML=el('evidenceLead').innerHTML;
      el('inboxLead').innerHTML=el('evidenceLead').innerHTML;
      el('inboxLead').onchange=function(){inboxSelection=null;el('inboxMessage').innerHTML='';el('inboxExcerpt').textContent='';el('inboxReviewed').checked=false;};
      el('prospectResults').innerHTML = j.results.length ? j.results.map(function(r){
        return '<details><summary>'+esc(r.company)+' · '+esc(r.state)+'</summary><p>'+esc(r.nextAction)+'</p><p>'+esc(r.reasons.join(', '))+'</p>'+r.fields.map(function(f){
          return '<p><strong>'+esc(f.field)+': '+esc(f.state)+'</strong> '+esc(f.values.join(', '))+'</p>'+f.evidence.map(function(e){return '<blockquote>'+esc(e.excerpt)+'<br><small>'+esc(e.reference)+' · '+esc(e.observedAt)+'</small></blockquote>';}).join('');
        }).join('')+(r.products||[]).map(function(p){return '<section><h4>Ripe '+esc(p.product)+'</h4>'+(p.reference?'<p>Conversation / event: '+esc(p.reference)+'</p>':p.outcomeScope==='unattributed'?'<p>Unattributed history — no conversation or event link recorded.</p>':'')+'<p>'+esc(p.state)+' · '+esc(p.nextAction)+'</p>'+(p.question?'<p>Suggested question: '+esc(p.question)+'</p>':'')+(p.dueAt?'<p>Review due: '+esc(p.dueAt)+(p.overdue?' · overdue':'')+'</p>':'')+(p.conversation?'<p>Conversation owner: '+esc(p.conversation.ownerLabel||'Unassigned')+' · '+esc(p.conversation.state)+(p.conversation.reviewedAt?' · reviewed '+esc(p.conversation.reviewedAt):'')+'</p>':'')+'<p>Delivery unavailable · client booking unavailable</p>'+p.outcomes.map(function(o){return '<p>Recorded outcome: '+esc(o.outcome)+' · '+esc(o.reason)+' · '+esc(o.at)+'</p>';}).join('')+p.history.map(function(h){return '<blockquote>'+esc(h.excerpt)+'<br><small>'+esc(h.reference)+' · '+esc(h.observedAt)+'</small></blockquote>';}).join('')+'</section>';}).join('')+'</details>';
      }).join('') : '<p class="muted">No assessed prospects in this evidence set. Save a brief and attach reviewed evidence to existing client leads.</p>';
      snapshot=j; renderConversations();
      var observed=j.results.filter(function(r){return (r.products||[]).some(function(p){return p.history.length;});}).length;
      el('productMetrics').textContent=observed+' contacts with product history / '+j.results.length+' reviewed contacts. Outcome counts describe recorded evidence, not conversion uplift.';
      ready = true;
    }).catch(function(e){if(ticket===generation){ready=false; error(e.message); el('briefVersion').textContent='Review unavailable. Nothing has been saved.';el('prospectResults').textContent='';}});
  }
  function date(id) { var v=el(id).value; return v ? v+'T00:00:00.000Z' : ''; }
  function saveBrief(event) {
    event.preventDefault(); if(!ready){error('Load the current brief before saving.');return;}
    var id=tenant.id, ticket=generation, b={offer:el('briefOffer').value.trim(),maxAgeDays:Number(el('briefAge').value),source:{reference:el('briefReference').value.trim(),excerpt:el('briefExcerpt').value.trim(),observedAt:date('briefObserved')}};
    fields.forEach(function(f){b[f]=el('brief_'+f).value.split(',').map(function(v){return v.trim();}).filter(Boolean);});
    b.aliases={};
    try { ['industry','market','role','need'].forEach(function(f){var groups={};el('alias_'+f).value.split(';').filter(function(v){return v.trim();}).forEach(function(pair){var parts=pair.split('=');if(parts.length!==2 || !parts[0].trim() || !parts[1].trim())throw Error('Use target = alias, separated by semicolons.');var key=parts[0].trim();if(['__proto__','constructor','prototype'].includes(key))throw Error('Invalid alias target.');(groups[key] ||= []).push(parts[1].trim());});b.aliases[f]=groups;}); } catch(e){error(e.message);return;}
    ready=false;
    RP.api(path('brief',id),{brief:b,expected_version:version}).then(function(){if(ticket===generation) return load();}).catch(function(e){if(ticket===generation){ready=true;error(e.message);}});
  }
  function saveEvidence(event) {
    event.preventDefault(); if(!ready){error('Load this client account before saving.');return;}
    var id=tenant.id,ticket=generation,facts={};
    ['industry','market','role','need'].forEach(function(f){var v=el('evidence_'+f).value.trim();if(v) facts[f]=v;});
    var b={lead_id:el('evidenceLead').value,source:el('evidenceSource').value.trim(),reference:el('evidenceReference').value.trim(),rights_reference:el('evidenceRights').value.trim(),observed_at:date('evidenceObserved'),excerpt:el('evidenceExcerpt').value.trim(),facts:facts,synthetic:el('prospectMode').value==='synthetic'};
    ready=false;
    RP.api(path('prospect-evidence',id),b).then(function(){if(ticket===generation)return load();}).catch(function(e){if(ticket===generation){ready=true;error(e.message);}});
  }


  function importLeads(event){
    event.preventDefault();if(!ready){error('Load this client account before importing.');return;}
    var rows=el('prospectImportRows').value.trim().split(/\r?\n/), id=tenant.id,ticket=generation;
    if(rows.length>50){error('Import at most 50 rows at a time.');return;}
    var body={synthetic:el('prospectMode').value==='synthetic',rows:rows.map(function(line){var cells=line.split('\t').map(function(v){return v.trim();});return cells.length===5?{email:cells[0],company:cells[1],reference:cells[2],rights_reference:cells[3],observed_at:cells[4]+'T00:00:00Z'}:{};})};
    ready=false;
    RP.api(path('prospect-import',id),body).then(function(j){if(ticket!==generation)return;var report=j.results.map(function(r){return 'Row '+r.row+': '+r.state+(r.reason?' ('+r.reason+')':'');}).join('; ');return load().then(function(){if(id===tenant.id)el('prospectImportReport').textContent=report;});}).catch(function(e){if(ticket===generation){ready=true;error(e.message+' Retry with the same source references; do not create new references for an uncertain import.');}});
  }
  function exportReview(){
    if(!ready || !snapshot){error('Refresh this account before downloading.');return;}
    var data={purpose:'Internal operator review only; not a marketing contact list',tenant_id:tenant.id,brief_version:version,assessed_at:snapshot.assessedAt,rules_version:snapshot.rulesVersion,synthetic:snapshot.synthetic,contactAllowed:false,results:snapshot.results};
    var url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');
    a.href=url;a.download='ripepiper-internal-review.json';a.click();URL.revokeObjectURL(url);
  }
  var inboxSelection=null,inboxBusy=false;
  function inboxForm(){return '<details><summary>Read selected inbox messages</summary><p>Read-only Google connection for this client. Select a business contact, preview a recent incoming message, then confirm its use for human review. Importing holds follow-ups; it does not reply or qualify the lead.</p><button id="inboxCheck" class="btn btn-line" type="button">Check inbox and calendar connection</button><div class="field"><label for="inboxLead">Existing business contact</label><select id="inboxLead"></select></div><button id="inboxList" class="btn btn-line" type="button">Find recent messages for this contact</button><div class="field"><label for="inboxMessage">Incoming message (last 30 days, up to 10)</label><select id="inboxMessage"></select></div><button id="inboxPreview" class="btn btn-line" type="button">Preview selected message</button><pre id="inboxExcerpt" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre><label class="consent"><input type="checkbox" id="inboxReviewed"><span>I reviewed this excerpt and its permitted use for this client.</span></label><button id="inboxImport" class="btn btn-line" type="button">Import for human review</button><p id="inboxStatus" role="status"></p></details>';}
  function inboxRequest(body,onResult){
    if(!ready||inboxBusy){el('inboxStatus').textContent='Load this client and wait for the current request.';return;}
    var ticket=generation,id=tenant.id;inboxBusy=true;el('inboxStatus').textContent='Checking…';
    RP.api(path('connection',id),body).then(function(j){
      if(ticket!==generation)return;
      if(j.state==='not_connected'){el('inboxStatus').textContent='No active tenant connection. A dedicated mailbox/calendar and read-only Google consent are required.';return;}
      onResult(j);
    }).catch(function(e){if(ticket===generation)el('inboxStatus').textContent=e.message;}).finally(function(){inboxBusy=false;});
  }
  function checkInbox(){inboxRequest({operation:'check'},function(j){el('inboxStatus').textContent=j.state==='identity_verified'?'Account identity verified for '+j.mailbox+' and calendar '+j.calendarId+'. Message access is checked on preview; sending is disabled.':'Connection is not verified.';});}
  function listInbox(){
    inboxSelection=null;el('inboxExcerpt').textContent='';el('inboxReviewed').checked=false;el('inboxMessage').innerHTML='';
    var lead=el('inboxLead').value;
    inboxRequest({operation:'list',lead_id:lead},function(j){
      if(lead!==el('inboxLead').value)return;
      el('inboxMessage').innerHTML=j.messages.items.map(function(m){return '<option value="'+esc(m.id)+'">'+esc(m.subject)+' · '+esc(m.observedAt)+'</option>';}).join('');
      el('inboxStatus').textContent=j.messages.items.length+' matching incoming messages. '+(j.messages.moreAvailable?'More exist; this view is limited to 10. ':'')+(j.messages.excluded?'Some messages were excluded because their identity or date did not match.':'');
    });
  }
  function previewInbox(){
    inboxSelection=null;el('inboxExcerpt').textContent='';el('inboxReviewed').checked=false;
    var lead=el('inboxLead').value,message=el('inboxMessage').value;
    inboxRequest({operation:'preview',lead_id:lead,message_id:message},function(j){
      if(lead!==el('inboxLead').value||message!==el('inboxMessage').value)return;
      inboxSelection={lead:lead,id:message,digest:j.message.digest};el('inboxExcerpt').textContent=j.message.excerpt;
      el('inboxStatus').textContent=j.message.truncated?'Showing a limited excerpt. Review it in the mailbox if more context is needed.':'Review the source. Sender matching does not authenticate the sender or establish buying intent.';
    });
  }
  function importInbox(){
    var s=inboxSelection;
    if(!s||s.lead!==el('inboxLead').value||s.id!==el('inboxMessage').value||!el('inboxReviewed').checked){el('inboxStatus').textContent='Preview this message and confirm its permitted use first.';return;}
    inboxRequest({operation:'import',lead_id:s.lead,message_id:s.id,digest:s.digest,reviewed:true},function(){
      var id=tenant.id;inboxSelection=null;load().then(function(){if(tenant.id===id)el('inboxStatus').textContent='Recorded for human review. Follow-ups are held; no reply was sent.';});
    });
  }
  function select(id,label,values) {return '<div class="field"><label for="'+id+'">'+label+'</label><select id="'+id+'">'+values.map(function(v){return '<option value="'+v+'">'+v.replaceAll('_',' ')+'</option>';}).join('')+'</select></div>';}
  var conversations=[], conversationRequest=null;
  function conversationForm(){return '<details><summary>Conversation ownership and review</summary><p class="hint">Assign a verified owner and record a human resolution for the current inbound evidence. New messages reopen review. Follow-ups remain held after resolution.</p><form id="conversationForm" class="stack"><label for="conversationChoice">Existing conversation</label><select id="conversationChoice"></select><button id="conversationOwners" class="btn btn-line" type="button">Load authorized owners</button><label for="conversationOwner">Review owner</label><select id="conversationOwner"></select>'+select('conversationState','Review state',['open','resolved'])+'<label for="conversationReason">Reviewed reason</label><textarea id="conversationReason" maxlength="1000" required></textarea><p id="conversationStatus" role="status"></p><button class="btn btn-line" type="submit">Save conversation review</button></form></details>';}
  function renderConversations(){
    conversationRequest=null;conversations=[];
    (snapshot.results||[]).forEach(function(r){(r.products||[]).forEach(function(p){if(p.product==='response'&&p.reference&&p.conversation)conversations.push({leadId:r.leadId,company:r.company,reference:p.reference,review:p.conversation});});});
    el('conversationChoice').innerHTML=conversations.map(function(c,i){return '<option value="'+i+'">'+esc(c.company)+' · '+esc(c.reference)+'</option>';}).join('');
    el('conversationChoice').value=conversations.length?'0':'';el('conversationOwner').innerHTML='';showConversation();
  }
  function showConversation(){conversationRequest=null;var c=conversations[Number(el('conversationChoice').value)];el('conversationReason').value='';el('conversationState').value='open';el('conversationStatus').textContent=c?'Current review version '+c.review.version+' · '+(c.review.ownerLabel||'Unassigned')+' · '+c.review.state:'No conversation evidence in this review.';if(c&&c.review.ownerId)el('conversationOwner').value=c.review.ownerId;}
  function loadConversationOwners(){
    if(!ready){error('Load this client account before reviewing.');return;}var id=tenant.id,ticket=generation;
    el('conversationStatus').textContent='Checking current authorized owners…';
    RP.api(path('conversation-review',id),{operation:'owners'}).then(function(j){if(ticket!==generation)return;el('conversationOwner').innerHTML=(j.owners||[]).map(function(o){return '<option value="'+esc(o.id)+'">'+esc(o.label)+'</option>';}).join('');showConversation();}).catch(function(e){if(ticket===generation){el('conversationOwner').innerHTML='';el('conversationStatus').textContent=e.message;}});
  }
  function saveConversation(event){
    event.preventDefault();var c=conversations[Number(el('conversationChoice').value)];if(!ready||!c||!el('conversationOwner').value||!el('conversationReason').value.trim()){error('Load the current conversation, select an authorized owner and enter the reviewed reason.');return;}
    if(!window.crypto||!window.crypto.randomUUID){error('Secure conversation review is unavailable in this browser.');return;}
    var id=tenant.id,ticket=generation,body={operation:'save',lead_id:c.leadId,thread_ref:c.reference,owner_id:el('conversationOwner').value,expected_version:c.review.version,inbound_snapshot:c.review.inboundSnapshot,state:el('conversationState').value,reason:el('conversationReason').value.trim(),synthetic:el('prospectMode').value==='synthetic'};
    var signature=JSON.stringify(body);if(!conversationRequest||conversationRequest.signature!==signature)conversationRequest={signature:signature,id:window.crypto.randomUUID()};body.request_id=conversationRequest.id;
    ready=false;RP.api(path('conversation-review',id),body).then(function(){if(ticket===generation)return load();}).catch(function(e){if(ticket===generation){ready=true;error(e.message+' If the result was uncertain, retry without changing this review.');}});
  }
  function productForm(){return '<details><summary>Product history and outcomes</summary><p class="hint">Staff-reviewed records on existing contacts. Recording a reply holds follow-ups across products. Opt-out records apply suppression. These forms do not send, publish or book.</p><form id="productForm" class="stack">'+select('productChoice','Product',['revive','signal','response','events'])+select('productKind','Record type',['evidence','outcome'])+'<div class="field"><label for="productLead">Existing lead</label><select id="productLead"></select></div>'+input('productReference','Unique source or message reference')+input('productRights','Permitted-use reference')+input('productObserved','Observed at (UTC)','datetime-local')+'<div class="field"><label for="productExcerpt">Reviewed source excerpt</label><textarea id="productExcerpt" maxlength="2000" required></textarea></div><div id="productFields" class="form-grid"></div><button class="btn btn-line" type="submit">Record reviewed event</button></form></details>';}
  function renderProductFields(){
    var p=el('productChoice').value, html='';
    if(el('productKind').value==='outcome') html=select('productOutcome','Verified outcome',['accepted','rejected','qualified_conversation','meeting_held','opportunity','won','lost'])+input('productReason','Reason supported by the source')+(p==='response'?input('outcomeThread','Existing conversation reference'):p==='events'?input('outcomeEvent','Existing event reference'):'');
    else if(p==='revive')html=input('lastContact','Last contact (UTC)','datetime-local')+select('previousInterest','Previously expressed interest',['unknown','yes','no'])+input('stalledReason','Why it stopped (enter unknown if unverified)');
    else if(p==='signal')html=input('signalRelevance','Why this business change relates to the offer')+input('signalExpiry','Evidence expires (UTC)','datetime-local');
    else if(p==='response')html=select('responseKind','Conversation event',['enquiry','reply'])+input('threadRef','Verified thread reference')+select('disposition','Reviewed disposition',['uncertain','interested','not_interested','later','wrong_person','opt_out','human'])+input('answerNeed','Stated need (blank if unknown)')+input('answerAuthority','Decision participants (blank if unknown)')+input('answerTiming','Stated timing (blank if unknown)')+input('nextContact','Agreed review time, required for later (UTC)','datetime-local');
    else html=select('eventKind','Event record',['registration','attendance'])+input('eventRef','Event reference')+input('eventEnd','Event ends (UTC)','datetime-local')+input('eventTimezone','Event timezone, e.g. Asia/Dubai')+select('attendance','Attendance evidence',['unknown','attended','verified_no_show'])+select('rosterComplete','Complete authoritative attendance roster',['no','yes']);
    el('productFields').innerHTML=html;
  }
  function utc(id){var v=el(id).value;return v ? new Date(v+'Z').toISOString() : '';}
  function saveProduct(event){
    event.preventDefault();if(!ready){error('Load this client account before saving.');return;}
    var id=tenant.id,ticket=generation,p=el('productChoice').value,c={product:p},v=function(id){return el(id).value.trim();};
    try {
      if(el('productKind').value==='outcome'){c.kind='outcome';c.outcome=v('productOutcome');c.reason=v('productReason');if(p==='response')c.threadRef=v('outcomeThread');if(p==='events')c.eventRef=v('outcomeEvent');}
      else if(p==='revive'){c.kind='history';c.lastContactAt=utc('lastContact');c.previousInterest=v('previousInterest');c.stalledReason=v('stalledReason');}
      else if(p==='signal'){c.kind='trigger';c.relevance=v('signalRelevance');c.expiresAt=utc('signalExpiry');}
      else if(p==='response'){c.kind=v('responseKind');c.threadRef=v('threadRef');c.disposition=v('disposition');c.need=v('answerNeed');c.authority=v('answerAuthority');c.timing=v('answerTiming');if(v('nextContact'))c.nextContactAt=utc('nextContact');}
      else {c.kind=v('eventKind');c.eventRef=v('eventRef');c.endsAt=utc('eventEnd');c.timezone=v('eventTimezone');c.attendance=v('attendance');c.rosterComplete=v('rosterComplete')==='yes';}
      var body={lead_id:v('productLead'),reference:v('productReference'),rights_reference:v('productRights'),excerpt:v('productExcerpt'),observed_at:utc('productObserved'),synthetic:el('prospectMode').value==='synthetic',context:c};
    }catch(e){error('Enter complete, valid dates.');return;}
    ready=false;
    RP.api(path('product-event',id),body).then(function(){if(ticket===generation)return load();}).catch(function(e){if(ticket===generation){ready=true;error(e.message);}});
  }
  window.addEventListener('rp:tenant-selected',function(event){++generation; tenant=event.detail; render();});
})();
