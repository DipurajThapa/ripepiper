import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {Env} from '../src/env';
import {googleToken,busyTimes,createMeetEvent,reconcileMeetEvent,calendarEventId,sheetAppend,sheetWrite} from '../src/lib/google';
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
