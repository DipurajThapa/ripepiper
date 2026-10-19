import type { Env } from "./env";
import { Db } from "./lib/db";
import { sendEmail, meetTranscript } from "./lib/google";
import { emails } from "./lib/email";
import { dueReminder } from "./lib/slots";
import { syncSheet } from "./lib/sheets";
import { analyseMeeting, minutesMarkdown } from "./lib/ai";
import { googleAdsRows, metaRows, linkedinRows, toTenantCurrency, type AdRow } from "./lib/ads";

/** Every 5 minutes: send due reminders (24 hours and 1 hour before each call). */
export async function sendReminders(env: Env, now = new Date()) {
  const db = new Db(env);
  const horizon = new Date(now.getTime() + 24 * 3600_000 + 10 * 60_000).toISOString();
  const upcoming = await db.select<any>("meetings", `status=eq.booked&start_at=gte.${now.toISOString()}&start_at=lte.${horizon}&select=*`);
  let sent = 0;
  for (const m of upcoming) {
    const which = dueReminder(new Date(m.start_at), now, !!m.reminder_24h_at, !!m.reminder_1h_at);
    if (!which) continue;
    const col = which === "24h" ? "reminder_24h_at" : "reminder_1h_at";
    // Claim the reminder first, so two overlapping runs can never send it twice.
    const claimed = await db.update("meetings", `id=eq.${m.id}&${col}=is.null`, { [col]: now.toISOString() });
    if (!claimed.length) continue;
    const e = emails.reminder(m.attendee_name ?? "there", m.start_at, m.meet_url ?? "", which);
    await sendEmail(env, m.attendee_email, e.subject, e.text);
    if (env.WHATSAPP_ENABLED === "true") await whatsappReminder(env, db, m, which).catch(() => {});
    sent++;
  }
  return { sent };
}

/** WhatsApp reminder only for people who contacted us on WhatsApp first, using an approved utility template. */
async function whatsappReminder(env: Env, db: Db, m: any, which: "24h" | "1h") {
  const lead = m.lead_id ? await db.one<any>("leads", `id=eq.${m.lead_id}&source=eq.whatsapp&select=landing_page`) : null;
  const phone = lead?.landing_page?.startsWith("wa:") ? lead.landing_page.slice(3) : null;
  if (!phone) return;
  await fetch(`https://graph.facebook.com/v23.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "template",
      template: { name: which === "24h" ? "meeting_reminder_24h" : "meeting_reminder_1h", language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: m.meet_url ?? "" }] }] } }),
  });
}

/** After a call: fetch the transcript, write notes and minutes with AI, or mark the call as a no-show. */
export async function processFinishedMeetings(env: Env, now = new Date()) {
  const db = new Db(env);
  const ended = new Date(now.getTime() - 20 * 60_000).toISOString();
  const giveUp = now.getTime() - 3 * 3600_000;
  const list = await db.select<any>("meetings", `status=eq.booked&end_at=lte.${ended}&meet_code=not.is.null&ai_processed_at=is.null&select=*&limit=5`);
  const out = { processed: 0, no_show: 0, waiting: 0 };
  for (const m of list) {
    try {
      const t = await meetTranscript(env, m.meet_code);
      if (t.status === "ready" && t.text && t.text.length > 200) {
        const lead = m.lead_id ? await db.one<any>("leads", `id=eq.${m.lead_id}&select=company,website`) : null;
        const a = await analyseMeeting(env, t.text, { company: lead?.company ?? lead?.website, attendee: m.attendee_name });
        await db.update("meetings", `id=eq.${m.id}`, { transcript: t.text, notes: { summary: a.summary, ...a.notes },
          minutes: minutesMarkdown(a, `Call with ${m.attendee_name ?? m.attendee_email}`, m.start_at.slice(0, 10)),
          requirements: { ...a.requirements, decisions: a.minutes.decisions, actions: a.minutes.actions }, ai_processed_at: now.toISOString(), status: "held" });
        if (m.lead_id) await db.update("leads", `id=eq.${m.lead_id}`, { status: "meeting_held" });
        const e = emails.adminAlert("Call notes ready", `Notes and minutes are ready for your call with ${m.attendee_name ?? m.attendee_email}. Review them and draft the pre-proposal in the admin area.`);
        await sendEmail(env, env.ADMIN_ALERT_EMAIL, e.subject, e.text);
        out.processed++;
      } else if (new Date(m.end_at).getTime() < giveUp) {
        const status = t.status === "no_record" || (t.participants ?? 0) < 2 ? "no_show" : "held";
        await db.update("meetings", `id=eq.${m.id}`, { status, ai_processed_at: now.toISOString() });
        if (status === "held") {
          const e = emails.adminAlert("Call held without a transcript", `Your call with ${m.attendee_email} has no transcript. Paste your notes in the admin area to create the minutes.`);
          await sendEmail(env, env.ADMIN_ALERT_EMAIL, e.subject, e.text);
        } else out.no_show++;
      } else out.waiting++;
    } catch (e) {
      out.waiting++;
      console.error("meeting processing failed", m.id, String(e));
    }
  }
  return out;
}

/** Nightly: pull ad spend and results for every connected ad account, converted to the client's currency. */
export async function syncAds(env: Env, days = 3) {
  const db = new Db(env);
  const accounts = await db.select<any>("ad_accounts", "status=neq.disconnected&select=*,tenants(currency)");
  const rates = Object.fromEntries((await db.select<any>("fx_rates", "select=currency,aed_per_unit")).map(r => [r.currency, Number(r.aed_per_unit)]));
  const to = new Date(), from = new Date(to.getTime() - days * 86400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const result = { accounts: accounts.length, rows: 0, errors: 0 };
  for (const acc of accounts) {
    try {
      let rows: AdRow[] = [];
      if (acc.platform === "google_ads") rows = await googleAdsRows(env, acc.account_ref, d(from), d(to));
      if (acc.platform === "meta") rows = await metaRows(env, acc.account_ref, d(from), d(to));
      if (acc.platform === "linkedin") {
        rows = await linkedinRows(env, acc.account_ref, d(from), d(to));
        const cur = await linkedinCurrency(env, acc.account_ref);
        rows = rows.map(r => ({ ...r, currency: r.currency || cur }));
      }
      const tenantCur = acc.tenants?.currency ?? "AED";
      const payload = rows.map(r => ({ tenant_id: acc.tenant_id, platform: acc.platform, day: r.day, campaign_ref: r.campaign_ref, campaign_name: r.campaign_name,
        spend: toTenantCurrency(r.spend, r.currency, tenantCur, rates), currency: tenantCur, impressions: r.impressions, clicks: r.clicks, conversions: r.conversions }));
      for (let i = 0; i < payload.length; i += 500) await db.upsert("ad_metrics_daily", payload.slice(i, i + 500), "tenant_id,platform,day,campaign_ref");
      await db.update("ad_accounts", `id=eq.${acc.id}`, { status: "connected", last_synced_at: new Date().toISOString(), last_error: null });
      result.rows += payload.length;
    } catch (e) {
      result.errors++;
      await db.update("ad_accounts", `id=eq.${acc.id}`, { status: "error", last_error: String(e).slice(0, 500) });
    }
  }
  return result;
}

async function linkedinCurrency(env: Env, accountId: string): Promise<string> {
  const res = await fetch(`https://api.linkedin.com/rest/adAccounts/${accountId}`, {
    headers: { Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`, "LinkedIn-Version": "202610", "X-Restli-Protocol-Version": "2.0.0" },
  });
  const j = (await res.json()) as any;
  return j.currency ?? "USD";
}

export async function runScheduled(cron: string, env: Env) {
  if (cron === "0 22 * * *") return { ads: await syncAds(env) };      // 02:00 Gulf Standard Time
  const [reminders, meetings, sheet] = await Promise.all([sendReminders(env), processFinishedMeetings(env), syncSheet(env)]);
  return { reminders, meetings, sheet };
}
