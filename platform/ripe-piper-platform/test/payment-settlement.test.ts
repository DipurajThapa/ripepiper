import {beforeAll,afterAll,describe,it,expect,beforeEach,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {stripeWebhook,razorpayWebhook,approveProposal,acceptQuote,inspectPayment} from '../src/routes/proposals';
import {minorUnits,parseStripeEvent,parseRazorpayEvent,stripeCheckoutKey,razorpayLink} from '../src/lib/payments';
import type {Env} from '../src/env';
const admin='00000000-0000-4000-8000-000000000001',directory=new URL('../supabase/migrations/',import.meta.url);
let db:PGlite;
const uuid=()=>crypto.randomUUID();
async function query<T=any>(sql:string,args:any[]=[]){return(await db.query<T>(sql,args)).rows;}
async function rpc(name:string,args:any[]){await db.exec('set role service_role');try{return(await query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}finally{await db.exec('reset role');}}
async function fixture(currency='AED'){
 const lead=(await query("insert into leads(source,email,company,country) values('import',$1,'Fixture company','AE') returning id",[uuid()+'@example.invalid']))[0].id;
 const p=(await query("insert into proposals(lead_id,kind,plan,package,currency,fixed_amount,content_md,status,client_email) values($1,'pre','engine','revive',$2,5000,'Fixture','sent','fixture@example.invalid') returning *",[lead,currency]))[0];
 return {...p,provider:currency==='AED'?'stripe':'razorpay',ref:(currency==='AED'?'cs_':'plink_')+uuid().replaceAll('-',''),attempt:uuid(),quote:null,amount:50000,lead};
}
const reserve=(f:any)=>rpc('reserve_payment_checkout',[f.id,f.quote,f.provider,f.amount,f.currency,f.quote?admin:null,f.attempt]);
const bind=(f:any)=>rpc('register_payment_checkout',[f.id,f.quote,f.provider,f.ref,f.amount,f.currency,f.quote?admin:null,f.attempt]);
const apply=(f:any,status='paid')=>rpc('apply_payment_event',[f.id,f.quote,f.provider,f.ref,f.amount,f.currency,status]);
async function bound(f:any){f.reservation=await reserve(f);await bind(f);return f;}
async function quoteFixture(){const f=await bound(await fixture());await apply(f);const p=(await query('select * from proposals where id=$1',[f.id]))[0];const q=(await query("insert into quotes(proposal_id,tenant_id,items,currency,total,status) values($1,$2,'[]','AED',125,'sent') returning id",[f.id,p.tenant_id]))[0];return{...f,tenant:p.tenant_id,quote:q.id,amount:12500,ref:'cs_'+uuid().replaceAll('-',''),attempt:uuid()};}
async function counts(){return(await query("select (select count(*)::int from tenants) tenants,(select count(*)::int from invites) invites,(select count(*)::int from fees) fees,(select count(*)::int from activity_log) activity"))[0];}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});await db.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;");
 for(const f of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,directory),'utf8'));
 await query("insert into auth.users(id,email,email_confirmed_at) values($1,'fixture-admin@example.invalid',now())",[admin]);await query('update profiles set is_admin=true where id=$1',[admin]);
});
afterAll(async()=>{await db.close();});
describe('RP014 atomic existing billing ledger',()=>{
 it.each(['AED','INR'])('settles %s once, preserves unrelated raw, and late failures return exact paid receipt',async currency=>{
  const before=await counts(),f=await bound(await fixture(currency));await query("update payments set raw=raw||'{\"retained\":\"fixture\"}' where id=$1",[f.reservation.paymentId]);
  const first=await apply(f);expect(first).toMatchObject({disposition:'applied',status:'paid',amountMinor:50000});expect(await apply(f)).toEqual(first);expect(await apply(f,'failed')).toEqual(first);
  const after=await counts();expect(after).toEqual({tenants:before.tenants+1,invites:before.invites+1,fees:before.fees+1,activity:before.activity+1});
  const row=(await query('select * from payments where id=$1',[first.paymentId]))[0];expect(row.status).toBe('paid');expect(row.raw.retained).toBe('fixture');expect(row.raw.billing.notifications).toMatchObject({state:'human_review_required',automaticDelivery:false,key:'billing:'+first.paymentId});expect(JSON.stringify(row.raw)).not.toContain('https://');
 });
 it('failed before paid remains recoverable but paid cannot be downgraded',async()=>{const f=await bound(await fixture());expect((await apply(f,'failed')).disposition).toBe('failed');expect((await apply(f)).disposition).toBe('applied');expect((await apply(f,'failed')).status).toBe('paid');});
 it('reserves one attempt and refuses unknown-attempt retry or wrong binding token',async()=>{
  const f=await fixture();await reserve(f);const before=await counts();await expect(reserve({...f,attempt:uuid()})).rejects.toThrow('reconciliation');await expect(bind({...f,attempt:uuid()})).rejects.toThrow('reconciliation');expect((await query('select status from proposals where id=$1',[f.id]))[0].status).toBe('sent');expect(await counts()).toEqual(before);await bind(f);
 });
 it('cannot rebind provider references across proposals, quote identities or financial terms',async()=>{
  const f=await bound(await fixture()),other=await fixture();await reserve(other);
  await expect(bind({...other,ref:f.ref})).rejects.toThrow('bound');await expect(bind({...f,amount:f.amount+1})).rejects.toThrow('terms');
  const before=await counts();for(const mutation of [{amount:f.amount-1},{amount:f.amount+1},{currency:'INR'},{id:other.id},{quote:uuid()}])expect((await apply({...f,...mutation})).disposition).toBe('rejected');expect(await counts()).toEqual(before);expect((await query('select status from payments where id=$1',[f.reservation.paymentId]))[0].status).toBe('pending');
 });
 it.each(['declined','superseded','draft'])('does not settle a %s proposal',async status=>{const f=await bound(await fixture());await query('update proposals set status=$2 where id=$1',[f.id,status]);const before=await counts();expect((await apply(f)).reason).toBe('target_not_open');expect(await counts()).toEqual(before);});
 it('serializes same/different refs on one proposal; competing paid reference is held without a duplicate fee',async()=>{
  const f=await bound(await fixture()),other={...f,ref:'cs_'+uuid().replaceAll('-','')};await query("insert into payments(proposal_id,provider,provider_ref,purpose,amount,currency,status) values($1,'stripe',$2,'advance',500,'AED','pending')",[f.id,other.ref]);const before=await counts();await db.exec('set role service_role');let replies:any[];
  try{replies=await Promise.all([f,other,f].map(x=>query('select apply_payment_event($1,null,$2,$3,$4,$5,\'paid\') result',[x.id,x.provider,x.ref,x.amount,x.currency])));}finally{await db.exec('reset role');}
  expect(replies!.filter(r=>r[0].result.disposition==='applied')).toHaveLength(2);expect(replies!.filter(r=>r[0].result.disposition==='rejected')).toHaveLength(1);const after=await counts();expect(after.fees).toBe(before.fees+1);expect(after.tenants).toBe(before.tenants+1);
 });
 it('quotes bind parent/tenant and settle one fee/activity despite duplicate/out-of-order callbacks',async()=>{
  const f=await quoteFixture();await bound(f);const before=await counts();const first=await apply(f);expect(first.quoteId).toBe(f.quote);expect(await apply(f)).toEqual(first);expect(await apply(f,'failed')).toEqual(first);const after=await counts();expect(after).toEqual({...before,fees:before.fees+1,activity:before.activity+1});expect((await query('select paid_at from quotes where id=$1',[f.quote]))[0].paid_at).not.toBeNull();await expect(reserve({...f,attempt:uuid()})).rejects.toThrow('not open');
 });
 it('quote scope/owner/closed state checks prevent acceptance and settlement',async()=>{
  const f=await quoteFixture();await expect(rpc('reserve_payment_checkout',[f.id,f.quote,'stripe',f.amount,'AED',uuid(),f.attempt])).rejects.toThrow('owner');await bound(f);const foreign=(await fixture()).id;expect((await apply({...f,id:foreign})).disposition).toBe('rejected');await query("update quotes set status='declined' where id=$1",[f.quote]);const before=await counts();expect((await apply(f)).reason).toBe('target_not_open');expect(await counts()).toEqual(before);
 });
 it.each(['tenants','invites','proposals','leads','fees','activity_log','payments'])('rolls back every effect when %s fails inside settlement',async table=>{
  const f=await bound(await fixture()),before=await counts(),payment=(await query('select * from payments where id=$1',[f.reservation.paymentId]))[0];
  await db.exec(`create function fixture_fail() returns trigger language plpgsql as $$begin raise exception 'fixture-stage-failure';end$$;create trigger fixture_failure before ${['proposals','leads','payments'].includes(table)?'update':'insert'} on ${table} for each row execute function fixture_fail();`);
  try{await expect(apply(f)).rejects.toThrow('fixture-stage-failure');}finally{await db.exec(`drop trigger fixture_failure on ${table};drop function fixture_fail();`);}
  expect(await counts()).toEqual(before);expect((await query('select * from payments where id=$1',[f.reservation.paymentId]))[0]).toEqual(payment);expect((await query('select status,tenant_id from proposals where id=$1',[f.id]))[0]).toEqual({status:'approved',tenant_id:null});expect((await apply(f)).disposition).toBe('applied');
 });
 it('refuses a foreign-tenant lead before payment or engagement effects',async()=>{
  const f=await bound(await fixture()),tenant=(await query("insert into tenants(name,slug,country,currency) values('Foreign',$1,'AE','AED') returning id",[uuid()]))[0].id;
  await query('update leads set tenant_id=$2 where id=$1',[f.lead,tenant]);const before=await counts();
  expect((await apply(f)).reason).toBe('target_binding');expect(await counts()).toEqual(before);expect((await query('select status from payments where id=$1',[f.reservation.paymentId]))[0].status).toBe('pending');expect((await query('select status from leads where id=$1',[f.lead]))[0].status).not.toBe('won');
 });
 it.each(['quotes','fees','activity_log','payments'])('rolls back quote settlement when %s fails',async table=>{
  const f=await bound(await quoteFixture()),before=await counts(),payment=(await query('select * from payments where id=$1',[f.reservation.paymentId]))[0];
  await db.exec(`create function fixture_fail() returns trigger language plpgsql as $$begin raise exception 'fixture-stage-failure';end$$;create trigger fixture_failure before ${['quotes','payments'].includes(table)?'update':'insert'} on ${table} for each row execute function fixture_fail();`);
  try{await expect(apply(f)).rejects.toThrow('fixture-stage-failure');}finally{await db.exec(`drop trigger fixture_failure on ${table};drop function fixture_fail();`);}
  expect(await counts()).toEqual(before);expect((await query('select * from payments where id=$1',[f.reservation.paymentId]))[0]).toEqual(payment);expect((await query('select paid_at from quotes where id=$1',[f.quote]))[0].paid_at).toBeNull();expect((await apply(f)).disposition).toBe('applied');
 });
 it('never treats an internal attempt placeholder as provider acknowledgement',async()=>{const f=await fixture();await reserve(f);const before=await counts();await expect(apply({...f,ref:'attempt:'+f.attempt})).rejects.toThrow('Invalid payment event');expect(await counts()).toEqual(before);});
 it('blocks authenticated platform-admin provider ledger forgery, deletion and marker/provider stripping',async()=>{
  const f=await bound(await fixture()),attempt=await fixture();await reserve(attempt);
  const adminCall=async(sql:string,args:any[]=[])=>{await db.exec("set role authenticated;select set_config('request.jwt.sub','"+admin+"',false)");try{return await query(sql,args);}finally{await db.exec('reset role');}};
  for(const [sql,args] of [
   ["update payments set status='paid',settled_at=now(),raw=raw||'{\"billing\":{\"receipt\":{\"disposition\":\"applied\"}}}' where id=$1",[f.reservation.paymentId]],
   ['delete from payments where id=$1',[f.reservation.paymentId]],
   ["update payments set provider='bank',raw=null where id=$1",[f.reservation.paymentId]],
   ['delete from payments where proposal_id=$1',[attempt.id]],
   ["insert into payments(proposal_id,provider,provider_ref,purpose,amount,currency,status) values($1,'stripe','cs_forged','advance',500,'AED','pending')",[f.id]],
   ["insert into payments(provider,provider_ref,purpose,amount,currency,status,raw) values('bank','manual-forged','advance',500,'AED','paid','{\"billing\":{}}')",[]]
  ] as [string,any[]][])await expect(adminCall(sql,args)).rejects.toThrow('service role');
  expect((await apply(f)).disposition).toBe('applied');
 });
 it('protects proposal/quote paid metadata while retaining legacy bank records, manual fees and draft edits',async()=>{
  const f=await fixture(),q=await quoteFixture();
  const adminCall=async(sql:string,args:any[]=[])=>{await db.exec("set role authenticated;select set_config('request.jwt.sub','"+admin+"',false)");try{return await query(sql,args);}finally{await db.exec('reset role');}};
  await expect(adminCall("update proposals set status='paid',paid_at=now() where id=$1",[f.id])).rejects.toThrow('service role');
  await expect(adminCall('update quotes set paid_at=now() where id=$1',[q.quote])).rejects.toThrow('service role');
  await query("update proposals set status='draft' where id=$1",[f.id]);await adminCall("update proposals set content_md='Reviewed draft' where id=$1",[f.id]);
  const bank=(await adminCall("insert into payments(provider,provider_ref,purpose,amount,currency,status) values('bank',$1,'setup',100,'AED','paid') returning id",[uuid()]))[0].id;
  await adminCall("update payments set amount=125 where id=$1",[bank]);await adminCall('delete from payments where id=$1',[bank]);
  await adminCall("insert into fees(tenant_id,month,type,amount,currency,note) values($1,'2026-10-01','setup',100,'AED','Manual fixture fee')",[q.tenant]);
  await bound(q);await apply(q);
  await expect(adminCall('update quotes set paid_at=null where id=$1',[q.quote])).rejects.toThrow('service role');await expect(adminCall('delete from quotes where id=$1',[q.quote])).rejects.toThrow('service role');
  await expect(adminCall("update proposals set status='approved',paid_at=null where id=$1",[q.id])).rejects.toThrow('service role');
  await expect(adminCall('select guard_managed_billing()')).rejects.toThrow();
 });
 it('keeps paid proposal and quote financial/recipient bindings immutable for authenticated admins',async()=>{
  const f=await bound(await quoteFixture()),first=await apply(f),other=await fixture(),foreignTenant=(await query("insert into tenants(name,slug,country,currency) values('Other',$1,'AE','AED') returning id",[uuid()]))[0].id;
  const adminCall=async(sql:string,args:any[]=[])=>{await db.exec("set role authenticated;select set_config('request.jwt.sub','"+admin+"',false)");try{return await query(sql,args);}finally{await db.exec('reset role');}};
  for(const [field,value] of [['lead_id',other.lead],['client_email','changed@example.invalid'],['currency','INR'],['fixed_amount',6000],['advance_pct',20],['tenant_id',foreignTenant]] as [string,any][])await expect(adminCall('update proposals set '+field+'=$2 where id=$1',[f.id,value])).rejects.toThrow('service role');
  await expect(adminCall('update proposals set advance_amount=999 where id=$1',[f.id])).rejects.toThrow();
  for(const [field,value] of [['proposal_id',other.id],['tenant_id',foreignTenant],['currency','INR'],['total',200]] as [string,any][])await expect(adminCall('update quotes set '+field+'=$2 where id=$1',[f.quote,value])).rejects.toThrow('service role');
  await adminCall("update proposals set content_md='Clarified paid scope wording' where id=$1",[f.id]);
  expect((await query('select advance_amount from proposals where id=$1',[f.id]))[0].advance_amount).toBe('500.00');expect(await apply(f)).toEqual(first);
 });
 it('denies anon/authenticated execution of each RPC',async()=>{for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{for(const sql of ["select reserve_payment_checkout(null,null,'stripe',1,'AED',null,null)","select register_payment_checkout(null,null,'stripe','cs_x',1,'AED',null,null)","select apply_payment_event(null,null,'stripe','cs_x',1,'AED','paid')"])await expect(query(sql)).rejects.toThrow();}finally{await db.exec('reset role');}}});
});
const env={SUPABASE_URL:'https://billing.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-public',SITE_URL:'https://fixture.invalid',STRIPE_SECRET_KEY:'fixture-stripe',STRIPE_WEBHOOK_SECRET:'fixture-whsec',RAZORPAY_KEY_ID:'fixture-rzp',RAZORPAY_KEY_SECRET:'fixture-rzp-secret',RAZORPAY_WEBHOOK_SECRET:'fixture-rzp-hook'} as Env;
async function hmac(secret:string,raw:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function signed(f:any,status='paid',provider=f.provider){
 const raw=JSON.stringify(provider==='stripe'?{type:status==='paid'?'checkout.session.completed':'checkout.session.async_payment_failed',data:{object:{id:f.ref,payment_status:status==='paid'?'paid':'unpaid',amount_total:f.amount,currency:f.currency.toLowerCase(),metadata:{proposal_id:f.id,quote_id:f.quote??''}}}}:{event:'payment_link.paid',payload:{payment_link:{entity:{id:f.ref,status:'paid',amount_paid:f.amount,currency:f.currency,notes:{proposal_id:f.id,quote_id:f.quote??''}}}}});
 if(provider==='stripe'){const t=Math.floor(Date.now()/1000);return new Request('https://fixture.invalid/webhooks/stripe',{method:'POST',body:raw,headers:{'Stripe-Signature':`t=${t},v1=${await hmac(env.STRIPE_WEBHOOK_SECRET,`${t}.${raw}`)}`}});}
 return new Request('https://fixture.invalid/webhooks/razorpay',{method:'POST',body:raw,headers:{'X-Razorpay-Signature':await hmac(env.RAZORPAY_WEBHOOK_SECRET,raw)}});
}
const adminRequest=()=>new Request('https://fixture.invalid/api/admin',{method:'POST',headers:{Authorization:'Bearer fixture-admin'}});
describe('actual signed webhook and checkout handlers with real local RPCs',()=>{
 let calls:{url:URL;init:RequestInit}[],mode:string,isAdmin:boolean;
 beforeEach(()=>{
  calls=[];mode='normal';isAdmin=true;
  vi.stubGlobal('fetch',async(input:any,init:RequestInit={})=>{
   const u=new URL(String(input));calls.push({url:u,init});
   if(u.host==='billing.supabase.invalid'){
    if(u.pathname==='/auth/v1/user')return Response.json({id:admin,email:'fixture-admin@example.invalid'});
    if(u.pathname==='/rest/v1/profiles')return Response.json([{is_admin:isAdmin}]);
    if(u.pathname.startsWith('/rest/v1/rpc/')){
     const name=u.pathname.split('/').at(-1)!,b=JSON.parse(String(init.body));
     if(mode==='malformed_'+name)return Response.json({});
     const args=name==='reserve_payment_checkout'?[b.p_proposal,b.p_quote,b.p_provider,b.p_amount_minor,b.p_currency,b.p_actor,b.p_attempt]:name==='register_payment_checkout'?[b.p_proposal,b.p_quote,b.p_provider,b.p_ref,b.p_amount_minor,b.p_currency,b.p_actor,b.p_attempt]:[b.p_proposal,b.p_quote,b.p_provider,b.p_ref,b.p_amount_minor,b.p_currency,b.p_status];
     try{const result=await rpc(name,args);if(mode==='malformed_timestamp'&&name==='apply_payment_event')return Response.json({...result,settledAt:'0'});if(mode==='lost_'+name)throw Error('lost committed response');return Response.json(result);}catch(error){if(mode==='lost_'+name)throw error;return Response.json({message:'fixture DB failure'},{status:500});}
    }
    const table=u.pathname.split('/').at(-1)!;if(!['payments','proposals','leads','quotes','memberships'].includes(table))throw Error('Unexpected DB table');
    const rows=await query('select * from '+table);return Response.json(rows.filter(row=>[...u.searchParams].every(([key,value])=>['select','limit'].includes(key)||!value.startsWith('eq.')||String(row[key])===value.slice(3))));
   }
   if(u.host==='api.stripe.com'||u.host==='api.razorpay.com'){
    if(mode==='provider_timeout')throw Error('Fixture provider uncertain response');
    const stripe=u.host==='api.stripe.com';let id,proposal,quote,amount,currency;
    if(init.method==='POST'){
     if(stripe){const b=new URLSearchParams(String(init.body));proposal=b.get('metadata[proposal_id]');quote=b.get('metadata[quote_id]');amount=Number(b.get('line_items[0][price_data][unit_amount]'));currency='aed';}else{const b=JSON.parse(String(init.body));proposal=b.notes.proposal_id;quote=b.notes.quote_id;amount=b.amount;currency='INR';expect(b.notify).toEqual({email:false,sms:false});expect(b.reminder_enable).toBe(false);}
     id=(stripe?'cs_':'plink_')+(quote||proposal).replaceAll('-','');
    }else{const ref=u.pathname.split('/').at(-1);const m=(await query('select * from payments where provider_ref=$1',[ref]))[0];id=m.provider_ref;proposal=m.proposal_id;quote=m.quote_id;amount=Number(m.amount)*100;currency=m.currency;}
    const data:any={id,currency,status:stripe?'open':'created',...(stripe?{payment_status:'unpaid',amount_total:amount,metadata:{proposal_id:proposal,quote_id:quote},url:'https://checkout.stripe.com/c/pay/'+id}:{amount,notes:{proposal_id:proposal,quote_id:quote},short_url:'https://rzp.io/i/'+id})};
    if(mode==='provider_badurl'){data.url='https://checkout.stripe.com.evil.invalid/stolen';data.short_url='https://evil.invalid/stolen';}
    if(mode==='provider_badamount'){data.amount_total=1;data.amount=1;}
    return Response.json(data);
   }
   throw Error('Forbidden external call '+u.host);
  });
 });
 it.each(['AED','INR'])('actual %s signed webhook calls only atomic RPC, holds notifications and safely replays',async currency=>{
  const f=await bound(await fixture(currency)),fn=currency==='AED'?stripeWebhook:razorpayWebhook;
  expect((await fn(await signed(f),env)).status).toBe(200);expect((await fn(await signed(f),env)).status).toBe(200);
  expect(calls).toHaveLength(2);expect(calls.every(c=>c.url.host==='billing.supabase.invalid'&&c.url.pathname.endsWith('/apply_payment_event'))).toBe(true);
  const m=(await query('select * from payments where id=$1',[f.reservation.paymentId]))[0];expect(m.status).toBe('paid');expect(m.raw.billing.notifications.automaticDelivery).toBe(false);
 });
 it('signed quote webhook reaches its bound quote transaction without proposal engagement effects',async()=>{
  const f=await bound(await quoteFixture()),before=await counts();expect((await stripeWebhook(await signed(f),env)).status).toBe(200);const after=await counts();expect(after).toEqual({...before,fees:before.fees+1,activity:before.activity+1});expect((await query('select paid_at from quotes where id=$1',[f.quote]))[0].paid_at).not.toBeNull();
 });
 it('returns retryable503 for lost committed acknowledgement, then replay recovers without another financial effect',async()=>{
  const f=await bound(await fixture()),before=await counts();mode='lost_apply_payment_event';expect((await stripeWebhook(await signed(f),env)).status).toBe(503);mode='normal';expect((await stripeWebhook(await signed(f),env)).status).toBe(200);const after=await counts();expect(after.fees).toBe(before.fees+1);expect(after.tenants).toBe(before.tenants+1);
 });
 it('does not confirm paid from a malformed acknowledgement timestamp',async()=>{const f=await bound(await fixture());mode='malformed_timestamp';expect((await stripeWebhook(await signed(f),env)).status).toBe(503);mode='normal';expect((await stripeWebhook(await signed(f),env)).status).toBe(200);});
 it('does not report financial completion from a truthy malformed RPC body',async()=>{const f=await bound(await fixture());mode='malformed_apply_payment_event';expect((await stripeWebhook(await signed(f),env)).status).toBe(503);expect((await query('select status from payments where id=$1',[f.reservation.paymentId]))[0].status).toBe('pending');});
 it('invalid signature, malformed/unsafe minor units and target mismatch cannot settle',async()=>{
  const f=await bound(await fixture());expect((await stripeWebhook(new Request('https://fixture.invalid',{method:'POST',body:'{}'}),env)).status).toBe(400);
  expect((await stripeWebhook(await signed({...f,amount:1.5}),env)).status).toBe(400);expect((await stripeWebhook(await signed({...f,amount:f.amount-1}),env)).status).toBe(409);expect((await stripeWebhook(await signed({...f,id:uuid()}),env)).status).toBe(409);expect((await query('select status from payments where id=$1',[f.reservation.paymentId]))[0].status).toBe('pending');
 });
 it.each(['AED','INR'])('approval %s binds once, retry retrieves existing checkout with GET only and persists no URL',async currency=>{
  const f=await fixture(currency);expect((await approveProposal(f.access_token,env)).status).toBe(303);expect((await approveProposal(f.access_token,env)).status).toBe(303);
  const providerCalls=calls.filter(c=>c.url.host.startsWith('api.'));expect(providerCalls.map(c=>c.init.method)).toEqual(['POST','GET']);
  if(currency==='AED')expect((providerCalls[0].init.headers as any)['Idempotency-Key']).toBe(`ripepiper:advance:${f.id}:AED:50000`);
  expect(JSON.stringify((await query('select * from payments where proposal_id=$1',[f.id]))[0])).not.toContain('https://');
 });
 it('provider uncertain creation is held with ledgerID and no automatic replacement on retry',async()=>{
  const f=await fixture();mode='provider_timeout';const first=await approveProposal(f.access_token,env);expect(first.status).toBe(503);const body=await first.text();expect(first.headers.get('Content-Type')).toContain('text/html');expect(body).toMatch(/Reference: [a-f0-9-]{36}/);mode='normal';expect((await approveProposal(f.access_token,env)).status).toBe(503);expect(calls.filter(c=>c.url.host==='api.stripe.com')).toHaveLength(1);expect((await query('select status from proposals where id=$1',[f.id]))[0].status).toBe('sent');
 });
 it.each(['malformed_reserve_payment_checkout','malformed_register_payment_checkout','provider_badurl','provider_badamount'])('%s never returns a checkout capability',async variant=>{
  const f=await fixture();mode=variant;const res=await approveProposal(f.access_token,env);expect(res.status).toBe(503);expect(res.headers.get('Location')).toBeNull();expect(await res.text()).not.toContain('checkout.stripe.com');if(variant==='malformed_reserve_payment_checkout')expect(calls.filter(c=>c.url.host==='api.stripe.com')).toHaveLength(0);
 });
 it('accepted quote retry retrieves existing binding, owner checks apply and paid quote refuses checkout',async()=>{
  const f=await quoteFixture();expect((await acceptQuote(adminRequest(),env,f.quote)).status).toBe(200);expect((await acceptQuote(adminRequest(),env,f.quote)).status).toBe(200);expect(calls.filter(c=>c.url.host==='api.stripe.com').map(c=>c.init.method)).toEqual(['POST','GET']);
  const m=(await query('select * from payments where quote_id=$1',[f.quote]))[0];await apply({...f,ref:m.provider_ref});expect((await acceptQuote(adminRequest(),env,f.quote)).status).toBe(409);
  const next=await quoteFixture();isAdmin=false;expect((await acceptQuote(adminRequest(),env,next.quote)).status).toBe(403);
 });
 it('staff inspection exposes held references, never provider capabilities or resend operations',async()=>{
  const f=await bound(await fixture());await apply(f);const res=await inspectPayment(adminRequest(),env,f.reservation.paymentId),body=await res.json() as any;expect(body.notification_disposition).toMatchObject({state:'human_review_required',automatic_delivery:false,key:'billing:'+f.reservation.paymentId});expect(JSON.stringify(body)).not.toContain('https://');isAdmin=false;await expect(inspectPayment(adminRequest(),env,f.reservation.paymentId)).rejects.toMatchObject({status:403});
 });
 it('retains quote identity on Stripe failed events; ignores Razorpay payment-ID failure without guessing a link',()=>{
  const f={proposalId:uuid(),quoteId:uuid()};expect(parseStripeEvent({type:'checkout.session.async_payment_failed',data:{object:{id:'cs_1',amount_total:100,currency:'aed',metadata:{proposal_id:f.proposalId,quote_id:f.quoteId}}}})).toMatchObject({...f,status:'failed'});expect(parseRazorpayEvent({event:'payment.failed',payload:{payment:{entity:{id:'pay_1',notes:{proposal_id:f.proposalId}}}}})).toBeNull();
  for(const amount of [NaN,Infinity,-1,0,1.005,'1.005','1e3',true])expect(()=>minorUnits(amount)).toThrow();expect(minorUnits('1.01')).toBe(101);
 });
});
