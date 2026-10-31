/** Independent QA: a partial contact acknowledgement cannot advance Signal ingestion. */
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {signalSource} from '../src/foundation/signal-sources';
import type {Env} from '../src/env';
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',lead='33333333-3333-4333-8333-333333333333',contactObservation='44444444-4444-4444-8444-444444444444',trigger='55555555-5555-4555-8555-555555555555';
const source={id:'66666666-6666-4666-8666-666666666666',tenantId:tenant,url:'https://signals.example.com/review.json',purposeReference:'reviewed-test-purpose',expiresAt:'2026-11-01T00:00:00Z',enabled:true,synthetic:true};
const item={id:'qa-change',company:'QA Synthetic',email:'qa@example.invalid',sourceUrl:'https://company.example.com/news',observedAt:'2026-10-24T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z',summary:'Opened a new service office.',relevance:'Review whether the office requires the offered service.'};
let receipt:any,writes:string[],env:Env;
const request=(body:any)=>new Request('https://qa.example.invalid/api',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));writes=[];receipt={lead_id:lead,observation_id:contactObservation,state:'created'};
 env={SUPABASE_URL:'https://qa.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-secret',SUPABASE_ANON_KEY:'fixture-public',SIGNAL_SOURCE_CONNECTIONS:JSON.stringify([source])} as Env;
 vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const u=new URL(input);
  if(u.href===source.url)return Response.json({items:[item]});
  if(u.host!=='qa.supabase.invalid')throw Error('External request forbidden by QA');
  if(u.pathname==='/auth/v1/user')return Response.json({id:actor,email:'qa@example.invalid'});
  if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:true}]);
  if(u.pathname==='/rest/v1/rpc/tenant_access')return Response.json(true);
  if(u.pathname==='/rest/v1/tenants')return Response.json([{id:tenant,status:'active'}]);
  if(u.pathname.endsWith('/import_review_lead')){writes.push('contact');return Response.json(receipt);}
  if(u.pathname.endsWith('/record_product_event')){writes.push('trigger');return Response.json(trigger);}
  throw Error('Unexpected request '+u.pathname);
 });
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
async function imported(){const preview:any=await(await signalSource(request({operation:'preview'}),env,tenant)).json();return signalSource(request({operation:'import',item_id:item.id,digest:preview.items[0].digest,reviewed:true}),env,tenant);}
it.each([undefined,null,true,'not-an-id'])('does not advance after an uncertain contact observation receipt: %s',async value=>{
 receipt.observation_id=value;
 expect((await imported()).status).toBe(503);
 expect(writes).toEqual(['contact']);
});
it('retains the canonical complete acknowledgement path',async()=>{const response=await imported();expect(response.status).toBe(200);const body:any=await response.json();expect(body).toMatchObject({ok:true,tenantId:tenant,sourceId:source.id,itemId:item.id,synthetic:true,lead_id:lead,observation_id:trigger,contactAllowed:false,delivery:'not_sent'});expect(body.digest).toMatch(/^[a-f0-9]{64}$/);expect(writes).toEqual(['contact','trigger']);});
