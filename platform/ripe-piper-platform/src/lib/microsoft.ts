import type { Env } from "../env";
import { buildMime, type MeetingInput, type MimeHeaders } from "./google";

/** Microsoft Graph (delegated) for a tenant's own mailbox: draft-then-send mail, calendarView busy times, Teams events. */
export type MsAccount = { refreshToken: string; rotate?: (refreshToken: string) => Promise<void> };
type TokenEntry = { refreshToken: string; token?: string; exp?: number; pending?: Promise<string> };
// One cache per account object (google.ts pattern); a changed refresh token invalidates the entry.
const tokens = new WeakMap<MsAccount, TokenEntry>();
const GRAPH = "https://graph.microsoft.com/v1.0";
export class MicrosoftError extends Error {
  /** Set when a draft exists but its send is unconfirmed: the caller holds the action with this reference and never re-sends. */
  messageId?: string;
  constructor(public status: number, message = "Microsoft integration request failed") { super(`${message} (${status})`); }
}
async function request(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new MicrosoftError(0, "Microsoft integration response is uncertain"); }
}
export async function msToken(env: Env, account: MsAccount): Promise<string> {
  if (![env.MS_CLIENT_ID, env.MS_CLIENT_SECRET, account.refreshToken].every(v => typeof v === "string" && v.trim()))
    throw new MicrosoftError(0, "Microsoft credentials are not configured");
  let entry = tokens.get(account);
  if (!entry || entry.refreshToken !== account.refreshToken) { entry = { refreshToken: account.refreshToken }; tokens.set(account, entry); }
  if (entry.token && (entry.exp ?? 0) > Date.now() + 60_000) return entry.token;
  if (entry.pending) return entry.pending;
  const current = entry;
  current.pending = (async () => {
    const res = await request("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.MS_CLIENT_ID!, client_secret: env.MS_CLIENT_SECRET!, refresh_token: current.refreshToken, grant_type: "refresh_token" }),
    });
    if (!res.ok) throw new MicrosoftError(res.status, "Microsoft token refresh failed");
    let j: any;
    try { j = await res.json(); } catch { throw new MicrosoftError(0, "Invalid Microsoft token response"); }
    if (typeof j?.access_token !== "string" || !j.access_token || !Number.isFinite(j.expires_in) || j.expires_in <= 60)
      throw new MicrosoftError(0, "Invalid Microsoft token response");
    // Microsoft may rotate the refresh token; the caller must re-seal and store it (the old one is to be discarded).
    if (typeof j.refresh_token === "string" && j.refresh_token && j.refresh_token !== current.refreshToken) {
      await account.rotate?.(j.refresh_token);
      account.refreshToken = current.refreshToken = j.refresh_token;
    }
    current.token = j.access_token; current.exp = Date.now() + j.expires_in * 1000;
    return current.token!;
  })();
  try { return await current.pending; } finally { current.pending = undefined; }
}
async function graph<T>(env: Env, account: MsAccount, path: string, init: RequestInit = {}, beforeRequest?: () => Promise<void>): Promise<T> {
  const token = await msToken(env, account);
  if (beforeRequest) await beforeRequest();
  const res = await request(GRAPH + path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!res.ok) {
    if (res.status === 401 && tokens.get(account)?.token === token) tokens.delete(account);
    // Provider bodies can contain contact details. Never expose them in errors or logs.
    throw new MicrosoftError(res.status);
  }
  try { const text = await res.text(); return (text ? JSON.parse(text) : null) as T; }
  catch { throw new MicrosoftError(0, "Invalid Microsoft API response"); }
}
const graphId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_=+\/-]{1,512}$/.test(id);

/** Draft (MIME via buildMime, so header guards and RFC 2047 apply) then send; /sendMail would return no id to reconcile. */
export async function msSendMail(env: Env, account: MsAccount, m: { from: string; to: string; subject: string; text: string; html?: string; headers?: MimeHeaders }, beforeSend?: () => Promise<void>) {
  const mime = new TextEncoder().encode(buildMime(m.from, m.to, m.subject, m.text, m.html, m.headers));
  let bin = ""; mime.forEach(b => (bin += String.fromCharCode(b)));
  const draft = await graph<any>(env, account, "/me/messages", { method: "POST", headers: { "Content-Type": "text/plain" }, body: btoa(bin) }, beforeSend);
  if (!graphId(draft?.id)) throw new MicrosoftError(0, "Microsoft draft acknowledgement is uncertain");
  try { await graph(env, account, `/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" }); }
  catch (e) { if (e instanceof MicrosoftError) e.messageId = draft.id; throw e; }
  return { messageId: draft.id as string };
}

// ponytail: one calendarView page of 500; a fuller window fails closed instead of following @odata.nextLink.
export async function msBusyTimes(env: Env, account: MsAccount, from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  const q = new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: "start,end,showAs,isCancelled", $top: "500" });
  const j = await graph<any>(env, account, `/me/calendarView?${q}`, { headers: { Prefer: 'outlook.timezone="UTC"' } });
  if (!Array.isArray(j?.value) || j["@odata.nextLink"] !== undefined) throw new MicrosoftError(0, "Calendar availability could not be verified");
  const at = (t: any) => {
    if (t?.timeZone !== "UTC" || typeof t.dateTime !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?$/.test(t.dateTime))
      throw new MicrosoftError(0, "Invalid calendar interval");
    return new Date(t.dateTime.slice(0, 23) + "Z");
  };
  return j.value.filter((e: any) => e?.isCancelled !== true && e?.showAs !== "free").map((e: any) => {
    const start = at(e.start), end = at(e.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new MicrosoftError(0, "Invalid calendar interval");
    return { start, end };
  });
}

/** One insertion with transactionId = meeting/action id (Graph's retry dedupe). An uncertain result is not replayed here. */
export async function msCreateEvent(env: Env, account: MsAccount, p: MeetingInput) {
  const utc = (iso: string) => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) throw new Error("Invalid meeting time"); return { dateTime: d.toISOString().slice(0, 19), timeZone: "UTC" }; };
  const ev = await graph<any>(env, account, "/me/events", { method: "POST", body: JSON.stringify({
    subject: p.summary, body: { contentType: "text", content: p.description }, start: utc(p.start), end: utc(p.end),
    attendees: [{ emailAddress: { address: p.email, name: p.name }, type: "required" }],
    isOnlineMeeting: true, transactionId: p.id,
  }) });
  if (!graphId(ev?.id)) throw new MicrosoftError(0, "Calendar event acknowledgement is uncertain");
  const joinUrl = ev.onlineMeeting?.joinUrl;
  return { eventId: ev.id as string, joinUrl: typeof joinUrl === "string" && joinUrl.startsWith("https://") ? joinUrl : null };
}
