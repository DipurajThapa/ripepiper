import type { Env } from "../env";

/** Google APIs used by the platform: Calendar (bookings with Meet links), Gmail (emails), Sheets (CRM), Meet + Drive (transcripts). */
type TokenEntry = { credentials: string; token?: string; exp?: number; pending?: Promise<string> };
// Cache only within one runtime configuration; rotation invalidates the old entry.
const tokens = new WeakMap<Env, TokenEntry>();
export class GoogleError extends Error {
  constructor(public status: number, message = "Google integration request failed") { super(`${message} (${status})`); }
}
async function request(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new GoogleError(0, "Google integration response is uncertain"); }
}
export async function googleToken(env: Env): Promise<string> {
  if (![env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REFRESH_TOKEN].every(v => typeof v === "string" && v.trim()))
    throw new GoogleError(0, "Google credentials are not configured");
  const credentials = JSON.stringify([env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REFRESH_TOKEN]);
  let entry = tokens.get(env);
  if (!entry || entry.credentials !== credentials) { entry = { credentials }; tokens.set(env, entry); }
  if (entry.token && (entry.exp ?? 0) > Date.now() + 60_000) return entry.token;
  if (entry.pending) return entry.pending;
  const current = entry;
  current.pending = (async () => {
    const res = await request("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }),
    });
    if (!res.ok) throw new GoogleError(res.status, "Google token refresh failed");
    let j: any;
    try { j = await res.json(); } catch { throw new GoogleError(0, "Invalid Google token response"); }
    if (typeof j?.access_token !== "string" || !j.access_token || !Number.isFinite(j.expires_in) || j.expires_in <= 60)
      throw new GoogleError(0, "Invalid Google token response");
    current.token = j.access_token; current.exp = Date.now() + j.expires_in * 1000;
    return current.token!;
  })();
  try { return await current.pending; } finally { current.pending = undefined; }
}
async function g<T>(env: Env, url: string, init: RequestInit = {}): Promise<T> {
  const token = await googleToken(env);
  const res = await request(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!res.ok) {
    if (res.status === 401 && tokens.get(env)?.token === token) tokens.delete(env);
    // Provider bodies/URLs can contain contact details. Never expose them in errors or logs.
    throw new GoogleError(res.status);
  }
  try { const text = await res.text(); return (text ? JSON.parse(text) : null) as T; }
  catch { throw new GoogleError(0, "Invalid Google API response"); }
}

// ------------------------------------------------------------------ Calendar
export async function busyTimes(env: Env, from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  const j = await g<any>(env, "https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: env.GOOGLE_CALENDAR_ID }] }),
  });
  const cal = j?.calendars?.[env.GOOGLE_CALENDAR_ID];
  if (!cal || (cal.errors !== undefined && (!Array.isArray(cal.errors) || cal.errors.length)) || !Array.isArray(cal.busy))
    throw new GoogleError(0, "Calendar availability could not be verified");
  return cal.busy.map((b: any) => {
    if (!b || typeof b.start !== "string" || typeof b.end !== "string" || !/[zZ]|[+-]\d{2}:\d{2}$/.test(b.start) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(b.end))
      throw new GoogleError(0, "Invalid calendar interval");
    const start = new Date(b.start), end = new Date(b.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new GoogleError(0, "Invalid calendar interval");
    return { start, end };
  });
}

export type MeetingInput = { id: string; start: string; end: string; email: string; name: string; summary: string; description: string };
export function calendarEventId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid meeting identifier");
  return "rp" + id.replace(/-/g, "").toLowerCase();
}
export function isMeetUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(value);
}
function verifiedEvent(ev: any, p: MeetingInput, expectedId: string) {
  if (ev?.id !== expectedId || ev.status !== "confirmed" || ev.extendedProperties?.private?.ripe_meeting_id !== p.id ||
      Date.parse(ev.start?.dateTime) !== Date.parse(p.start) || Date.parse(ev.end?.dateTime) !== Date.parse(p.end) ||
      !ev.attendees?.some((a: any) => typeof a.email === "string" && a.email.toLowerCase() === p.email.toLowerCase()))
    throw new GoogleError(0, "Calendar event does not match the reservation");
  const entry = (ev.conferenceData?.entryPoints ?? []).find((e: any) => e.entryPointType === "video");
  const meetUrl = entry?.uri ?? ev.hangoutLink;
  if (!isMeetUrl(meetUrl) || ["pending", "failure"].includes(ev.conferenceData?.createRequest?.status?.statusCode))
    throw new GoogleError(0, "Calendar conference is not ready");
  return { eventId: ev.id as string, meetUrl, meetCode: meetUrl.split("/").pop()! };
}
/** Read-only provider reconciliation. Never creates, updates or invites. */
export async function reconcileMeetEvent(env: Env, p: MeetingInput, eventId = calendarEventId(p.id)) {
  if (!/^[a-z0-9_]{5,1024}$/.test(eventId)) throw new Error("Invalid calendar event identifier");
  const ev = await g<any>(env, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`);
  return verifiedEvent(ev, p, eventId);
}
/** One insertion only. On uncertain response/duplicate ID, GET the same event; never replay an invitation. */
export async function createMeetEvent(env: Env, p: MeetingInput) {
  const eventId = calendarEventId(p.id);
  let ev: any;
  try {
    ev = await g<any>(env,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events?conferenceDataVersion=1&sendUpdates=all`, {
        method: "POST", body: JSON.stringify({ id: eventId, summary: p.summary, description: p.description,
          start: { dateTime: p.start, timeZone: "Asia/Dubai" }, end: { dateTime: p.end, timeZone: "Asia/Dubai" },
          attendees: [{ email: p.email, displayName: p.name }],
          conferenceData: { createRequest: { requestId: p.id, conferenceSolutionKey: { type: "hangoutsMeet" } } },
          reminders: { useDefault: false, overrides: [{ method: "email", minutes: 1440 }, { method: "popup", minutes: 60 }] },
          extendedProperties: { private: { ripe_meeting_id: p.id } },
        }),
      });
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 0 || e.status === 409 || e.status >= 500)) return reconcileMeetEvent(env, p);
    throw e;
  }
  return verifiedEvent(ev, p, eventId);
}

export async function cancelEvent(env: Env, eventId: string) {
  await g(env, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events/${eventId}?sendUpdates=all`, { method: "DELETE" });
}

// ------------------------------------------------------------------ Gmail
function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = ""; bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildMime(from: string, to: string, subject: string, text: string, html?: string): string {
  const encSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  if (!html) {
    return [`From: ${from}`, `To: ${to}`, `Subject: ${encSubject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", text].join("\r\n");
  }
  const b = "rp_" + Math.random().toString(36).slice(2);
  return [`From: ${from}`, `To: ${to}`, `Subject: ${encSubject}`, "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${b}"`, "",
    `--${b}`, "Content-Type: text/plain; charset=UTF-8", "", text, `--${b}`, "Content-Type: text/html; charset=UTF-8", "", html, `--${b}--`].join("\r\n");
}

export async function sendEmail(env: Env, to: string, subject: string, text: string, html?: string) {
  await g(env, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", body: JSON.stringify({ raw: b64url(buildMime(env.MAIL_FROM, to, subject, text, html)) }),
  });
}

// ------------------------------------------------------------------ Sheets (CRM)
export async function sheetValues(env: Env, range: string): Promise<string[][]> {
  const j = await g<any>(env, `https://sheets.googleapis.com/v4/spreadsheets/${env.CRM_SHEET_ID}/values/${encodeURIComponent(range)}`);
  return j.values ?? [];
}

export async function sheetEnsureTab(env: Env, tab: string, header: string[]) {
  const meta = await g<any>(env, `https://sheets.googleapis.com/v4/spreadsheets/${env.CRM_SHEET_ID}?fields=sheets.properties.title`);
  const exists = (meta.sheets ?? []).some((s: any) => s.properties.title === tab);
  if (!exists) {
    await g(env, `https://sheets.googleapis.com/v4/spreadsheets/${env.CRM_SHEET_ID}:batchUpdate`, {
      method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
    await sheetWrite(env, `${tab}!A1`, [header]);
  }
}

export async function sheetWrite(env: Env, range: string, rows: (string | number)[][]) {
  await g(env, `https://sheets.googleapis.com/v4/spreadsheets/${env.CRM_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT", body: JSON.stringify({ values: rows }),
  });
}

export async function sheetAppend(env: Env, tab: string, rows: (string | number)[][]) {
  await g(env, `https://sheets.googleapis.com/v4/spreadsheets/${env.CRM_SHEET_ID}/values/${encodeURIComponent(tab + "!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST", body: JSON.stringify({ values: rows }),
  });
}

// ------------------------------------------------------------------ Meet transcripts
/**
 * Finds the conference record for a meeting code and returns the transcript text.
 * Requires a Workspace edition with transcripts (Business Standard or higher) and transcription turned on for the call.
 */
export async function meetTranscript(env: Env, meetCode: string): Promise<{ status: "ready" | "no_record" | "no_transcript"; text?: string; participants?: number }> {
  const recs = await g<any>(env, `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(`space.meeting_code = "${meetCode}"`)}`);
  const rec = (recs.conferenceRecords ?? [])[0];
  if (!rec) return { status: "no_record" };
  const parts = await g<any>(env, `https://meet.googleapis.com/v2/${rec.name}/participants`);
  const participants = (parts.participants ?? []).length;
  const ts = await g<any>(env, `https://meet.googleapis.com/v2/${rec.name}/transcripts`);
  const t = (ts.transcripts ?? []).find((x: any) => x.state === "FILE_GENERATED") ?? (ts.transcripts ?? [])[0];
  if (!t) return { status: "no_transcript", participants };
  const lines: string[] = [];
  let pageToken = "";
  do {
    const e = await g<any>(env, `https://meet.googleapis.com/v2/${t.name}/entries?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`);
    for (const en of e.transcriptEntries ?? []) lines.push(`${en.participant ?? "Speaker"}: ${en.text}`);
    pageToken = e.nextPageToken ?? "";
  } while (pageToken);
  return { status: "ready", text: lines.join("\n"), participants };
}

// ------------------------------------------------------------------ Tenant read-only inbox pilot
export async function googleMailbox(env: Env): Promise<string> {
  const profile=await g<any>(env,'https://gmail.googleapis.com/gmail/v1/users/me/profile');
  if(typeof profile?.emailAddress!=='string'||!profile.emailAddress.includes('@'))throw new GoogleError(0,'Invalid mailbox identity');
  return profile.emailAddress;
}
export async function googleCalendarIdentity(env: Env) {
  const calendar=await g<any>(env,`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}`);
  if(typeof calendar?.id!=='string'||!['reader','writer','owner'].includes(calendar.accessRole)||calendar.deleted)throw new GoogleError(0,'Calendar read access unavailable');
  return {id:calendar.id as string,role:calendar.accessRole as string};
}
function singleAddress(value: string):string|null {
  const address=value.trim().match(/^(?:[^<>@]*<([^<>]+)>|([^<>\s]+))$/);
  const result=address?.[1]??address?.[2];
  return result&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(result)?result.toLowerCase():null;
}
function inboundMetadata(message:any,id:string,sender:string,mailbox:string) {
  const headers=message?.payload?.headers;
  if(!Array.isArray(headers)||message.id!==id||!/^[a-zA-Z0-9_-]{1,128}$/.test(message.threadId??'')||
    !Array.isArray(message.labelIds)||message.labelIds.some((l:string)=>['SENT','DRAFT','SPAM','TRASH'].includes(l)))throw new GoogleError(0,'Unsupported incoming message');
  const header=(name:string)=>headers.filter((h:any)=>typeof h.name==='string'&&h.name.toLowerCase()===name).map((h:any)=>h.value);
  const from=header('from'),to=header('to'),subject=header('subject');
  const date=Number(message.internalDate);
  if(from.length!==1||to.length!==1||typeof from[0]!=='string'||typeof to[0]!=='string'||singleAddress(from[0])!==sender.toLowerCase()||singleAddress(to[0])!==mailbox.toLowerCase()||
    !Number.isFinite(date)||date>Date.now()||date<Date.now()-30*86400000)throw new GoogleError(0,'Message identity or date mismatch');
  return {id,threadId:message.threadId as string,subject:typeof subject[0]==='string'?subject[0].slice(0,300):'(no subject)',observedAt:new Date(date).toISOString()};
}
export async function listInboundMessages(env:Env,sender:string,mailbox:string) {
  const q=`from:(${sender}) to:(${mailbox}) newer_than:30d -in:sent -in:drafts -in:spam -in:trash`;
  const result=await g<any>(env,`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${encodeURIComponent(q)}`);
  if(!result||typeof result!=='object'||Array.isArray(result)||(result.messages!==undefined&&!Array.isArray(result.messages)))throw new GoogleError(0,'Invalid message list');
  if((result?.messages?.length??0)>10)throw new GoogleError(0,'Message list exceeds limit');
  const messages=[];let excluded=0;
  for(const item of result?.messages??[]){
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(item.id??''))throw new GoogleError(0,'Invalid message identifier');
    const message=await g<any>(env,`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`);
    try{messages.push(inboundMetadata(message,item.id,sender,mailbox));}catch{excluded++;}
  }
  return {items:messages,moreAvailable:!!result?.nextPageToken,excluded};
}
export async function readInboundMessage(env:Env,id:string,sender:string,mailbox:string){
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new GoogleError(0,'Invalid message identifier');
  // Verify envelope metadata before fetching any body, then recheck the full response.
  const envelope=await g<any>(env,`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`);
  inboundMetadata(envelope,id,sender,mailbox);
  if(!Number.isFinite(envelope.sizeEstimate)||envelope.sizeEstimate>256000)throw new GoogleError(0,'Message exceeds review limit');
  const message=await g<any>(env,`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
  const meta=inboundMetadata(message,id,sender,mailbox);
  if(!Number.isFinite(message.sizeEstimate)||message.sizeEstimate>256000)throw new GoogleError(0,'Message exceeds review limit');
  const texts:string[]=[];let parts=0;
  function visit(part:any,depth:number){
    if(++parts>30||depth>5)throw new GoogleError(0,'Message structure exceeds review limit');
    if(part?.mimeType==='message/rfc822')return; // Do not ingest forwarded attachments.
    if(part?.filename||part?.body?.attachmentId)return;
    if(part?.mimeType==='text/plain'&&typeof part.body?.data==='string'){
      if(part.body.data.length>350000)throw new GoogleError(0,'Message body exceeds review limit');
      let bytes:Uint8Array;
      try{bytes=Uint8Array.from(atob(part.body.data.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
      catch{throw new GoogleError(0,'Invalid message encoding');}
      texts.push(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
    }
    if(part?.parts!==undefined&&!Array.isArray(part.parts))throw new GoogleError(0,'Invalid message structure');
    for(const child of part?.parts??[])visit(child,depth+1);
  }
  visit(message.payload,0);
  const body=texts.join('\n').trim();
  if(!body)throw new GoogleError(0,'Plain-text review unavailable; use reviewed manual evidence');
  const text=`Subject: ${meta.subject}\n${body}`;
  const excerpt=text.slice(0,2000),truncated=text.length>2000;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({...meta,excerpt,truncated}))))).map(b=>b.toString(16).padStart(2,'0')).join('');
  return {...meta,excerpt,truncated,digest};
}
