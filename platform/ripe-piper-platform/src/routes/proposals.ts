import type { Env } from "../env";
import { Db } from "../lib/db";
import { renderMarkdown, escapeHtml } from "../lib/blog";
import { stripeCheckout, razorpayLink, verifyStripe, verifyRazorpay, parseStripeEvent, parseRazorpayEvent, type PaymentEvent } from "../lib/payments";
import { sendEmail } from "../lib/google";
import { emails } from "../lib/email";
import { money } from "../lib/pricing";
import { json, bad, html } from "./http";

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
    : p.status === "approved" ? `<p class="ok"><span>You approved this pre-proposal. <a href="/p/${token}/approve">Continue to payment</a>.</span></p>`
    : p.status === "paid" ? `<p class="ok"><span>Thank you. Your advance has been received and the work has started.</span></p>`
    : `<p class="muted">This proposal is ${p.status}.</p>`;
  return html(page("Your pre-proposal", renderMarkdown(p.content_md) + `<div class="formbox">${action}</div>`, env.SITE_URL));
}

/** Approve and pay: Stripe for AED, Razorpay for INR. GET resumes an approved proposal that was not paid yet. */
export async function approveProposal(token: string, env: Env) {
  if (!tokenOk(token)) return html("Not found", 404);
  const db = new Db(env);
  const p = await db.one<any>("proposals", `access_token=eq.${token}&select=*`);
  if (!p || !["sent", "approved"].includes(p.status)) return Response.redirect(`${env.SITE_URL}/p/${token}`, 303);
  const lead = p.lead_id ? await db.one<any>("leads", `id=eq.${p.lead_id}&select=name,company`) : null;
  const req = {
    proposalId: p.id, amount: Number(p.advance_amount), currency: p.currency, email: p.client_email, name: lead?.name ?? p.client_email,
    description: `Ripe Piper advance (${p.advance_pct}%): ${p.plan === "sprint" ? "Revive Sprint" : "Monthly engine"}, ${p.package}`,
    successUrl: `${env.SITE_URL}/p/${token}`, cancelUrl: `${env.SITE_URL}/p/${token}`,
  };
  const pay = p.currency === "AED" ? await stripeCheckout(env, req) : await razorpayLink(env, req);
  if (p.status === "sent") await db.update("proposals", `id=eq.${p.id}`, { status: "approved", approved_at: new Date().toISOString() });
  await db.upsert("payments", { proposal_id: p.id, provider: p.currency === "AED" ? "stripe" : "razorpay", provider_ref: pay.ref, purpose: "advance",
    amount: Number(p.advance_amount), currency: p.currency, status: "pending" }, "provider,provider_ref");
  return Response.redirect(pay.url, 303);
}

/** Shared by both webhooks: mark the payment, then start the engagement exactly once. */
async function onPaid(env: Env, ev: PaymentEvent, provider: "stripe" | "razorpay") {
  const db = new Db(env);
  if (ev.quoteId) return onQuotePaid(env, ev, provider);
  const p = await db.one<any>("proposals", `id=eq.${ev.proposalId}&select=*`);
  if (!p) return;
  await db.upsert("payments", { proposal_id: p.id, provider, provider_ref: ev.ref, purpose: "advance", amount: ev.amount, currency: ev.currency, status: ev.status, tenant_id: p.tenant_id }, "provider,provider_ref");
  if (ev.status !== "paid" || p.status === "paid") return;
  if (ev.currency !== p.currency || !["sent", "approved"].includes(p.status)) {
    console.error("Payment currency/status mismatch", p.id);
    return;
  }
  if (Math.round(ev.amount * 100) < Math.round(Number(p.advance_amount) * 100)) {
    const a = emails.adminAlert("Payment amount mismatch", `Proposal ${p.id} expected ${p.advance_amount} ${p.currency}, received ${ev.amount} ${ev.currency}.`);
    await sendEmail(env, env.ADMIN_ALERT_EMAIL, a.subject, a.text);
    return;
  }
  const lead = p.lead_id ? await db.one<any>("leads", `id=eq.${p.lead_id}&select=*`) : null;
  let tenantId = p.tenant_id as string | null;
  if (!tenantId) {
    const name = lead?.company || p.client_email.split("@")[1];
    const slug = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "client") + "-" + p.id.slice(0, 6);
    const [t] = await db.insert<any>("tenants", { name, slug, country: lead?.country && ["AE", "IN", "SA", "QA"].includes(lead.country) ? lead.country : "OTHER",
      currency: p.currency, plan: p.plan, package: p.package, status: "onboarding" });
    tenantId = t.id;
    await db.insert("invites", { tenant_id: tenantId, email: p.client_email.toLowerCase(), role: "owner" });
  }
  const now = new Date();
  await db.update("proposals", `id=eq.${p.id}`, { status: "paid", paid_at: now.toISOString(), tenant_id: tenantId });
  await db.update("payments", `provider=eq.${provider}&provider_ref=eq.${encodeURIComponent(ev.ref)}`, { tenant_id: tenantId });
  await db.insert("fees", { tenant_id: tenantId, month: `${now.toISOString().slice(0, 7)}-01`, type: "setup", amount: ev.amount, currency: p.currency, note: `${p.advance_pct}% advance on the fixed-scope price` });
  await db.insert("activity_log", { tenant_id: tenantId, actor: "Ripe Piper", kind: "milestone", message: `Advance of ${money(ev.amount, p.currency)} received. The engagement has started.` });
  if (lead) await db.update("leads", `id=eq.${lead.id}`, { status: "won" });
  const m = emails.advanceReceived(lead?.name ?? "there", money(ev.amount, p.currency), `${env.SITE_URL}/portal/`);
  await sendEmail(env, p.client_email, m.subject, m.text);
  const a = emails.adminAlert("Advance paid", `${p.client_email} paid ${money(ev.amount, p.currency)} for proposal ${p.id}. Send the full proposal next.`);
  await sendEmail(env, env.ADMIN_ALERT_EMAIL, a.subject, a.text);
}

export async function stripeWebhook(req: Request, env: Env) {
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) return bad("Invalid signature.", 400);
  const ev = parseStripeEvent(JSON.parse(raw));
  if (ev?.proposalId) await onPaid(env, ev, "stripe");
  return json({ received: true });
}

export async function razorpayWebhook(req: Request, env: Env) {
  const raw = await req.text();
  if (!(await verifyRazorpay(raw, req.headers.get("X-Razorpay-Signature"), env.RAZORPAY_WEBHOOK_SECRET))) return bad("Invalid signature.", 400);
  const ev = parseRazorpayEvent(JSON.parse(raw));
  if (ev?.proposalId) await onPaid(env, ev, "razorpay");
  return json({ received: true });
}

/** Payment for a customisation quotation. */
async function onQuotePaid(env: Env, ev: PaymentEvent, provider: "stripe" | "razorpay") {
  const db = new Db(env);
  const q = await db.one<any>("quotes", `id=eq.${ev.quoteId}&select=*`);
  if (!q) return;
  await db.upsert("payments", { proposal_id: q.proposal_id, tenant_id: q.tenant_id, provider, provider_ref: ev.ref, purpose: "quote", amount: ev.amount, currency: ev.currency, status: ev.status }, "provider,provider_ref");
  if (ev.status !== "paid" || ev.currency !== q.currency || Math.round(ev.amount * 100) < Math.round(Number(q.total) * 100)) return;
  const now = new Date();
  const existing = await db.one<any>("fees", `tenant_id=eq.${q.tenant_id}&type=eq.quote&note=eq.${encodeURIComponent("Quotation " + q.id)}&select=id`);
  if (!existing) await db.insert("fees", { tenant_id: q.tenant_id, month: `${now.toISOString().slice(0, 7)}-01`, type: "quote", amount: ev.amount, currency: q.currency, note: `Quotation ${q.id}` });
  await db.insert("activity_log", { tenant_id: q.tenant_id, actor: "Ripe Piper", kind: "milestone", message: `Payment of ${money(ev.amount, q.currency)} received for the customisation quotation.` });
}

/** Client owner accepts a quotation in the portal and is sent to payment. */
export async function acceptQuote(req: Request, env: Env, id: string) {
  const { requireUser } = await import("./http");
  const user = await requireUser(req, env);
  const db = new Db(env);
  const q = await db.one<any>("quotes", `id=eq.${id}&status=eq.sent&select=*`);
  if (!q) return bad("This quotation is not open for acceptance.", 404);
  const owner = await db.one<any>("memberships", `tenant_id=eq.${q.tenant_id}&user_id=eq.${user.id}&role=eq.owner&select=user_id`);
  if (!owner && !user.is_admin) return bad("Only the account owner can accept a quotation.", 403);
  await db.update("quotes", `id=eq.${id}`, { status: "accepted" });
  const payReq = { proposalId: q.proposal_id, quoteId: q.id, amount: Number(q.total), currency: q.currency, email: user.email, name: user.email,
    description: "Ripe Piper customisation quotation", successUrl: `${env.SITE_URL}/portal/#quotes`, cancelUrl: `${env.SITE_URL}/portal/#quotes` };
  const pay = q.currency === "AED" ? await stripeCheckout(env, payReq) : await razorpayLink(env, payReq);
  await db.insert("activity_log", { tenant_id: q.tenant_id, actor: user.email, kind: "change", message: `Quotation accepted: ${money(Number(q.total), q.currency)}.` });
  return json({ ok: true, payment_url: pay.url });
}
