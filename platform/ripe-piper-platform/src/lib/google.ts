import type { Env } from "../env";

/** Google APIs used by the platform: Calendar (bookings with Meet links), Gmail (emails), Sheets (CRM), Meet + Drive (transcripts). */
let cached: { token: string; exp: number } | null = null;

export async function googleToken(env: Env): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function g<T>(env: Env, url: string, init: RequestInit = {}): Promise<T> {
  const token = await googleToken(env);
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google API ${res.status} on ${url.split("?")[0]}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

// ------------------------------------------------------------------ Calendar
export async function busyTimes(env: Env, from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  const j = await g<any>(env, "https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: env.GOOGLE_CALENDAR_ID }] }),
  });
  const cal = j.calendars?.[env.GOOGLE_CALENDAR_ID] ?? Object.values(j.calendars ?? {})[0];
  return ((cal as any)?.busy ?? []).map((b: any) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

/** Creates the calendar event with a Google Meet link and sends the invitation to the attendee. */
export async function createMeetEvent(env: Env, p: { id: string; start: string; end: string; email: string; name: string; summary: string; description: string }) {
  const ev = await g<any>(env,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events?conferenceDataVersion=1&sendUpdates=all`, {
      method: "POST",
      body: JSON.stringify({
        summary: p.summary,
        description: p.description,
        start: { dateTime: p.start, timeZone: "Asia/Dubai" },
        end: { dateTime: p.end, timeZone: "Asia/Dubai" },
        attendees: [{ email: p.email, displayName: p.name }],
        conferenceData: { createRequest: { requestId: p.id, conferenceSolutionKey: { type: "hangoutsMeet" } } },
        reminders: { useDefault: false, overrides: [{ method: "email", minutes: 1440 }, { method: "popup", minutes: 60 }] },
        extendedProperties: { private: { ripe_meeting_id: p.id } },
      }),
    });
  const entry = (ev.conferenceData?.entryPoints ?? []).find((e: any) => e.entryPointType === "video");
  return { eventId: ev.id as string, meetUrl: (entry?.uri ?? ev.hangoutLink ?? null) as string | null, meetCode: (ev.conferenceData?.conferenceId ?? null) as string | null };
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
  await g(env, `https://sheets.googleapis.com/v4/spreadsheets/${env.CRM_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: "PUT", body: JSON.stringify({ values: rows }),
  });
}

export async function sheetAppend(env: Env, tab: string, rows: (string | number)[][]) {
  await g(env, `https://sheets.googleapis.com/v4/spreadsheets/${env.CRM_SHEET_ID}/values/${encodeURIComponent(tab + "!A1")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
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
