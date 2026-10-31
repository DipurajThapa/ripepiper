/* Capability stays in this closure only. GET performs no API call. */
(function(){
 'use strict';
 var fragment=window.location.hash,token=null,button=document.getElementById('confirmStop'),status=document.getElementById('stopStatus'),busy=false;
 try { window.history.replaceState(null,'',window.location.pathname+window.location.search); }
 catch (_) { status.textContent='The link could not be secured in browser history. Confirmation is unavailable.';return; }
 var match=/^#token=([0-9a-f]{64})$/.exec(fragment);fragment=null;
 if(!match){status.textContent='This link is invalid or incomplete. Request a new link from the business.';return;}
 token=match[1];match=null;button.disabled=false;status.textContent='Ready. Use the button to confirm your contact stop.';
 button.onclick=async function(){
  if(busy||!token)return;busy=true;button.disabled=true;status.textContent='Confirming your contact stop…';
  try {
   var result=await fetch('/api/tenant-unsubscribe/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token}),cache:'no-store',referrerPolicy:'no-referrer',credentials:'omit'});
   var receipt=await result.json();
   var keys=receipt&&!Array.isArray(receipt)?Object.keys(receipt).sort().join(','):'';
   // Only a confirmation carries the sending business name; it is shown as text, never markup.
   if(!result.ok||receipt.version!==1||!(receipt.status==='invalid'&&keys==='status,version'||receipt.status==='confirmed'&&keys==='businessName,status,version'&&typeof receipt.businessName==='string'&&receipt.businessName.trim()&&receipt.businessName.length<=200))throw Error('unavailable');
   token=null;
   if(receipt.status==='confirmed'){var name=receipt.businessName.trim(),title=document.getElementById('stopTitle');if(title)title.textContent='Stop emails from '+name;status.textContent='Confirmed. Emails from '+name+' to this contact have been stopped.';}
   else status.textContent='This link is invalid or has expired. Request a new link from the business.';
  } catch (_) {status.textContent='We could not confirm the result. No success has been confirmed. You may try again using the button; this page will not retry automatically.';button.disabled=false;}
  finally {busy=false;}
 };
})();
