// End-to-end flow through the real Worker code with simulated Supabase, Google, Stripe and Anthropic APIs:
// inquiry -> qualify -> slots -> book (Meet link + email) -> double-booking refused -> pre-proposal approve -> Stripe webhook
// -> tenant + owner invite + fee + activity log -> idempotent replay.
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/index";

type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let sentEmails: { to: string; raw: string }[];
let calendarEvents: Row[];
const uuid = () => crypto.randomUUID();

function matches(row: Row, query: URLSearchParams): boolean {
  for (const [k, v] of query) {
    if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    const cell = row[k];
    if (op === "eq" && String(cell) !== decodeURIComponent(val)) return false;
    if (op === "neq" && String(cell) === val) return false;
    if (op === "is" && val === "null" && cell != null) return false;
    if (op === "not" && val === "is.null" && cell == null) return false;
    if (op === "in" && !val.replace(/[()]/g, "").split(",").includes(String(cell))) return false;
    if (op === "gte" && !(String(cell) >= val)) return false;
    if (op === "lte" && !(String(cell) <= val)) return false;
    if (op === "lt" && !(Number(cell) < Number(val))) return false;
  }
  return true;
}

function constraint(table: string, row: Row, existing: Row[]): boolean {
  if (table === "leads") return existing.some(r => (r.tenant_id ?? null) === (row.tenant_id ?? null) && r.email === row.email);
  if (table === "payments") return existing.some(r => r.provider === row.provider && r.provider_ref === row.provider_ref);
  if (table === "meetings") return existing.some(r => r.tenant_id == null && ["booked", "rescheduled"].includes(r.status) && r.start_at < row.end_at && r.end_at > row.start_at);
  return false;
}

function defaults(table: string, row: Row): Row {
  const base: Row = { id: uuid(), created_at: new Date().toISOString(), ...row };
  if (table === "meetings") base.status ??= "booked";
  if (table === "proposals") { base.access_token ??= uuid(); base.advance_pct ??= 10; base.advance_amount = Math.round(base.fixed_amount * base.advance_pct) / 100; }
  if (table === "newsletter_subscribers") { base.confirm_token ??= uuid(); base.status ??= "pending"; }
  return base;
}

async function fakeSupabase(url: URL, init: RequestInit): Promise<Response> {
  if (url.pathname === "/auth/v1/user") return Response.json({ id: "admin-1", email: "admin@ripepiper.com" });
  const table = url.pathname.replace("/rest/v1/", "");
  tables[table] ??= [];
  const t = tables[table], q = url.searchParams, method = init.method ?? "GET";
  const body = init.body ? JSON.parse(String(init.body)) : null;
  if (method === "GET") {
    let rows = t.filter(r => matches(r, q));
    if (table === "profiles") rows = [{ is_admin: true }];
    const lim = Number(q.get("limit") ?? 0);
    return Response.json(lim ? rows.slice(0, lim) : rows);
  }
  if (method === "POST") {
    const upsertKeys = q.get("on_conflict")?.split(",");
    const out: Row[] = [];
    for (const raw of Array.isArray(body) ? body : [body]) {
      if (upsertKeys) {
        const hit = t.find(r => upsertKeys.every(k => r[k] === raw[k]));
        if (hit) { Object.assign(hit, raw); out.push(hit); continue; }
      } else if (constraint(table, raw, t)) {
        return new Response(JSON.stringify({ code: table === "meetings" ? "23P01" : "23505" }), { status: 409 });
      }
      const r = defaults(table, raw); t.push(r); out.push(r);
    }
    return Response.json(out);
  }
  if (method === "PATCH") {
    const rows = t.filter(r => matches(r, q));
    rows.forEach(r => Object.assign(r, body));
    return Response.json(rows);
  }
  return new Response("unsupported", { status: 500 });
}

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.host === "challenges.cloudflare.com" && url.pathname.endsWith("/siteverify")) {
    const params = new URLSearchParams(String(init.body));
    return Response.json({ success: params.get("secret") === "turnstile-test-secret" && params.get("response") === "test-valid-token" });
  }
  if (url.host === "test.supabase.co") return fakeSupabase(url, init);
  if (url.host === "oauth2.googleapis.com") return Response.json({ access_token: "g-token", expires_in: 3600 });
  if (url.pathname.endsWith("/freeBusy")) return Response.json({ calendars: { primary: { busy: [] } } });
  if (url.pathname.includes("/calendar/v3/calendars/") && init.method === "POST") {
    const ev = JSON.parse(String(init.body)); calendarEvents.push(ev);
    return Response.json({ id: "evt_" + calendarEvents.length, hangoutLink: "https://meet.google.com/abc-defg-hij", conferenceData: { conferenceId: "abc-defg-hij", entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] } });
  }
  if (url.pathname.endsWith("/messages/send")) {
    const raw = atob(JSON.parse(String(init.body)).raw.replace(/-/g, "+").replace(/_/g, "/"));
    sentEmails.push({ to: /To: (.*)\r\n/.exec(raw)![1], raw }); return Response.json({ id: "m" });
  }
  if (url.host === "api.stripe.com") return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
  throw new Error("Unexpected fetch: " + url.href);
}

const env: any = {
  SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srv", SUPABASE_ANON_KEY: "anon",
  GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", GOOGLE_REFRESH_TOKEN: "r", GOOGLE_CALENDAR_ID: "primary",
  CRM_SHEET_ID: "sheet", MAIL_FROM: "Ripe Piper <hello@ripepiper.com>", ADMIN_ALERT_EMAIL: "founder@ripepiper.com",
  STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_test", TURNSTILE_SECRET: "turnstile-test-secret", SITE_URL: "https://ripepiper.com", AI_MODEL: "m",
};
const pending: Promise<unknown>[] = [];
const ctx: any = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} };
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(new Request("https://ripepiper.com" + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(path === "/api/lead" && body && typeof body === "object" ? { ...body as object, turnstile_token: "test-valid-token" } : body), redirect: "manual" }), env, ctx);

async function sign(secret: string, payload: string) {
  const t = Math.floor(Date.now() / 1000);
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${payload}`)))].map(b => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${s}`;
}

beforeEach(() => {
  tables = {}; sentEmails = []; calendarEvents = [];
  vi.stubGlobal("fetch", fakeFetch);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T04:00:00Z"));   // Monday 08:00 GST
});

describe("inquiry to booked call", () => {
  it("qualifies the lead, offers slots, books a Meet call and emails the confirmation", async () => {
    const r1 = await call("POST", "/api/lead", { name: "Sara Khan", email: "sara@gulfinteriors.ae", website: "gulfinteriors.ae", package: "revive", country: "United Arab Emirates", deal_band: 2, consent: true, utm_source: "linkedin" });
    const j1: any = await r1.json();
    expect(j1.route).toBe("calendar");
    expect(j1.slots[0].label).toBe("Mon 2 Nov, 10:00 GST");
    expect(tables.leads[0]).toMatchObject({ status: "qualified", utm_source: "linkedin", country: "AE" });

    const r2 = await call("POST", "/api/book", { lead_id: j1.lead_id, start: j1.slots[0].start });
    const j2: any = await r2.json();
    expect(j2.ok).toBe(true);
    expect(j2.meet_url).toBe("https://meet.google.com/abc-defg-hij");
    expect(calendarEvents[0].attendees[0].email).toBe("sara@gulfinteriors.ae");
    expect(tables.leads[0].status).toBe("meeting_booked");
    expect(sentEmails.some(e => e.to === "sara@gulfinteriors.ae")).toBe(true);

    // A second person cannot take the same slot.
    const other: any = await (await call("POST", "/api/lead", { name: "Raj", email: "raj@punetech.in", website: "punetech.in", package: "signal", country: "India", deal_band: 1, consent: true })).json();
    const r3 = await call("POST", "/api/book", { lead_id: other.lead_id, start: j1.slots[0].start });
    expect(r3.status).toBe(409);
  });

  it("routes Gmail users to the work-email step and small deals to 'not yet'", async () => {
    expect((await (await call("POST", "/api/lead", { name: "A", email: "a@gmail.com", website: "a.com", deal_band: 2, consent: true })).json() as any).route).toBe("work_email");
    expect((await (await call("POST", "/api/lead", { name: "B", email: "b@small.ae", website: "small.ae", deal_band: 0, consent: true })).json() as any).route).toBe("not_fit");
  });

  it("rejects a form without consent", async () => {
    const r = await call("POST", "/api/lead", { name: "C", email: "c@x.ae", website: "x.ae", deal_band: 2 });
    expect(r.status).toBe(400);
  });
});

describe("pre-proposal approval and 10% advance", () => {
  it("approves, pays through Stripe, creates the client account once", async () => {
    tables.leads = [{ id: "lead-1", tenant_id: null, email: "sara@gulfinteriors.ae", name: "Sara Khan", company: "Gulf Interiors", country: "AE", status: "meeting_held" }];
    tables.proposals = [defaults("proposals", { lead_id: "lead-1", kind: "pre", plan: "engine", package: "signal", currency: "AED", fixed_amount: 27500, content_md: "# Pre-proposal", client_email: "sara@gulfinteriors.ae", status: "sent" })];
    const p = tables.proposals[0];

    const approve = await call("POST", `/p/${p.access_token}/approve`);
    expect(approve.status).toBe(303);
    expect(approve.headers.get("Location")).toContain("checkout.stripe.com");
    expect(p.status).toBe("approved");

    const evt = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_1", payment_status: "paid", amount_total: 275000, currency: "aed", metadata: { proposal_id: p.id, quote_id: "" } } } });
    const bad = await call("POST", "/webhooks/stripe", evt, { "Stripe-Signature": "t=1,v1=00" });
    expect(bad.status).toBe(400);
    const ok = await call("POST", "/webhooks/stripe", evt, { "Stripe-Signature": await sign("whsec_test", evt) });
    expect(ok.status).toBe(200);

    expect(p.status).toBe("paid");
    expect(tables.tenants).toHaveLength(1);
    expect(tables.tenants[0]).toMatchObject({ name: "Gulf Interiors", currency: "AED", plan: "engine", package: "signal" });
    expect(tables.invites[0]).toMatchObject({ email: "sara@gulfinteriors.ae", role: "owner" });
    expect(tables.fees[0]).toMatchObject({ amount: 2750, type: "setup" });
    expect(tables.payments.find(x => x.provider_ref === "cs_test_1")!.status).toBe("paid");
    expect(tables.leads[0].status).toBe("won");

    // Stripe retries webhooks: a replay must not create a second client account or fee.
    await call("POST", "/webhooks/stripe", evt, { "Stripe-Signature": await sign("whsec_test", evt) });
    expect(tables.tenants).toHaveLength(1);
    expect(tables.fees).toHaveLength(1);
  });

  it("does not start work when the paid amount is less than the advance", async () => {
    tables.proposals = [defaults("proposals", { kind: "pre", plan: "sprint", package: "revive", currency: "AED", fixed_amount: 3500, content_md: "x", client_email: "c@d.ae", status: "approved" })];
    const p = tables.proposals[0];
    const evt = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_low", payment_status: "paid", amount_total: 1000, currency: "aed", metadata: { proposal_id: p.id } } } });
    await call("POST", "/webhooks/stripe", evt, { "Stripe-Signature": await sign("whsec_test", evt) });
    expect(p.status).toBe("approved");
    expect(tables.tenants ?? []).toHaveLength(0);
    expect(sentEmails.some(e => e.to === "founder@ripepiper.com" && e.raw.includes("expected 350 AED, received 10 AED"))).toBe(true);
  });
});

describe("reminders", () => {
  it("sends the 24-hour reminder once, even if the job runs twice", async () => {
    const { sendReminders } = await import("../src/jobs");
    tables.meetings = [{ id: "m1", status: "booked", start_at: "2026-11-03T04:00:00.000Z", end_at: "2026-11-03T04:15:00.000Z", attendee_email: "sara@gulfinteriors.ae", attendee_name: "Sara", meet_url: "https://meet.google.com/x", reminder_24h_at: null, reminder_1h_at: null }];
    expect((await sendReminders(env)).sent).toBe(1);
    expect((await sendReminders(env)).sent).toBe(0);
    expect(sentEmails.filter(e => e.to === "sara@gulfinteriors.ae")).toHaveLength(1);
  });
});
