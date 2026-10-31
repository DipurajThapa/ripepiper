import {describe,it,expect,vi} from 'vitest';
import {buildTenantSend,sendTenantMail,tenantMeeting,tenantBusy,TenantSendBlocked} from '../src/foundation/tenant-send';
import {executeSyntheticAction} from '../src/foundation/action-reliability';
import {calendarEventId} from '../src/lib/google';
import {baseEnv,brandSetup,fakeDb,googleConnection,microsoftConnection} from './helpers/tenant-send';
const tA='a1111111-1111-4111-8111-111111111111',tB='b1111111-1111-4111-8111-111111111111';
const link='https://ripepiper.com/unsubscribe.html#token='+'ab'.repeat(32);
const action={to:'buyer@prospect.example',subject:'Following up',body:'Hello,\n\nIs the project still relevant?',unsubscribeUrl:link};
const decode=(b64:string)=>new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));
type Call={url:URL;init:RequestInit};
/** Answers only the Google and Microsoft hosts; each token endpoint returns an access token derived from the refresh token it was given. */
function providers(graph:(url:URL)=>Response=url=>url.pathname.endsWith('/send')?new Response(null,{status:202}):Response.json({id:'draft-B'})){
 const calls:Call[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string,init:RequestInit={})=>{
  const url=new URL(input);calls.push({url,init});
  if(url.host==='oauth2.googleapis.com'||url.host==='login.microsoftonline.com')return Response.json({access_token:'at:'+new URLSearchParams(String(init.body)).get('refresh_token'),expires_in:3600});
  if(url.host==='gmail.googleapis.com')return Response.json({id:'gmail-A'});
  if(url.host==='graph.microsoft.com')return graph(url);
  if(url.host==='www.googleapis.com'&&url.pathname.endsWith('/freeBusy'))return Response.json({calendars:{'cal-a@group.calendar.google.com':{busy:[{start:'2026-11-02T05:00:00Z',end:'2026-11-02T06:00:00Z'}]}}});
  if(url.host==='www.googleapis.com'){const b=JSON.parse(String(init.body));return Response.json({...b,status:'confirmed',conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}]}});}
  throw Error('Unexpected host '+url.host);
 }));
 return calls;
}
const auth=(c:Call)=>(c.init.headers as any)?.Authorization;
describe('tenant send adapters (network stubbed, synthetic identities)',()=>{
 it('sends concurrently for tenant A (Google) and B (Microsoft), each with only its own From, signature and token',async()=>{
  const calls=providers();
  const a=googleConnection(tA,'owner@alpha.example','rt-A','cal-a@group.calendar.google.com'),b=microsoftConnection('sales@beta.example','rt-B');
  const mailA=buildTenantSend(a,brandSetup('Alpha','Owner@Alpha.example',{replyTo:'replies@alpha.example'}),'Alpha Ltd',action);
  const mailB=buildTenantSend(b,brandSetup('Beta','sales@beta.example'),'Beta LLC',action);
  expect(await Promise.all([sendTenantMail(baseEnv('true'),a,mailA),sendTenantMail(baseEnv('true'),b,mailB)])).toEqual([{messageId:'gmail-A'},{messageId:'draft-B'}]);
  const gmail=calls.filter(c=>c.url.host==='gmail.googleapis.com'),graph=calls.filter(c=>c.url.host==='graph.microsoft.com');
  expect(gmail).toHaveLength(1);expect(graph.map(c=>c.url.pathname)).toEqual(['/v1.0/me/messages','/v1.0/me/messages/draft-B/send']);
  expect(auth(gmail[0])).toBe('Bearer at:rt-A');expect(graph.every(c=>auth(c)==='Bearer at:rt-B')).toBe(true);
  const rawA=decode(JSON.parse(String(gmail[0].init.body)).raw),rawB=decode(String(graph[0].init.body));
  expect(rawA).toContain('From: "Alpha" <owner@alpha.example>\r\n');expect(rawA).toContain('Reply-To: replies@alpha.example\r\n');expect(rawA).toContain(`List-Unsubscribe: <${link}>\r\n`);
  expect(rawA).toContain('Alpha\nHead of Sales\n\n1 Alpha Street, Dubai, AE');expect(rawA).toContain('Unsubscribe: '+link);
  expect(rawB).toContain('From: "Beta" <sales@beta.example>\r\n');expect(rawB).toContain('Beta\nHead of Sales');
  for(const leak of ['Beta','beta.example','rt-B'])expect(rawA).not.toContain(leak);
  for(const leak of ['Alpha','alpha.example','rt-A'])expect(rawB).not.toContain(leak);
  expect(rawA).not.toContain('ripepiper.com>');expect(rawA).not.toContain('List-Unsubscribe-Post');
 });
 it('keeps an approved body that already carries the sign-off unchanged apart from the unsubscribe line',()=>{
  const c=googleConnection(tA,'owner@alpha.example','rt-A','cal-a'),setup=brandSetup('Alpha','owner@alpha.example');
  const signed=buildTenantSend(c,setup,'Alpha Ltd',action).text.replace(/\n\nUnsubscribe: .*$/,'');
  expect(buildTenantSend(c,setup,'Alpha Ltd',{...action,body:signed}).text).toBe(`${signed}\n\nUnsubscribe: ${link}`);
 });
 it.each([
  ['sender_unverified',{senderEmail:'other@alpha.example'},link],
  ['sender_unverified',{senderEmail:null},link],
  ['legal_footer_required',{legalFooter:null},link],
  ['legal_footer_required',{legalFooter:undefined},link],
  ['unsubscribe_required',{},null],
  ['unsubscribe_required',{},'https://ripepiper.com/unsubscribe.html#token=short'],
  ['unsubscribe_required',{},'http://ripepiper.com/unsubscribe.html#token='+'ab'.repeat(32)],
 ])('blocks %s before any provider call',async(code,patch,url)=>{
  const calls=providers();
  expect(()=>buildTenantSend(googleConnection(tA,'owner@alpha.example','rt-A','cal-a'),brandSetup('Alpha','owner@alpha.example',patch),'Alpha Ltd',{...action,unsubscribeUrl:url})).toThrow(new TenantSendBlocked(code as any));
  expect(calls).toHaveLength(0);
 });
 it('invites from the client calendar in the setup timezone, and only with the send flag on',async()=>{
  const calls=providers(()=>Response.json({id:'evt-B',onlineMeeting:{joinUrl:'https://teams.microsoft.com/l/x'}}));
  const input={id:'c1111111-1111-4111-8111-111111111111',start:'2026-11-02T05:00:00Z',end:'2026-11-02T05:30:00Z',email:'buyer@prospect.example',name:'Buyer',summary:'Alpha Ltd: project review',description:'Synthetic'};
  const a=googleConnection(tA,'owner@alpha.example','rt-A','cal-a@group.calendar.google.com'),setup=brandSetup('Alpha','owner@alpha.example');
  await expect(tenantMeeting(baseEnv(),a,setup,input)).rejects.toThrow('send_disabled');expect(calls).toHaveLength(0);
  expect(await tenantMeeting(baseEnv('true'),a,setup,input)).toEqual({eventId:calendarEventId(input.id),joinUrl:'https://meet.google.com/abc-defg-hij'});
  const insert=calls.find(c=>c.url.host==='www.googleapis.com')!,body=JSON.parse(String(insert.init.body));
  expect(insert.url.pathname).toBe('/calendar/v3/calendars/cal-a%40group.calendar.google.com/events');expect(auth(insert)).toBe('Bearer at:rt-A');
  expect(body.start.timeZone).toBe('Asia/Kolkata');expect(body.end.timeZone).toBe('Asia/Kolkata');
  const before=calls.length;await expect(tenantMeeting(baseEnv('true'),a,setup,{...input,start:'2026-11-02T05:00:00'})).rejects.toThrow('explicit offset');expect(calls).toHaveLength(before);
  expect(await tenantMeeting(baseEnv('true'),microsoftConnection('sales@beta.example','rt-B'),brandSetup('Beta','sales@beta.example'),input)).toEqual({eventId:'evt-B',joinUrl:'https://teams.microsoft.com/l/x'});
  const event=calls.find(c=>c.url.host==='graph.microsoft.com')!;
  expect(JSON.parse(String(event.init.body)).transactionId).toBe(input.id);expect(auth(event)).toBe('Bearer at:rt-B');
 });
 it('reads busy times from the client calendar only',async()=>{
  const calls=providers(()=>Response.json({value:[]}));
  const from=new Date('2026-11-02T00:00:00Z'),to=new Date('2026-11-03T00:00:00Z');
  expect(await tenantBusy(baseEnv(),googleConnection(tA,'owner@alpha.example','rt-A','cal-a@group.calendar.google.com'),from,to)).toEqual([{start:new Date('2026-11-02T05:00:00Z'),end:new Date('2026-11-02T06:00:00Z')}]);
  expect(JSON.parse(String(calls.find(c=>c.url.pathname.endsWith('/freeBusy'))!.init.body)).items).toEqual([{id:'cal-a@group.calendar.google.com'}]);
  expect(await tenantBusy(baseEnv(),microsoftConnection('sales@beta.example','rt-B'),from,to)).toEqual([]);
 });
});
describe('tenant send through the fenced action (TENANT_SEND_ENABLED on, stubbed providers)',()=>{
 it('holds an uncertain Microsoft send with the draft id and never sends twice',async()=>{
  const calls=providers(url=>url.pathname.endsWith('/send')?new Response('PRIVATE',{status:503}):Response.json({id:'draft-B'}));
  const c=microsoftConnection('sales@beta.example','rt-B'),f=fakeDb(tB,brandSetup('Beta','sales@beta.example'),{name:'Beta LLC'});
  const r=await executeSyntheticAction(f.db,baseEnv('true'),f.row.id,tB,async()=>c);
  expect(r.status).toBe(503);expect(await r.text()).not.toContain('PRIVATE');
  expect(f.row).toMatchObject({state:'review',provider_ref:'draft-B',error_code:'uncertain_result',connection_id:c.connectionId,connection_version:5});
  expect((await executeSyntheticAction(f.db,baseEnv('true'),f.row.id,tB,async()=>c)).status).toBe(409);
  expect(calls.filter(x=>x.url.pathname==='/v1.0/me/messages')).toHaveLength(1);
  expect(calls.filter(x=>x.url.pathname.endsWith('/send'))).toHaveLength(1);
  expect(f.calls.some(x=>x.name==='complete_fenced_synthetic_action')).toBe(false);
 });
 it('calls the provider once after the connection preflight and holds the accepted send for reconciliation',async()=>{
  const calls=providers(),c=googleConnection(tA,'owner@alpha.example','rt-A','cal-a'),f=fakeDb(tA,brandSetup('Alpha','owner@alpha.example'),{name:'Alpha Ltd'});
  expect((await executeSyntheticAction(f.db,baseEnv('true'),f.row.id,tA,async()=>c)).status).toBe(202);
  expect(f.row).toMatchObject({state:'review',provider_ref:'gmail-A',error_code:'provider_accepted',connection_id:c.connectionId,connection_version:2});
  expect(f.calls.find(x=>x.name==='tenant_connection_current')?.args).toEqual({p_tenant:tA,p_connection:c.connectionId,p_execution_version:3,p_version:2,p_purpose:'mail_send'});
  expect(calls.filter(x=>x.url.host==='gmail.googleapis.com')).toHaveLength(1);
 });
 it('makes no provider send when the connection is no longer current',async()=>{
  const calls=providers(),f=fakeDb(tA,brandSetup('Alpha','owner@alpha.example'),{current:false});
  expect((await executeSyntheticAction(f.db,baseEnv('true'),f.row.id,tA,async()=>googleConnection(tA,'owner@alpha.example','rt-A','cal-a'))).status).toBe(503);
  expect(calls.filter(x=>x.url.host==='gmail.googleapis.com')).toHaveLength(0);expect(f.row).toMatchObject({state:'review',error_code:'sender_unverified',provider_ref:null});
 });
 it('holds a send whose sender does not match the connected mailbox, with no provider call',async()=>{
  const calls=providers(),f=fakeDb(tA,brandSetup('Alpha','spoof@alpha.example'));
  expect((await executeSyntheticAction(f.db,baseEnv('true'),f.row.id,tA,async()=>googleConnection(tA,'owner@alpha.example','rt-A','cal-a'))).status).toBe(409);
  expect(calls).toHaveLength(0);expect(f.row).toMatchObject({state:'review',error_code:'sender_unverified'});
 });
});
