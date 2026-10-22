import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
