import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {Env} from '../src/env';
import {googleToken,busyTimes,createMeetEvent,reconcileMeetEvent,calendarEventId,sheetAppend,sheetWrite,buildMime,sendEmail} from '../src/lib/google';
import {brandFrom} from '../src/lib/brand';
let env:Env;
const p={id:'11111111-1111-4111-8111-111111111111',start:'2026-11-01T08:00:00Z',end:'2026-11-01T08:15:00Z',email:'fixture@example.invalid',name:'Fixture',summary:'Test',description:'Synthetic'};
const event=()=>({id:calendarEventId(p.id),status:'confirmed',extendedProperties:{private:{ripe_meeting_id:p.id}},start:{dateTime:p.start},end:{dateTime:p.end},attendees:[{email:p.email}],hangoutLink:'https://meet.google.com/abc-defg-hij'});
beforeEach(()=>{env={GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_REFRESH_TOKEN:'refresh',GOOGLE_CALENDAR_ID:'primary',CRM_SHEET_ID:'fixture'} as Env;});
function mockProvider(fn:(url:URL,init:RequestInit)=>Response|Promise<Response>){
 const calls:{url:URL;init:RequestInit}[]=[];
 vi.stubGlobal('fetch',vi.fn(async (input:string,init:RequestInit)=>{
  const url=new URL(input);calls.push({url,init});
  if(url.host==='oauth2.googleapis.com')return Response.json({access_token:'fixture-token',expires_in:3600});
  return fn(url,init);
 }));return calls;
}
describe('Google integration boundaries',()=>{
 it('coalesces refreshes, isolates account configurations and invalidates rotated credentials',async()=>{
  const fetcher=vi.fn(async()=>Response.json({access_token:'token-'+fetcher.mock.calls.length,expires_in:3600}));vi.stubGlobal('fetch',fetcher);
  expect(await Promise.all([googleToken(env),googleToken(env)])).toEqual(['token-1','token-1']);
  expect(await googleToken(env)).toBe('token-1');expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await googleToken({...env,GOOGLE_REFRESH_TOKEN:'other'})).toBe('token-2');
  env.GOOGLE_REFRESH_TOKEN='rotated';expect(await googleToken(env)).toBe('token-3');
 });
 it('rejects missing credentials before network and malformed token responses',async()=>{
  const fetcher=vi.fn(async()=>Response.json({expires_in:3600}));vi.stubGlobal('fetch',fetcher);
  await expect(googleToken({...env,GOOGLE_REFRESH_TOKEN:''})).rejects.toThrow('not configured');expect(fetcher).not.toHaveBeenCalled();
  await expect(googleToken(env)).rejects.toThrow('Invalid Google token');
 });
 it('does not retain failed refreshes or leak provider payloads',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('PRIVATE refresh-token',{status:400})).mockResolvedValueOnce(Response.json({access_token:'recovered',expires_in:3600}));vi.stubGlobal('fetch',fetcher);
  await expect(googleToken(env)).rejects.toThrow('Google token refresh failed (400)');expect(await googleToken(env)).toBe('recovered');
 });
 it('invalidates a rejected token without replaying the provider mutation',async()=>{
  const calls=mockProvider(()=>new Response('PRIVATE account',{status:401}));
  await expect(sheetAppend(env,'Leads',[['test']])).rejects.toThrow('Google integration request failed (401)');
  await googleToken(env);expect(calls.filter(c=>c.url.host==='oauth2.googleapis.com')).toHaveLength(2);expect(calls.filter(c=>c.url.host==='sheets.googleapis.com')).toHaveLength(1);
 });
 it.each([{}, {calendars:{other:{busy:[]}}},{calendars:{primary:{errors:[{reason:'notFound'}],busy:[]}}},{calendars:{primary:{}}},{calendars:{primary:{busy:[{start:'garbage',end:p.end}]}}},{calendars:{primary:{busy:[{start:p.end,end:p.start}]}}}])('fails closed on unavailable or invalid calendar data: %j',async body=>{
  mockProvider(()=>Response.json(body));await expect(busyTimes(env,new Date(p.start),new Date(p.end))).rejects.toThrow();
 });
 it('accepts an explicitly empty configured calendar and valid busy intervals',async()=>{
  mockProvider(()=>Response.json({calendars:{primary:{busy:[]}}}));expect(await busyTimes(env,new Date(p.start),new Date(p.end))).toEqual([]);
  mockProvider(()=>Response.json({calendars:{primary:{busy:[{start:p.start,end:p.end}]}}}));expect(await busyTimes(env,new Date(p.start),new Date(p.end))).toEqual([{start:new Date(p.start),end:new Date(p.end)}]);
 });
 it('bounds network requests and treats timeouts as uncertain',async()=>{
  const calls=mockProvider(()=>{throw new Error('PRIVATE network message');});
  await expect(busyTimes(env,new Date(p.start),new Date(p.end))).rejects.toThrow('Google integration response is uncertain');expect(calls.every(c=>c.init.signal instanceof AbortSignal)).toBe(true);
 });
 it('writes untrusted CRM fields as raw values rather than formulas',async()=>{
  const calls=mockProvider(()=>Response.json({}));await sheetWrite(env,'Leads!A1',[['=IMPORTXML("private")']]);await sheetAppend(env,'Leads',[['+cmd']]);
  const writes=calls.filter(c=>c.url.host==='sheets.googleapis.com');expect(writes).toHaveLength(2);expect(writes.every(c=>c.url.searchParams.get('valueInputOption')==='RAW')).toBe(true);
 });
});
describe('stable calendar reservation reconciliation',()=>{
 it('uses one stable event ID and verifies confirmed conference details',async()=>{
  const calls=mockProvider(()=>Response.json(event()));expect((await createMeetEvent(env,p)).meetCode).toBe('abc-defg-hij');
  const insert=calls.find(c=>c.url.pathname.endsWith('/events'))!;expect(JSON.parse(String(insert.init.body)).id).toBe(calendarEventId(p.id));
 });
 it.each([409,503,0])('reads the same event after %i without a second insertion',async status=>{
  const calls=mockProvider((_url,init)=>{if(init.method==='POST'){if(!status)throw Error('timeout');return new Response('',{status});}return Response.json(event());});
  expect((await createMeetEvent(env,p)).eventId).toBe(calendarEventId(p.id));expect(calls.filter(c=>c.url.pathname.includes('/events')&&c.init.method==='POST')).toHaveLength(1);expect(calls.at(-1)!.url.pathname.endsWith('/'+calendarEventId(p.id))).toBe(true);
 });
 it.each([false, true])('bounds pending conference reads (permanently pending: %s)', async neverReady => {
  let reads = 0;
  const pending = () => ({...event(), conferenceData:{createRequest:{status:{statusCode:'pending'}}}});
  const calls = mockProvider((_url,init) => {
   if (init.method === 'POST') return Response.json(pending());
   reads++; return Response.json(neverReady || reads < 2 ? pending() : event());
  });
  if (neverReady) await expect(createMeetEvent(env,p)).rejects.toThrow('pending');
  else expect((await createMeetEvent(env,p)).meetCode).toBe('abc-defg-hij');
  expect(reads).toBe(neverReady ? 3 : 2);
  expect(calls.filter(c=>c.url.pathname.includes('/events') && c.init.method==='POST')).toHaveLength(1);
 });
 it('does not retry a definite provider rejection',async()=>{
  const calls=mockProvider(()=>new Response('PRIVATE',{status:403}));await expect(createMeetEvent(env,p)).rejects.toThrow('(403)');expect(calls.filter(c=>c.url.pathname.includes('/events'))).toHaveLength(1);
 });
 it.each(['identity','time','attendee','cancelled','pending','unsafe_link'])('refuses mismatched or incomplete event: %s',async kind=>{
  const ev:any=event();if(kind==='identity')ev.extendedProperties.private.ripe_meeting_id='foreign';if(kind==='time')ev.start.dateTime=p.end;if(kind==='attendee')ev.attendees=[];if(kind==='cancelled')ev.status='cancelled';if(kind==='pending')ev.conferenceData={createRequest:{status:{statusCode:'pending'}}};if(kind==='unsafe_link')ev.hangoutLink='https://attacker.invalid';
  mockProvider(()=>Response.json(ev));await expect(reconcileMeetEvent(env,p)).rejects.toThrow();
 });
});

it('rejects an OAuth refresh completed after its credential binding changed',async()=>{
 let complete!:(r:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>complete=r)).mockResolvedValue(Response.json({access_token:'new',expires_in:3600}));vi.stubGlobal('fetch',fetcher);
 const pending=googleToken(env);env.GOOGLE_REFRESH_TOKEN='rotated';
 const rejection=expect(pending).rejects.toThrow('credentials changed');
 complete(Response.json({access_token:'old',expires_in:3600}));await rejection;
 expect(await googleToken(env)).toBe('new');
});
it('rejects a replaced in-flight cache entry even when credentials are later restored',async()=>{
 let complete!:(r:Response)=>void;const original=env.GOOGLE_REFRESH_TOKEN;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>complete=r)).mockResolvedValue(Response.json({access_token:'new',expires_in:3600}));vi.stubGlobal('fetch',fetcher);
 const pending=googleToken(env);env.GOOGLE_REFRESH_TOKEN='rotated';await googleToken(env);env.GOOGLE_REFRESH_TOKEN=original;
 const rejection=expect(pending).rejects.toThrow('credentials changed');complete(Response.json({access_token:'old',expires_in:3600}));await rejection;
});
describe('header-safe MIME and per-send identity',()=>{
 const decode=(raw:string)=>new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));
 const words=(h:string)=>h.match(/=\?UTF-8\?B\?([^?]+)\?=/g)!.map(w=>new TextDecoder().decode(Uint8Array.from(atob(w.slice(10,-2)),c=>c.charCodeAt(0)))).join('');
 it('RFC 2047-encodes a non-ASCII display name in bounded words and keeps ASCII From unchanged',()=>{
  const name='Zoë Café '.repeat(8)+'"Ltd"',from=buildMime(brandFrom(name,'zoe@client.invalid'),'c@d.invalid','s','b').split('\r\nTo:')[0];
  expect(from.split('\r\n').every(l=>l.length<=78)).toBe(true);
  expect(from).toMatch(/^From: (=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=(\r\n )?)+ <zoe@client\.invalid>$/);expect(from.match(/=\?[^ ]+\?=/g)!.every(w=>w.length<=75)).toBe(true);
  expect(words(from)).toBe(name);
  expect(buildMime('Ripe Piper <hello@ripepiper.invalid>','c@d.invalid','s','b').split('\r\n')[0]).toBe('From: Ripe Piper <hello@ripepiper.invalid>');
 });
 it('emits Reply-To and RFC 8058 one-click unsubscribe headers',()=>{
  const mime=buildMime('a@b.invalid','c@d.invalid','s','b',undefined,{'Reply-To':'reply@client.invalid','List-Unsubscribe':'<https://ripepiper.invalid/u?t=x>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'});
  const head=mime.split('\r\n\r\n')[0].split('\r\n');
  expect(head).toEqual(expect.arrayContaining(['Reply-To: reply@client.invalid','List-Unsubscribe: <https://ripepiper.invalid/u?t=x>','List-Unsubscribe-Post: List-Unsubscribe=One-Click']));
 });
 it.each([
  ['from',()=>buildMime('a@b.invalid\r\nBcc: x@y.invalid','c@d.invalid','s','b')],
  ['to',()=>buildMime('a@b.invalid','c@d.invalid\nBcc: x@y.invalid','s','b')],
  ['header',()=>buildMime('a@b.invalid','c@d.invalid','s','b',undefined,{'Reply-To':'r@x.invalid\r\nBcc: x@y.invalid'})],
  ['unlisted header',()=>buildMime('a@b.invalid','c@d.invalid','s','b',undefined,{Bcc:'x@y.invalid'} as any)],
  ['brand name',()=>brandFrom('Name\r\nBcc: x','a@b.invalid')],
  ['brand address list',()=>brandFrom('Name','a@b.invalid, x@y.invalid')],
 ])('rejects header injection via %s',(_n,fn)=>{expect(fn).toThrow();});
 it('defaults sendEmail to env.MAIL_FROM and honours a per-send identity',async()=>{
  const calls=mockProvider(()=>Response.json({id:'msg_1'}));const agency={...env,MAIL_FROM:'Ripe Piper <hello@ripepiper.invalid>'} as Env;
  await sendEmail(agency,'c@d.invalid','s','b');
  await sendEmail(agency,'c@d.invalid','s','b',undefined,undefined,{from:brandFrom('Client','owner@client.invalid'),headers:{'Reply-To':'owner@client.invalid'}});
  const raws=calls.filter(c=>c.url.host==='gmail.googleapis.com').map(c=>decode(JSON.parse(String(c.init.body)).raw));
  expect(raws[0]).toMatch(/^From: Ripe Piper <hello@ripepiper\.invalid>\r\n/);expect(raws[0]).not.toContain('Reply-To');
  expect(raws[1]).toMatch(/^From: "Client" <owner@client\.invalid>\r\n/);expect(raws[1]).toContain('Reply-To: owner@client.invalid');
 });
 it('rejects injected headers before any provider call',async()=>{
  const calls=mockProvider(()=>Response.json({id:'msg_1'}));
  await expect(sendEmail(env,'c@d.invalid','s','b',undefined,undefined,{from:'x@y.invalid\nBcc: z@y.invalid'})).rejects.toThrow('Invalid email header');expect(calls).toHaveLength(0);
 });
 it('defaults meeting time zone to Asia/Dubai and honours a tenant time zone',async()=>{
  const calls=mockProvider(()=>Response.json(event()));await createMeetEvent(env,p);await createMeetEvent(env,{...p,timeZone:'Europe/London'});
  const bodies=calls.filter(c=>c.init.method==='POST'&&c.url.pathname.endsWith('/events')).map(c=>JSON.parse(String(c.init.body)));
  expect(bodies.map(b=>[b.start.timeZone,b.end.timeZone])).toEqual([['Asia/Dubai','Asia/Dubai'],['Europe/London','Europe/London']]);
 });
});
