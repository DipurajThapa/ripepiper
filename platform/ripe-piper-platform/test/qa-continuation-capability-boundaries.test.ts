import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import worker from '../src/index';
import {Db,DbError} from '../src/lib/db';
import {confirmTenantUnsubscribe,tenantUnsubscribe,unsubscribeOrigin} from '../src/foundation/tenant-unsubscribe';
import type {Env} from '../src/env';
import {gateRpc} from './helpers/tenant-gate';

// Independent QA: synthetic transport only; no network or provider credentials.
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lead='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',actor='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const token='ab'.repeat(32),env={SITE_URL:'https://outreach.fixture.invalid'} as Env;
const request=(body:unknown)=>new Request('https://hostile.fixture.invalid/api',{method:'POST',headers:{Authorization:'Bearer fixture',Origin:'https://hostile.fixture.invalid'},body:JSON.stringify(body)});
beforeEach(()=>{vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id:actor,email:'staff@fixture.invalid',is_admin:true});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('independent capability boundary adversaries',()=>{
 it('GET and HEAD routed requests cannot consume a capability or touch DB/provider',async()=>{
  const rpc=gateRpc(),fetch=vi.fn(()=>{throw Error('Forbidden network');});vi.stubGlobal('fetch',fetch);
  for(const method of ['GET','HEAD']){
   const response=await worker.fetch(new Request('https://fixture.invalid/api/tenant-unsubscribe/confirm?token='+token,{method}),env,{} as ExecutionContext);
   expect(response.status).toBe(404);expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(Db.prototype.userFromToken).not.toHaveBeenCalled();
 });
 it.each([{token:token.toUpperCase()},{token:token+'00'},{token:token.slice(2)},{token:' '+token},{token},{token,tenantId:tenant},{token,leadId:lead},{token,confirmed:true}])('accepts only literal lowercase token input %j',async body=>{
  const rpc=gateRpc().mockResolvedValue({version:1,status:'invalid'});
  const response=await confirmTenantUnsubscribe(request(body),env);
  if(Object.keys(body).length===1&&body.token===token){
   expect(response.status).toBe(200);
   const digest=createHash('sha256').update(token,'utf8').digest('hex');
   expect(rpc).toHaveBeenCalledWith('confirm_tenant_unsubscribe',{p_hash:digest});
   expect(digest).not.toBe(createHash('sha256').update(Buffer.from(token,'hex')).digest('hex'));
  }else{expect(response.status).toBe(400);expect(rpc).not.toHaveBeenCalled();}
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');expect(response.headers.get('Cache-Control')).toBe('no-store');
 });
 it.each([null,true,[],{version:1,status:'confirmed',tenantId:tenant},{version:'1',status:'confirmed'},{version:1,status:'stopped'},{version:1,status:'CONFIRMED'},{version:1,status:'invalid',email:'private@fixture.invalid'}])('never turns malformed SQL confirmation %j into success or metadata',async receipt=>{
  gateRpc().mockResolvedValue(receipt);
  const response=await confirmTenantUnsubscribe(request({token}),env);expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/confirmed|aaaaaaaa|private@|abababab/);
 });
 it('keeps confirmed and invalid replies minimal and never authenticates bearer callers',async()=>{
  const rpc=gateRpc();
  for(const receipt of [{version:1,status:'confirmed',businessName:'Fixture business'},{version:1,status:'invalid'}]){rpc.mockResolvedValue(receipt);const response=await confirmTenantUnsubscribe(request({token}),env);expect(await response.json()).toEqual(receipt);}
  expect(Db.prototype.userFromToken).not.toHaveBeenCalled();
 });
 it.each(['record','issue_link'])('rejects extra %s arguments before mutation',async operation=>{
  const rpc=gateRpc();const response=await tenantUnsubscribe(request({operation,reference:'Verified fixture objection',actor,tenantId:tenant}),env,tenant,lead);
  expect(response.status).toBe(400);expect(rpc).not.toHaveBeenCalled();
 });
 it('uses SITE_URL rather than hostile Host/Origin and persists only the returned token hash',async()=>{
  const rpc=gateRpc().mockResolvedValue({version:1,status:'issued',expiresAt:'2027-01-01T00:00:00Z'});
  const response=await tenantUnsubscribe(request({operation:'issue_link'}),env,tenant,lead);expect(response.status).toBe(201);
  const receipt:any=await response.json(),url=new URL(receipt.url),raw=url.hash.slice('#token='.length);
  expect(url.origin).toBe(env.SITE_URL);expect(raw).toMatch(/^[0-9a-f]{64}$/);expect(receipt.delivery).toBe('not_sent');
  expect(rpc).toHaveBeenCalledWith('issue_tenant_unsubscribe',{p_tenant:tenant,p_lead:lead,p_actor:actor,p_hash:createHash('sha256').update(raw).digest('hex')});
  expect(JSON.stringify(rpc.mock.calls)).not.toContain(raw);
 });
 it.each(['https://localhost','https://127.0.0.1','http://public.fixture.invalid','https://user:secret@fixture.invalid','https://fixture.invalid/path','https://fixture.invalid/?token=secret','https://fixture.invalid/#secret','javascript:alert(1)'])('rejects unsafe configured origin %s before issuing',async site=>{
  expect(()=>unsubscribeOrigin(site)).toThrow();const rpc=gateRpc();
  expect((await tenantUnsubscribe(request({operation:'issue_link'}),{...env,SITE_URL:site},tenant,lead)).status).toBe(503);expect(rpc).not.toHaveBeenCalled();
 });
 it.each(['http://localhost:8787','http://127.0.0.1:8787','http://[::1]:8787'])('permits explicit local fixture origin %s',site=>{expect(unsubscribeOrigin(site)).toBe(site);});
 it.each([{version:1,status:'stopped',tenantId:lead,leadId:lead,alreadyStopped:false},{version:1,status:'stopped',tenantId:tenant,leadId:tenant,alreadyStopped:false},{version:1,status:'stopped',tenantId:tenant,leadId:lead,alreadyStopped:'false'},{version:1,status:'stopped',tenantId:tenant,leadId:lead,alreadyStopped:false,token}])('refuses a foreign or ambiguous staff stop acknowledgement %j',async receipt=>{
  gateRpc().mockResolvedValue(receipt);expect((await tenantUnsubscribe(request({operation:'record',reference:'Verified objection reference'}),env,tenant,lead)).status).toBe(503);
 });
 it.each([['42501',403],['P0002',404],['22023',400],['40001',503],['unrecognized',503]] as const)('maps controlled SQL %s without returning private diagnostics',async(code,status)=>{
  gateRpc().mockRejectedValue(new DbError(400,JSON.stringify({code,message:'PRIVATE_TOKEN='+token})));
  const response=await tenantUnsubscribe(request({operation:'issue_link'}),env,tenant,lead);expect(response.status).toBe(status);expect(await response.text()).not.toContain('PRIVATE_TOKEN');
 });
});

