import type { Env } from "../env";

/** Stripe (AED) and Razorpay (INR): create a payment for the advance, and verify webhooks. */

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Stripe-Signature header: "t=<unix>,v1=<hex>[,v1=...]". Signed payload is "<t>.<raw body>". Rejects events older than 5 minutes. */
export async function verifyStripe(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=") as [string, string]).filter(p => p.length === 2)) as Record<string, string>;
  const sigs = header.split(",").filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(nowSec - t) > 300 || sigs.length === 0) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return sigs.some(s => safeEqual(s, expected));
}

/** Razorpay webhook: X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret) in hex. */
export async function verifyRazorpay(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  return safeEqual(header, await hmacHex(secret, rawBody));
}

export interface PaymentRequest { proposalId: string; quoteId?: string; amount: number; currency: "AED" | "INR"; description: string; email: string; name: string; successUrl: string; cancelUrl: string }

/** Stripe Checkout Session for AED. Amounts are in fils (1 AED = 100 fils). */
export async function stripeCheckout(env: Env, p: PaymentRequest): Promise<{ url: string; ref: string }> {
  const form = new URLSearchParams({
    mode: "payment",
    success_url: p.successUrl, cancel_url: p.cancelUrl,
    customer_email: p.email,
    client_reference_id: p.proposalId,
    "metadata[proposal_id]": p.proposalId,
    "metadata[quote_id]": p.quoteId ?? "",
    "payment_intent_data[metadata][proposal_id]": p.proposalId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "aed",
    "line_items[0][price_data][unit_amount]": String(Math.round(p.amount * 100)),
    "line_items[0][price_data][product_data][name]": p.description,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  const j = (await res.json()) as any;
  if (!res.ok) throw new Error(`Stripe error: ${j.error?.message ?? res.status}`);
  return { url: j.url, ref: j.id };
}

/** Razorpay Payment Link for INR. Amounts are in paise (₹1 = 100 paise). */
export async function razorpayLink(env: Env, p: PaymentRequest): Promise<{ url: string; ref: string }> {
  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`), "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: Math.round(p.amount * 100), currency: "INR", description: p.description,
      reference_id: p.proposalId.slice(0, 40),
      customer: { name: p.name, email: p.email },
      notify: { email: true, sms: false }, reminder_enable: true,
      notes: { proposal_id: p.proposalId, quote_id: p.quoteId ?? "" },
      callback_url: p.successUrl, callback_method: "get",
    }),
  });
  const j = (await res.json()) as any;
  if (!res.ok) throw new Error(`Razorpay error: ${j.error?.description ?? res.status}`);
  return { url: j.short_url, ref: j.id };
}

/** Normalise a verified webhook into one shape. Returns null for events we do not act on. */
export interface PaymentEvent { proposalId: string; quoteId?: string; ref: string; amount: number; currency: string; status: "paid" | "failed" }

export function parseStripeEvent(evt: any): PaymentEvent | null {
  const o = evt?.data?.object;
  if (evt?.type === "checkout.session.completed" && o?.payment_status === "paid") {
    return { proposalId: o.metadata?.proposal_id ?? o.client_reference_id, quoteId: o.metadata?.quote_id || undefined, ref: o.id, amount: o.amount_total / 100, currency: String(o.currency).toUpperCase(), status: "paid" };
  }
  if (evt?.type === "checkout.session.async_payment_failed") {
    return { proposalId: o.metadata?.proposal_id ?? o.client_reference_id, ref: o.id, amount: o.amount_total / 100, currency: String(o.currency).toUpperCase(), status: "failed" };
  }
  return null;
}

export function parseRazorpayEvent(evt: any): PaymentEvent | null {
  if (evt?.event === "payment_link.paid") {
    const pl = evt.payload?.payment_link?.entity;
    return { proposalId: pl?.notes?.proposal_id, quoteId: pl?.notes?.quote_id || undefined, ref: pl?.id, amount: pl?.amount_paid / 100, currency: pl?.currency, status: "paid" };
  }
  if (evt?.event === "payment.failed") {
    const pay = evt.payload?.payment?.entity;
    return { proposalId: pay?.notes?.proposal_id, ref: pay?.id, amount: pay?.amount / 100, currency: pay?.currency, status: "failed" };
  }
  return null;
}
