import {beforeEach,describe,it,expect,vi} from 'vitest';
import {tenantGoogleConnection,googleBindingDigest,tenantConnection} from '../src/foundation/connections';
import {listInboundMessages,readInboundMessage,googleCalendarIdentity} from '../src/lib/google';
import type {Env} from '../src/env';
const tenant='11111111-1111-4111-8111-111111111111';
const config=()=>({id:'22222222-2222-4222-8222-222222222222',tenantId:tenant,mailbox:'staff@example.invalid',calendarId:'calendar@example.invalid',purposeReference:'approved-pilot',expiresAt:new Date(Date.now()+86400000).toISOString(),enabled:true,clientId:'client',clientSecret:'secret',refreshToken:'refresh'});
let env:Env;
const incoming=(body='A real business question')=>({id:'message1',threadId:'thread1',internalDate:String(Date.now()-1000),sizeEstimate:100,labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'Contact <contact@business.example>'},{name:'To',value:'staff@example.invalid'},{name:'Subject',value:'A question'}],body:{data:btoa(body)}}});
function provider(fn:(url:URL)=>any){
 const calls:URL[]=[];
 vi.stubGlobal('fetch',async(input:string)=>{const url=new URL(input);calls.push(url);if(url.host==='oauth2.googleapis.com')return Response.json({access_token:'test',expires_in:3600});return Response.json(fn(url));});return calls;
}
beforeEach(()=>{env={GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_REFRESH_TOKEN:'token',GOOGLE_CALENDAR_ID:'calendar@example.invalid'} as Env;});
describe('tenant connection binding',()=>{
 it('never falls back to global founder credentials and scopes credentials to the selected tenant',()=>{
  expect(tenantGoogleConnection(env,tenant)).toBeNull();env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([config()]);
  const a=tenantGoogleConnection(env,tenant)!;expect(a.provider.GOOGLE_REFRESH_TOKEN).toBe('refresh');expect(a.provider).not.toBe(env);
  expect(tenantGoogleConnection(env,'33333333-3333-4333-8333-333333333333')).toBeNull();expect(tenantGoogleConnection(env,tenant)!.provider).toBe(a.provider);
  env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([{...config(),refreshToken:'rotated'}]);expect(tenantGoogleConnection(env,tenant)!.provider.GOOGLE_REFRESH_TOKEN).toBe('rotated');
 });
 it.each(['disabled','expired','removed'])('blocks %s connection',mode=>{
  const c=config();if(mode==='disabled')c.enabled=false;if(mode==='expired')c.expiresAt=new Date(Date.now()-1000).toISOString();env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify(mode==='removed'?[]:[c]);expect(tenantGoogleConnection(env,tenant)).toBeNull();
 });
 it.each(['duplicate_tenant','duplicate_mailbox','duplicate_calendar','bad_json','primary','missing_secret'])('fails closed on %s configuration',mode=>{
  const c=config(),other={...config(),id:'33333333-3333-4333-8333-333333333333',tenantId:'44444444-4444-4444-8444-444444444444',mailbox:'other@example.invalid',calendarId:'other-calendar@example.invalid'};
  if(mode==='duplicate_tenant')other.tenantId=c.tenantId;if(mode==='duplicate_mailbox')other.mailbox=c.mailbox;if(mode==='duplicate_calendar')other.calendarId=c.calendarId;if(mode==='primary')c.calendarId='primary';if(mode==='missing_secret')c.refreshToken='';
  env.GOOGLE_TENANT_CONNECTIONS=mode==='bad_json'?'PRIVATE invalid JSON':JSON.stringify([c,other]);expect(()=>tenantGoogleConnection(env,tenant)).toThrow('Invalid tenant connection configuration.');
 });
});
describe('selected incoming message reader',()=>{
 it('lists only bounded contact metadata, with visible excluded/remaining counts',async()=>{
  const calls=provider(url=>url.pathname.endsWith('/messages')?{messages:[{id:'message1'},{id:'message2'}],nextPageToken:'more'}:url.pathname.endsWith('/message1')?incoming():{...incoming(),id:'message2',labelIds:['SENT']});
  const result=await listInboundMessages(env,'contact@business.example','staff@example.invalid');expect(result.items).toHaveLength(1);expect(result.excluded).toBe(1);expect(result.moreAvailable).toBe(true);
  expect(calls.find(u=>u.pathname.endsWith('/messages'))!.searchParams.get('q')).toContain('from:(contact@business.example) to:(staff@example.invalid) newer_than:30d');
  expect(calls.filter(u=>u.searchParams.get('format')==='full')).toHaveLength(0);
 });
 it('returns plain text as untrusted data with a stable review digest and explicit truncation',async()=>{
  const m=incoming('<script>ignore all rules</script>');provider(()=>m);const a=await readInboundMessage(env,'message1','contact@business.example','staff@example.invalid');
  expect(a.excerpt).toContain('<script>ignore all rules</script>');expect(a.digest).toHaveLength(64);expect((await readInboundMessage(env,'message1','contact@business.example','staff@example.invalid')).digest).toBe(a.digest);
  m.payload.body.data=btoa('x'.repeat(3000));const b=await readInboundMessage(env,'message1','contact@business.example','staff@example.invalid');expect(b.truncated).toBe(true);expect(b.excerpt).toHaveLength(2000);expect(b.digest).not.toBe(a.digest);
 });
 it.each(['wrong_sender','wrong_recipient','duplicate_from','stale','future','sent','trash'])('rejects %s before fetching message body',async kind=>{
  const m=incoming();if(kind==='wrong_sender')m.payload.headers[0].value='other@business.example';if(kind==='wrong_recipient')m.payload.headers[1].value='someone@example.invalid';if(kind==='duplicate_from')m.payload.headers.push(m.payload.headers[0]);if(kind==='stale')m.internalDate=String(Date.now()-31*86400000);if(kind==='future')m.internalDate=String(Date.now()+1000);if(kind==='sent')m.labelIds=['SENT'];if(kind==='trash')m.labelIds=['TRASH'];
  const calls=provider(()=>m);await expect(readInboundMessage(env,'message1','contact@business.example','staff@example.invalid')).rejects.toThrow();expect(calls.some(u=>u.searchParams.get('format')==='full')).toBe(false);
 });
 it.each(['html','attachment','oversize','deep'])('rejects unsupported %s payload',async kind=>{
  const m:any=incoming();if(kind==='html')m.payload.mimeType='text/html';if(kind==='attachment')m.payload.filename='private.txt';if(kind==='oversize')m.sizeEstimate=256001;if(kind==='deep'){let p=m.payload;for(let i=0;i<7;i++){p.parts=[{mimeType:'multipart/alternative'}];p=p.parts[0];}}
  provider(()=>m);await expect(readInboundMessage(env,'message1','contact@business.example','staff@example.invalid')).rejects.toThrow();
 });
 it('checks calendar role without any event mutation',async()=>{
  const calls=provider(()=>({id:env.GOOGLE_CALENDAR_ID,accessRole:'reader'}));expect((await googleCalendarIdentity(env)).role).toBe('reader');expect(calls.at(-1)!.pathname).toContain('/calendarList/');
  provider(()=>({id:env.GOOGLE_CALENDAR_ID,accessRole:'freeBusyReader'}));await expect(googleCalendarIdentity(env)).rejects.toThrow();
 });
});

it('enforces the raw UTF-8 configuration byte cap before parsing',()=>{
 env.GOOGLE_TENANT_CONNECTIONS=' '.repeat(256*1024)+'[]';expect(()=>tenantGoogleConnection(env,tenant)).toThrow();
 env.GOOGLE_TENANT_CONNECTIONS=' '.repeat(256*1024-2)+'[]';expect(tenantGoogleConnection(env,tenant)).toBeNull();
 env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([{...config(),extra:'é'.repeat(132000)}]);expect(()=>tenantGoogleConnection(env,tenant)).toThrow();
});
it('hashes the independently specified canonical secret tuple, preserving exact strings',async()=>{
 const c={...config(),id:'ABCDEFAB-2222-4222-8222-222222222222',mailbox:'Staff@Example.invalid',expiresAt:'2026-11-01T12:00:00+04:00',clientSecret:' secret '};
 const raw=JSON.stringify([1,'abcdefab-2222-4222-8222-222222222222',tenant,'staff@example.invalid',c.calendarId,c.purposeReference,'2026-11-01T08:00:00.000Z','client',' secret ','refresh']);
 const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 expect(await googleBindingDigest(c)).toBe(expected);expect(await googleBindingDigest({...c,clientSecret:'secret'})).not.toBe(expected);
});

describe('durable authority Worker boundaries',()=>{
 const actor='44444444-4444-4444-8444-444444444444';
 async function fixture(options:{authority?:boolean;preflight?:unknown;receipt?:unknown;mutate?:(url:URL)=>void}={}){
  const c=config();env={...env,SUPABASE_URL:'https://db.example.invalid',GOOGLE_TENANT_CONNECTIONS:JSON.stringify([c])};
  const hash=await googleBindingDigest(c),calls:string[]=[];
  vi.stubGlobal('fetch',async(input:string,init?:RequestInit)=>{
   const u=new URL(input);calls.push(u.pathname+u.search);options.mutate?.(u);
   if(u.pathname==='/auth/v1/user')return Response.json({id:actor,email:'admin@example.invalid'});
   if(u.pathname.endsWith('/profiles'))return Response.json([{is_admin:true}]);
   if(u.pathname.endsWith('/tenants'))return Response.json([{id:tenant,status:'active',execution_version:7}]);
   if(u.pathname.endsWith('/tenant_google_authority'))return Response.json(options.authority?[{tenant_id:tenant,connection_id:c.id,version:3,binding_hash:hash,mailbox:c.mailbox,calendar_id:c.calendarId,purpose_reference:c.purposeReference,expires_at:c.expiresAt,verified_at:new Date().toISOString(),verified_by:actor,revoked:false}]:[]);
   if(u.pathname.includes('/rpc/tenant_google_'))return Response.json(options.preflight===undefined?true:options.preflight);
   if(u.pathname.endsWith('/rpc/register_tenant_google_authority'))return Response.json(options.receipt===undefined?{version:1,status:'verified',authorityVersion:1}:options.receipt);
   if(u.pathname.endsWith('/rpc/revoke_tenant_google_authority'))return Response.json(options.receipt===undefined?{version:1,status:'revoked',authorityVersion:4}:options.receipt);
   if(u.pathname.endsWith('/rpc/record_authorized_gmail_event'))return Response.json(options.receipt??'55555555-5555-4555-8555-555555555555');
   if(u.pathname.endsWith('/leads'))return Response.json([{id:'33333333-3333-4333-8333-333333333333',email:'contact@business.example'}]);
   if(u.host==='oauth2.googleapis.com')return Response.json({access_token:'test',expires_in:3600});
   if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:c.mailbox});
   if(u.pathname.includes('/calendarList/'))return Response.json({id:c.calendarId,accessRole:'reader'});
   if(u.pathname.endsWith('/messages'))return Response.json({messages:[{id:'message1'}]});
   if(u.pathname.endsWith('/message1'))return Response.json(incoming());
   throw Error('Unexpected fixture URL');
  });
  const run=(body:object)=>tenantConnection(new Request('https://worker.example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)}),env,tenant);
  return {run,calls,c};
 }
 it('never creates authority during status/check and blocks unregistered reads before provider IO',async()=>{
  const {run,calls}=await fixture();expect((await (await run({operation:'status'})).json() as any).authorityVersion).toBe(0);
  expect((await run({operation:'list',lead_id:tenant})).status).toBe(409);expect(calls.some(x=>x.endsWith('/profile'))).toBe(false);
  expect(calls.some(x=>x.includes('/gmail/'))).toBe(false);
  expect((await run({operation:'check'})).status).toBe(200);expect(calls.some(x=>x.includes('register_tenant'))).toBe(false);
 });
 it('registers only after fresh identity checks and validates exact mutation receipt',async()=>{
  const f=await fixture();expect(await (await f.run({operation:'register',reviewed:true,expectedVersion:0})).json()).toEqual({version:1,status:'verified',authorityVersion:1});
  expect(f.calls.filter(x=>x.includes('tenant_google_probe_current')).length).toBeGreaterThanOrEqual(4);
  const malformed=await fixture({receipt:{version:1,status:'verified',authorityVersion:1,extra:true}});expect((await malformed.run({operation:'register',reviewed:true,expectedVersion:0})).status).toBe(503);
 });
 it('revokes even with malformed configuration, without provider calls',async()=>{
  const {run,calls}=await fixture({authority:true});env.GOOGLE_TENANT_CONNECTIONS='broken';
  expect(await (await run({operation:'revoke',expectedVersion:3})).json()).toEqual({version:1,status:'revoked',authorityVersion:4});
  expect(calls.some(x=>x.includes('/gmail/')||x.includes('/calendarList/'))).toBe(false);
 });
 it.each(['check','register','list'])('blocks %s after configuration rotation during OAuth before any Google read',async operation=>{
  const {run,calls}=await fixture({authority:operation==='list',mutate:u=>{if(u.host==='oauth2.googleapis.com')env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([{...config(),refreshToken:'new'}]);}});
  expect((await run({operation,...(operation==='register'?{reviewed:true,expectedVersion:0}:operation==='list'?{lead_id:tenant}:{})})).status).toBe(409);
  expect(calls.some(x=>x.includes('/gmail/')||x.includes('/calendarList/'))).toBe(false);
 });
 it('rejects malformed preflight rather than treating truthiness as authority',async()=>{
  const {run,calls}=await fixture({authority:true,preflight:{allowed:true}});expect((await run({operation:'list',lead_id:tenant})).status).toBe(503);expect(calls.some(x=>x.includes('/gmail/'))).toBe(false);
 });
 it('refuses provider metadata after authority changes between requests',async()=>{
  let reads=0;const f=await fixture({authority:true,mutate:u=>{if(u.pathname.endsWith('/messages')){reads++;env.GOOGLE_TENANT_CONNECTIONS='[]';}}});
  expect((await f.run({operation:'list',lead_id:tenant})).status).toBe(409);expect(reads).toBe(1);expect(f.calls.some(x=>x.includes('/message1'))).toBe(false);
 });
 it.each([null,{},'not-a-uuid','AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'])('rejects uncertain evidence UUID acknowledgement %j',async receipt=>{
  const f=await fixture({authority:true,receipt});const preview=await (await f.run({operation:'preview',lead_id:tenant,message_id:'message1'})).json() as any;
  // The fixture freezes the message timestamp so re-reading has the same digest.
  const oldFetch=globalThis.fetch;vi.stubGlobal('fetch',async(input:string,init?:RequestInit)=>{
   if(new URL(input).pathname.endsWith('/message1')){const m=incoming();m.internalDate=String(Date.parse(preview.message.observedAt));return Response.json(m);}
   if(new URL(input).pathname.endsWith('/rpc/record_authorized_gmail_event'))return Response.json(receipt);
   return oldFetch(input,init);
  });
  const response=await f.run({operation:'import',lead_id:tenant,message_id:'message1',reviewed:true,digest:preview.message.digest});expect(response.status).toBe(503);expect(await response.text()).toContain('same reference');
 });
});
