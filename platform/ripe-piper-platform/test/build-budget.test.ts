import {it,expect,vi} from 'vitest';
import {paidPolicy,reserveAI,settleAI} from '../src/lib/build-budget';
import {analyseMeeting} from '../src/lib/ai';
import type {Env} from '../src/env';
const env=()=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',AI_MODEL:'fixture-model',PAID_AI_ENABLED:'true',AI_COST_POLICY:JSON.stringify({model:'fixture-model',reference:'verified-tariff-fixture',expiresAt:'2099-01-01T00:00:00Z',inputMicroPerMillion:1000000,outputMicroPerMillion:2000000})} as Env);
it('blocks paid use without explicit current reviewed configuration before any network',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 for(const patch of [{PAID_AI_ENABLED:undefined},{AI_COST_POLICY:''},{AI_MODEL:'foreign-model'},{AI_COST_POLICY:JSON.stringify({model:'fixture-model',reference:'p',expiresAt:'2000-01-01'})}])
  await expect(analyseMeeting({...env(),...patch},'synthetic',{})).rejects.toThrow('Paid AI is unavailable');
 expect(fetcher).not.toHaveBeenCalled();
});
it('requires atomic reservation before exactly one provider call and settles validated usage',async()=>{
 const calls:{url:string;body:any}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
  calls.push({url,body:JSON.parse(String(init.body))});
  if(url.includes('reserve_build_usage'))return Response.json(true);
  if(url.includes('settle_build_usage'))return Response.json(true);
  expect(init.signal).toBeInstanceOf(AbortSignal);
  return Response.json({usage:{input_tokens:20,output_tokens:10},stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({summary:'Fixture',notes:{},minutes:{},requirements:{}})}]});
 }));
 expect((await analyseMeeting(env(),'synthetic',{})).summary).toBe('Fixture');
 expect(calls.map(c=>c.url.includes('/rpc/')?c.url.split('/').at(-1):'provider')).toEqual(['reserve_build_usage','provider','settle_build_usage']);
 expect(calls[2].body.p_actual_micro).toBe(40);
});
it.each(['max_tokens','refusal',undefined])('settles usage but rejects a %s answer so no partial draft is saved',async stop_reason=>{
 const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push(url.includes('/rpc/')?url.split('/').at(-1)!:'provider');
  if(url.includes('/rpc/'))return Response.json(true);return Response.json({usage:{input_tokens:20,output_tokens:10},stop_reason,content:[{type:'text',text:JSON.stringify({summary:'Cut',notes:{},minutes:{},requirements:{}})}]});}));
 await expect(analyseMeeting(env(),'synthetic',{})).rejects.toThrow('incomplete');expect(calls).toEqual(['reserve_build_usage','provider','settle_build_usage']);
});
it('does not call provider if budget reservation is refused',async()=>{
 const fetcher=vi.fn(async()=>Response.json(false));vi.stubGlobal('fetch',fetcher);
 await expect(analyseMeeting(env(),'synthetic',{})).rejects.toThrow('Paid AI is unavailable');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retains the reservation on timeout or private provider errors and never retries',async()=>{
 for(const result of ['timeout','error']){
  const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
   calls.push(url);if(url.includes('/rpc/'))return Response.json(true);
   if(result==='timeout')throw new Error('network unavailable');return new Response('PRIVATE PROVIDER BODY',{status:503});
  }));
  await expect(analyseMeeting(env(),'synthetic',{})).rejects.not.toThrow('PRIVATE PROVIDER BODY');expect(calls).toHaveLength(2);
 }
});
it('freezes further discretionary use if provider usage cannot be reconciled',async()=>{
 const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,body:JSON.parse(String(init.body))});return Response.json(true);}));
 const reservation=await reserveAI(env(),'system','user',100,{tenantId:null});
 await expect(settleAI(env(),reservation,{input_tokens:1,output_tokens:101})).rejects.toThrow('reconciliation');
 expect(calls.at(-1).url).toContain('hold_build_budget');expect(calls.some(c=>c.url.includes('settle_build_usage'))).toBe(false);
 expect(()=>paidPolicy({...env(),AI_COST_POLICY:'{}'})).toThrow();
});
it('records a tenant scope on the reservation before any provider call, keeps agency calls unattributed, and still rejects cache tokens',async()=>{
 const tenant='22222222-2222-4222-8222-222222222222',calls:{url:string;method?:string;body:any}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,method:init.method,body:JSON.parse(String(init.body??'null'))});
  return url.includes('build_usage?')?Response.json([{id:'x'}]):Response.json(true);}));
 const reservation=await reserveAI(env(),'system','user',100,{tenantId:tenant});
 expect(calls.map(c=>c.url.split('/').at(-1))).toEqual(['reserve_build_usage',`build_usage?id=eq.${reservation.id}&tenant_id=is.null`]);
 expect(calls[1]).toMatchObject({method:'PATCH',body:{tenant_id:tenant}});
 await expect(settleAI(env(),reservation,{input_tokens:1,output_tokens:1,cache_read_input_tokens:1})).rejects.toThrow('reconciliation');
 expect(calls.at(-1)!.url).toContain('hold_build_budget');
 calls.length=0;await reserveAI(env(),'system','user',100,{tenantId:null});expect(calls.map(c=>c.url.split('/').at(-1))).toEqual(['reserve_build_usage']);
});
it('blocks before the provider when tenant attribution cannot be written',async()=>{
 for(const patch of [()=>Response.json([]),()=>new Response('denied',{status:500})]){
  const urls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{urls.push(url);return url.includes('build_usage?')?patch():Response.json(true);}));
  await expect(reserveAI(env(),'system','user',100,{tenantId:'22222222-2222-4222-8222-222222222222'})).rejects.toThrow('Paid AI is unavailable');
  expect(urls).toHaveLength(2);
 }
});
