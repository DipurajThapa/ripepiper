import type { Env } from "./env";
import { Db } from "./lib/db";
import { sendEmail, meetTranscript, isMeetUrl } from "./lib/google";
import { emails } from "./lib/email";
import { validInstant } from "./foundation/prospecting";
import { meetingSnapshot, saveMeetingDraft } from "./foundation/consultation-review";
import { dueReminder } from "./lib/slots";
import { syncSheet } from "./lib/sheets";
import { analyseMeeting, minutesMarkdown } from "./lib/ai";
import { googleAdsRows, metaRows, linkedinRows, toTenantCurrency, adsHttpError, redactedAdsError, type AdRow } from "./lib/ads";
import { runReviveAutomation } from "./foundation/revive-automation";

/** Default-off consultation reminders. A claim is not delivery; uncertain attempts never retry automatically. */
export async function sendReminders(env: Env, now = new Date()) {
  if(env.CONSULTATION_REMINDERS_ENABLED!=="true")return {sent:0,review:0,disabled:true};
  const db=new Db(env,15000),horizon=new Date(now.getTime()+24*3600_000+10*60_000).toISOString();
  const upcoming=await db.select<any>("meetings",`tenant_id=is.null&status=eq.booked&start_at=gte.${now.toISOString()}&start_at=lte.${horizon}&select=*&order=start_at.asc&limit=51`);
  if(upcoming.length>50)return {sent:0,review:0,blocked:"review_capacity"};
  let sent=0,review=0;
  for(const m of upcoming){
    if(m.tenant_id!=null||!m.google_event_id||!isMeetUrl(m.meet_url))continue;
    const which=dueReminder(new Date(m.start_at),now,!!m.reminder_24h_at,!!m.reminder_1h_at);if(!which)continue;
    const token=crypto.randomUUID(),args={p_meeting:m.id,p_window:which,p_token:token};
    try{
      const claimed=await db.rpc<any>("claim_consultation_reminder",args);if(claimed===null)continue;
      if(!validReminderReceipt(claimed,m,which,token,"claimed"))throw Error("Claim acknowledgement uncertain");
      // This fenced authorization rereads the current booking immediately before the provider call.
      const authorized=await db.rpc<any>("authorize_consultation_reminder",args);if(authorized===null){review++;continue;}
      if(!validReminderReceipt(authorized,m,which,token,"dispatching"))throw Error("Authorization acknowledgement uncertain");
      const email=emails.reminder(m.attendee_name??"there",m.start_at,m.meet_url,which);
      const ack=await sendEmail(env,m.attendee_email,email.subject,email.text,undefined,async()=>{
        // OAuth refresh may take time; fence the actual Gmail mutation after it completes.
        if(await db.rpc("confirm_consultation_dispatch",args)!==true)throw Error("Booking changed before provider dispatch");
      });
      const finished=await db.rpc<any>("finish_consultation_reminder",{...args,p_message:ack.messageId});
      if(!validReminderReceipt(finished,m,which,token,"acknowledged")||finished.messageId!==ack.messageId||!validInstant(finished.acknowledgedAt))throw Error("Delivery acknowledgement uncertain");
      sent++;
    }catch{
      review++;
      // Failure may follow a committed claim or send. Keep the original fence and never send again.
      await db.rpc("hold_consultation_reminder",args).catch(()=>{});
    }
  }
  return {sent,review};
}
function validReminderReceipt(receipt:any,m:any,window:string,token:string,state:string){
 return !!receipt&&receipt.meetingId===m.id&&receipt.window===window&&receipt.token===token&&receipt.state===state&&validInstant(receipt.leaseUntil)&&(state==="acknowledged"||Date.parse(receipt.leaseUntil)>Date.now())&&sameSnapshot(receipt.snapshot,meetingSnapshot(m));
}

function sameSnapshot(actual:any,expected:Record<string,unknown>){return !!actual&&typeof actual==="object"&&!Array.isArray(actual)&&Object.keys(actual).length===Object.keys(expected).length&&Object.keys(expected).every(key=>actual[key]===expected[key]);}

/** Draft notes never establish prospect identity, attendance or a lead conversion. */
export async function processFinishedMeetings(env: Env, now = new Date()) {
  if(env.MEETING_TRANSCRIPTS_ENABLED!=="true")return {processed:0,no_show:0,waiting:0,review:0,disabled:true};
  const db=new Db(env,15000),ended=new Date(now.getTime()-20*60_000).toISOString(),giveUp=now.getTime()-3*3600_000;
  const list=await db.select<any>("meetings",`tenant_id=is.null&status=eq.booked&end_at=lte.${ended}&ai_processed_at=is.null&select=*&order=end_at.asc&limit=5`);
  const out={processed:0,no_show:0,waiting:0,review:0};
  for(const m of list){
    let transcript:string|undefined;
    try{
      const t=m.meet_code?await meetTranscript(env,m.meet_code):{status:"no_record" as const};transcript=t.text;
      if(t.status==="ready"&&typeof transcript==="string"&&transcript.length>200){
        const lead=m.lead_id?await db.one<any>("leads",`id=eq.${m.lead_id}&tenant_id=is.null&select=company,website`):null;
        const a=await analyseMeeting(env,transcript,{company:lead?.company??lead?.website,attendee:m.attendee_name});
        await saveMeetingDraft(db,m,{transcript,notes:{summary:a.summary,...a.notes},minutes:minutesMarkdown(a,`Call with ${m.attendee_name??m.attendee_email}`,m.start_at.slice(0,10)),requirements:{...a.requirements,decisions:a.minutes.decisions,actions:a.minutes.actions}},"transcript_unverified");out.processed++;out.review++;
      }else if(new Date(m.end_at).getTime()<giveUp||!m.meet_code){
        await saveMeetingDraft(db,m,{transcript},"attendance_source_unavailable");out.review++;
      }else out.waiting++;
    }catch{
      if(new Date(m.end_at).getTime()<giveUp)try{await saveMeetingDraft(db,m,{transcript},"analysis_unavailable");out.review++;}catch{out.waiting++;}
      else out.waiting++;
    }
  }
  return out;
}

/** Nightly: pull ad spend and results for every connected ad account, converted to the client's currency. */
export async function syncAds(env: Env, days = 3) {
  if(env.ADS_SYNC_ENABLED!=="true")return {accounts:0,rows:0,errors:0,disabled:true};
  try { return await syncEnabledAds(env, days); }
  catch (error) { throw new Error(redactedAdsError(error)); }
}

async function syncEnabledAds(env: Env, days: number) {
  const db = new Db(env);
  const accounts = await db.select<any>("ad_accounts", "status=neq.disconnected&select=*,tenants(currency,status)");
  const rates = Object.fromEntries((await db.select<any>("fx_rates", "select=currency,aed_per_unit")).map(r => [r.currency, Number(r.aed_per_unit)]));
  const to = new Date(), from = new Date(to.getTime() - days * 86400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const result = { accounts: accounts.length, rows: 0, errors: 0 };
  for (const acc of accounts) {
    try {
      // Refresh state immediately before touching a provider; the list may be stale after a pause.
      const current = await db.one<any>("tenants", `id=eq.${acc.tenant_id}&status=eq.active&select=id,currency`);
      const connection = await db.one<any>("ad_accounts", `id=eq.${acc.id}&status=neq.disconnected&select=id`);
      if (!current || !connection) continue;
      let rows: AdRow[] = [];
      if (acc.platform === "google_ads") rows = await googleAdsRows(env, acc.account_ref, d(from), d(to));
      if (acc.platform === "meta") rows = await metaRows(env, acc.account_ref, d(from), d(to));
      if (acc.platform === "linkedin") {
        rows = await linkedinRows(env, acc.account_ref, d(from), d(to));
        const cur = await linkedinCurrency(env, acc.account_ref);
        rows = rows.map(r => ({ ...r, currency: r.currency || cur }));
      }
      // A pause during a provider read must not reconnect the account or publish rows.
      if (!await db.one("tenants", `id=eq.${acc.tenant_id}&status=eq.active&select=id`) ||
          !await db.one("ad_accounts", `id=eq.${acc.id}&status=neq.disconnected&select=id`)) continue;
      const tenantCur = current.currency;
      const payload = rows.map(r => ({ tenant_id: acc.tenant_id, platform: acc.platform, day: r.day, campaign_ref: r.campaign_ref, campaign_name: r.campaign_name,
        spend: toTenantCurrency(r.spend, r.currency, tenantCur, rates), currency: tenantCur, impressions: r.impressions, clicks: r.clicks, conversions: r.conversions }));
      for (let i = 0; i < payload.length; i += 500) await db.upsert("ad_metrics_daily", payload.slice(i, i + 500), "tenant_id,platform,day,campaign_ref");
      await db.update("ad_accounts", `id=eq.${acc.id}&status=neq.disconnected`, { status: "connected", last_synced_at: new Date().toISOString(), last_error: null });
      result.rows += payload.length;
    } catch (e) {
      result.errors++;
      await db.update("ad_accounts", `id=eq.${acc.id}&status=neq.disconnected`, { status: "error", last_error: redactedAdsError(e) });
    }
  }
  return result;
}

async function linkedinCurrency(env: Env, accountId: string): Promise<string> {
  const res = await fetch(`https://api.linkedin.com/rest/adAccounts/${accountId}`, {
    headers: { Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`, "LinkedIn-Version": "202610", "X-Restli-Protocol-Version": "2.0.0" },
  });
  if (!res.ok) throw adsHttpError("linkedin", res.status);
  const j = (await res.json()) as any;
  return j.currency ?? "USD";
}

export async function runScheduled(cron: string, env: Env) {
  if (cron === "0 22 * * *") return { ads: env.ADS_SYNC_ENABLED === "true" ? await syncAds(env) : {accounts:0,rows:0,errors:0,disabled:true} };      // 02:00 Gulf Standard Time
  // Revive reuses the existing tick only after explicit isolated-environment activation.
  // Its dedicated staff route and direct tests do not execute the founder's other jobs.
  const revive = env.REVIVE_AUTOMATION_ENABLED === "true" ? await runReviveAutomation(env) : undefined;
  const [reminders, meetings, sheet] = await Promise.all([
    env.CONSULTATION_REMINDERS_ENABLED === "true" ? sendReminders(env) : {sent:0,review:0,disabled:true},
    env.MEETING_TRANSCRIPTS_ENABLED === "true" ? processFinishedMeetings(env) : {processed:0,no_show:0,waiting:0,review:0,disabled:true},
    env.SHEETS_SYNC_ENABLED === "true" ? syncSheet(env) : {synced:0,failed:0,disabled:true},
  ]);
  return { reminders, meetings, sheet, ...(revive ? { revive } : {}) };
}
