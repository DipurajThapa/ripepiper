/* Managed Revive setup extends the existing reviewed business brief. No activation or sending. */
(function(){
 'use strict';
 var RP=window.RP,panel=document.getElementById('reviveSetupPanel'),tenant,generation=0,request=0,ready=false,dirty=false,context=null,sourceCount=1,claimCount=1;
 var el=function(id){return document.getElementById(id);},esc=RP.esc;
 RP.senderVerified=RP.senderVerified||{};
 function field(id,label,type,max){return '<div class="field"><label for="'+id+'">'+label+'</label><input id="'+id+'" type="'+(type||'text')+'"'+(max?' maxlength="'+max+'"':'')+'></div>';}
 function select(id,label,options){return '<div class="field"><label for="'+id+'">'+label+'</label><select id="'+id+'">'+options.map(function(o){return '<option value="'+esc(o[0])+'">'+esc(o[1])+'</option>';}).join('')+'</select></div>';}
 function notice(text){el('reviveSetupStatus').textContent=text;}
 function missingLabel(key){var labels={setup_required:'save a client setup',reviewed_setup_required:'review this setup',current_brief_required:'a current reviewed business brief',owner_unavailable:'a currently authorized owner',reviewer_unavailable:'a currently authorized reviewer',sourceInventory:'approved source inventory',relationshipSummary:'reviewed relationship summary',senderName:'declared sender name',senderEmail:'declared sender email',ownerId:'responsible owner',market:'market',language:'language',timezone:'timezone',outcomeWindowDays:'outcome observation window',startMinute:'local working-window start',endMinute:'local working-window end',dailyContactCap:'daily contact cap',salesCapacityPerWeek:'declared weekly meeting capacity',workingDays:'local working days'};return Object.prototype.hasOwnProperty.call(labels,key)?labels[key]:key;}
 function api(body){return RP.api('/api/admin/tenants/'+tenant.id+'/revive-setup',body);}
 function rowFields(kind){return Array.from({length:10},function(_,i){return '<fieldset id="setup'+kind+'Row'+i+'"'+(i?' hidden':'')+'><legend>'+kind+' '+(i+1)+'</legend><div class="form-grid">'+(kind==='Source'?select('setupSourceType'+i,'Source type',[['website','Website'],['email','Selected email'],['interview','Client interview'],['file','Approved file']])+field('setupSourceReference'+i,'Existing source reference','text',240)+field('setupSourceRights'+i,'Permitted-use reference','text',240):field('setupClaimText'+i,'Supported claim (leave unsupported claims out)','text',500)+field('setupClaimReference'+i,'Supporting source reference','text',240))+'</div></fieldset>';}).join('');}
 function render(){
  panel.innerHTML='<h3>Ripe Revive client setup: '+esc(tenant.name)+'</h3><p class="hint">Staff prepares this managed service after discovery. Use the <a href="#prospectingPanel">existing business brief</a> for the offer, buyers and exclusions. This form adds source references and operating constraints; it does not verify mailbox ownership, activate this account or send messages. Unknowns may remain blank in a draft.</p><button id="reviveSetupReload" class="btn btn-line" type="button">Reload saved setup (discards unsaved edits)</button><p id="reviveSetupStatus" role="status"></p><p id="reviveSetupMissing" class="hint"></p><form id="reviveSetupForm" class="stack" novalidate><fieldset id="reviveSetupFields"><legend>Client operating details</legend><div class="form-grid">'+field('setupWebsite','Website URL (optional, supplied only)','url',1000)+field('setupWebsiteReference','Website source reference','text',240)+field('setupSenderName','Declared sender name','text',80)+field('setupSenderEmail','Declared sender email','email',254)+field('setupReplyTo','Reply-to address (optional)','email',254)+field('setupBookingUrl','Default booking URL (optional, HTTPS)','url',1000)+field('setupBookingReference','Booking URL reference','text',240)+field('setupPostalReference','Postal address reference','text',240)+select('setupOwner','Responsible staff owner',[['','Unknown / not assigned']])+field('setupMarket','Market (two-letter code)','text',2)+field('setupLanguage','Language tag, e.g. en-AE','text',35)+field('setupTimezone','Timezone, e.g. Asia/Dubai','text',80)+field('setupSalesCapacity','Declared meeting capacity per week (0–100)','number')+field('setupOutcomeWindow','Outcome observation window in days (1–180)','number')+field('setupWorkingDays','Working days (ISO numbers 1=Mon … 7=Sun, comma-separated)','text',30)+field('setupStart','Working window starts (client local time)','time')+field('setupEnd','Working window ends (client local time; 24:00 allowed as text)','text',5)+field('setupDailyCap','Daily contact cap (1–25)','number')+'</div><p id="setupSenderBadge" class="hint"></p><div class="field"><label for="setupSignature">Email signature (optional, plain text)</label><textarea id="setupSignature" maxlength="500"></textarea></div><div class="field"><label for="setupPostalAddress">Postal address for the email footer (optional)</label><textarea id="setupPostalAddress" maxlength="300"></textarea></div><div class="field"><label for="setupRelationship">Existing relationship summary (may stay blank in a draft)</label><textarea id="setupRelationship" maxlength="1000"></textarea></div>'+field('setupRelationshipReference','Relationship source reference','text',240)+'<details><summary>Approved source inventory (up to 10)</summary><p class="hint">Reference material already reviewed by staff. A source reference is not permission to contact its subject.</p>'+rowFields('Source')+'<button id="setupSourceAdd" class="btn btn-line" type="button">Add source row</button> <button id="setupSourceRemove" class="btn btn-line" type="button">Remove last source row</button></details><details><summary>Supported claims (optional, up to 10)</summary><p class="hint">Only record claims supported by the cited material. These do not duplicate the offer or buyer brief.</p>'+rowFields('Claim')+'<button id="setupClaimAdd" class="btn btn-line" type="button">Add claim row</button> <button id="setupClaimRemove" class="btn btn-line" type="button">Remove last claim row</button></details></fieldset><label class="consent"><input id="setupReviewed" type="checkbox"><span>I reviewed these exact operating details and source references against the current business brief. Saving as reviewed does not grant outreach rights.</span></label><div class="hero-actions"><button id="setupSaveDraft" class="btn btn-line" type="submit">Save setup draft</button><button id="setupSaveReviewed" class="btn btn-dark" type="button">Save reviewed setup</button></div></form>'+RP.connectionsMarkup();
  el('reviveSetupReload').onclick=load;
  el('reviveSetupForm').oninput=function(e){dirty=true;if(!e||!e.target||e.target.id!=='setupReviewed')el('setupReviewed').checked=false;};
  el('reviveSetupForm').onsubmit=function(e){e.preventDefault();save('draft');};el('setupSaveReviewed').onclick=function(){save('reviewed');};
  ['Source','Claim'].forEach(function(kind){el('setup'+kind+'Add').onclick=function(){rows(kind,1);};el('setup'+kind+'Remove').onclick=function(){rows(kind,-1);};});
  sourceCount=claimCount=1;load();
 }
 function rows(kind,delta){
  if(!ready){notice('Load the current setup before editing rows.');return;}
  var count=kind==='Source'?sourceCount:claimCount,next=Math.max(1,Math.min(10,count+delta));
  if(next===count)return;
  if(delta<0){(kind==='Source'?['Reference','Rights']:['Text','Reference']).forEach(function(s){el('setup'+kind+s+(count-1)).value='';});}
  if(kind==='Source')sourceCount=next;else claimCount=next;
  for(var i=0;i<10;i++)el('setup'+kind+'Row'+i).hidden=i>=next;
  dirty=true;el('setupReviewed').checked=false;
 }
 function validBody(b){
  var keys=['website','supportedClaims','sourceInventory','relationshipSummary','senderName','senderEmail','ownerId','market','language','timezone','salesCapacityPerWeek','outcomeWindowDays','workingDays','startMinute','endMinute','dailyContactCap'];
  return b&&typeof b==='object'&&!Array.isArray(b)&&keys.every(function(k){return Object.prototype.hasOwnProperty.call(b,k);})&&Array.isArray(b.supportedClaims)&&b.supportedClaims.length<=10&&b.supportedClaims.every(function(c){return c&&typeof c.text==='string'&&typeof c.reference==='string';})&&Array.isArray(b.sourceInventory)&&b.sourceInventory.length<=10&&b.sourceInventory.every(function(s){return s&&['website','email','interview','file'].includes(s.type)&&typeof s.reference==='string'&&typeof s.rightsReference==='string';});
 }
 function validContext(j){return j&&j.tenantId===tenant.id&&(j.setup===null||j.setup&&Number.isInteger(j.setup.version)&&j.setup.version>0&&['draft','reviewed'].includes(j.setup.state)&&validBody(j.setup.body))&&(j.currentBriefVersion===null||Number.isInteger(j.currentBriefVersion)&&j.currentBriefVersion>0)&&typeof j.ready==='boolean'&&Array.isArray(j.missing)&&j.missing.every(function(x){return typeof x==='string';})&&Array.isArray(j.owners)&&j.owners.every(function(o){return o&&typeof o.id==='string'&&typeof o.label==='string';});}
 function lock(value){el('reviveSetupFields').disabled=value;el('setupSaveDraft').disabled=value;el('setupSaveReviewed').disabled=value;el('setupReviewed').disabled=value;}
 function load(){
  var ticket=generation,req=++request;ready=false;context=null;lock(true);notice('Loading client setup…');el('reviveSetupMissing').textContent='';
  var pending=api({operation:'get'}).then(function(j){if(ticket!==generation||req!==request)return;if(!j||j.ok!==true||j.delivery!=='not_sent'||!validContext(j.context))throw Error('The setup response could not be verified. Reload before editing.');context=j.context;fill();ready=true;lock(false);}).catch(function(e){if(ticket===generation&&req===request){notice(e.message);lock(true);}});
  var id=tenant.id;senderBadge([]);RP.wireConnections(id,function(){return ticket===generation&&!!tenant&&tenant.id===id;},senderBadge)();
  return pending;
 }
 function toTime(minute){return minute===null||minute===undefined?'':String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');}
 function fill(){
  var s=context.setup,b=s&&s.body||{};dirty=false;el('setupReviewed').checked=false;
  var owners=context.owners.slice();if(b.ownerId&&!owners.some(function(o){return o.id===b.ownerId;}))owners.push({id:b.ownerId,label:'Previous owner unavailable — choose a current owner before review'});
  el('setupOwner').innerHTML='<option value="">Unknown / not assigned</option>'+owners.map(function(o){return '<option value="'+esc(o.id)+'">'+esc(o.label)+'</option>';}).join('');
  var values={setupWebsite:b.website&&b.website.url,setupWebsiteReference:b.website&&b.website.reference,setupSenderName:b.senderName,setupSenderEmail:b.senderEmail,setupOwner:b.ownerId,setupMarket:b.market,setupLanguage:b.language,setupTimezone:b.timezone,setupSalesCapacity:b.salesCapacityPerWeek,setupOutcomeWindow:b.outcomeWindowDays,setupWorkingDays:b.workingDays&&b.workingDays.join(','),setupStart:toTime(b.startMinute),setupEnd:toTime(b.endMinute),setupDailyCap:b.dailyContactCap,setupRelationship:b.relationshipSummary&&b.relationshipSummary.text,setupRelationshipReference:b.relationshipSummary&&b.relationshipSummary.reference,setupReplyTo:b.replyTo,setupSignature:b.signature,setupBookingUrl:b.booking&&b.booking.url,setupBookingReference:b.booking&&b.booking.reference,setupPostalAddress:b.legalFooter&&b.legalFooter.postalAddress,setupPostalReference:b.legalFooter&&b.legalFooter.reference};
  Object.keys(values).forEach(function(id){el(id).value=values[id]===null||values[id]===undefined?'':values[id];});
  var sources=b.sourceInventory||[],claims=b.supportedClaims||[];sourceCount=Math.max(1,sources.length);claimCount=Math.max(1,claims.length);
  if(sourceCount>10||claimCount>10)throw Error('The setup has more rows than this editor supports. Do not save a truncated setup.');
  for(var i=0;i<10;i++){var source=sources[i]||{},claim=claims[i]||{};el('setupSourceType'+i).value=source.type||'website';el('setupSourceReference'+i).value=source.reference||'';el('setupSourceRights'+i).value=source.rightsReference||'';el('setupClaimText'+i).value=claim.text||'';el('setupClaimReference'+i).value=claim.reference||'';el('setupSourceRow'+i).hidden=i>=sourceCount;el('setupClaimRow'+i).hidden=i>=claimCount;}
  notice((s?'Setup v'+s.version+' · '+s.state:'No saved setup')+' · '+(context.currentBriefVersion?'current brief v'+context.currentBriefVersion:'no business brief yet')+'. '+(context.ready?'Reviewed preparation is complete; execution still requires its separate approvals and connections.':'Preparation is incomplete or needs current review.'));
  el('reviveSetupMissing').textContent=context.missing.length?'Still needed: '+context.missing.map(missingLabel).join('; '):'No setup fields are currently missing. Declared mailbox and capacity details are not provider verification.';
 }
 function senderBadge(rows){var verified=rows.some(function(c){return c.senderVerified===true;});RP.senderVerified[tenant.id]=verified;el('setupSenderBadge').textContent=verified?'Sender: verified against the connected mailbox.':'Sender: declared, not verified against a connected mailbox.';}
 function value(id){return el(id).value.trim();}function nullable(id){return value(id)||null;}function number(id){return value(id)===''?null:Number(value(id));}
 function minute(id){var v=value(id);if(!v)return null;var m=/^(\d{2}):(\d{2})$/.exec(v);if(!m||Number(m[2])>59||Number(m[1])>24||Number(m[1])===24&&Number(m[2])!==0)throw Error('Use a valid local HH:MM working window.');return Number(m[1])*60+Number(m[2]);}
 function body(){
  var sources=[],claims=[];
  for(var i=0;i<sourceCount;i++)if(value('setupSourceReference'+i)||value('setupSourceRights'+i)){if(!value('setupSourceReference'+i)||!value('setupSourceRights'+i))throw Error('Source row '+(i+1)+' needs both its source and permitted-use references, or leave the row blank.');sources.push({type:value('setupSourceType'+i),reference:value('setupSourceReference'+i),rightsReference:value('setupSourceRights'+i)});}
  for(var j=0;j<claimCount;j++)if(value('setupClaimText'+j)||value('setupClaimReference'+j)){if(!value('setupClaimText'+j)||!value('setupClaimReference'+j))throw Error('Claim row '+(j+1)+' needs both the supported claim and its reference, or leave the row blank.');claims.push({text:value('setupClaimText'+j),reference:value('setupClaimReference'+j)});}
  if(!!value('setupWebsite')!==!!value('setupWebsiteReference'))throw Error('Add both the supplied website URL and its reference, or leave both blank in a draft.');
  if(!!value('setupRelationship')!==!!value('setupRelationshipReference'))throw Error('Add both the relationship summary and its reference, or leave both blank in a draft.');
  var b={website:value('setupWebsite')||value('setupWebsiteReference')?{url:value('setupWebsite'),reference:value('setupWebsiteReference')}:null,supportedClaims:claims,sourceInventory:sources,relationshipSummary:value('setupRelationship')||value('setupRelationshipReference')?{text:value('setupRelationship'),reference:value('setupRelationshipReference')}:null,senderName:nullable('setupSenderName'),senderEmail:nullable('setupSenderEmail'),ownerId:nullable('setupOwner'),market:nullable('setupMarket'),language:nullable('setupLanguage'),timezone:nullable('setupTimezone'),salesCapacityPerWeek:number('setupSalesCapacity'),outcomeWindowDays:number('setupOutcomeWindow'),workingDays:value('setupWorkingDays')?value('setupWorkingDays').split(',').map(function(d){return Number(d.trim());}):null,startMinute:minute('setupStart'),endMinute:minute('setupEnd'),dailyContactCap:number('setupDailyCap')};
  // Brand profile keys are optional: sent only when set, so setups without them stay unchanged.
  if(!!value('setupBookingUrl')!==!!value('setupBookingReference'))throw Error('Add both the default booking URL and its reference, or leave both blank.');
  if(!!value('setupPostalAddress')!==!!value('setupPostalReference'))throw Error('Add both the postal address and its reference, or leave both blank.');
  var brand={replyTo:nullable('setupReplyTo'),signature:nullable('setupSignature'),booking:value('setupBookingUrl')?{url:value('setupBookingUrl'),reference:value('setupBookingReference')}:null,legalFooter:value('setupPostalAddress')?{postalAddress:value('setupPostalAddress'),reference:value('setupPostalReference')}:null};
  Object.keys(brand).forEach(function(k){if(brand[k]!==null)b[k]=brand[k];});
  // Mirror the Worker's deterministic format checks so a rejection never costs the operator's edits.
  if(b.market!==null)b.market=b.market.toUpperCase();if(b.market!==null&&!/^[A-Z]{2}$/.test(b.market))throw Error('Use a two-letter market code, e.g. AE.');
  if(b.language!==null&&!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(b.language))throw Error('Use a language tag such as en-AE.');
  if(b.timezone!==null){try{var tz=new Intl.DateTimeFormat('en',{timeZone:b.timezone}).resolvedOptions().timeZone;if(tz.toLowerCase()===b.timezone.toLowerCase())b.timezone=tz;}catch(e){throw Error('Use an IANA timezone such as Asia/Dubai.');}}
  if(b.workingDays!==null&&(new Set(b.workingDays).size!==b.workingDays.length||!b.workingDays.every(function(d){return Number.isInteger(d)&&d>=1&&d<=7;})))throw Error('Use distinct working days 1–7, comma-separated.');
  return b;
 }
 function save(state){
  if(!ready||!context){notice('Load the current client setup before saving.');return;}
  if(state==='reviewed'&&!el('setupReviewed').checked){notice('Review these exact details and select the review confirmation before saving as reviewed.');return;}
  var payload;try{payload={operation:'save',expectedVersion:context.setup?context.setup.version:0,briefVersion:context.currentBriefVersion,state:state,body:body()};}catch(e){notice(e.message);return;}
  if(state==='reviewed'&&(!payload.body.sourceInventory.length||['relationshipSummary','senderName','senderEmail','ownerId','market','language','timezone','outcomeWindowDays','startMinute','endMinute','dailyContactCap'].some(function(k){return payload.body[k]===null;})||!(payload.body.salesCapacityPerWeek>=1)||!payload.body.workingDays||!payload.briefVersion)){notice('Complete the missing setup fields and current business brief before saving as reviewed.');return;}
  var ticket=generation,req=++request,tenantId=tenant.id;ready=false;lock(true);notice('Saving '+state+' setup…');
  api(payload).then(function(j){
   if(ticket!==generation||req!==request)return;
   if(!j||j.ok!==true||j.tenantId!==tenantId||!Number.isInteger(j.version)||j.version<1||![payload.expectedVersion,payload.expectedVersion+1].includes(j.version)||j.briefVersion!==payload.briefVersion||j.state!==state||j.ready!==(state==='reviewed')||j.delivery!=='not_sent')throw Error('The setup acknowledgement is uncertain. Reload before another save; no activation or send was requested.');
   window.dispatchEvent(new CustomEvent('rp:revive-setup-changed',{detail:{tenantId:tenantId}}));return load();
  }).catch(function(e){if(ticket!==generation||req!==request)return;
   // A definitive 4xx rejection saved nothing; stale versions are re-rejected server-side, so edits stay usable.
   if([400,403,404,409].includes(e.status)){ready=true;lock(false);notice(e.message+' Nothing was saved; your edits are kept.');return;}
   ready=false;context=null;notice(e.message+' Reload saved setup before another change.');lock(true);});
 }
 window.addEventListener('rp:tenant-selected',function(e){++generation;++request;tenant=e.detail;ready=false;dirty=false;context=null;render();});
 window.addEventListener('rp:business-brief-changed',function(e){if(tenant&&e.detail&&e.detail.tenantId===tenant.id){++generation;++request;ready=false;context=null;lock(true);notice('The business brief changed. Reload setup and review it against the current brief before continuing.');}});
})();
/* Connections, channel choices and operator access, shared by the staff admin and the client portal.
   Credentials stay on the server; the browser only sees provider, identity, purposes and status. */
(function(){
 'use strict';
 var RP=window.RP,esc=RP.esc,el=function(id){return document.getElementById(id);},mail=['google_workspace','microsoft_365'];
 var providers={google_workspace:'Google Workspace',microsoft_365:'Microsoft 365',whatsapp_cloud:'WhatsApp',linkedin:'LinkedIn',sms:'SMS'},interest={whatsapp:'WhatsApp',linkedin:'LinkedIn (manual profile tasks only)',sms:'SMS'};
 var signIn=['accounts.google.com','login.microsoftonline.com'];
 function attr(e,name){return e&&e.target&&e.target.getAttribute?e.target.getAttribute(name):null;}
 RP.connectionsMarkup=function(){return '<section class="stack" id="connectionsSection"><h4>Connections and channels</h4><p class="hint">Connect the mailbox your messages are sent from. The sign-in is stored encrypted on Ripe Piper servers and is never shown here. The internal CRM record is always on. WhatsApp, LinkedIn and SMS are not yet available; choosing them only records interest.</p><div id="connectionsList"></div><fieldset><legend>Channels</legend><div class="field"><label for="channelEmail">Email provider</label><select id="channelEmail"><option value="">Not selected</option><option value="google">Google Workspace</option><option value="microsoft">Microsoft 365</option></select></div><label class="consent"><input id="channelCalendar" type="checkbox"><span>Calendar for booked meetings (needs an email provider)</span></label>'+Object.keys(interest).map(function(k){return '<label class="consent"><input id="channel_'+k+'" type="checkbox"><span>'+interest[k]+': not yet available, record interest</span></label>';}).join('')+'</fieldset><button id="channelsSave" class="btn btn-line" type="button">Save channel choices</button><p id="connectionsStatus" role="status"></p></section>';};
 /** Wires the markup above to one tenant and returns load(). isCurrent() guards every late response. */
 RP.wireConnections=function(tenantId,isCurrent,onList){
  var path='/api/admin/tenants/'+tenantId+'/connection',rows=[];
  function status(text){if(isCurrent())el('connectionsStatus').textContent=text;}
  function show(j){
   if(!j||!Array.isArray(j.connections)||j.connections.length>20||!j.connections.every(function(c){return c&&typeof c.id==='string'&&Object.prototype.hasOwnProperty.call(providers,c.provider)&&Array.isArray(c.purposes)&&typeof c.status==='string'&&Number.isInteger(c.version);}))throw Error('The connection list could not be verified. Reload before changing connections.');
   rows=j.connections;
   el('connectionsList').innerHTML=rows.length?'<ul>'+rows.map(function(c){var action=mail.indexOf(c.provider)<0?' · not yet available':c.status==='connected'?' <button type="button" class="btn btn-line" data-connection-revoke="'+esc(c.id)+'">Revoke</button>':' <button type="button" class="btn btn-line" data-connection-connect="'+esc(c.id)+'">Connect</button>';
    return '<li>'+esc(providers[c.provider])+' · '+esc(c.identity||'no account yet')+' · '+esc(c.purposes.join(', '))+' · '+esc(c.status)+(c.lastCheckedAt?' · checked '+esc(c.lastCheckedAt):'')+(c.expiresAt?' · expires '+esc(c.expiresAt):'')+(c.senderVerified===true?' · sender verified':'')+action+'</li>';}).join('')+'</ul>':'<p class="hint">No channels chosen yet.</p>';
   var email=rows.find(function(c){return mail.indexOf(c.provider)>=0;});
   el('channelEmail').value=email?(email.provider==='google_workspace'?'google':'microsoft'):'';el('channelCalendar').checked=!!email&&email.purposes.indexOf('calendar')>=0;
   Object.keys(interest).forEach(function(k){el('channel_'+k).checked=rows.some(function(c){return c.provider===(k==='whatsapp'?'whatsapp_cloud':k);});});
   if(onList)onList(rows);
  }
  function load(){status('Loading connections…');return RP.api(path,{operation:'connections'}).then(function(j){if(isCurrent()){show(j);status('');}}).catch(function(e){status(e.message);});}
  el('channelsSave').onclick=function(){
   var ch={};if(el('channelEmail').value)ch.email=el('channelEmail').value;if(el('channelCalendar').checked)ch.calendar=true;Object.keys(interest).forEach(function(k){if(el('channel_'+k).checked)ch[k]=true;});
   status('Saving channel choices…');RP.api(path,{operation:'select_channels',channels:ch}).then(function(j){if(isCurrent()){show(j);status('Channel choices saved. Use Connect to give consent for the email provider.');}}).catch(function(e){status(e.message);});
  };
  el('connectionsList').onclick=function(e){
   var connect=attr(e,'data-connection-connect'),revoke=attr(e,'data-connection-revoke'),c=rows.find(function(r){return r.id===(connect||revoke);});
   if(!c||!isCurrent())return;
   if(revoke){if(!window.confirm('Revoke this connection? Sending through it stops and the stored sign-in is deleted.'))return;status('Revoking…');RP.api(path,{operation:'revoke',connectionId:c.id,expectedVersion:c.version}).then(load).catch(function(err){status(err.message);});return;}
   status('Opening the provider sign-in…');
   RP.api('/api/admin/tenants/'+tenantId+'/connections/'+(c.provider==='google_workspace'?'google':'microsoft')+'/authorize',{purposes:c.purposes.filter(function(p){return p==='mail_send'||p==='calendar';})}).then(function(j){
    var u=null;try{u=new URL(j.url);}catch(x){u=null;}
    if(!u||u.protocol!=='https:'||signIn.indexOf(u.hostname)<0)throw Error('The sign-in link could not be verified. Nothing was connected.');
    if(isCurrent())window.location.assign(u.href);
   }).catch(function(err){status(err.message);});
  };
  return load;
 };
 var capabilities=[['read','See results and records'],['operate','Run the brief, setup and campaigns'],['approve','Approve envelopes and campaigns']];
 RP.grantsMarkup=function(staff){return '<section class="stack" id="grantsSection"><span class="kicker">Operator access</span><p class="hint">'+(staff?'Staff work in a client account only under the client’s grant or a contract reference recorded here.':'Choose which Ripe Piper operators may work in your account, what they may do and until when. You can revoke access at any time.')+' Every grant and revoke appears in the client activity timeline.</p><div id="grantsList"></div><div class="form-grid"><div class="field"><label for="grantEmail">Operator email</label><input id="grantEmail" type="email" maxlength="254"></div><div class="field"><label for="grantExpiry">Access ends on (UTC, within 366 days)</label><input id="grantExpiry" type="date"></div>'+(staff?'<div class="field"><label for="grantContract">Contract reference</label><input id="grantContract" type="text" maxlength="200"></div>':'')+'</div><fieldset><legend>Allowed to</legend>'+capabilities.map(function(c){return '<label class="consent"><input id="grantCap_'+c[0]+'" type="checkbox"><span>'+c[1]+'</span></label>';}).join('')+'</fieldset><button id="grantSave" class="btn btn-line" type="button">Grant access</button><p id="grantsStatus" role="status"></p></section>';};
 /** Same route for owners and staff; the Worker derives the authority from the caller, never from this form. Returns load(). */
 RP.wireGrants=function(tenantId,isCurrent,staff){
  var path='/api/admin/tenants/'+tenantId+'/operator-grants';
  function status(text){if(isCurrent())el('grantsStatus').textContent=text;}
  function show(j){
   if(!j||!Array.isArray(j.grants))throw Error('The access list could not be verified. Reload before changing access.');
   var now=Date.now();
   el('grantsList').innerHTML=j.grants.length?'<ul>'+j.grants.map(function(g){var active=!g.revoked_at&&Date.parse(g.expires_at)>now;
    return '<li>'+esc(g.operator&&g.operator.email||g.operator_id)+' · '+esc((g.capabilities||[]).join(', '))+' · '+(g.authority==='contract'?'contract '+esc(g.contract_reference):'granted by the client')+' · '+(g.revoked_at?'revoked '+esc(g.revoked_at):(active?'until ':'expired ')+esc(g.expires_at))+(active?' <button type="button" class="btn btn-line" data-grant-revoke="'+esc(g.id)+'">Revoke</button>':'')+'</li>';}).join('')+'</ul>':'<p class="hint">No operator has access.</p>';
  }
  function load(){return RP.api(path,{operation:'list'}).then(function(j){if(isCurrent())show(j);}).catch(function(e){status(e.message);});}
  function after(message){return function(){return load().then(function(){status(message);});};}
  el('grantSave').onclick=function(){
   var caps=capabilities.map(function(c){return c[0];}).filter(function(c){return el('grantCap_'+c).checked;}),day=el('grantExpiry').value,body={operation:'grant',operator_email:el('grantEmail').value.trim(),capabilities:caps,expires_at:day?day+'T23:59:59Z':''};
   if(staff)body.contract_reference=el('grantContract').value.trim();
   if(!body.operator_email||!caps.length||!day){status('Enter the operator email, at least one capability and an end date.');return;}
   status('Granting access…');RP.api(path,body).then(after('Access granted.')).catch(function(e){status(e.message);});
  };
  el('grantsList').onclick=function(e){
   var id=attr(e,'data-grant-revoke');if(!id||!isCurrent())return;
   if(!window.confirm('Revoke this operator access now?'))return;
   status('Revoking access…');RP.api(path,{operation:'revoke',grant_id:id}).then(after('Access revoked.')).catch(function(err){status(err.message);});
  };
  return load;
 };
})();
