/* Shared prospect review in the existing Clients panel. All persistence uses staff APIs. */
(function () {
  "use strict";
  var RP = window.RP, panel = document.getElementById("prospectingPanel"), tenant, generation = 0, version = 0, ready = false;
  var fields = ["industries", "markets", "roles", "needs", "excludedIndustries"];
  var labels = ["Target industries", "Target markets", "Buyer roles", "Needs we address", "Excluded industries"];
  var esc = RP.esc, el = function(id) { return document.getElementById(id); };
  function error(message) { el("prospectError").textContent = message; }
  function input(id,label,type) { return '<div class="field"><label for="'+id+'">'+label+'</label><input id="'+id+'" type="'+(type||'text')+'"></div>'; }
  function render() {
    ready = false; version = 0;
    panel.innerHTML = '<h3>Business brief and prospect review: '+esc(tenant.name)+'</h3><p class="hint">Review sourced facts before recording them. Fit scores are not conversion probabilities. This review does not send messages.</p>'+
      '<label for="prospectMode">Evidence set</label><select id="prospectMode"><option value="synthetic">Synthetic test contacts</option><option value="business">Existing business contacts</option></select><button class="btn btn-line" type="button" id="prospectRefresh">Refresh review</button><p id="prospectError" class="err" role="alert"></p><p id="briefVersion" role="status">Loading brief…</p>'+
      '<details><summary>Business brief</summary><form id="briefForm" class="stack"><div class="field"><label for="briefOffer">Offer and problem solved</label><textarea id="briefOffer" maxlength="500" required></textarea></div><div class="form-grid">'+
      fields.map(function(f,i){return input('brief_'+f,labels[i]+' (comma-separated)');}).join('')+ input('briefAge','Evidence validity in days','number')+input('briefReference','Brief source reference')+input('briefObserved','Source date','date')+'</div><div class="field"><label for="briefExcerpt">Supporting source excerpt or interview note</label><textarea id="briefExcerpt" maxlength="2000" required></textarea></div><button class="btn btn-dark" type="submit">Save reviewed brief version</button></form></details>'+
      '<details><summary>Add reviewed prospect evidence</summary><form id="evidenceForm" class="stack"><div class="field"><label for="evidenceLead">Existing lead</label><select id="evidenceLead"></select></div><div class="form-grid">'+input('evidenceSource','Source type, e.g. client interview')+input('evidenceReference','Unique dated source reference')+input('evidenceRights','Permitted-use reference')+input('evidenceObserved','Observation date','date')+
      ['industry','market','role','need'].map(function(f){return input('evidence_'+f,f.charAt(0).toUpperCase()+f.slice(1)+' (leave unknown blank)');}).join('')+'</div><div class="field"><label for="evidenceExcerpt">Source excerpt containing the recorded values</label><textarea id="evidenceExcerpt" maxlength="2000" required></textarea></div><button class="btn btn-line" type="submit">Record reviewed evidence</button></form></details><div id="prospectResults" aria-live="polite"></div>';
    el('briefAge').value = '90';
    el('briefForm').onsubmit = saveBrief;
    el('evidenceForm').onsubmit = saveEvidence;
    el('prospectRefresh').onclick = load;
    el('prospectMode').onchange = load;
    load();
  }
  function path(action,id) { return '/api/admin/tenants/'+(id||tenant.id)+'/'+action; }
  function load() {
    var ticket = ++generation, synthetic = el('prospectMode').value === 'synthetic';
    ready = false; error('');
    el('prospectResults').textContent = 'Loading current evidence…';
    return RP.api(path('shortlist'), {synthetic:synthetic}).then(function(j){
      if(ticket !== generation) return;
      version = j.brief ? j.brief.version : 0;
      var b = j.brief ? j.brief.body : null;
      el('briefVersion').textContent = version ? 'Current brief version: '+version : 'No brief saved yet. Enter a reviewed offer and audience.';
      el('briefOffer').value = b ? b.offer : '';
      fields.forEach(function(f){el('brief_'+f).value=b ? b[f].join(', ') : '';});
      el('briefAge').value = b ? b.maxAgeDays : 90;
      el('briefReference').value = b ? b.source.reference : '';
      el('briefObserved').value = b ? b.source.observedAt.slice(0,10) : '';
      el('briefExcerpt').value = b ? b.source.excerpt : '';
      el('evidenceLead').innerHTML = j.leads.filter(function(l){return synthetic === l.email.toLowerCase().endsWith('.invalid');}).map(function(l){return '<option value="'+esc(l.id)+'">'+esc(l.company || l.email)+'</option>';}).join('');
      el('prospectResults').innerHTML = j.results.length ? j.results.map(function(r){
        return '<details><summary>'+esc(r.company)+' · '+esc(r.state)+(r.score === null ? '' : ' · fit '+r.score+'/100')+'</summary><p>'+esc(r.nextAction)+'</p><p>'+esc(r.reasons.join(', '))+'</p>'+r.fields.map(function(f){
          return '<p><strong>'+esc(f.field)+': '+esc(f.state)+'</strong> '+esc(f.values.join(', '))+'</p>'+f.evidence.map(function(e){return '<blockquote>'+esc(e.excerpt)+'<br><small>'+esc(e.reference)+' · '+esc(e.observedAt)+'</small></blockquote>';}).join('');
        }).join('')+'</details>';
      }).join('') : '<p class="muted">No assessed prospects in this evidence set. Save a brief and attach reviewed evidence to existing client leads.</p>';
      ready = true;
    }).catch(function(e){if(ticket===generation){ready=false; error(e.message); el('briefVersion').textContent='Review unavailable. Nothing has been saved.';el('prospectResults').textContent='';}});
  }
  function date(id) { var v=el(id).value; return v ? v+'T00:00:00.000Z' : ''; }
  function saveBrief(event) {
    event.preventDefault(); if(!ready){error('Load the current brief before saving.');return;}
    var id=tenant.id, ticket=generation, b={offer:el('briefOffer').value.trim(),maxAgeDays:Number(el('briefAge').value),source:{reference:el('briefReference').value.trim(),excerpt:el('briefExcerpt').value.trim(),observedAt:date('briefObserved')}};
    fields.forEach(function(f){b[f]=el('brief_'+f).value.split(',').map(function(v){return v.trim();}).filter(Boolean);});
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
  window.addEventListener('rp:tenant-selected',function(event){++generation; tenant=event.detail; render();});
})();
