import type { Env } from "../env";
import { Db, DbError } from "../lib/db";
import { sendEmail } from "../lib/google";
import { emails } from "../lib/email";
import { safeEqual } from "../lib/payments";
import { cleanText } from "../lib/validate";
import { verifyWhatsApp, parseWebhook, isStop, maskNumber } from "../lib/whatsapp";
import { json, bad } from "./http";

const MAX_WEBHOOK_BYTES = 1_000_000;

/** Meta subscription check: echo hub.challenge only for our own verify token. */
export async function whatsappVerify(req: Request, env: Env) {
  const q = new URL(req.url).searchParams, token = q.get("hub.verify_token") ?? "", challenge = q.get("hub.challenge") ?? "";
  if (q.get("hub.mode") !== "subscribe" || !env.WHATSAPP_VERIFY_TOKEN || !safeEqual(token, env.WHATSAPP_VERIFY_TOKEN) || !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return bad("Forbidden.", 403);
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

/** STOP is honoured even while sending is off; a database failure returns 503 so Meta retries (writes are idempotent). */
export async function whatsappWebhook(req: Request, env: Env, ctx: ExecutionContext) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES) return bad("Request is too large.", 413);
  const raw = await req.text();
  if (raw.length > MAX_WEBHOOK_BYTES || !(await verifyWhatsApp(raw, req.headers.get("X-Hub-Signature-256"), env.WHATSAPP_APP_SECRET))) return bad("Invalid signature.", 401);
  let event: ReturnType<typeof parseWebhook>;
  try { event = parseWebhook(JSON.parse(raw), env.WHATSAPP_PHONE_ID); } catch { return json({ received: true, disposition: "ignored" }); }
  for (const f of event.failed) console.error("whatsapp_delivery_failed", { code: f.code });
  const db = new Db(env, 15000);
  try {
    for (const m of event.inbound) {
      if (isStop(m.text)) { await optOut(db, m.from); continue; }
      const alert = emails.adminAlert("WhatsApp message received", `From ${maskNumber(m.from)} (match it to the meeting's WhatsApp number in admin).\n\n${cleanText(m.text, 1000) || "[non-text message]"}\n\nReply from the WhatsApp Business app; replies inside 24 hours may be charged.`);
      ctx.waitUntil(sendEmail(env, env.ADMIN_ALERT_EMAIL, alert.subject, alert.text).catch(() => {}));
    }
  } catch { return bad("Opt-out not recorded yet. Provider retry is safe.", 503); }
  return json({ received: true });
}

/** Records the opt-out on every agency meeting with this number and suppresses the mapped attendee email. */
async function optOut(db: Db, number: string) {
  const q = `tenant_id=is.null&attendee_whatsapp=eq.${encodeURIComponent(number)}`;
  const rows = await db.select<{ attendee_email: string | null }>("meetings", `${q}&select=attendee_email`);
  if (!rows.length) { console.log("whatsapp_stop_unmatched"); return; }
  await db.update("meetings", `${q}&whatsapp_opted_out_at=is.null`, { whatsapp_opted_out_at: new Date().toISOString() });
  for (const email of new Set(rows.map(r => r.attendee_email?.toLowerCase()).filter((e): e is string => !!e))) {
    try { await db.insert("agency_suppression", { email, reason: "whatsapp STOP" }); }
    catch (e) { if (!(e instanceof DbError && e.isConflict)) throw e; }
  }
}
