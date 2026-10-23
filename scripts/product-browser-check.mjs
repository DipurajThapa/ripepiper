// Optional local rendered-browser acceptance. Uses the existing runtime's Playwright,
// real admin markup/styles/script, and an explicitly synthetic API fixture. No network.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=new URL('../',import.meta.url);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const failures=[];page.on('pageerror',e=>failures.push(e.message));
await page.route('**/*',route=>route.abort());
try {
 let html=await readFile(new URL('site/admin/index.html',root),'utf8');
 html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.setContent(html);
 await page.addStyleTag({content:await readFile(new URL('site/assets/site.css',root),'utf8')});
 await page.evaluate(()=>{
  document.querySelectorAll('[hidden]').forEach(n=>n.removeAttribute('hidden'));
  const panel=document.getElementById('prospectingPanel');document.body.replaceChildren(panel);panel.style.display='block';
  window.fixtureCalls=[];
  window.RP={esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api:async(path,body)=>{
   window.fixtureCalls.push({path,body});
   if(path.endsWith('/shortlist'))return {brief:null,leads:[{id:'lead-fixture',email:'fixture@example.invalid',company:'Synthetic company'}],results:[],synthetic:true};
   return {ok:true,results:[{row:1,state:'created'}]};
  }};
 });
 await page.addScriptTag({content:await readFile(new URL('site/assets/prospecting-admin.js',root),'utf8')});
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('rp:tenant-selected',{detail:{id:'tenant-fixture',name:'Synthetic Ripe Piper'}})));
 await page.getByText('Product history and outcomes',{exact:true}).click();
 for(const product of ['revive','signal','response','events']) {
  await page.selectOption('#productChoice',product);
  await page.fill('#productReference','source-'+product);await page.fill('#productRights','fixture-only');await page.fill('#productObserved','2026-10-22T12:00');await page.fill('#productExcerpt','Staff-reviewed synthetic source');
  if(product==='revive'){await page.fill('#lastContact','2026-08-01T12:00');await page.fill('#stalledReason','Unknown');}
  if(product==='signal'){await page.fill('#signalRelevance','Fixture business need');await page.fill('#signalExpiry','2026-11-22T12:00');}
  if(product==='response'){await page.fill('#threadRef','fixture-thread');await page.selectOption('#disposition','interested');}
  if(product==='events'){await page.fill('#eventRef','fixture-event');await page.fill('#eventEnd','2026-10-21T12:00');await page.fill('#eventTimezone','UTC');}
  await page.getByRole('button',{name:'Record reviewed event',exact:true}).click();
  await page.waitForFunction(p=>window.fixtureCalls.some(c=>c.path.endsWith('/product-event')&&c.body.context.product===p),product);
 }
 await page.getByText('Import permitted contacts',{exact:true}).click();
 await page.fill('#prospectImportRows','fixture@example.invalid\tFixture\tsource-import\tfixture-only\t2026-10-22');
 await page.getByRole('button',{name:'Validate and import',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('prospectImportReport').textContent.includes('created'));
 const contexts=await page.evaluate(()=>window.fixtureCalls.filter(c=>c.path.endsWith('/product-event')).map(c=>c.body.context));
 assert.equal(contexts.length,4);assert.equal(contexts[2].authority,'');assert.equal(contexts[3].attendance,'unknown');
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`Horizontal overflow at ${width}`);}
 assert.deepEqual(failures,[]);
 console.log('PASS: four rendered product forms, import/report, desktop/mobile overflow, no page errors; synthetic API only.');
}finally{await browser.close();}
