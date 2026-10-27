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
   if(!result.ok||!receipt||Array.isArray(receipt)||Object.keys(receipt).sort().join(',')!=='status,version'||receipt.version!==1||!['confirmed','invalid'].includes(receipt.status))throw Error('unavailable');
   token=null;
   status.textContent=receipt.status==='confirmed'?'Confirmed. The contact stop for this tenant’s outreach has been recorded.':'This link is invalid or has expired. Request a new link from the business.';
  } catch (_) {status.textContent='We could not confirm the result. No success has been confirmed. You may try again using the button; this page will not retry automatically.';button.disabled=false;}
  finally {busy=false;}
 };
})();
