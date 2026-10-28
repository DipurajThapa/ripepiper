/* Explicit staff contact stop controls in the current prospect selection. */
(function(){
 'use strict';var RP=window.RP;
 RP.tenantStopMarkup=function(){return '<section class="formbox"><h4>Tenant contact stop</h4><p>Record an operator-verified objection for this business and contact. This preserves the deal history. Requests already dispatched may still arrive.</p><div class="field"><label for="tenantStopReference">Verified objection reference (8–240 characters)</label><input id="tenantStopReference" type="text" maxlength="240"></div><div class="actions"><button id="tenantStopRecord" class="btn btn-line" type="button">Record verified contact stop</button><button id="tenantStopIssue" class="btn btn-line" type="button">Create confirmation link</button></div><p id="tenantStopStatus" role="status"></p><div class="field"><label for="tenantStopLink">New link (not sent)</label><textarea id="tenantStopLink" readonly></textarea></div></section>';};
 RP.wireTenantStop=function(tenantId,lead,isCurrent,onStopped){
  var id=lead.id||lead.leadId,el=function(n){return document.getElementById(n);},record=el('tenantStopRecord'),issue=el('tenantStopIssue'),reference=el('tenantStopReference'),status=el('tenantStopStatus'),link=el('tenantStopLink'),busy=false;
  if(!record||!issue)return;
  var current=function(){return isCurrent()&&document.getElementById('tenantStopRecord')===record;};
  var exact=function(r,keys){return r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).sort().join(',')===keys.sort().join(',');};
  async function run(operation){
   if(!current()||busy)return;
   var body={operation:operation};
   if(operation==='record'){body.reference=reference.value.trim();if(body.reference.length<8||body.reference.length>240){status.textContent='Enter the verified objection reference (8–240 characters).';return;}}
   busy=true;record.disabled=issue.disabled=true;link.value='';status.textContent='Saving…';
   try{
    var r=await RP.api('/api/admin/tenants/'+encodeURIComponent(tenantId)+'/leads/'+encodeURIComponent(id)+'/unsubscribe',body);
    if(!current())return;
    if(operation==='record'){
     if(!exact(r,['version','status','tenantId','leadId','alreadyStopped'])||r.version!==1||r.status!=='stopped'||r.tenantId!==tenantId.toLowerCase()||r.leadId!==id.toLowerCase()||typeof r.alreadyStopped!=='boolean')throw Error('uncertain');
     status.textContent=r.alreadyStopped?'The contact stop was already recorded.':'The tenant contact stop is recorded.';
     if(onStopped)onStopped();
    }else{
     if(!exact(r,['version','status','url','expiresAt','delivery'])||r.version!==1||r.status!=='issued'||r.delivery!=='not_sent'||typeof r.url!=='string'||typeof r.expiresAt!=='string'||!Number.isFinite(Date.parse(r.expiresAt)))throw Error('uncertain');
     var u=new URL(r.url);if(u.pathname!=='/unsubscribe.html'||!/^#token=[0-9a-f]{64}$/.test(u.hash)||u.username||u.password||u.search||!['https:','http:'].includes(u.protocol))throw Error('uncertain');
     link.value=r.url;status.textContent='Link created, not sent. It expires '+new Date(r.expiresAt).toLocaleString()+'. Share it only with the intended contact.';
    }
   }catch(_){if(current())status.textContent='The result is unavailable or the request was declined. Review the contact before trying again. Your reference is preserved.';}
   finally{busy=false;if(current())record.disabled=issue.disabled=false;}
  }
  record.onclick=function(){return run('record');};issue.onclick=function(){return run('issue_link');};
 };
})();

