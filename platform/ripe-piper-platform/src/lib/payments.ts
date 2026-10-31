import type { Env } from "../env";

/** Stripe (AED) and Razorpay (INR): create a payment for the advance, and verify webhooks. */

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Stripe-Signature header: "t=<unix>,v1=<hex>[,v1=...]". Signed payload is "<t>.<raw body>". Rejects events older than 5 minutes. */
export async function verifyStripe(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header || typeof secret !== "string" || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=") as [string, string]).filter(p => p.length === 2)) as Record<string, string>;
  const sigs = header.split(",").filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!Number.isSafeInteger(t) || t <= 0 || Math.abs(nowSec - t) > 300 || sigs.length === 0) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return sigs.some(s => safeEqual(s, expected));
}

/** Razorpay webhook: X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret) in hex. */
export async function verifyRazorpay(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || typeof secret !== "string" || !secret) return false;
  return safeEqual(header, await hmacHex(secret, rawBody));
}

export interface PaymentRequest { proposalId: string; quoteId?: string; amount: number; currency: "AED" | "INR"; description: string; email: string; name: string; successUrl: string; cancelUrl: string }
export type PaymentProvider = "stripe" | "razorpay";
export const paymentId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const providerReference = (provider: PaymentProvider, ref: unknown): ref is string => typeof ref === "string" && ref.length <= 190 && (provider === "stripe" ? /^cs_[A-Za-z0-9_]+$/ : /^plink_[A-Za-z0-9_]+$/).test(ref);
/** Parse decimal major units without rounding fractional minor units or coercing invalid values. */
export function minorUnits(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error("Invalid payment amount");
  const [whole, fraction = ""] = String(value).split(".");
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (n <= 0n || n > 999999999999n) throw new Error("Invalid payment amount");
  return Number(n);
}
function validMinor(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 999999999999; }
function hostedUrl(value: unknown, provider: PaymentProvider): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("Invalid checkout receipt");
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.hostname !== (provider === "stripe" ? "checkout.stripe.com" : "rzp.io")) throw new Error("Invalid checkout receipt");
  return u.href;
}
function checkoutReceipt(j: any, provider: PaymentProvider, p: PaymentRequest, ref?: string) {
  const meta = provider === "stripe" ? j?.metadata : j?.notes;
  if (!providerReference(provider,j?.id) || (ref !== undefined && ref !== j.id) ||
      meta?.proposal_id !== p.proposalId || (meta?.quote_id || undefined) !== p.quoteId ||
      (provider === "stripe" ? j.amount_total : j.amount) !== minorUnits(p.amount) ||
      String(j.currency).toUpperCase() !== p.currency ||
      (provider === "stripe" ? j.status !== "open" || j.payment_status !== "unpaid" : !["created","partially_paid"].includes(j.status))) throw new Error("Checkout requires reconciliation");
  return {ref:j.id as string,url:hostedUrl(provider === "stripe" ? j.url : j.short_url,provider)};
}
async function providerJson(url: string, init: RequestInit) {
  const res = await fetch(url,{...init,redirect:"error",signal:AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error("Payment provider unavailable; reconcile the checkout before retrying.");
  const body = await res.text();
  if (body.length > 64000) throw new Error("Invalid checkout receipt");
  return JSON.parse(body);
}
/** Documented Stripe key: same target and immutable financial terms; never a fresh retry key. */
export function stripeCheckoutKey(p: PaymentRequest) { return `ripepiper:${p.quoteId ? "quote:"+p.quoteId : "advance:"+p.proposalId}:${p.currency}:${minorUnits(p.amount)}`; }
export async function stripeCheckout(env: Env, p: PaymentRequest): Promise<{url:string;ref:string}> {
  const form = new URLSearchParams({
    mode:"payment",success_url:p.successUrl,cancel_url:p.cancelUrl,customer_email:p.email,client_reference_id:p.proposalId,
    "metadata[proposal_id]":p.proposalId,"metadata[quote_id]":p.quoteId??"",
    "payment_intent_data[metadata][proposal_id]":p.proposalId,
    "line_items[0][quantity]":"1","line_items[0][price_data][currency]":"aed",
    "line_items[0][price_data][unit_amount]":String(minorUnits(p.amount)),"line_items[0][price_data][product_data][name]":p.description,
  });
  return checkoutReceipt(await providerJson("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":stripeCheckoutKey(p)},body:form}),"stripe",p);
}
export async function razorpayLink(env: Env, p: PaymentRequest): Promise<{url:string;ref:string}> {
  return checkoutReceipt(await providerJson("https://api.razorpay.com/v1/payment_links",{method:"POST",headers:{Authorization:"Basic "+btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`),"Content-Type":"application/json"},body:JSON.stringify({
    amount:minorUnits(p.amount),currency:"INR",description:p.description,reference_id:p.quoteId??p.proposalId,
    customer:{name:p.name,email:p.email},notify:{email:false,sms:false},reminder_enable:false,accept_partial:false,
    notes:{proposal_id:p.proposalId,quote_id:p.quoteId??""},callback_url:p.successUrl,callback_method:"get",
  })}),"razorpay",p);
}
/** Authorized POST recovery only. The hosted checkout capability is never stored in the database. */
export async function retrieveCheckout(env: Env, provider: PaymentProvider, ref: string, p: PaymentRequest) {
  if (!providerReference(provider,ref)) throw new Error("Checkout requires reconciliation");
  const url = provider === "stripe" ? `https://api.stripe.com/v1/checkout/sessions/${ref}` : `https://api.razorpay.com/v1/payment_links/${ref}`;
  const Authorization = provider === "stripe" ? `Bearer ${env.STRIPE_SECRET_KEY}` : "Basic "+btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  return checkoutReceipt(await providerJson(url,{method:"GET",headers:{Authorization}}),provider,p,ref);
}

export interface PaymentEvent { proposalId: string; quoteId?: string; ref: string; amount: number; currency: string; status: "paid" | "failed" }
function paymentEvent(proposalId: unknown, quoteId: unknown, ref: unknown, amount: unknown, currency: unknown, status: "paid"|"failed", provider: PaymentProvider): PaymentEvent {
  if (!paymentId(proposalId) || (quoteId !== undefined && quoteId !== "" && !paymentId(quoteId)) || !providerReference(provider,ref) || !validMinor(amount) || currency !== (provider === "stripe" ? "AED" : "INR")) throw new Error("Invalid payment event");
  return {proposalId,quoteId:quoteId ? String(quoteId) : undefined,ref,amount:amount/100,currency:String(currency),status};
}
/** Only supported checkout/link identities can change a bound payment. */
export function parseStripeEvent(evt: any): PaymentEvent | null {
  const type=evt?.type,o=evt?.data?.object;
  if (!["checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed"].includes(type)) return null;
  if (type === "checkout.session.completed" && o?.payment_status !== "paid") return null;
  if (type === "checkout.session.async_payment_succeeded" && o?.payment_status !== "paid") throw new Error("Invalid paid checkout event");
  return paymentEvent(o?.metadata?.proposal_id??o?.client_reference_id,o?.metadata?.quote_id,o?.id,o?.amount_total,typeof o?.currency === "string" ? o.currency.toUpperCase() : o?.currency,type.endsWith("failed")?"failed":"paid","stripe");
}
export function parseRazorpayEvent(evt: any): PaymentEvent | null {
  // payment.failed contains a payment ID, not the registered Payment Link ID. Never guess a binding.
  if (evt?.event !== "payment_link.paid") return null;
  const pl=evt?.payload?.payment_link?.entity;
  if(pl?.status!=="paid")throw new Error("Invalid paid link event");
  return paymentEvent(pl?.notes?.proposal_id,pl?.notes?.quote_id,pl?.id,pl?.amount_paid,pl?.currency,"paid","razorpay");
}
