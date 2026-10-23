import {beforeEach,describe,it,expect,vi} from 'vitest';
import {tenantGoogleConnection} from '../src/foundation/connections';
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
