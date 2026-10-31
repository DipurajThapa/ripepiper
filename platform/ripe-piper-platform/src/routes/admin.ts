import { saveMeetingDraft } from "../foundation/consultation-review";
import type { Env } from "../env";
import { Db, DbError } from "../lib/db";
import { meetTranscript, sendEmail, reconcileMeetEvent, cancelEvent, GoogleError } from "../lib/google";
import { PaidUseBlocked } from "../lib/build-budget";
import { analyseMeeting, minutesMarkdown, draftPreProposal, priceBlock, type MeetingAnalysis } from "../lib/ai";
import { quoteTotal, money } from "../lib/pricing";
import { emails } from "../lib/email";
import { cleanEmail, cleanText } from "../lib/validate";
import { syncAds } from "../jobs";
import { json, bad, readJson, requireUser, HttpError } from "./http";

const paidAI = <T>(p: Promise<T>) => p.catch(e => { throw e instanceof PaidUseBlocked ? new HttpError(409, "Paid AI is not enabled for this environment.") : e; });
const TAKEN = new Error("already claimed");
/** Claim a draft (draft -> sent) only once Gmail is reachable; release it only when Gmail definitely rejected the send (4xx).
 *  A 5xx, timeout or unverified result after the claim may still have delivered, so it stays sent and a retry can never email the client twice. */
async function claimAndSend(env: Env, table: string, id: string, claim: Record<string, unknown>, release: Record<string, unknown>, to: string, m: { subject: string; text: string }) {
  const db = new Db(env); let claimed = false;
  try {
    await sendEmail(env, to, m.subject, m.text, undefined, async () => { const [r] = await db.update(table, `id=eq.${id}&status=eq.draft`, claim); if (!r) throw TAKEN; claimed = true; });
    return "sent";
  } catch (e) {
    if (e === TAKEN) return "taken";
    if (!claimed) { if (e instanceof GoogleError) return "unsent"; throw e; }
    if (e instanceof GoogleError && e.status >= 400 && e.status < 500) { await db.update(table, `id=eq.${id}&status=eq.sent`, release); return "unsent"; }
    return "uncertain";
  }
}

const storedAnalysis = (m: any): MeetingAnalysis => ({ summary: m.notes?.summary ?? "", notes: m.notes, minutes: { decisions: m.requirements?.decisions ?? [], actions: m.requirements?.actions ?? [] }, requirements: m.requirements });

/** Fetch the Meet transcript (or use an uploaded one) and produce notes, minutes and requirements with AI. */
export async function processMeeting(req: Request, env: Env, id: string) {
  await requireUser(req, env, true);
  if(env.MEETING_TRANSCRIPTS_ENABLED!=="true")return bad("Meeting transcript processing is disabled.",409);
  const b = await readJson(req).catch(() => ({} as Record<string, any>));
  const db = new Db(env);
  const m = await db.one<any>("meetings", `id=eq.${id}&tenant_id=is.null&select=*`);
  if (!m || m.tenant_id !== null) return bad("Meeting not found.", 404);
  const posted = typeof b.transcript === "string" && b.transcript.trim().length > 200;
  // Notes already exist and nothing new was posted: return them instead of paying for the model again.
  if (!posted && m.notes) return json({ ok: true, analysis: storedAnalysis(m), minutes: m.minutes });
  let transcript = posted ? b.transcript : m.transcript;
  if (!transcript) {
    if (!m.meet_code) return bad("This meeting has no Google Meet code. Paste the transcript instead.");
    const t = await meetTranscript(env, m.meet_code);
    if (t.status !== "ready") return bad(t.status === "no_record" ? "Google has no record of this call yet. Try again 30 minutes after the call ends." : "The call has no transcript. Turn on transcription in Google Meet, or paste the transcript.");
    transcript = t.text;
  }
  const lead = m.lead_id ? await db.one<any>("leads", `id=eq.${m.lead_id}&tenant_id=is.null&select=name,company,website`) : null;
  const a = await paidAI(analyseMeeting(env, transcript!, { company: lead?.company ?? lead?.website, attendee: m.attendee_name }));
  const minutes = minutesMarkdown(a, `Call with ${m.attendee_name ?? m.attendee_email}`, new Date(m.start_at).toISOString().slice(0, 10));
  await saveMeetingDraft(db,m,{transcript,notes:{summary:a.summary,...a.notes},minutes,requirements:{...a.requirements,decisions:a.minutes.decisions,actions:a.minutes.actions}},"transcript_unverified");
  // A new analysis replaces the basis of any unsent draft, so draftProposal must write a fresh one.
  await db.update("proposals", `meeting_id=eq.${m.id}&kind=eq.pre&status=eq.draft`, { status: "superseded" });
  return json({ ok: true, analysis: a, minutes });
}

/** Draft the pre-proposal from the meeting analysis. Prices come from the published price list. */
export async function draftProposal(req: Request, env: Env, meetingId: string) {
  await requireUser(req, env, true);
  const b = await readJson(req).catch(() => ({} as Record<string, any>));
  const db = new Db(env);
  const m = await db.one<any>("meetings", `id=eq.${meetingId}&tenant_id=is.null&select=*`);
  if (!m?.requirements) return bad("Process the meeting first, so the proposal is based on the call.");
  const lead = m.lead_id ? await db.one<any>("leads", `id=eq.${m.lead_id}&tenant_id=is.null&select=*`) : null;
  const currency = b.currency === "INR" || (!b.currency && lead?.country === "IN") ? "INR" : "AED";
  const plan = ["sprint", "engine"].includes(b.plan) ? b.plan : m.requirements.recommended_plan;
  const pkg = ["revive", "signal", "response", "events"].includes(b.package) ? b.package : m.requirements.recommended_package;
  const { scope } = priceBlock(currency, plan, pkg, b.single_event === true);
  // A retry or double click reuses the open draft for the same choices instead of paying for the model again.
  const same = await db.one<any>("proposals", `meeting_id=eq.${m.id}&kind=eq.pre&status=eq.draft&plan=eq.${encodeURIComponent(plan)}&package=eq.${encodeURIComponent(pkg)}&currency=eq.${currency}&fixed_amount=eq.${scope.total}&select=*`);
  if (same) return json({ ok: true, proposal: same });
  const analysis: MeetingAnalysis = { ...storedAnalysis(m), requirements: { ...m.requirements, recommended_plan: plan, recommended_package: pkg } };
  const content = await paidAI(draftPreProposal(env, analysis, { company: lead?.company ?? lead?.website ?? "your company", contact: m.attendee_name ?? "", currency, singleEvent: b.single_event === true }));
  const [p] = await db.insert<any>("proposals", { lead_id: m.lead_id, meeting_id: m.id, kind: "pre", plan, package: pkg, currency, fixed_amount: scope.total, content_md: content, client_email: m.attendee_email, status: "draft" });
  return json({ ok: true, proposal: p });
}

/** Send the reviewed pre-proposal to the client. */
export async function sendProposal(req: Request, env: Env, id: string) {
  await requireUser(req, env, true);
  const db = new Db(env);
  const p = await db.one<any>("proposals", `id=eq.${id}&status=eq.draft&select=id,lead_id,access_token,client_email`);
  if (!p) return bad("Only draft proposals can be sent.");
  const lead = p.lead_id ? await db.one<any>("leads", `id=eq.${p.lead_id}&select=name`) : null;
  const link = `${env.SITE_URL}/p/${p.access_token}`, m = emails.preProposal(lead?.name ?? "there", link);
  const r = await claimAndSend(env, "proposals", id, { status: "sent", sent_at: new Date().toISOString() }, { status: "draft", sent_at: null }, p.client_email, m);
  if (r === "taken") return bad("Only draft proposals can be sent.");
  if (r === "unsent") return bad("The email was not sent. The proposal is still a draft; check the Gmail connection and try again.", 502);
  if (r === "uncertain") return bad(`Email delivery is uncertain, so the proposal is marked sent and will not be emailed again. Share the client link directly: ${link}`, 502);
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
  if (!(total > 0)) return bad("A quotation total must be greater than zero. Record free customisations without a quotation.");
  // A retried "create and send" reuses the identical open draft instead of creating a second payable quotation.
  const key = (xs: any[]) => JSON.stringify(xs.map(i => [i.description, Number(i.quantity), Number(i.unit_price)]));
  const same = (await db.select<any>("quotes", `proposal_id=eq.${p.id}&status=in.(draft,sent,accepted)&paid_at=is.null&select=*`)).find(o => key(o.items) === key(items));
  if (same && same.status !== "draft") return bad("An identical quotation was already sent and is awaiting payment.", 409);
  const [q] = same ? [same] : await db.insert<any>("quotes", { proposal_id: p.id, tenant_id: p.tenant_id, items, currency: p.currency, total, status: "draft" });
  return json({ ok: true, quote: q, total_label: money(total, p.currency) });
}

export async function sendQuote(req: Request, env: Env, id: string) {
  await requireUser(req, env, true);
  const db = new Db(env);
  const q = await db.one<any>("quotes", `id=eq.${id}&status=eq.draft&select=*`);
  if (!q) return bad("Only draft quotations can be sent.");
  const p = await db.one<any>("proposals", `id=eq.${q.proposal_id}&select=client_email`);
  const m = emails.quote("there", `${env.SITE_URL}/portal/#quotes`);
  const r = await claimAndSend(env, "quotes", id, { status: "sent" }, { status: "draft" }, p.client_email, m);
  if (r === "taken") return bad("Only draft quotations can be sent.");
  if (r === "unsent") return bad("The email was not sent. The quotation is still a draft; check the Gmail connection and send it again.", 502);
  await db.insert("activity_log", { tenant_id: q.tenant_id, actor: "Ripe Piper", kind: "change", message: `Quotation for customisations sent: ${money(Number(q.total), q.currency)}.` });
  if (r === "uncertain") return bad("Email delivery is uncertain. The quotation is live on the client's dashboard and will not be emailed again; tell the client directly.", 502);
  return json({ ok: true });
}

/** Invite a person to a client's dashboard, or change the role of someone who already accepted. They sign in with Google or an email link using this address. */
export async function inviteUser(req: Request, env: Env, tenantId: string) {
  const staff = await requireUser(req, env, true);
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
  if (previous?.accepted_at) return changeRole(db, tenantId, email, role, staff.id);
  await db.upsert("invites", { tenant_id: tenantId, email, role }, "tenant_id,email");
  return json({ ok: true });
}

async function changeRole(db: Db, tenantId: string, email: string, role: string, actor: string) {
  try {
    const r = await db.rpc<{ role: string; previous_role: string }>("set_member_role", { p_tenant: tenantId, p_email: email, p_role: role, p_actor: actor });
    return json({ ok: true, changed: r.previous_role !== r.role, role: r.role });
  } catch (e) {
    if (e instanceof DbError && e.body.includes("Last owner")) return bad("This is the client's only owner. Make another member an owner first.", 409);
    if (e instanceof DbError && e.body.includes("Member not found")) return bad("This person accepted an invitation but has no access to this client now.", 409);
    throw e;
  }
}

export async function runAdsSync(req: Request, env: Env) {
  await requireUser(req, env, true);
  if(env.ADS_SYNC_ENABLED!=="true")return bad("Ads sync is disabled.",409);
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
  const changed = await db.update("meetings", `id=eq.${id}&tenant_id=is.null&status=eq.booked&google_event_id=eq.${encodeURIComponent(m.google_event_id)}&start_at=eq.${encodeURIComponent(m.start_at)}&end_at=eq.${encodeURIComponent(m.end_at)}&attendee_email=eq.${encodeURIComponent(m.attendee_email)}&lead_id=${m.lead_id ? "eq." + encodeURIComponent(m.lead_id) : "is.null"}`, {
    meet_url: ev.meetUrl, meet_code: ev.meetCode,
  });
  if (!changed.length) return bad("The reservation changed. Reload before continuing.", 409);
  await db.insert("activity_log", { actor: user.id, kind: "note", visible_to_client: false,
    message: `Calendar event verified for consultation ${m.id}; reservation updated without sending an invitation.` });
  if (m.lead_id) await db.update("leads", `id=eq.${m.lead_id}&tenant_id=is.null&status=eq.qualified`, { status: "meeting_booked" });
  return json({ ok: true, meeting_id: m.id, meet_url: ev.meetUrl, delivery: "not_sent" });
}

/** Cancel a booked consultation: delete the calendar event, free the slot and let the prospect rebook through the public flow. */
export async function cancelBooking(req: Request, env: Env, id: string) {
  const user = await requireUser(req, env, true);
  const db = new Db(env);
  const m = await db.one<any>("meetings", `id=eq.${id}&tenant_id=is.null&status=eq.booked&select=*`);
  if (!m) return bad("No booked consultation was found.", 404);
  // 404/410: the event is already gone. Any other failure changes nothing, so the calendar and the booking never disagree.
  if (m.google_event_id) try { await cancelEvent(env, m.google_event_id); }
  catch (e) { if (!(e instanceof GoogleError && (e.status === 404 || e.status === 410))) return bad("The calendar event could not be cancelled. The booking is unchanged; try again.", 409); }
  // The guard trigger moves any in-flight reminder to review when the status changes.
  const changed = await db.update("meetings", `id=eq.${id}&tenant_id=is.null&status=eq.booked`, { status: "cancelled" });
  if (!changed.length) return bad("The booking changed. Reload before continuing.", 409);
  if (m.lead_id && !(await db.select("meetings", `lead_id=eq.${m.lead_id}&tenant_id=is.null&status=in.(booked,rescheduled,held)&id=neq.${id}&select=id&limit=1`)).length)
    await db.update("leads", `id=eq.${m.lead_id}&tenant_id=is.null&status=eq.meeting_booked`, { status: "qualified" });
  await db.insert("activity_log", { actor: user.id, kind: "note", visible_to_client: false, message: `Consultation ${m.id} cancelled by staff; calendar event removed and the prospect can rebook.` });
  return json({ ok: true, meeting_id: m.id, status: "cancelled" });
}
