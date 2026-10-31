import type { Env } from "../env";
import { Db, DbError } from "../lib/db";
import { cleanEmail, cleanText, cleanWebsite, routeLead, scoreLead, isFreeEmail, pickUtm } from "../lib/validate";
import { freeSlots, isOfferedSlot, BOOKING } from "../lib/slots";
import { busyTimes, calendarEventId, createMeetEvent, sendEmail } from "../lib/google";
import { emails } from "../lib/email";
import { BOOKING_TOKEN_TTL_MS, newBookingToken, hashBookingToken, validBookingToken } from "../lib/booking";
import { json, bad, readJson, verifyTurnstile } from "./http";

// Same assumptions as the public calculator (site/assets/site.js calc()).
const CALC_MEETING_RATES = [0.02, 0.06] as const, CALC_MAX_LEADS = 1_000_000, CALC_MAX_DEAL = 1e12;
const COUNTRY: Record<string, string> = { "United Arab Emirates": "AE", India: "IN", "Saudi Arabia": "SA", Qatar: "QA", Other: "OTHER" };

async function upsertLead(db: Db, row: Record<string, unknown>) {
  try {
    return (await db.insert("leads", row))[0];
  } catch (e) {
    if (!(e instanceof DbError && e.isConflict)) throw e;
    // Same person submitted again: keep the original record and refresh the answers.
    const { source, ...patch } = row;
    const query = `tenant_id=is.null&email=eq.${encodeURIComponent(String(row.email))}`;
    const updated = await db.update("leads", `${query}&status=neq.meeting_booked&status=neq.meeting_held&status=neq.proposal&status=neq.won&status=neq.unsubscribed`, patch);
    return updated[0] ?? await db.one("leads", `${query}&select=*`);
  }
}

async function busyWithMeetings(env: Env, db: Db, now: Date) {
  const to = new Date(now.getTime() + (BOOKING.horizonDays + 1) * 86400_000);
  const [g, booked] = await Promise.all([
    busyTimes(env, now, to),
    db.select<any>("meetings", `tenant_id=is.null&status=in.(booked,rescheduled)&start_at=gte.${now.toISOString()}&select=start_at,end_at`),
  ]);
  return [...g, ...booked.map(b => ({ start: new Date(b.start_at), end: new Date(b.end_at) }))];
}

/** Step 1 of booking: save the lead and decide the route (calendar, ask for work email, or not a fit yet). */
export async function postLead(req: Request, env: Env, ctx: ExecutionContext) {
  const b = await readJson(req);
  if (b.website_url_confirm) return json({ ok: true, route: "not_fit" });               // honeypot: bots fill hidden fields
  if (!(await verifyTurnstile(env, b.turnstile_token, req))) return bad("Please confirm you are not a robot and try again.");
  const email = cleanEmail(b.email), name = cleanText(b.name, 120), website = cleanWebsite(b.website);
  const dealBand = Number(b.deal_band);
  if (!email || !name || !website) return bad("Please enter your name, work email and company website.");
  if (![0, 1, 2, 3].includes(dealBand)) return bad("Please choose the average value of one deal.");
  if (b.consent !== true) return bad("Please tick the box to agree that we may contact you about this request.");
  const pkg = ["revive", "signal", "response", "events", "unsure"].includes(String(b.package)) ? String(b.package) : "unsure";
  const country = cleanText(b.country, 40);
  const route = routeLead(email, dealBand);
  const bookingToken = route === "calendar" ? newBookingToken() : null;
  const db = new Db(env);
  const lead = await upsertLead(db, {
    source: "book_form", name, email, website, company: website, country: COUNTRY[country] ?? "OTHER", package_interest: pkg,
    deal_band: dealBand, score: scoreLead({ dealBand, pkg, freeEmail: isFreeEmail(email), country }),
    status: route === "not_fit" ? "not_fit" : route === "calendar" ? "qualified" : "new",
    booking_token_hash: bookingToken ? await hashBookingToken(bookingToken) : null,
    booking_token_expires_at: bookingToken ? new Date(Date.now() + BOOKING_TOKEN_TTL_MS).toISOString() : null,
    booking_token_used_at: null,
    consent_at: new Date().toISOString(), ...pickUtm(b),
  });
  if (lead.status === "unsubscribed") return json({ ok: true, route: "not_fit" });
  if (["meeting_booked", "meeting_held", "proposal", "won"].includes(lead.status))
    return json({ ok: true, route: "already_booked" });
  // Speed to lead: the founder hears about every inquiry within a minute.
  const alert = emails.adminAlert("New inquiry", `${name} <${email}>\n${website}\nPackage: ${pkg}\nDeal band: ${dealBand}\nRoute: ${route}`);
  ctx.waitUntil(sendEmail(env, env.ADMIN_ALERT_EMAIL, alert.subject, alert.text).catch(() => {}));
  if (route !== "calendar") return json({ ok: true, route, lead_id: lead.id });
  const now = new Date();
  const slots = freeSlots(now, await busyWithMeetings(env, db, now)).slice(0, 18);
  return json({ ok: true, route, lead_id: lead.id, booking_token: bookingToken, slots });
}

/** Step 2 of booking: reserve the slot, create the Google Meet event, confirm by email. */
export async function postBook(req: Request, env: Env) {
  const b = await readJson(req);
  if (!validBookingToken(b.booking_token) || !/^[0-9a-f-]{36}$/i.test(String(b.lead_id))) return bad("Please complete the booking form again.", 403);
  const db = new Db(env);
  const lead = await db.one<any>("leads", `id=eq.${encodeURIComponent(String(b.lead_id))}&tenant_id=is.null&select=*`);
  if (!lead || !["qualified", "meeting_booked"].includes(lead.status)) return bad("Please complete the booking form again.", 403);
  const now = new Date();
  const hash = await hashBookingToken(b.booking_token);
  if (lead.booking_token_hash !== hash ||
      !lead.booking_token_expires_at || Date.parse(lead.booking_token_expires_at) <= now.getTime())
    return bad("This booking link has expired or has already been used. Please complete the form again.", 403);
  // A retry may read its own confirmed reservation, never create another event or email.
  // Keep the original capability expiry and require the same requested slot and attendee.
  if (lead.booking_token_used_at) {
    const requested = Date.parse(String(b.start));
    if (!Number.isFinite(requested)) return bad("Invalid booking time.", 400);
    const existing = await db.one<any>("meetings",
      `tenant_id=is.null&lead_id=eq.${lead.id}&kind=eq.discovery&status=in.(booked,rescheduled)&start_at=eq.${encodeURIComponent(new Date(requested).toISOString())}&attendee_email=eq.${encodeURIComponent(lead.email)}&select=*`);
    if (!existing) return bad("This booking link has already been used. Please contact Ripe Piper.", 403);
    if (!existing.google_event_id || !/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(existing.meet_url ?? ""))
      return bad("Your requested time remains reserved for review. Please contact Ripe Piper before trying again.", 503);
    return json({ ok: true, meeting_id: existing.id, start: existing.start_at,
      label: freeSlots(now, []).find(s => Date.parse(s.start) === requested)?.label ?? existing.start_at,
      meet_url: existing.meet_url });
  }
  if (lead.status !== "qualified") return bad("Please complete the booking form again.", 403);
  const slot = isOfferedSlot(String(b.start), now, await busyWithMeetings(env, db, now));
  if (!slot) return bad("That time is no longer available. Please choose another time.", 409);
  const meetingId = crypto.randomUUID();
  let reserved: unknown;
  try {
    reserved = await db.rpc("reserve_consultation", { p_lead: lead.id, p_hash: hash, p_meeting: meetingId,
      p_event: calendarEventId(meetingId), p_start: slot.start, p_end: slot.end, p_email: lead.email, p_name: lead.name ?? null });
  } catch (e) {
    if (e instanceof DbError && e.isConflict) return bad("That time was just booked or a consultation already exists. Please choose another time.", 409);
    return bad("Your reservation could not be verified. Please contact Ripe Piper for review before trying again.", 503);
  }
  if (reserved === false) return bad("This booking link has expired or has already been used. Please complete the form again.", 403);
  if (reserved !== true) return bad("Your reservation could not be verified. Please contact Ripe Piper for review before trying again.", 503);
  const meeting = { id: meetingId };
  try {
    const ev = await createMeetEvent(env, {
      id: meeting.id, start: slot.start, end: slot.end, email: lead.email, name: lead.name ?? lead.email,
      summary: `Ripe Piper call with ${lead.name ?? lead.email}`,
      description: `15-minute discovery call.\nCompany website: ${lead.website ?? ""}\nPackage of interest: ${lead.package_interest ?? ""}`,
    });
    const saved = await db.update("meetings", `id=eq.${meeting.id}&tenant_id=is.null&status=eq.booked&google_event_id=eq.${ev.eventId}`, { meet_url: ev.meetUrl, meet_code: ev.meetCode });
    if (!saved.length) throw new Error("Reservation changed during confirmation");
    await db.update("leads", `id=eq.${lead.id}&tenant_id=is.null&status=eq.qualified`, { status: "meeting_booked" });
    const m = emails.bookingConfirmed(lead.name ?? "there", slot.start, ev.meetUrl ?? "");
    try { await sendEmail(env, lead.email, m.subject, m.text); }
    catch (mailError) { console.error("Booking confirmed but email delivery failed", meeting.id); }
    return json({ ok: true, meeting_id: meeting.id, start: slot.start, label: slot.label, meet_url: ev.meetUrl });
  } catch (e) {
    // A timeout or database failure does not prove Google failed to create the event.
    // Preserve the reservation and stable event ID for staff reconciliation; never blindly resend.
    console.error("Booking requires calendar reconciliation", meeting.id);
    return bad("Your booking could not be confirmed. The requested time remains reserved for review. Please contact Ripe Piper before trying again.", 503);
  }
}

export async function postCalculator(req: Request, env: Env, ctx: ExecutionContext) {
  const b = await readJson(req);
  if (!(await verifyTurnstile(env, b.turnstile_token, req))) return bad("Please confirm you are not a robot and try again.");
  const email = cleanEmail(b.email), name = cleanText(b.name, 120), company = cleanText(b.company, 160);
  if (!email || !name || !company) return bad("Please enter your name, work email and company name.");
  if (b.consent !== true) return bad("Please tick the box so we can email you the breakdown.");
  const leads = Number(b.leads), deal = Number(b.deal), close = Number(b.close), currency = String(b.currency);
  const inRange = (v: number, max: number) => Number.isFinite(v) && v >= 0 && v <= max;
  if (!inRange(leads, CALC_MAX_LEADS) || !inRange(deal, CALC_MAX_DEAL) || !inRange(close, 100) || !["AED", "INR"].includes(currency))
    return bad("Please check the calculator numbers and try again.");
  const db = new Db(env), q = `email=eq.${encodeURIComponent(email)}&select=email`;
  // Verified opt-outs get the same response and no mail, so the endpoint does not reveal suppression state.
  if ((await Promise.all([db.one("agency_suppression", q), db.one("suppression", q)])).some(Boolean)) return json({ ok: true });
  const lead = await upsertLead(db, { source: "calculator", name, email, company, consent_at: new Date().toISOString(), ...pickUtm(b) });
  if (lead.status === "unsubscribed") return json({ ok: true });
  const meetings: [number, number] = [leads * CALC_MEETING_RATES[0], leads * CALC_MEETING_RATES[1]];
  const deals: [number, number] = [meetings[0] * close / 100, meetings[1] * close / 100];
  const m = emails.calculatorBreakdown({ leads, deal, close, currency, meetings, deals, revenue: [deals[0] * deal, deals[1] * deal] });
  const alert = emails.adminAlert("Calculator breakdown requested", `${name} <${email}>\n${company}\n\n${m.summary}\n\nBreakdown due within one business day.`);
  ctx.waitUntil(sendEmail(env, env.ADMIN_ALERT_EMAIL, alert.subject, alert.text).catch(() => {}));
  ctx.waitUntil(sendEmail(env, email, m.subject, m.text).catch(() => {}));
  return json({ ok: true });
}

export async function postNewsletter(req: Request, env: Env, ctx: ExecutionContext) {
  const b = await readJson(req);
  const email = cleanEmail(b.email);
  if (!email) return bad("Please enter a valid email address.");
  if (!(await verifyTurnstile(env, b.turnstile_token, req))) return bad("Please confirm you are not a robot and try again.");
  if (b.consent !== true) return bad("Please tick the box to agree to receive the newsletter.");
  const db = new Db(env);
  const token = await db.rpc<unknown>("request_agency_newsletter", { p_email: email });
  if (typeof token === "string" && /^[0-9a-f-]{36}$/i.test(token)) {
    const m = emails.newsletterConfirm(`${env.SITE_URL}/api/newsletter/confirm?token=${token}`);
    ctx.waitUntil(sendEmail(env, email, m.subject, m.text).catch(() => {}));
  }
  return json({ ok: true });
}

function newsletterConfirmationPage(message: string, token?: string, status = 200) {
  const form = token ? `<form method="post" action="/api/newsletter/confirm"><input type="hidden" name="token" value="${token}"><button type="submit">Confirm subscription</button></form>` : "";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Newsletter confirmation | Ripe Piper</title></head><body><main><h1>Newsletter confirmation</h1><p>${message}</p>${form}</main></body></html>`, {
    status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff" },
  });
}

export async function getNewsletterConfirm(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return newsletterConfirmationPage("This confirmation link is invalid. Please request a new one.", undefined, 400);
  // Opening a link, including by an email scanner, never changes subscription state.
  return newsletterConfirmationPage("Confirm that you want to receive the Ripe Piper newsletter.", token);
}

export async function postNewsletterConfirm(req: Request, env: Env) {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return newsletterConfirmationPage("This confirmation request is invalid.", undefined, 400);
  if (Number(req.headers.get("content-length") ?? 0) > 1024) return newsletterConfirmationPage("This confirmation request is invalid.", undefined, 400);
  const body = await req.text();
  if (body.length > 1024) return newsletterConfirmationPage("This confirmation request is invalid.", undefined, 400);
  const params = new URLSearchParams(body), token = params.get("token") ?? "";
  if (params.getAll("token").length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return newsletterConfirmationPage("This confirmation link is invalid. Please request a new one.", undefined, 400);
  const confirmed = await new Db(env).rpc<unknown>("confirm_agency_newsletter", { p_token: token });
  if (confirmed !== true) return newsletterConfirmationPage("This subscription could not be confirmed. Please contact hello@ripepiper.com.", undefined, 400);
  return newsletterConfirmationPage("Your newsletter subscription is confirmed.");
}

export async function postOptOut(req: Request, env: Env) {
  const b = await readJson(req);
  const email = cleanEmail(b.email);
  if (!email) return bad("Please enter a valid email address.");
  if (!(await verifyTurnstile(env, b.turnstile_token, req))) return bad("Please confirm you are not a robot and try again.");
  const token = newBookingToken();
  const issued = await new Db(env).rpc<unknown>("issue_agency_opt_out", { p_hash: await hashBookingToken(token), p_email: email });
  if (issued !== true) return bad("Please wait a minute before requesting another confirmation email.", 429);
  const link = `${env.SITE_URL}/opt-out.html#confirm=${token}`;
  try {
    await sendEmail(env, email, "Confirm your Ripe Piper opt-out", `To stop Ripe Piper's own marketing emails, open this link and confirm within 24 hours: ${link}\n\nFor client campaign requests or help, reply to the original message or email hello@ripepiper.com.`);
  } catch {
    return bad("We could not verify delivery of the confirmation email. Please try again or contact hello@ripepiper.com.", 503);
  }
  return json({ ok: true });
}

export async function postOptOutConfirm(req: Request, env: Env) {
  const b = await readJson(req);
  if (!validBookingToken(b.token)) return bad("This confirmation link is invalid or expired.", 400);
  const result = await new Db(env).rpc<unknown>("confirm_agency_opt_out", { p_hash: await hashBookingToken(b.token) });
  if (result !== true) return bad("This confirmation link is invalid or expired. Please request a new one.", 400);
  return json({ ok: true });
}
