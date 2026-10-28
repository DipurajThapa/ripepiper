import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Db} from '../src/lib/db';
import {inspectReminderReceipts} from '../src/foundation/reminder-receipts';
import type {Env} from '../src/env';
const id='11111111-1111-4111-8111-111111111111',env={} as Env;
const req=()=>new Request(`https://fixture.invalid/api/admin/meetings/${id}/reminder-receipts`,{headers:{Authorization:'Bearer fixture'}});
const now='2026-10-27T12:00:00.000Z',past='2026-10-27T11:59:59.000Z',future='2026-10-27T12:01:00.000Z';
const receipt=(state='claimed')=>({state,leaseUntil:future,token:'PRIVATE_DISPATCH_TOKEN',snapshot:{email:'PRIVATE_CONTACT',name:'PRIVATE_NAME'},reason:'PRIVATE_PROVIDER_ERROR',authorizedAt:'not exposed'});
function meeting(receipts:any={},extra:any={}){return{id,tenant_id:null,reminder_receipts:receipts,reminder_24h_at:null,reminder_1h_at:null,...extra};}
function stored(value:any){return vi.spyOn(Db.prototype,'one').mockResolvedValue(value);}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(now));vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id,email:'staff@fixture.invalid',is_admin:true});});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe('read-only agency reminder receipt inspection',()=>{
 it('projects only selected columns and returns ordered absent windows with no-store',async()=>{
  const one=stored(meeting());const r=await inspectReminderReceipts(req(),env,id);expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');
  expect(one).toHaveBeenCalledWith('meetings',`id=eq.${id}&tenant_id=is.null&select=id,tenant_id,reminder_receipts,reminder_24h_at,reminder_1h_at`);
  expect(await r.json()).toEqual({version:1,meetingId:id,canRetry:false,receipts:['24h','1h'].map(window=>({window,state:'absent',leaseUntil:null,acknowledgedAt:null,providerMessageId:null,requiresReview:false,delivery:'not_sent'}))});
 });
 it.each(['claimed','dispatching','review','acknowledged'])('redacts internal %s receipt fields and never promises delivery or retry',async state=>{
  stored(meeting({'1h':{...receipt(state),acknowledgedAt:past,messageId:'provider_123-OK'}}));
  const update=vi.spyOn(Db.prototype,'update'),rpc=vi.spyOn(Db.prototype,'rpc');const r=await inspectReminderReceipts(req(),env,id),body=await r.json() as any;
  expect(body.receipts[1]).toEqual({window:'1h',state,leaseUntil:future,acknowledgedAt:past,providerMessageId:'provider_123-OK',requiresReview:state==='review',delivery:'unknown'});
  expect(body.canRetry).toBe(false);expect(JSON.stringify(body)).not.toMatch(/PRIVATE|token|snapshot|reason|authorizedAt|attendee/);expect(update).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
 });
 it.each(['claimed','dispatching'])('marks expired or equal lease %s for review without altering ledger',async state=>{
  const row=meeting({'24h':{...receipt(state),leaseUntil:now},'1h':{...receipt(state),leaseUntil:past}});stored(row);
  const update=vi.spyOn(Db.prototype,'update'),rpc=vi.spyOn(Db.prototype,'rpc');const r=await inspectReminderReceipts(req(),env,id),body=await r.json() as any;
  expect(body.receipts.every((r:any)=>r.requiresReview&&r.delivery==='unknown')).toBe(true);expect(row.reminder_receipts['24h'].state).toBe(state);expect(update).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
 });
 it.each([null,[],false,'{}',{'2h':receipt()},{'24h':null},{'24h':[]},{'24h':{}},{'24h':receipt('sent')},{'24h':{...receipt(),leaseUntil:'0'}},{'24h':{...receipt(),leaseUntil:'2026-02-30T12:00:00Z'}},{'24h':{...receipt(),acknowledgedAt:'bad'}},{'24h':{...receipt(),messageId:'has spaces'}},{'24h':{...receipt(),messageId:'x'.repeat(241)}},{'24h':receipt('acknowledged')},{'24h':{...receipt('acknowledged'),acknowledgedAt:past}},{'24h':{...receipt('acknowledged'),messageId:'valid'}}])('rejects malformed stored receipts %j without exposing contents',async value=>{
  stored(meeting(value));const r=await inspectReminderReceipts(req(),env,id);expect(r.status).toBe(503);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(await r.text()).not.toMatch(/PRIVATE/);
 });
 it('accepts bounded 240-character IDs and valid optional nulls',async()=>{
  stored(meeting({'24h':{...receipt('acknowledged'),acknowledgedAt:past,messageId:'x'.repeat(240)},'1h':{...receipt(),acknowledgedAt:null,messageId:null}}));expect((await inspectReminderReceipts(req(),env,id)).status).toBe(200);
 });
 it.each(['reminder_24h_at','reminder_1h_at'])('fails uncertain for legacy %s without its receipt',async key=>{
  stored(meeting({}, {[key]:past}));expect((await inspectReminderReceipts(req(),env,id)).status).toBe(503);
 });
 it.each([null,meeting({}, {tenant_id:id})])('returns404 for missing or tenant meeting',async value=>{
  stored(value);expect((await inspectReminderReceipts(req(),env,id)).status).toBe(404);
 });
 it('authenticates before receipt reads and rejects nonstaff',async()=>{
  const one=stored(meeting());await expect(inspectReminderReceipts(new Request('https://fixture.invalid'),env,id)).rejects.toMatchObject({status:401});
  vi.mocked(Db.prototype.userFromToken).mockResolvedValue({id,email:'client@fixture.invalid',is_admin:false});await expect(inspectReminderReceipts(req(),env,id)).rejects.toMatchObject({status:403});expect(one).not.toHaveBeenCalled();
 });
 it('rejects invalid meeting IDs before query and redacts failed DB reads',async()=>{
  const one=stored(meeting());expect((await inspectReminderReceipts(req(),env,'invalid&select=*')).status).toBe(404);expect(one).not.toHaveBeenCalled();
  one.mockRejectedValue(Error('PRIVATE_DB_URL'));const r=await inspectReminderReceipts(req(),env,id);expect(r.status).toBe(503);expect(await r.text()).not.toContain('PRIVATE');
 });
});
