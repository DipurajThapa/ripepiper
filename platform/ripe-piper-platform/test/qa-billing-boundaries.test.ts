import {it,expect,vi,afterEach} from 'vitest';
import worker from '../src/index';
import type {Env} from '../src/env';
const id='fa400000-0000-4000-8000-000000000001',proposal='fa400000-0000-4000-8000-000000000002';
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',SITE_URL:'https://fixture.invalid',STRIPE_WEBHOOK_SECRET:'fixture-signature'} as Env;
const ctx={waitUntil(){}} as unknown as ExecutionContext;
afterEach(()=>vi.unstubAllGlobals());
it('actual payment receipt router denies anonymous/client callers and returns only staff-safe disposition',async()=>{
 let admin=false,found=true;const calls:string[]=[];
 vi.stubGlobal('fetch',async(input:any)=>{
  const u=new URL(String(input));calls.push(u.pathname);
  if(u.host!=='fixture.supabase.co')throw Error('Unexpected provider call');
  if(u.pathname==='/auth/v1/user')return Response.json({id,email:'staff@example.invalid'});
  if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:admin}]);
  if(u.pathname==='/rest/v1/payments')return Response.json(found?[{id,proposal_id:proposal,quote_id:null,status:'paid',settled_at:'2026-10-23T00:00:00Z',raw:{checkout:{state:'bound',url:'https://private.invalid/secret'},billing:{notifications:{state:'human_review_required',private:'must not escape'}}}}]:[]);
  throw Error('Unexpected database mutation');
 });
 const call=(token?:string)=>worker.fetch(new Request('https://fixture.invalid/api/admin/payments/'+id+'/receipt',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:'{}'}),env,ctx);
 expect((await call()).status).toBe(401);expect((await call('client')).status).toBe(403);expect(calls).not.toContain('/rest/v1/payments');
 admin=true;const response=await call('staff'),body:any=await response.json();
 expect(response.status).toBe(200);expect(body.payment_id).toBe(id);expect(body.notification_disposition).toMatchObject({state:'human_review_required',automatic_delivery:false});
 expect(JSON.stringify(body)).not.toMatch(/private\.invalid|must not escape|fixture-service|https:\/\//);
 found=false;expect((await call('staff')).status).toBe(404);
});
async function signedRequest(){
 const raw=JSON.stringify({type:'checkout.session.completed',data:{object:{id:'cs_qa_boundary',payment_status:'paid',amount_total:50000,currency:'aed',metadata:{proposal_id:proposal,quote_id:''}}}}),t=Math.floor(Date.now()/1000);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 return new Request('https://fixture.invalid/webhooks/stripe',{method:'POST',headers:{'Stripe-Signature':`t=${t},v1=${signature}`},body:raw});
}
it.each([{},true,'paid',{version:1,disposition:'applied',paymentId:id,provider:'stripe',ref:'cs_qa_boundary',proposalId:proposal,quoteId:null,amountMinor:50000,currency:'AED',status:'paid',tenantId:id,feeId:id,activityId:1,inviteId:null,settledAt:'0'}])('actual signed webhook router cannot acknowledge malformed settlement evidence: %j',async receipt=>{
 const calls:string[]=[];vi.stubGlobal('fetch',async(input:any)=>{const u=new URL(String(input));calls.push(u.href);if(u.origin!=='https://fixture.supabase.co'||!u.pathname.endsWith('/rpc/apply_payment_event'))throw Error('Unexpected external side effect');return Response.json(receipt);});
 const result=await worker.fetch(await signedRequest(),env,ctx);
 expect(result.status).toBe(503);expect((await result.json()as any).ok).toBe(false);expect(calls).toHaveLength(1);
});
