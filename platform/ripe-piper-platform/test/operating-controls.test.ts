import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/google', async original => ({...await original<any>(), googleToken:vi.fn(async()=> 'fixture-token'), meetTranscript:vi.fn(), sendEmail:vi.fn(), sheetEnsureTab:vi.fn()}));
vi.mock('../src/lib/ai', async original => ({...await original<any>(), analyseMeeting:vi.fn()}));
import {analyseMeeting} from '../src/lib/ai';
import type {Env} from '../src/env';
import {Db} from '../src/lib/db';
import {processFinishedMeetings, runScheduled, syncAds} from '../src/jobs';
import {syncSheet} from '../src/lib/sheets';
import {googleAdsRows, metaRows, linkedinRows, redactedAdsError} from '../src/lib/ads';
import {googleToken, meetTranscript, sendEmail, sheetEnsureTab} from '../src/lib/google';
import {processMeeting, runAdsSync} from '../src/routes/admin';
const env={SUPABASE_URL:'https://fixture.invalid',ADS_SYNC_ENABLED:'true'} as Env;
const id='11111111-1111-4111-8111-111111111111';
const request=()=>new Request('https://fixture.invalid/api/admin/fixture',{method:'POST',headers:{Authorization:'Bearer fixture'},body:'{"transcript":"fixture"}'});
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllGlobals();});

describe('default-off operating controls',()=>{
 it.each([undefined,'false','TRUE','True',' true ','1',true,1,null])('disabled value %j does no DB or provider work in exported and scheduled jobs',async flag=>{
  const fetch=vi.fn(()=>{throw Error('Unexpected I/O');});vi.stubGlobal('fetch',fetch);
  const database=vi.spyOn(Db.prototype,'select');
  const disabled={MEETING_TRANSCRIPTS_ENABLED:flag,SHEETS_SYNC_ENABLED:flag,ADS_SYNC_ENABLED:flag} as unknown as Env;
  expect(await processFinishedMeetings(disabled)).toMatchObject({disabled:true,processed:0});
  expect(await syncSheet(disabled)).toEqual({disabled:true,synced:0,failed:0});
  expect(await syncAds(disabled)).toEqual({disabled:true,accounts:0,rows:0,errors:0});
  expect(await runScheduled('0 22 * * *',disabled)).toMatchObject({ads:{disabled:true}});
  expect(await runScheduled('*/5 * * * *',disabled)).toMatchObject({meetings:{disabled:true},sheet:{disabled:true}});
  expect(database).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  for(const provider of [googleToken,meetTranscript,sendEmail,sheetEnsureTab])expect(provider).not.toHaveBeenCalled();
 });
 it('exact true reaches enabled jobs through scheduler',async()=>{
  const database=vi.spyOn(Db.prototype,'select').mockResolvedValue([]);
  expect(await runScheduled('0 22 * * *',env)).toEqual({ads:{accounts:0,rows:0,errors:0}});
  expect(await runScheduled('*/5 * * * *',{...env,MEETING_TRANSCRIPTS_ENABLED:'true',SHEETS_SYNC_ENABLED:'true'})).toMatchObject({meetings:{processed:0},sheet:{synced:0,failed:0}});
  expect(database.mock.calls.map(c=>c[0])).toEqual(['ad_accounts','fx_rates','meetings','sheet_outbox']);
 });
 for(const [name,handler] of [['transcripts',processMeeting],['ads',runAdsSync]] as const){
  it(`${name} authenticates before reporting disabled and performs no job work`,async()=>{
   const user=vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id,email:'staff@fixture.invalid',is_admin:true});
   const one=vi.spyOn(Db.prototype,'one'),select=vi.spyOn(Db.prototype,'select'),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
   const response=await handler(request(),{} as Env,id);expect(response.status).toBe(409);expect(user).toHaveBeenCalledTimes(1);
   expect(one).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(meetTranscript).not.toHaveBeenCalled();
  });
  it(`${name} rejects missing credentials and nonstaff while disabled`,async()=>{
   await expect(handler(new Request('https://fixture.invalid'),{} as Env,id)).rejects.toMatchObject({status:401});
   vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id,email:'client@fixture.invalid',is_admin:false});
   const select=vi.spyOn(Db.prototype,'select');await expect(handler(request(),{} as Env,id)).rejects.toMatchObject({status:403});expect(select).not.toHaveBeenCalled();
  });
 }
});

describe('agency-only manual transcript processing',()=>{
 it.each([null,id,undefined])('rejects unavailable or foreign meeting scope %j before transcript and AI work',async tenant=>{
  vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id,email:'staff@fixture.invalid',is_admin:true});
  const one=vi.spyOn(Db.prototype,'one').mockResolvedValue(tenant===null?null:{id,tenant_id:tenant,meet_code:'abc-defg-hij',lead_id:id});
  const rpc=vi.spyOn(Db.prototype,'rpc');
  const response=await processMeeting(request(),{...env,MEETING_TRANSCRIPTS_ENABLED:'true'},id);
  expect(response.status).toBe(404);expect(one).toHaveBeenCalledExactlyOnceWith('meetings',`id=eq.${id}&tenant_id=is.null&select=*`);
  expect(meetTranscript).not.toHaveBeenCalled();expect(analyseMeeting).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
 });
 it('loads lead context only from agency scope before producing draft notes',async()=>{
  vi.spyOn(Db.prototype,'userFromToken').mockResolvedValue({id,email:'staff@fixture.invalid',is_admin:true});
  const transcript='Synthetic agency transcript. '.repeat(12);
  const one=vi.spyOn(Db.prototype,'one').mockResolvedValueOnce({id,tenant_id:null,lead_id:id,kind:'discovery',start_at:'2026-10-27T08:00:00Z',end_at:'2026-10-27T08:30:00Z',attendee_email:'agency@fixture.invalid',attendee_name:'Agency',transcript}).mockResolvedValueOnce({name:'Agency',company:'Agency Fixture'});
  vi.mocked(analyseMeeting).mockResolvedValue({summary:'Draft',notes:{},requirements:{},minutes:{decisions:[],actions:[]}} as any);
  vi.spyOn(Db.prototype,'rpc').mockResolvedValue({meetingId:id,reviewVersion:1,attendance:'unknown',notesReady:true});
  const supersede=vi.spyOn(Db.prototype,'update').mockResolvedValue([]);
  const response=await processMeeting(request(),{...env,MEETING_TRANSCRIPTS_ENABLED:'true'},id);
  expect(response.status).toBe(200);expect(supersede).toHaveBeenCalledWith('proposals',`meeting_id=eq.${id}&kind=eq.pre&status=eq.draft`,{status:'superseded'});expect(one).toHaveBeenNthCalledWith(1,'meetings',`id=eq.${id}&tenant_id=is.null&select=*`);
  expect(one).toHaveBeenNthCalledWith(2,'leads',`id=eq.${id}&tenant_id=is.null&select=name,company,website`);
  expect(analyseMeeting).toHaveBeenCalledWith(expect.anything(),transcript,{company:'Agency Fixture',attendee:'Agency'});expect(meetTranscript).not.toHaveBeenCalled();
 });
});

describe('redacted ads boundaries',()=>{
 it.each([['google_ads',googleAdsRows],['meta',metaRows],['linkedin',linkedinRows]] as const)('%s rejects HTTP failures without consuming provider payloads',async(provider,read)=>{
  const json=vi.fn(),text=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:429,json,text})));
  await expect(read(env,'fixture','2026-10-01','2026-10-02')).rejects.toThrow(`${provider}_http_429`);
  expect(json).not.toHaveBeenCalled();expect(text).not.toHaveBeenCalled();
 });
 it.each([googleAdsRows,metaRows,linkedinRows])('redacts network and parser exceptions',async read=>{
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('SECRET_TOKEN https://private.invalid?token=secret');}));
  await expect(read(env,'fixture','2026-10-01','2026-10-02')).rejects.toThrow(/^ads_sync_failed$/);
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>{throw Error('PRIVATE_BODY');}})));
  await expect(read(env,'fixture','2026-10-01','2026-10-02')).rejects.toThrow(/^ads_sync_failed$/);
 });
 it('does not trust arbitrary exceptions imitating stable status strings',()=>{
  expect(redactedAdsError(Error('meta_http_403'))).toBe('ads_sync_failed');
  expect(redactedAdsError({message:'secret',toString:()=>{throw Error('must not stringify');}})).toBe('ads_sync_failed');
 });
 function accounts(platform:string){
  vi.spyOn(Db.prototype,'select').mockImplementation(async table=>table==='ad_accounts'?[{id,tenant_id:id,platform,account_ref:'fixture'}]:[]);
  vi.spyOn(Db.prototype,'one').mockResolvedValue({id,currency:'AED'});
  const update=vi.spyOn(Db.prototype,'update').mockResolvedValue([]),upsert=vi.spyOn(Db.prototype,'upsert').mockResolvedValue([]);
  return {update,upsert};
 }
 it('checks LinkedIn currency HTTP status before parsing and persists only the stable code',async()=>{
  const {update,upsert}=accounts('linkedin'),json=vi.fn(async()=>({currency:'AED',message:'PRIVATE_BODY'}));
  vi.stubGlobal('fetch',vi.fn(async(input:any)=>String(input).includes('/adAnalytics?')?Response.json({elements:[]}):{ok:false,status:401,json}));
  expect(await syncAds(env)).toEqual({accounts:1,rows:0,errors:1});expect(json).not.toHaveBeenCalled();expect(upsert).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith('ad_accounts',expect.any(String),{status:'error',last_error:'linkedin_http_401'});
 });
 it('redacts failed account lookup and failed error persistence at exported job boundary',async()=>{
  const {update}=accounts('meta');vi.mocked(Db.prototype.select).mockRejectedValueOnce(Error('PRIVATE_DATABASE_PAYLOAD'));
  await expect(syncAds(env)).rejects.toThrow(/^ads_sync_failed$/);
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('PRIVATE_PROVIDER_PAYLOAD');}));update.mockRejectedValueOnce(Error('PRIVATE_DB_WRITE_PAYLOAD'));
  await expect(syncAds(env)).rejects.toThrow(/^ads_sync_failed$/);
 });
 it('persists generic stable code for arbitrary provider and DB errors',async()=>{
  const {update}=accounts('meta');vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('token=PRIVATE_BODY');}));
  await syncAds(env);expect(update).toHaveBeenCalledWith('ad_accounts',expect.any(String),{status:'error',last_error:'ads_sync_failed'});
  vi.mocked(Db.prototype.one).mockRejectedValue(Error('SQL PRIVATE_BODY'));
  await syncAds(env);expect(update.mock.calls.every(c=>(c[2] as any).last_error==='ads_sync_failed')).toBe(true);
 });
});
