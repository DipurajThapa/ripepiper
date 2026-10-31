import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { buildPreview, previewServer } from './preview.mjs';

const root = new URL('../', import.meta.url);
for (const [form, fields, err, ok] of [
  ['gateForm', {gName:'Test',gEmail:'synthetic@example.invalid',gCompany:'Ripe Piper test',gConsent:true},'gErr','gOk'],
  ['optForm',{oEmail:'synthetic@example.invalid',oReason:'test'},'oErr','oOk'],
  ['nlForm',{nlEmail:'synthetic@example.invalid',nlConsent:true},'nlErr','nlOk']
]) {
  for (const config of [undefined,{live:false}]) test(`${form}: no config/live=false cannot report success or send`, async () => {
    const elements = Object.fromEntries(Object.entries(fields).map(([id,value])=>[id,{value:String(value),checked:value===true}]));
    elements[err]={textContent:''}; elements[ok]={hidden:true,innerHTML:''};
    let submit; elements[form]={addEventListener:(_name,handler)=>{submit=handler;}};
    let requests=0;
    const context={window:{RP_CONFIG:config},document:{querySelector:()=>null,querySelectorAll:()=>[],getElementById:id=>elements[id]||null},location:{hostname:'ripepiper.com',pathname:'/',search:'',hash:'',protocol:'https:'},URLSearchParams,sessionStorage:{getItem:()=>null,setItem:()=>{}},fetch:()=>{requests++;throw new Error('Network forbidden');}};
    vm.runInNewContext(await readFile(new URL('site/assets/site.js',root),'utf8'),context);
    submit({preventDefault(){}});
    assert.match(elements[err].textContent,/Nothing has been submitted or sent/);
    assert.equal(elements[ok].hidden,true);assert.equal(elements[ok].innerHTML,'');assert.equal(requests,0);
  });
}

test('live consultation UI forwards its one-use capability from lead response to booking API', async () => {
  const token='12345678-1234-4234-8234-123456789abc';
  const requests=[];
  const slot={getAttribute:()=> '2026-11-02T06:00:00Z',setAttribute(){},disabled:false};
  const result={hidden:true,innerHTML:'',scrollIntoView(){},querySelectorAll:()=>[slot],querySelector:()=>null,appendChild(){},addEventListener(_event,fn){this.click=fn}};
  const fields={
    fName:{value:'Synthetic User'},fEmail:{value:'synthetic@example.invalid'},fSite:{value:'example.invalid'},
    fDeal:{value:'2'},fCountry:{value:'India'},fPkg:{value:'revive'},fConsent:{checked:true},
    fErr:{textContent:''},fResult:result,bookForm:{addEventListener(_event,fn){this.submit=fn}},
  };
  const win={RP_CONFIG:{live:true,turnstileSiteKey:'test-key'},turnstile:{render(_node,opts){this.callback=opts.callback;return 1},execute(){this.callback('synthetic-token')},remove(){}}};
  const context={window:win,document:{body:{appendChild(){}},createElement:()=>({style:{},remove(){},firstChild:{}}),querySelector:()=>null,querySelectorAll:()=>[],getElementById:id=>fields[id]||null},
    location:{hostname:'ripepiper.com',pathname:'/book.html',search:'',hash:'',protocol:'https:'},URLSearchParams,
    sessionStorage:{getItem:()=>null,setItem:()=>{}},setTimeout,clearTimeout,
    fetch:async (_url,init)=>{const b=JSON.parse(init.body);requests.push(b);return {ok:true,json:async()=>requests.length===1?{ok:true,lead_id:'lead-1',booking_token:token,route:'calendar',slots:[{start:'2026-11-02T06:00:00Z',label:'Mon 2 Nov, 10:00 GST'}]}:{ok:true,label:'Mon 2 Nov, 10:00 GST'}};}};
  vm.runInNewContext(await readFile(new URL('site/assets/site.js',root),'utf8'),context);
  fields.bookForm.submit({preventDefault(){}});
  await new Promise(r=>setImmediate(r));
  result.click({target:{closest:()=>slot}});
  await new Promise(r=>setImmediate(r));
  assert.equal(requests.length,2,JSON.stringify({error:fields.fErr.textContent,result:result.innerHTML,token:requests[0]?.booking_token}));
  assert.equal(requests[1].lead_id,'lead-1');
  assert.equal(requests[1].booking_token,token);
  assert.equal('whatsapp' in requests[1],false);
});

test('book form is replaced with the email notice before input when not live', async () => {
  let replaced=null,listened=false;
  const bookForm={addEventListener(){listened=true},replaceWith(n){replaced=n}};
  const context={window:{RP_CONFIG:{live:false}},document:{createElement:()=>({}),querySelector:()=>null,querySelectorAll:()=>[],getElementById:id=>id==='bookForm'?bookForm:null},
    location:{hostname:'ripepiper.com',pathname:'/book.html',search:'',hash:'',protocol:'https:'},URLSearchParams,sessionStorage:{getItem:()=>null,setItem:()=>{}},fetch:()=>{throw new Error('Network forbidden');}};
  vm.runInNewContext(await readFile(new URL('site/assets/site.js',root),'utf8'),context);
  assert.equal(listened,false);assert.match(replaced.innerHTML,/mailto:hello@ripepiper\.com/);
});

test('newsletter loads Turnstile on pages without the script tag and sends its token', async () => {
  const requests=[],appended=[];
  const fields={nlEmail:{value:'synthetic@example.invalid'},nlConsent:{checked:true},nlErr:{textContent:''},nlOk:{hidden:true,innerHTML:''},nlForm:{addEventListener(_e,fn){this.submit=fn}}};
  const win={RP_CONFIG:{live:true,turnstileSiteKey:'test-key'}};
  const turnstile={render(_node,opts){this.callback=opts.callback;return 1},execute(){this.callback('synthetic-token')},remove(){}};
  const body={appendChild(el){appended.push(el);if(el.src){win.turnstile=turnstile;el.onload();}}};
  const context={window:win,document:{body,createElement:()=>({style:{},remove(){}}),querySelector:()=>null,querySelectorAll:()=>[],getElementById:id=>fields[id]||null},
    location:{hostname:'ripepiper.com',pathname:'/packages/revive.html',search:'',hash:'',protocol:'https:'},URLSearchParams,sessionStorage:{getItem:()=>null,setItem:()=>{}},setTimeout,clearTimeout,
    fetch:async (url,init)=>{requests.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({ok:true})};}};
  vm.runInNewContext(await readFile(new URL('site/assets/site.js',root),'utf8'),context);
  fields.nlForm.submit({preventDefault(){}});
  for(let i=0;i<5&&!requests.length;i++)await new Promise(r=>setImmediate(r));
  assert.equal(appended.filter(el=>el.src).length,1);assert.equal(appended.find(el=>el.src).src,'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  assert.equal(requests.length,1,fields.nlErr.textContent);assert.equal(requests[0].url,'/api/newsletter');assert.equal(requests[0].body.turnstile_token,'synthetic-token');
});

test('no public page ships the placeholder WhatsApp number', async () => {
  const files=(await readdir(new URL('site/',root),{recursive:true})).filter(f=>/\.(html|js)$/.test(f));
  for(const f of files)assert.ok(!(await readFile(new URL('site/'+f.replaceAll('\\','/'),root),'utf8')).includes('000 0000'),f);
});

test('preview copies preserve source and reject writes/API access', async () => {
  const temp=await mkdtemp(resolve(tmpdir(),'ripepiper-preview-'));
  let server;
  try {
    const before=await readFile(new URL('site/assets/config.js',root),'utf8');
    await buildPreview(temp);
    const win={};vm.runInNewContext(await readFile(resolve(temp,'assets/config.js'),'utf8'),{window:win});
    assert.equal(win.RP_CONFIG.live,false);assert.equal(win.RP_CONFIG.supabaseUrl,'');assert.equal(win.RP_CONFIG.apiBase,'');
    assert.equal(await readFile(new URL('site/assets/config.js',root),'utf8'),before);
    server=previewServer(temp);server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${server.address().port}`;
    const home=await fetch(url);assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/connect-src 'none'/);
    assert.match(await home.text(),/Sample data only/);
    assert.equal((await fetch(url+'/api/lead',{method:'POST',body:'{}'})).status,405);
    assert.equal((await fetch(url+'/api/slots')).status,403);
    assert.equal((await fetch(url+'/webhooks/stripe')).status,403);
    assert.equal((await fetch(url+'/%2e%2e%2fpackage.json')).status,404);
    assert.equal((await fetch(url+'/admin/')).status,200);
  } finally { if(server)await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true}); }
});

test('push hook rejects main and baseline writes but allows feature refs', () => {
  for(const ref of ['refs/heads/main','refs/tags/baseline/production-2026-10-22']){
    const r=spawnSync('sh',['.githooks/pre-push'],{cwd:root,input:`refs/heads/feature/x a ${ref} b\n`,encoding:'utf8'});assert.equal(r.status,1);
  }
  assert.equal(spawnSync('sh',['.githooks/pre-push'],{cwd:root,input:'refs/heads/feature/x a refs/heads/feature/x b\n'}).status,0);
});

test('default deploy command is blocked',()=>{
  const r=spawnSync(process.execPath,['platform/ripe-piper-platform/scripts/blocked-deploy.mjs'],{cwd:root,encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/explicit owner approval/);
});
