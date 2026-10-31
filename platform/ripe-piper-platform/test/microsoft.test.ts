import {describe,it,expect,vi} from 'vitest';
import type {Env} from '../src/env';
import {msToken,msSendMail,msBusyTimes,msCreateEvent,type MsAccount} from '../src/lib/microsoft';
const env={MS_CLIENT_ID:'m-client',MS_CLIENT_SECRET:'m-secret'} as Env;
const p={id:'11111111-1111-4111-8111-111111111111',start:'2026-11-01T08:00:00Z',end:'2026-11-01T08:15:00Z',email:'fixture@example.invalid',name:'Fixture',summary:'Test',description:'Synthetic'};
const HOSTS=['login.microsoftonline.com','graph.microsoft.com'];
// network-guard.ts blocks real fetch; this stub answers only the two Microsoft hosts and records every call.
function stub(fn:(url:URL,init:RequestInit)=>Response|Promise<Response>,token:Record<string,unknown>={access_token:'at-1',expires_in:3600}){
 const calls:{url:URL;init:RequestInit}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string,init:RequestInit={})=>{
  const url=new URL(input);calls.push({url,init});
  if(!HOSTS.includes(url.host))throw new Error('unexpected host '+url.host);
  if(url.host==='login.microsoftonline.com')return Response.json(token);
  return fn(url,init);
 }));return calls;
}
const mail={from:'"Client Co" <owner@client.example>',to:'fixture@example.invalid',subject:'Hello',text:'Body'};
describe('Microsoft Graph adapter',()=>{
 it('creates a MIME draft, then sends it, after the preflight, and returns the draft id',async()=>{
  const order:string[]=[];
  const calls=stub((url,init)=>{order.push(`${init.method} ${url.pathname}`);return url.pathname.endsWith('/send')?new Response(null,{status:202}):Response.json({id:'AAMkAD=='},{status:201});});
  const r=await msSendMail(env,{refreshToken:'rt'},mail,async()=>{order.push('preflight');});
  expect(r).toEqual({messageId:'AAMkAD=='});
  expect(order).toEqual(['preflight','POST /v1.0/me/messages','POST /v1.0/me/messages/AAMkAD%3D%3D/send']);
  const draft=calls.find(c=>c.url.pathname==='/v1.0/me/messages')!;
  expect((draft.init.headers as any)['Content-Type']).toBe('text/plain');expect((draft.init.headers as any).Authorization).toBe('Bearer at-1');
  const raw=new TextDecoder().decode(Uint8Array.from(atob(String(draft.init.body)),c=>c.charCodeAt(0)));
  expect(raw).toContain('From: "Client Co" <owner@client.example>\r\n');expect(raw).toContain('To: fixture@example.invalid\r\n');
  expect(calls.every(c=>HOSTS.includes(c.url.host))).toBe(true);
 });
 it('blocks before any Graph call when the preflight fails, and rejects header injection',async()=>{
  const calls=stub(()=>Response.json({id:'x'}));
  await expect(msSendMail(env,{refreshToken:'rt'},mail,async()=>{throw new Error('authority changed');})).rejects.toThrow('authority changed');
  await expect(msSendMail(env,{refreshToken:'rt'},{...mail,to:'a@b.invalid\r\nBcc: x@y.invalid'})).rejects.toThrow('Invalid email header');
  expect(calls.filter(c=>c.url.host==='graph.microsoft.com')).toHaveLength(0);
 });
 it('keeps the draft id on an uncertain send and never re-sends; errors are status-only',async()=>{
  const calls=stub(url=>url.pathname.endsWith('/send')?new Response('PRIVATE recipient fixture@example.invalid',{status:503}):Response.json({id:'draft-1'}));
  const e=await msSendMail(env,{refreshToken:'rt'},mail).catch(x=>x);
  expect(e.message).toBe('Microsoft integration request failed (503)');expect(e.message).not.toContain('PRIVATE');expect(e.messageId).toBe('draft-1');
  expect(calls.filter(c=>c.url.pathname.endsWith('/send'))).toHaveLength(1);
  stub(()=>Response.json({}));
  await expect(msSendMail(env,{refreshToken:'rt2'},mail)).rejects.toThrow('draft acknowledgement is uncertain');
 });
 it('creates one event with transactionId and an online meeting, without replay on uncertainty',async()=>{
  const calls=stub(()=>Response.json({id:'evt-1',onlineMeeting:{joinUrl:'https://teams.microsoft.com/l/meetup-join/fixture'}}));
  expect(await msCreateEvent(env,{refreshToken:'rt'},p)).toEqual({eventId:'evt-1',joinUrl:'https://teams.microsoft.com/l/meetup-join/fixture'});
  const body=JSON.parse(String(calls.find(c=>c.url.pathname==='/v1.0/me/events')!.init.body));
  expect(body).toMatchObject({transactionId:p.id,isOnlineMeeting:true,start:{dateTime:'2026-11-01T08:00:00',timeZone:'UTC'},end:{dateTime:'2026-11-01T08:15:00',timeZone:'UTC'},attendees:[{emailAddress:{address:p.email}}]});
  const failing=stub(()=>new Response('PRIVATE',{status:500}));
  await expect(msCreateEvent(env,{refreshToken:'rt3'},p)).rejects.toThrow('Microsoft integration request failed (500)');
  expect(failing.filter(c=>c.url.pathname==='/v1.0/me/events')).toHaveLength(1);
 });
 it('reads busy times from calendarView in UTC and fails closed on invalid or paged data',async()=>{
  const calls=stub(()=>Response.json({value:[
   {start:{dateTime:'2026-11-01T08:00:00.0000000',timeZone:'UTC'},end:{dateTime:'2026-11-01T09:00:00.0000000',timeZone:'UTC'},showAs:'busy'},
   {start:{dateTime:'2026-11-01T10:00:00.0000000',timeZone:'UTC'},end:{dateTime:'2026-11-01T11:00:00.0000000',timeZone:'UTC'},showAs:'free'},
   {start:{dateTime:'2026-11-01T12:00:00.0000000',timeZone:'UTC'},end:{dateTime:'2026-11-01T13:00:00.0000000',timeZone:'UTC'},showAs:'busy',isCancelled:true}]}));
  expect(await msBusyTimes(env,{refreshToken:'rt'},new Date('2026-11-01T00:00:00Z'),new Date('2026-11-02T00:00:00Z')))
   .toEqual([{start:new Date('2026-11-01T08:00:00Z'),end:new Date('2026-11-01T09:00:00Z')}]);
  const v=calls.find(c=>c.url.pathname==='/v1.0/me/calendarView')!;
  expect(v.url.searchParams.get('startDateTime')).toBe('2026-11-01T00:00:00.000Z');expect((v.init.headers as any).Prefer).toBe('outlook.timezone="UTC"');
  for(const body of [{},{value:[],'@odata.nextLink':'https://graph.microsoft.com/next'},{value:[{start:{dateTime:'2026-11-01T08:00:00',timeZone:'Pacific Standard Time'},end:{dateTime:'2026-11-01T09:00:00',timeZone:'UTC'}}]},{value:[{start:{dateTime:'2026-11-01T09:00:00',timeZone:'UTC'},end:{dateTime:'2026-11-01T08:00:00',timeZone:'UTC'}}]}]){
   stub(()=>Response.json(body));await expect(msBusyTimes(env,{refreshToken:'rt'},new Date(),new Date())).rejects.toThrow();
  }
 });
 it('coalesces refreshes, hands a rotated refresh token to the caller and refuses missing credentials before network',async()=>{
  const rotate=vi.fn(async()=>{}),account:MsAccount={refreshToken:'rt-old',rotate};
  const calls=stub(()=>Response.json({}),{access_token:'at-9',expires_in:3600,refresh_token:'rt-new'});
  expect(await Promise.all([msToken(env,account),msToken(env,account)])).toEqual(['at-9','at-9']);
  expect(calls.filter(c=>c.url.host==='login.microsoftonline.com')).toHaveLength(1);
  expect(rotate).toHaveBeenCalledWith('rt-new');expect(account.refreshToken).toBe('rt-new');
  expect(await msToken(env,account)).toBe('at-9');
  const body=new URLSearchParams(String(calls[0].init.body));expect(body.get('grant_type')).toBe('refresh_token');expect(body.get('refresh_token')).toBe('rt-old');
  const f=vi.fn();vi.stubGlobal('fetch',f);
  await expect(msToken({...env,MS_CLIENT_SECRET:''},{refreshToken:'rt'})).rejects.toThrow('not configured');expect(f).not.toHaveBeenCalled();
  stub(()=>Response.json({}),{error:'invalid_grant'});
  await expect(msToken(env,{refreshToken:'rt-x'})).rejects.toThrow('Invalid Microsoft token response');
 });
});
