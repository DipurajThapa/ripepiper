import type { Env } from "../env";
import { Db } from "../lib/db";
import { meetTranscript, sendEmail, reconcileMeetEvent } from "../lib/google";
import { analyseMeeting, minutesMarkdown, draftPreProposal, priceBlock, type MeetingAnalysis } from "../lib/ai";
import { quoteTotal, money } from "../lib/pricing";
import { emails } from "../lib/email";
import { cleanEmail, cleanText } from "../lib/validate";
import { syncAds } from "../jobs";
import { json, bad, readJson, requireUser } from "./http";

/** Fetch the Meet transcript (or use an uploaded one) and produce notes, minutes and requirements with AI. */
export async function processMeeting(req: Request, env: Env, id: string) {
  await requireUser(req, env, true);
  const b = await readJson(req).catch(() => ({} as Record<string, any>));
  const db = new Db(env);
  const m = await db.one<any>("meetings", `id=eq.${id}&select=*`);
  if (!m) return bad("Meeting not found.", 404);
  let transcript = typeof b.transcript === "string" && b.transcript.trim().length > 200 ? b.transcript : m.transcript;
  if (!transcript) {
    if (!m.meet_code) return bad("This meeting has no Google Meet code. Paste the transcript instead.");
    const t = await meetTranscript(env, m.meet_code);
    if (t.status !== "ready") return bad(t.status === "no_record" ? "Google has no record of this call yet. Try again 30 minutes after the call ends." : "The call has no transcript. Turn on transcription in Google Meet, or paste the transcript.");
    transcript = t.text;
  }
  const lead = m.lead_id ? await db.one<any>("leads", `id=eq.${m.lead_id}&select=name,company,website`) : null;
  const a = await analyseMeeting(env, transcript!, { company: lead?.company ?? lead?.website, attendee: m.attendee_name });
  const minutes = minutesMarkdown(a, `Call with ${m.attendee_name ?? m.attendee_email}`, new Date(m.start_at).toISOString().slice(0, 10));
  await db.update("meetings", `id=eq.${id}`, { transcript, notes: { summary: a.summary, ...a.notes }, minutes, requirements: { ...a.requirements, decisions: a.minutes.decisions, actions: a.minutes.actions }, ai_processed_at: new Date().toISOString(), status: "held" });
  if (m.lead_id) await db.update("leads", `id=eq.${m.lead_id}`, { status: "meeting_held" });
  return json({ ok: true, analysis: a, minutes });
}

/** Draft the pre-proposal from the meeting analysis. Prices come from the published price list. */
export async function draftProposal(req: Request, env: Env, meetingId: string) {
  await requireUser(req, env, true);
  const b = await readJson(req).catch(() => ({} as Record<string, any>));
  const db = new Db(env);
  const m = await db.one<any>("meetings", `id=eq.${meetingId}&select=*`);
  if (!m?.requirements) return bad("Process the meeting first, so the proposal is based on the call.");
  const lead = m.lead_id ? await db.one<any>("leads", `id=eq.${m.lead_id}&select=*`) : null;
  const currency = b.currency === "INR" || (!b.currency && lead?.country === "IN") ? "INR" : "AED";
  const plan = ["sprint", "engine"].includes(b.plan) ? b.plan : m.requirements.recommended_plan;
  const pkg = ["revive", "signal", "response", "events"].includes(b.package) ? b.package : m.requirements.recommended_package;
  const analysis: MeetingAnalysis = { summary: m.notes?.summary ?? "", notes: m.notes, minutes: { decisions: m.requirements.decisions ?? [], actions: m.requirements.actions ?? [] }, requirements: { ...m.requirements, recommended_plan: plan, recommended_package: pkg } };
  const content = await draftPreProposal(env, analysis, { company: lead?.company ?? lead?.website ?? "your company", contact: m.attendee_name ?? "", currency, singleEvent: b.single_event === true });
  const { scope } = priceBlock(currency, plan, pkg, b.single_event === true);
  const [p] = await db.insert<any>("proposals", { lead_id: m.lead_id, meeting_id: m.id, kind: "pre", plan, package: pkg, currency, fixed_amount: scope.total, content_md: content, client_email: m.attendee_email, status: "draft" });
  return json({ ok: true, proposal: p });
}

/** Send the reviewed pre-proposal to the client. */
export async function sendProposal(req: Request, env: Env, id: string) {
  await requireUser(req, env, true);
  const db = new Db(env);
  const [p] = await db.update<any>("proposals", `id=eq.${id}&status=eq.draft`, { status: "sent", sent_at: new Date().toISOString() });
  if (!p) return bad("Only draft proposals can be sent.");
  const lead = p.lead_id ? await db.one<any>("leads", `id=eq.${p.lead_id}&select=name`) : null;
  const m = emails.preProposal(lead?.name ?? "there", `${env.SITE_URL}/p/${p.access_token}`);
  await sendEmail(env, p.client_email, m.subject, m.text);
  return json({ ok: true });
}

/** Quotation for customisations, created after the proposal is locked (paid). The total is calculated here, not in the browser. */
export async function createQuote(req: Request, env: Env) {
  await requireUser(req, env, true);
  const b = await readJson(req);
  const db = new Db(env);
  const p = await db.one<any>("proposals", `id=eq.${encodeURIComponent(String(b.proposal_id))}&select=*`);
  if (!p || p.status !== "paid") return bad("Customisations can be quoted only after the advance is paid and the proposal is locked.");
  const items = (Array.isArray(b.items) ? b.items : []).map((i: any) => ({ description: cleanText(i.description, 200), quantity: Number(i.quantity), unit_price: Number(i.unit_price) }));
  if (!items.length) return bad("Add at least one item to the quotation.");
  const total = quoteTotal(items);
  const [q] = await db.insert<any>("quotes", { proposal_id: p.id, tenant_id: p.tenant_id, items, currency: p.currency, total, status: "draft" });
  return json({ ok: true, quote: q, total_label: money(total, p.currency) });
}

export async function sendQuote(req: Request, env: Env, id: string) {
  await requireUser(req, env, true);
  const db = new Db(env);
  const [q] = await db.update<any>("quotes", `id=eq.${id}&status=eq.draft`, { status: "sent" });
  if (!q) return bad("Only draft quotations can be sent.");
  const p = await db.one<any>("proposals", `id=eq.${q.proposal_id}&select=client_email`);
  const m = emails.quote("there", `${env.SITE_URL}/portal/#quotes`);
  await sendEmail(env, p.client_email, m.subject, m.text);
  await db.insert("activity_log", { tenant_id: q.tenant_id, actor: "Ripe Piper", kind: "change", message: `Quotation for customisations sent: ${money(Number(q.total), q.currency)}.` });
  return json({ ok: true });
}

/** Invite a person to a client's dashboard. They sign in with Google or an email link using this address. */
export async function inviteUser(req: Request, env: Env, tenantId: string) {
  await requireUser(req, env, true);
  const b = await readJson(req);
  const email = cleanEmail(b.email);
  if (!email) return bad("Please enter a valid email address.");
  if (b.role !== "viewer" && b.role !== "owner") return bad("Choose an owner or viewer role.");
  const role = b.role;
  const db = new Db(env);
  const tenant = await db.one<{ status: string }>("tenants", `id=eq.${tenantId}&select=status`);
  if (!tenant) return bad("Client not found.", 404);
  if (!['onboarding', 'active'].includes(tenant.status)) return bad("This client is paused or inactive.", 409);
  const previous = await db.one<{ accepted_at: string | null }>("invites", `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&select=accepted_at`);
  if (previous?.accepted_at) return bad("This invitation was already accepted. Review the member's role separately.", 409);
  await db.upsert("invites", { tenant_id: tenantId, email, role }, "tenant_id,email");
  return json({ ok: true });
}

export async function runAdsSync(req: Request, env: Env) {
  await requireUser(req, env, true);
  return json({ ok: true, result: await syncAds(env, 7) });
}

/** Repair the existing public-consultation link using a provider read, without another invitation. */
export async function reconcileBooking(req: Request, env: Env, id: string) {
  const user = await requireUser(req, env, true);
  const db = new Db(env);
  const m = await db.one<any>("meetings", `id=eq.${id}&tenant_id=is.null&status=eq.booked&select=*`);
  if (!m || !m.google_event_id) return bad("No reconcilable consultation reservation was found.", 404);
  let ev;
  try {
    ev = await reconcileMeetEvent(env, { id: m.id, start: m.start_at, end: m.end_at, email: m.attendee_email,
      name: m.attendee_name ?? "", summary: "", description: "" }, m.google_event_id);
  } catch {
    return bad("Calendar confirmation is still unavailable or does not match. The reservation remains held; check the configured calendar before changing it.", 409);
  }
  await db.insert("activity_log", { actor: user.id, kind: "note", visible_to_client: false,
    message: `Calendar event verified for consultation ${m.id}; reconciliation requested without sending an invitation.` });
  const changed = await db.update("meetings", `id=eq.${id}&tenant_id=is.null&status=eq.booked&google_event_id=eq.${encodeURIComponent(m.google_event_id)}&start_at=eq.${encodeURIComponent(m.start_at)}&end_at=eq.${encodeURIComponent(m.end_at)}&attendee_email=eq.${encodeURIComponent(m.attendee_email)}&lead_id=${m.lead_id ? "eq." + encodeURIComponent(m.lead_id) : "is.null"}`, {
    meet_url: ev.meetUrl, meet_code: ev.meetCode,
  });
  if (!changed.length) return bad("The reservation changed. Reload before continuing.", 409);
  if (m.lead_id) await db.update("leads", `id=eq.${m.lead_id}&tenant_id=is.null&status=eq.qualified`, { status: "meeting_booked" });
  return json({ ok: true, meeting_id: m.id, meet_url: ev.meetUrl, delivery: "not_sent" });
}
