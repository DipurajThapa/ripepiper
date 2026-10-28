import type { Env } from "../env";
import { Db } from "../lib/db";
import { bad, json, requireUser } from "../routes/http";
import { validInstant } from "./prospecting";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messageId = /^[a-zA-Z0-9_-]{1,240}$/;
const windows = ["24h", "1h"] as const;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

/** Inspection cannot repair, resend or establish recipient delivery. */
export async function inspectReminderReceipts(req: Request, env: Env, id: string) {
  await requireUser(req, env, true);
  if (!uuid.test(id)) return bad("Meeting not found.", 404);
  try {
    const meeting = await new Db(env, 15000, 32000).one<any>("meetings", `id=eq.${id}&tenant_id=is.null&select=id,tenant_id,reminder_receipts,reminder_24h_at,reminder_1h_at`);
    if (!meeting || meeting.tenant_id !== null) return bad("Meeting not found.", 404);
    if (meeting.id !== id || !object(meeting.reminder_receipts) || Object.keys(meeting.reminder_receipts).some(key => !windows.includes(key as any))) throw Error("Malformed receipt");
    const now = Date.now();
    const receipts = windows.map(window => {
      const stored = meeting.reminder_receipts[window];
      if (!Object.prototype.hasOwnProperty.call(meeting.reminder_receipts, window)) {
        // Old successful sends predate the ledger: absence cannot prove not_sent.
        if (meeting[window === "24h" ? "reminder_24h_at" : "reminder_1h_at"] != null) throw Error("Legacy receipt unavailable");
        return {window, state:"absent", leaseUntil:null, acknowledgedAt:null, providerMessageId:null, requiresReview:false, delivery:"not_sent"};
      }
      if (!object(stored) || !["claimed", "dispatching", "acknowledged", "review"].includes(stored.state) || !validInstant(stored.leaseUntil)) throw Error("Malformed receipt");
      if (stored.acknowledgedAt != null && !validInstant(stored.acknowledgedAt)) throw Error("Malformed acknowledgement");
      if (stored.messageId != null && (typeof stored.messageId !== "string" || !messageId.test(stored.messageId))) throw Error("Malformed message ID");
      if (stored.state === "acknowledged" && (!validInstant(stored.acknowledgedAt) || typeof stored.messageId !== "string" || !messageId.test(stored.messageId))) throw Error("Missing acknowledgement");
      return {window, state:stored.state, leaseUntil:stored.leaseUntil, acknowledgedAt:stored.acknowledgedAt ?? null, providerMessageId:stored.messageId ?? null,
        requiresReview:stored.state === "review" || (["claimed", "dispatching"].includes(stored.state) && Date.parse(stored.leaseUntil) <= now), delivery:"unknown"};
    });
    return json({version:1, meetingId:id, canRetry:false, receipts});
  } catch {
    return bad("Reminder receipts are unavailable or uncertain. No retry was performed.", 503);
  }
}
