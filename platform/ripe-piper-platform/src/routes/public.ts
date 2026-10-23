import type { Env } from "../env";
import { Db, DbError } from "../lib/db";
import { cleanEmail, cleanText, cleanWebsite, routeLead, scoreLead, isFreeEmail, pickUtm } from "../lib/validate";
import { freeSlots, isOfferedSlot, BOOKING } from "../lib/slots";
import { busyTimes, calendarEventId, createMeetEvent, sendEmail } from "../lib/google";
import { emails } from "../lib/email";
import { BOOKING_TOKEN_TTL_MS, newBookingToken, hashBookingToken, validBookingToken } from "../lib/booking";
import { json, bad, readJson, verifyTurnstile } from "./http";

const COUNTRY: Record<string, string> = { "United Arab Emirates": "AE", India: "IN", "Saudi Arabia": "SA", Qatar: "QA", Other: "OTHER" };

async function upsertLead(db: Db, row: Record<string, unknown>) {
  try {
    return (await db.insert("leads", row))[0];
  } catch (e) {
    if (!(e instanceof DbError && e.isConflict)) throw e;
    // Same person submitted again: keep the original record and refresh the answers.
    const { source, ...patch } = row;
    const query = `tenant_id=is.null&email=eq.${encodeURIComponent(String(row.email))}`;
    const updated = await db.update("leads", `${query}&status=neq.meeting_booked&status=neq.meeting_held&status=neq.proposal&status=neq.won`, patch);
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

export async function getSlots(_req: Request, env: Env) {
  const db = new Db(env), now = new Date();
  return json({ ok: true, slots: freeSlots(now, await busyWithMeetings(env, db, now)) });
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
  // Atomic conditional claim in PostgREST prevents replay or concurrent reservations for a lead.
  const claimed = await db.update("leads", `id=eq.${lead.id}&tenant_id=is.null&status=eq.qualified&booking_token_hash=eq.${hash}&booking_token_used_at=is.null&booking_token_expires_at=gt.${now.toISOString()}`, { booking_token_used_at: now.toISOString() });
  if (!claimed.length) return bad("This booking link has expired or has already been used. Please complete the form again.", 403);
  let meeting: any;
  try {
    const meetingId = crypto.randomUUID();
    meeting = (await db.insert("meetings", { id: meetingId, google_event_id: calendarEventId(meetingId), lead_id: lead.id, kind: "discovery", start_at: slot.start, end_at: slot.end, attendee_email: lead.email, attendee_name: lead.name }))[0];
  } catch (e) {
    if (e instanceof DbError && e.isConflict) return bad("That time was just booked or a consultation already exists. Please complete the form again to choose another time.", 409);
    throw e;
  }
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
  const db = new Db(env);
  await upsertLead(db, { source: "calculator", name, email, company, consent_at: new Date().toISOString(), ...pickUtm(b) });
  const m = emails.calculatorBreakdown(name);
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
  const [sub] = await db.upsert<any>("newsletter_subscribers", { email, status: "pending", consent_at: new Date().toISOString() }, "email");
  const m = emails.newsletterConfirm(`${env.SITE_URL}/api/newsletter/confirm?token=${sub.confirm_token}`);
  ctx.waitUntil(sendEmail(env, email, m.subject, m.text).catch(() => {}));
  return json({ ok: true });
}

export async function getNewsletterConfirm(req: Request, env: Env) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(token)) return Response.redirect(`${env.SITE_URL}/`, 302);
  await new Db(env).update("newsletter_subscribers", `confirm_token=eq.${token}&status=eq.pending`, { status: "confirmed", confirmed_at: new Date().toISOString() });
  return Response.redirect(`${env.SITE_URL}/#subscribed`, 302);
}

export async function postOptOut(req: Request, env: Env) {
  const b = await readJson(req);
  const email = cleanEmail(b.email);
  if (!email) return bad("Please enter a valid email address.");
  if (!(await verifyTurnstile(env, b.turnstile_token, req))) return bad("Please confirm you are not a robot and try again.");
  const db = new Db(env);
  await db.upsert("suppression", { email, reason: cleanText(b.reason, 120) || "opt-out page" }, "email");
  await db.update("newsletter_subscribers", `email=eq.${encodeURIComponent(email)}`, { status: "unsubscribed", unsubscribed_at: new Date().toISOString() });
  await db.update("leads", `email=eq.${encodeURIComponent(email)}`, { status: "unsubscribed" });
  return json({ ok: true });
}
