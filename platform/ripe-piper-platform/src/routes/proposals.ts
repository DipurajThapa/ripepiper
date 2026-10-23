import type { Env } from "../env";
import { Db } from "../lib/db";
import { validInstant } from "../foundation/prospecting";
import { renderMarkdown, escapeHtml } from "../lib/blog";
import { stripeCheckout, razorpayLink, retrieveCheckout, minorUnits, paymentId, providerReference, verifyStripe, verifyRazorpay, parseStripeEvent, parseRazorpayEvent, type PaymentEvent, type PaymentRequest, type PaymentProvider } from "../lib/payments";
import { money } from "../lib/pricing";
import { json, bad, html, requireUser } from "./http";

const tokenOk = (t: string) => /^[0-9a-f-]{36}$/.test(t);

function page(title: string, inner: string, site: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} | Ripe Piper</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Boldonse&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${site}/assets/site.css"></head><body><main id="main"><section><div class="wrap prose-wrap"><article class="prose">${inner}</article></div></section></main></body></html>`;
}

/** Client-facing pre-proposal page, opened from the secret link in the email. */
export async function viewProposal(token: string, env: Env) {
  if (!tokenOk(token)) return html("Not found", 404);
  const p = await new Db(env).one<any>("proposals", `access_token=eq.${token}&select=*`);
  if (!p || p.status === "superseded") return html(page("Proposal not found", "<h1>This proposal link is no longer valid</h1><p>Please contact us at hello@ripepiper.com.</p>", env.SITE_URL), 404);
  const action = p.status === "sent"
    ? `<form method="post" action="/p/${token}/approve"><p>By approving, you agree to the scope and fixed-scope price above and to pay the advance of <strong>${money(Number(p.advance_amount), p.currency)}</strong>.</p>
       <button class="btn btn-dark" type="submit">Approve and pay ${money(Number(p.advance_amount), p.currency)}</button></form>`
    : p.status === "approved" ? `<form method="post" action="/p/${token}/approve"><p class="ok">You approved this pre-proposal. Continue to payment when ready.</p><button class="btn btn-dark" type="submit">Continue to payment</button></form>`
    : p.status === "paid" ? `<p class="ok"><span>Thank you. Your advance has been received. Onboarding is awaiting team review.</span></p>`
    : `<p class="muted">This proposal is ${p.status}.</p>`;
  return html(page("Your pre-proposal", renderMarkdown(p.content_md) + `<div class="formbox">${action}</div>`, env.SITE_URL));
}

/** Only the existing explicit POST may reveal a provider-hosted checkout URL. */
async function checkout(env: Env, p: PaymentRequest, actor: string|null) {
  const db=new Db(env,15000),provider:PaymentProvider=p.currency==="AED"?"stripe":"razorpay",amount=minorUnits(p.amount);
  const rows=await db.select<any>("payments",`proposal_id=eq.${p.proposalId}&purpose=eq.${p.quoteId?"quote":"advance"}&select=id,proposal_id,quote_id,provider,provider_ref,amount,currency,status,raw`);
  const matches=rows.filter(row=>(row.quote_id??undefined)===p.quoteId||(p.quoteId&&row.quote_id==null));
  if(matches.length){
    const m=matches[0];
    if(matches.length!==1||!paymentId(m.id)||m.proposal_id!==p.proposalId||(m.quote_id??undefined)!==p.quoteId||m.provider!==provider||m.currency!==p.currency||minorUnits(m.amount)!==amount||!["pending","failed"].includes(m.status)||m.raw?.checkout?.state!=="bound"||!providerReference(provider,m.provider_ref))throw new CheckoutReview(m.id,"existing_checkout");
    return retrieveCheckout(env,provider,m.provider_ref,p);
  }
  const attempt=crypto.randomUUID();let paymentRecord:string|undefined;
  try{
    const reserve=await db.rpc<any>("reserve_payment_checkout",{p_proposal:p.proposalId,p_quote:p.quoteId??null,p_provider:provider,p_amount_minor:amount,p_currency:p.currency,p_actor:actor,p_attempt:attempt});
    if(!reserve||reserve.version!==1||reserve.disposition!=="reserved"||!paymentId(reserve.paymentId)||reserve.attemptId!==attempt||reserve.provider!==provider||reserve.proposalId!==p.proposalId||reserve.quoteId!==(p.quoteId??null)||reserve.amountMinor!==amount||reserve.currency!==p.currency)throw new Error("Invalid checkout reservation");
    paymentRecord=reserve.paymentId;
    const pay=provider==="stripe"?await stripeCheckout(env,p):await razorpayLink(env,p);
    const bound=await db.rpc<any>("register_payment_checkout",{p_proposal:p.proposalId,p_quote:p.quoteId??null,p_provider:provider,p_ref:pay.ref,p_amount_minor:amount,p_currency:p.currency,p_actor:actor,p_attempt:attempt});
    if(!bound||bound.version!==1||bound.paymentId!==paymentRecord||bound.provider!==provider||bound.ref!==pay.ref||bound.proposalId!==p.proposalId||bound.quoteId!==(p.quoteId??null)||bound.amountMinor!==amount||bound.currency!==p.currency||!["pending","failed"].includes(bound.status))throw new Error("Invalid checkout binding");
    return pay;
  }catch{throw new CheckoutReview(paymentRecord,"checkout_creation_or_binding");}
}
class CheckoutReview extends Error {constructor(public paymentRecord:string|undefined,public phase:string){super("Checkout requires reconciliation");}}
function checkoutError(error:unknown){
  const e=error instanceof CheckoutReview?error:new CheckoutReview(undefined,"provider_retrieval");
  return json({ok:false,error:"Payment checkout needs operator review. Contact Ripe Piper; the operator must check the existing provider checkout before any replacement is created.",phase:e.phase,...(paymentId(e.paymentRecord)?{payment_id:e.paymentRecord}:{})},503);
}
export async function approveProposal(token: string, env: Env) {
  if(!tokenOk(token))return html("Not found",404);
  const db=new Db(env,15000),p=await db.one<any>("proposals",`access_token=eq.${token}&select=*`);
  if(!p||!["sent","approved"].includes(p.status))return Response.redirect(`${env.SITE_URL}/p/${token}`,303);
  const lead=p.lead_id?await db.one<any>("leads",`id=eq.${p.lead_id}&select=name,company`):null;
  const request:PaymentRequest={proposalId:p.id,amount:Number(p.advance_amount),currency:p.currency,email:p.client_email,name:lead?.name??p.client_email,description:`Ripe Piper advance (${p.advance_pct}%): ${p.plan==="sprint"?"Revive Sprint":"Monthly engine"}, ${p.package}`,successUrl:`${env.SITE_URL}/p/${token}`,cancelUrl:`${env.SITE_URL}/p/${token}`};
  try{return Response.redirect((await checkout(env,request,null)).url,303);}catch(error){return checkoutError(error);}
}

const rejectedReasons=new Set(["unknown_target","target_binding","unregistered_reference","financial_or_target_binding","legacy_payload_requires_review","legacy_or_refunded_requires_review","target_not_open"]);
/** Exact acknowledgement, not a truthy database body. Unknown outcomes return retryable 503. */
function validReceipt(r:any,ev:PaymentEvent,provider:PaymentProvider){
  if(!r||r.version!==1||!["applied","failed"].includes(r.disposition)||!paymentId(r.paymentId)||r.provider!==provider||r.ref!==ev.ref||r.proposalId!==ev.proposalId||r.quoteId!==(ev.quoteId??null)||r.amountMinor!==minorUnits(ev.amount)||r.currency!==ev.currency)return false;
  if(r.disposition==="failed")return ev.status==="failed"&&r.status==="failed";
  return r.status==="paid"&&paymentId(r.tenantId)&&paymentId(r.feeId)&&Number.isSafeInteger(r.activityId)&&r.activityId>0&&(r.inviteId===null||paymentId(r.inviteId))&&validInstant(r.settledAt);
}
async function webhook(req:Request,env:Env,provider:PaymentProvider){
  const raw=await req.text();if(raw.length>64000)return bad("Webhook is too large.",413);
  const verified=provider==="stripe"?await verifyStripe(raw,req.headers.get("Stripe-Signature"),env.STRIPE_WEBHOOK_SECRET):await verifyRazorpay(raw,req.headers.get("X-Razorpay-Signature"),env.RAZORPAY_WEBHOOK_SECRET);
  if(!verified)return bad("Invalid signature.",400);
  let event:PaymentEvent|null;
  try{const value=JSON.parse(raw);event=provider==="stripe"?parseStripeEvent(value):parseRazorpayEvent(value);}catch{return bad("Invalid payment event.",400);}
  if(!event)return json({received:true,disposition:"ignored"});
  try{
    const receipt=await new Db(env,15000).rpc<any>("apply_payment_event",{p_proposal:event.proposalId,p_quote:event.quoteId??null,p_provider:provider,p_ref:event.ref,p_amount_minor:minorUnits(event.amount),p_currency:event.currency,p_status:event.status});
    if(receipt?.version===1&&receipt.disposition==="rejected"&&rejectedReasons.has(receipt.reason))return json({received:false,disposition:"rejected",reason:receipt.reason},409);
    if(!validReceipt(receipt,event,provider))throw new Error("Unverified payment acknowledgement");
    return json({received:true,disposition:receipt.disposition,payment_id:receipt.paymentId,notification_disposition:receipt.disposition==="applied"?"human_review_required":undefined});
  }catch{return bad("Payment acknowledgement is unverified. Provider retry is safe; operator review may be required.",503);}
}
export const stripeWebhook=(req:Request,env:Env)=>webhook(req,env,"stripe");
export const razorpayWebhook=(req:Request,env:Env)=>webhook(req,env,"razorpay");

/** Accept or resume an unpaid quotation without creating another checkout. */
export async function acceptQuote(req:Request,env:Env,id:string){
  const user=await requireUser(req,env);if(!paymentId(id))return bad("Quotation not found.",404);
  const db=new Db(env,15000),q=await db.one<any>("quotes",`id=eq.${id}&select=*`);
  if(!q||!["sent","accepted"].includes(q.status)||q.paid_at)return bad("This quotation is not open for payment.",409);
  const owner=await db.one<any>("memberships",`tenant_id=eq.${q.tenant_id}&user_id=eq.${user.id}&role=eq.owner&select=user_id`);
  if(!owner&&!user.is_admin)return bad("Only the account owner can accept a quotation.",403);
  const payReq:PaymentRequest={proposalId:q.proposal_id,quoteId:q.id,amount:Number(q.total),currency:q.currency,email:user.email,name:user.email,description:"Ripe Piper customisation quotation",successUrl:`${env.SITE_URL}/portal/#quotes`,cancelUrl:`${env.SITE_URL}/portal/#quotes`};
  try{return json({ok:true,payment_url:(await checkout(env,payReq,user.id)).url});}catch(error){return checkoutError(error);}
}
/** Staff can inspect held notification references; this endpoint cannot send or requeue anything. */
export async function inspectPayment(req:Request,env:Env,id:string){
  await requireUser(req,env,true);if(!paymentId(id))return bad("Payment not found.",404);
  const m=await new Db(env,15000).one<any>("payments",`id=eq.${id}&select=id,proposal_id,quote_id,provider,status,settled_at,raw`);
  if(!m)return bad("Payment not found.",404);
  const n=m.raw?.billing?.notifications;
  return json({payment_id:m.id,proposal_id:m.proposal_id,quote_id:m.quote_id,status:m.status,settled_at:m.settled_at,checkout_phase:["creating","bound"].includes(m.raw?.checkout?.state)?m.raw.checkout.state:"legacy_requires_review",review_disposition:rejectedReasons.has(m.raw?.billingReview?.reason)?{state:"human_review_required",reason:m.raw.billingReview.reason}:null,notification_disposition:n?.state==="human_review_required"?{state:"human_review_required",key:`billing:${m.id}`,client_purpose:m.quote_id?"quote_paid":"advance_received",client_recipient_reference:`proposal:${m.proposal_id}`,admin_recipient_reference:"configured_admin",automatic_delivery:false}:null});
}
