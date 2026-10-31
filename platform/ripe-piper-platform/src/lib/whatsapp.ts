import type { Env } from "../env";
import { hmacHex, safeEqual } from "./payments";

/** WhatsApp Cloud API (Meta): one approved utility template out, signed webhooks in. Default off. */
export const WA_GRAPH_VERSION = "v26.0";
const WA_TEMPLATE_LANGUAGE = "en";
const WA_TIMEOUT_MS = 15_000;

export const whatsappEnabled = (env: Env) => env.WHATSAPP_ENABLED === "true";

/**
 * Receipts accept only [A-Za-z0-9_-]{1,128}. A wamid is "wamid." + base64, so keep it reversible:
 * "wa_" + the base64url body without padding.
 */
export function receiptId(wamid: string): string {
  return "wa_" + wamid.replace(/^wamid\./, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sends an approved template; parameters fill {{1}}, {{2}}... in order. Never retried here. */
export async function sendWhatsAppTemplate(env: Env, to: string, name: string, params: string[]): Promise<{ messageId: string }> {
  if (!whatsappEnabled(env) || !env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID || !name) throw new Error("WhatsApp is not configured");
  const res = await fetch(`https://graph.facebook.com/${WA_GRAPH_VERSION}/${encodeURIComponent(env.WHATSAPP_PHONE_ID)}/messages`, {
    method: "POST", signal: AbortSignal.timeout(WA_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "template",
      template: { name, language: { code: WA_TEMPLATE_LANGUAGE }, components: [{ type: "body", parameters: params.map(text => ({ type: "text", text })) }] } }),
  });
  // Provider error bodies can echo the recipient; report the status only.
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status})`);
  const id = ((await res.json()) as any)?.messages?.[0]?.id;
  if (typeof id !== "string" || !/^wamid\.[A-Za-z0-9+/=_-]{1,200}$/.test(id)) throw new Error("WhatsApp acknowledgement uncertain");
  return { messageId: id };
}

/** X-Hub-Signature-256 = "sha256=" + hex HMAC-SHA256 of the raw body with the app secret. */
export async function verifyWhatsApp(rawBody: string, header: string | null, secret: string | undefined): Promise<boolean> {
  if (!header?.startsWith("sha256=") || !secret) return false;
  return safeEqual(header.slice(7).toLowerCase(), await hmacHex(secret, rawBody));
}

export interface WaInbound { from: string; id: string; text: string }
export interface WaFailed { id: string; code: number | null }

/** Only events for our own business number; numbers become E.164. */
export function parseWebhook(json: any, phoneId: string | undefined): { inbound: WaInbound[]; failed: WaFailed[] } {
  const out = { inbound: [] as WaInbound[], failed: [] as WaFailed[] };
  if (json?.object !== "whatsapp_business_account" || !phoneId || !Array.isArray(json.entry)) return out;
  for (const entry of json.entry) for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
    const v = change?.value;
    if (change?.field !== "messages" || v?.metadata?.phone_number_id !== phoneId) continue;
    for (const m of Array.isArray(v.messages) ? v.messages : []) {
      const from = "+" + String(m?.from ?? "");
      if (!/^\+[1-9][0-9]{7,14}$/.test(from) || typeof m?.id !== "string") continue;
      out.inbound.push({ from, id: m.id, text: m.type === "text" && typeof m.text?.body === "string" ? m.text.body : m.type === "button" && typeof m.button?.text === "string" ? m.button.text : "" });
    }
    for (const s of Array.isArray(v.statuses) ? v.statuses : [])
      if (s?.status === "failed" && typeof s.id === "string") out.failed.push({ id: s.id, code: Number.isSafeInteger(s.errors?.[0]?.code) ? s.errors[0].code : null });
  }
  return out;
}

/** STOP, UNSUBSCRIBE or "stop whatsapp", ignoring case and surrounding punctuation. */
export const isStop = (text: string) => /^\W*(stop|unsubscribe|stop whatsapp)\W*$/i.test(text.trim());

export const maskNumber = (e164: string) => e164.slice(0, 4) + "*".repeat(Math.max(0, e164.length - 7)) + e164.slice(-3);
