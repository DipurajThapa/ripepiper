// End-to-end flow through the real Worker code with simulated Supabase, Google, Stripe and Anthropic APIs:
// inquiry -> qualify -> slots -> book (Meet link + email) -> double-booking refused -> pre-proposal approve -> Stripe webhook
// -> tenant + owner invite + fee + activity log -> idempotent replay.
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/index";
import { syncSheet } from "../src/lib/sheets";
import { syncAds } from "../src/jobs";

type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let sentEmails: { to: string; raw: string }[];
let calendarEvents: Row[];
let rpcCalls: string[];
let rpcBodies: any[];
const uuid = () => crypto.randomUUID();

function matches(row: Row, query: URLSearchParams): boolean {
  for (const [k, v] of query) {
    if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    const cell = k.includes('->>') ? row[k.split('->>')[0]]?.[k.split('->>')[1]] : row[k];
    if (op === "eq" && String(cell) !== decodeURIComponent(val)) return false;
    if (op === "neq" && String(cell) === val) return false;
    if (op === "is" && val === "null" && cell != null) return false;
    if (op === "not" && val === "is.null" && cell == null) return false;
    if (op === "in" && !val.replace(/[()]/g, "").split(",").includes(String(cell))) return false;
    if (op === "gte" && !(String(cell) >= val)) return false;
    if (op === "gt" && !(String(cell) > val)) return false;
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
  if (url.pathname === "/auth/v1/user") return Response.json(init.headers && (init.headers as Record<string,string>).Authorization === "Bearer client-token"
    ? { id: "client-1", email: "client@example.invalid" } : { id: "admin-1", email: "admin@ripepiper.com" });
  if (url.pathname.startsWith("/rest/v1/rpc/")) { rpcCalls.push(url.pathname); const b=JSON.parse(String(init.body)); rpcBodies.push(b); return Response.json(url.pathname.endsWith("/claim_fenced_synthetic_action") ? {token:b.p_token,approvalVersion:1,assetVersion:1} : true); }
  const table = url.pathname.replace("/rest/v1/", "");
  tables[table] ??= [];
  const t = tables[table], q = url.searchParams, method = init.method ?? "GET";
  const body = init.body ? JSON.parse(String(init.body)) : null;
  if (method === "GET") {
    let rows = t.filter(r => matches(r, q));
    if (table === "profiles") rows = [{ is_admin: q.get("id") !== "eq.client-1" }];
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
    return Response.json({ ...ev, status: "confirmed", hangoutLink: "https://meet.google.com/abc-defg-hij", conferenceData: { conferenceId: "abc-defg-hij", entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] } });
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
  tables = {}; sentEmails = []; calendarEvents = []; rpcCalls = []; rpcBodies = []; delete env.GOOGLE_TENANT_CONNECTIONS;
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

    const r2 = await call("POST", "/api/book", { lead_id: j1.lead_id, booking_token: j1.booking_token, start: j1.slots[0].start });
    const j2: any = await r2.json();
    expect(j2.ok).toBe(true);
    expect(j2.meet_url).toBe("https://meet.google.com/abc-defg-hij");
    expect(calendarEvents[0].attendees[0].email).toBe("sara@gulfinteriors.ae");
    expect(tables.leads[0].status).toBe("meeting_booked");
    expect(sentEmails.some(e => e.to === "sara@gulfinteriors.ae")).toBe(true);

    // A second person cannot take the same slot.
    const other: any = await (await call("POST", "/api/lead", { name: "Raj", email: "raj@punetech.in", website: "punetech.in", package: "signal", country: "India", deal_band: 1, consent: true })).json();
    const r3 = await call("POST", "/api/book", { lead_id: other.lead_id, booking_token: other.booking_token, start: j1.slots[0].start });
    expect(r3.status).toBe(409);
  });

  it("returns a confirmed retry without provider calls or duplicate emails", async () => {
    const lead: any = await (await call("POST", "/api/lead", { name: "A", email: "a@first.ae", website: "first.ae", deal_band: 2, consent: true })).json();
    const request = { lead_id: lead.lead_id, booking_token: lead.booking_token, start: lead.slots[0].start };
    const first = await (await call("POST", "/api/book", request)).json();
    const fetchSpy = vi.fn(fakeFetch); vi.stubGlobal("fetch", fetchSpy);
    const emailCount = sentEmails.length;
    expect(await (await call("POST", "/api/book", request)).json()).toEqual(first);
    expect(fetchSpy.mock.calls.every(([url]) => new URL(String(url)).host === "test.supabase.co")).toBe(true);
    expect(calendarEvents).toHaveLength(1); expect(sentEmails).toHaveLength(emailCount);
    // Also recover when confirmation persisted but the lead-status update did not.
    tables.leads[0].status = "qualified";
    expect((await call("POST", "/api/book", request)).status).toBe(200);
    tables.meetings[0].meet_url = null;
    expect((await call("POST", "/api/book", request)).status).toBe(503);
  });

  it("does not expose cancelled, tenant-owned, changed-attendee or expired retry details", async () => {
    const lead: any = await (await call("POST", "/api/lead", { name: "A", email: "a@first.ae", website: "first.ae", deal_band: 2, consent: true })).json();
    const request = { lead_id: lead.lead_id, booking_token: lead.booking_token, start: lead.slots[0].start };
    await call("POST", "/api/book", request);
    const meeting = tables.meetings[0];
    for (const patch of [{ status: "cancelled" }, { tenant_id: uuid() }, { attendee_email: "other@example.invalid" }]) {
      const original = { ...meeting }; Object.assign(meeting, patch);
      expect((await call("POST", "/api/book", request)).status).toBe(403);
      for (const key of Object.keys(patch)) delete meeting[key];
      Object.assign(meeting, original);
    }
    vi.setSystemTime(new Date("2026-11-02T04:16:00Z"));
    expect((await call("POST", "/api/book", request)).status).toBe(403);
    expect(calendarEvents).toHaveLength(1);
  });

  it("routes Gmail users to the work-email step and small deals to 'not yet'", async () => {
    expect((await (await call("POST", "/api/lead", { name: "A", email: "a@gmail.com", website: "a.com", deal_band: 2, consent: true })).json() as any).route).toBe("work_email");
    expect((await (await call("POST", "/api/lead", { name: "B", email: "b@small.ae", website: "small.ae", deal_band: 0, consent: true })).json() as any).route).toBe("not_fit");
  });

  it("rejects a form without consent", async () => {
    const r = await call("POST", "/api/lead", { name: "C", email: "c@x.ae", website: "x.ae", deal_band: 2 });
    expect(r.status).toBe(400);
  });
  it("rejects guessed UUIDs, a foreign lead token, and already-used consultation capability", async () => {
    const a: any = await (await call("POST", "/api/lead", { name: "A", email: "a@first.ae", website: "first.ae", deal_band: 2, consent: true })).json();
    const b: any = await (await call("POST", "/api/lead", { name: "B", email: "b@second.ae", website: "second.ae", deal_band: 2, consent: true })).json();
    const start = a.slots[0].start;
    expect((await call("POST", "/api/book", { lead_id: a.lead_id, start })).status).toBe(403);
    expect((await call("POST", "/api/book", { lead_id: a.lead_id, booking_token: b.booking_token, start })).status).toBe(403);
    expect((await call("POST", "/api/book", { lead_id: a.lead_id, booking_token: a.booking_token, start })).status).toBe(200);
    expect((await call("POST", "/api/book", { lead_id: a.lead_id, booking_token: a.booking_token, start: a.slots[1].start })).status).toBe(403);
    expect(calendarEvents).toHaveLength(1);
    const again: any = await (await call("POST", "/api/lead", { name: "A", email: "a@first.ae", website: "first.ae", deal_band: 2, consent: true })).json();
    expect(again.route).toBe("already_booked");
    expect(again.booking_token).toBeUndefined();
    expect(tables.leads[0].status).toBe("meeting_booked");
  });
  it("rejects expired or ineligible lead tokens before provider side effects", async () => {
    const a: any = await (await call("POST", "/api/lead", { name: "A", email: "a@first.ae", website: "first.ae", deal_band: 2, consent: true })).json();
    vi.setSystemTime(new Date("2026-11-02T04:16:00Z"));
    expect((await call("POST", "/api/book", { lead_id: a.lead_id, booking_token: a.booking_token, start: a.slots[0].start })).status).toBe(403);
    vi.setSystemTime(new Date("2026-11-02T04:00:00Z"));
    tables.leads[0].status = "new";
    expect((await call("POST", "/api/book", { lead_id: a.lead_id, booking_token: a.booking_token, start: a.slots[0].start })).status).toBe(403);
    expect(calendarEvents).toHaveLength(0);
  });
});

describe("staff data request intake", () => {
  it("rejects unsigned and malformed requests, and records a scoped synthetic case without sending", async () => {
    const tenant = "11111111-1111-4111-8111-111111111111";
    const lead = "22222222-2222-4222-8222-222222222222";
    tables.leads = [{ id: lead, tenant_id: tenant, email: "fixture@example.invalid" }];
    const body = { tenant_id: tenant, lead_id: lead, kind: "object" };
    expect((await call("POST", "/api/admin/subject-requests", body)).status).toBe(401);
    expect((await call("POST", "/api/admin/subject-requests", { ...body, kind: "unknown" }, { Authorization: "Bearer test-admin" })).status).toBe(400);
    expect((await call("POST", "/api/admin/subject-requests", { ...body, tenant_id: "33333333-3333-4333-8333-333333333333" }, { Authorization: "Bearer test-admin" })).status).toBe(404);
    const res = await call("POST", "/api/admin/subject-requests", body, { Authorization: "Bearer test-admin" });
    expect(res.status).toBe(201);
    expect(tables.subject_requests).toMatchObject([{ tenant_id: tenant, lead_id: lead, kind: "object", state: "pending_verification" }]);
    expect(sentEmails).toHaveLength(0);
  });
});

describe("staff-managed client setup", () => {
  it("requires an administrator and prepares an inactive managed tenant without provider effects", async () => {
    const body = { name: "Synthetic Client", slug: "synthetic-client", country: "AE", currency: "AED", package: "revive" };
    expect((await call("POST", "/api/admin/tenants", body)).status).toBe(401);
    expect((await call("POST", "/api/admin/tenants", body, { Authorization: "Bearer client-token" })).status).toBe(403);
    expect((await call("POST", "/api/admin/tenants", { ...body, package: "invalid" }, { Authorization: "Bearer test-admin" })).status).toBe(400);
    const res = await call("POST", "/api/admin/tenants", body, { Authorization: "Bearer test-admin" });
    expect(res.status).toBe(201);
    expect(tables.tenants).toMatchObject([{ slug: "synthetic-client", ownership: "managed", status: "onboarding", package: "revive" }]);
    expect(sentEmails).toHaveLength(0);
    expect(calendarEvents).toHaveLength(0);
  });
  it("redeems invitations only through an authenticated portal and blocks invites for paused tenants", async () => {
    const tenant = "11111111-1111-4111-8111-111111111111";
    tables.tenants = [{ id: tenant, status: 'onboarding' }];
    expect((await call("POST", "/api/portal/accept-invites")).status).toBe(401);
    const accepted = await call("POST", "/api/portal/accept-invites", {}, { Authorization: "Bearer client-token" });
    expect(accepted.status).toBe(200);
    expect(rpcCalls).toEqual(["/rest/v1/rpc/accept_verified_invites"]);
    const invite = `/api/admin/tenants/${tenant}/invite`;
    expect((await call("POST", invite, { email: "new@example.invalid" })).status).toBe(401);
    expect((await call("POST", invite, { email: "new@example.invalid" }, { Authorization: "Bearer client-token" })).status).toBe(403);
    expect((await call("POST", invite, { email: "new@example.invalid", role: "garbage" }, { Authorization: "Bearer test-admin" })).status).toBe(400);
    tables.tenants[0].status = 'paused';
    expect((await call("POST", invite, { email: "new@example.invalid", role: "viewer" }, { Authorization: "Bearer test-admin" })).status).toBe(409);
    expect(tables.invites || []).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });
  it("requires staff and a reason to pause, with no provider traffic", async () => {
    const path = "/api/admin/tenants/11111111-1111-4111-8111-111111111111/pause";
    expect((await call("POST", path, { reason: "Staff pause review" })).status).toBe(401);
    expect((await call("POST", path, { reason: "Staff pause review" }, { Authorization: "Bearer client-token" })).status).toBe(403);
    expect((await call("POST", path, { reason: "short" }, { Authorization: "Bearer test-admin" })).status).toBe(400);
    const result = await call("POST", path, { reason: "Staff pause review" }, { Authorization: "Bearer test-admin" });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, status: "paused" });
    expect(rpcCalls).toEqual(["/rest/v1/rpc/pause_tenant_execution"]);
    expect(sentEmails).toHaveLength(0);
    expect(calendarEvents).toHaveLength(0);
  });
  it("skips stale ad connections for a paused tenant before contacting a provider", async () => {
    const tenant = "11111111-1111-4111-8111-111111111111";
    tables.tenants = [{ id: tenant, status: "paused", currency: "AED" }];
    tables.ad_accounts = [{ id: "22222222-2222-4222-8222-222222222222", tenant_id: tenant, platform: "google_ads", account_ref: "fixture", status: "connected" }];
    const result = await syncAds(env, 1);
    expect(result).toEqual({ accounts: 1, rows: 0, errors: 0 });
    expect(tables.ad_accounts[0].status).toBe("connected");
    expect(sentEmails).toHaveLength(0);
  });
});

describe("synthetic action endpoint", () => {
  it("fails closed without an admin session or explicit test-sink flag", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect((await call("POST", `/api/admin/actions/${id}/test`)).status).toBe(401);
    expect((await call("POST", `/api/admin/actions/${id}/test`, {}, { Authorization: "Bearer client-token" })).status).toBe(403);
    expect((await call("POST", `/api/admin/actions/${id}/test`, {}, { Authorization: "Bearer test-admin" })).status).toBe(403);
    expect(sentEmails).toHaveLength(0);
  });
  it("calls only fenced database claim and test-sink completion when explicitly enabled", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    env.SYNTHETIC_SINK_ENABLED = "true";
    tables.outbound_actions=[{id,tenant_id:"22222222-2222-4222-8222-222222222222",state:"queued"}];
    try {
      const res = await call("POST", `/api/admin/actions/${id}/test`, {}, { Authorization: "Bearer test-admin" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, state: "tested", action_id: id });
      expect(rpcCalls).toEqual(["/rest/v1/rpc/claim_fenced_synthetic_action", "/rest/v1/rpc/complete_fenced_synthetic_action"]);
      expect(sentEmails).toHaveLength(0);
      expect(calendarEvents).toHaveLength(0);
    } finally { delete env.SYNTHETIC_SINK_ENABLED; }
  });
});

describe("pre-proposal approval and 10% advance", () => {
  it("approves, pays through Stripe, creates the client account once", async () => {
    tables.leads = [{ id: "lead-1", tenant_id: null, email: "sara@gulfinteriors.ae", name: "Sara Khan", company: "Gulf Interiors", country: "AE", status: "meeting_held" }];
    tables.proposals = [defaults("proposals", { lead_id: "lead-1", kind: "pre", plan: "engine", package: "signal", currency: "AED", fixed_amount: 27500, content_md: "# Pre-proposal", client_email: "sara@gulfinteriors.ae", status: "sent" })];
    const p = tables.proposals[0];

    expect((await call("GET", `/p/${p.access_token}/approve`)).status).toBe(404);
    expect(p.status).toBe("sent");
    expect(tables.payments || []).toHaveLength(0);

    const approve = await call("POST", `/p/${p.access_token}/approve`);
    expect(approve.status).toBe(303);
    expect(approve.headers.get("Location")).toContain("checkout.stripe.com");
    expect(p.status).toBe("approved");
    const approvedPage = await call("GET", `/p/${p.access_token}`);
    expect(await approvedPage.text()).toContain('method="post"');

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

describe("quotation checkout resilience", () => {
  it("keeps a sent quotation open when Stripe checkout creation fails", async () => {
    tables.quotes = [defaults("quotes", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", proposal_id: "proposal-1", tenant_id: "tenant-1", status: "sent", currency: "AED", total: 500 })];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.host === "api.stripe.com") return Promise.resolve(Response.json({ error: { message: "Checkout temporarily unavailable" } }, { status: 503 }));
      return fakeFetch(input, init);
    });
    const res = await call("POST", "/api/portal/quotes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/accept", undefined, { Authorization: "Bearer simulated-admin-token" });
    expect(res.status).toBe(500);
    expect(tables.quotes[0].status).toBe("sent");
    expect(tables.payments ?? []).toHaveLength(0);
  });
});

describe("reminders", () => {
  it("sends the 24-hour reminder once, even if the job runs twice", async () => {
    const { sendReminders } = await import("../src/jobs");
    tables.meetings = [{ id: "m1", status: "booked", start_at: "2026-11-03T04:00:00.000Z", end_at: "2026-11-03T04:15:00.000Z", attendee_email: "sara@gulfinteriors.ae", attendee_name: "Sara", google_event_id: "evt_test", meet_url: "https://meet.google.com/abc-defg-hij", reminder_24h_at: null, reminder_1h_at: null }];
    expect((await sendReminders(env)).sent).toBe(1);
    expect((await sendReminders(env)).sent).toBe(0);
    expect(sentEmails.filter(e => e.to === "sara@gulfinteriors.ae")).toHaveLength(1);
  });
});

describe('staff business brief and cited shortlist',()=>{
  it('links stored brief and same-tenant evidence to assessment without any model or provider call',async()=>{
    const tenant='11111111-1111-4111-8111-111111111111',lead='22222222-2222-4222-8222-222222222222';
    const root=`/api/admin/tenants/${tenant}`;
    const headers={Authorization:'Bearer test-admin'};
    const brief={offer:'Synthetic revive offer',industries:['construction'],markets:['AE'],roles:['owner'],needs:['dormant leads'],excludedIndustries:[],maxAgeDays:90,
      source:{reference:'interview:fixture-brief',excerpt:'Synthetic reviewed brief',observedAt:'2026-10-22T00:00:00Z'}};
    tables.tenants=[{id:tenant,status:'onboarding'}];
    tables.leads=[{id:lead,tenant_id:tenant,email:'fixture@example.invalid',company:'Synthetic customer',status:'new'}];
    expect((await call('POST',root+'/brief',{brief,expected_version:0})).status).toBe(401);
    expect((await call('POST',root+'/brief',{brief,expected_version:0},{Authorization:'Bearer client-token'})).status).toBe(403);
    expect((await call('POST',root+'/brief',{brief:{...brief,markets:[]},expected_version:0},headers)).status).toBe(400);
    expect((await call('POST',root+'/brief',{brief,expected_version:0},headers)).status).toBe(200);
    tables.business_briefs=[{tenant_id:tenant,version:1,body:brief}];
    const evidence={lead_id:lead,source:'client interview',reference:'interview:fixture-lead',rights_reference:'synthetic-only',observed_at:'2026-10-22T00:00:00Z',synthetic:true,
      facts:{industry:'construction',market:'AE',role:'owner',need:'dormant leads'},excerpt:'construction / AE / owner / dormant leads'};
    expect((await call('POST',root+'/prospect-evidence',{...evidence,lead_id:'33333333-3333-4333-8333-333333333333'},headers)).status).toBe(404);
    expect((await call('POST',root+'/prospect-evidence',evidence,headers)).status).toBe(201);
    expect(tables.lead_observations[0].assessment_reviewed_by).toBe('admin-1');
    const response=await call('POST',root+'/shortlist',{synthetic:true},headers);
    expect(response.status).toBe(200);
    const result:any=await response.json();
    expect(result.brief.version).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({leadId:lead,state:'candidate',contactAllowed:false});
    expect(result.results[0].fields[0].evidence[0].reference).toBe('interview:fixture-lead');
    tables.lead_suppression=[{tenant_id:tenant,lead_id:lead}];
    const stopped:any=await (await call('POST',root+'/shortlist',{synthetic:true},headers)).json();
    expect(stopped.results[0].state).toBe('excluded');
    expect(sentEmails).toHaveLength(0);expect(calendarEvents).toHaveLength(0);
  });
});

describe('managed product API boundaries',()=>{
 const tenant='11111111-1111-4111-8111-111111111111',lead='22222222-2222-4222-8222-222222222222';
 const root=`/api/admin/tenants/${tenant}`,headers={Authorization:'Bearer test-admin'};
 const payload={lead_id:lead,reference:'fixture-message',rights_reference:'fixture-purpose',excerpt:'Reviewed reply',observed_at:'2026-10-22T00:00:00Z',synthetic:true,
 context:{product:'response',kind:'reply',threadRef:'fixture-thread',disposition:'interested',need:'',authority:'',timing:''}};
 it('requires staff, correct tenant identity and evidence mode before recording a product event',async()=>{
  tables.leads=[{id:lead,tenant_id:tenant,email:'fixture@example.invalid',status:'new'}];
  expect((await call('POST',root+'/product-event',payload)).status).toBe(401);
  expect((await call('POST',root+'/product-event',payload,{Authorization:'Bearer client-token'})).status).toBe(403);
  expect((await call('POST',root+'/product-event',{...payload,lead_id:tenant},headers)).status).toBe(404);
  expect((await call('POST',root+'/product-event',{...payload,synthetic:false},headers)).status).toBe(400);
  expect((await call('POST',root+'/product-event',{...payload,context:{...payload.context,product:'revive'}},headers)).status).toBe(400);
  expect((await call('POST',root+'/product-event',payload,headers)).status).toBe(201);
  expect(rpcCalls.filter(p=>p.endsWith('/record_product_event'))).toHaveLength(1);
  expect(sentEmails).toHaveLength(0);expect(calendarEvents).toHaveLength(0);
 });
 it('requires outcome evidence from the same tenant, lead, mode, reference and observation time',async()=>{
  tables.leads=[{id:lead,tenant_id:tenant,email:'fixture@example.invalid'}];
  const context={product:'response',kind:'outcome',outcome:'meeting_held',reason:'Verified by owner',threadRef:'fixture-thread'};
  const request={...payload,context};
  expect((await call('POST',root+'/product-event',{...request,context:{...context,threadRef:undefined}},headers)).status).toBe(400);
  expect((await call('POST',root+'/product-event',request,headers)).status).toBe(409);
  const source={id:'source',tenant_id:tenant,lead_id:lead,synthetic:true,assessment_reviewed_by:'admin',observed_at:payload.observed_at,product_context:payload.context};
  for(const patch of [{tenant_id:lead},{lead_id:tenant},{synthetic:false},{assessment_reviewed_by:null},{observed_at:'2026-10-23T00:00:00Z'},{product_context:{...payload.context,threadRef:'different'}}]){
   tables.lead_observations=[{...source,...patch}];
   expect((await call('POST',root+'/product-event',request,headers)).status).toBe(409);
  }
  expect(rpcCalls).toHaveLength(0);
  tables.lead_observations=[source];
  expect((await call('POST',root+'/product-event',request,headers)).status).toBe(201);
  expect(rpcBodies[0].p_context.threadRef).toBe('fixture-thread');
  expect(sentEmails).toHaveLength(0);expect(calendarEvents).toHaveLength(0);
 });
 it('shows standalone product review without requiring a business brief or another product',async()=>{
  tables.tenants=[{id:tenant}];tables.leads=[{id:lead,tenant_id:tenant,email:'fixture@example.invalid',status:'new'}];
  tables.lead_observations=[{id:'fixture',tenant_id:tenant,lead_id:lead,synthetic:true,observed_at:payload.observed_at,assessment_reviewed_by:'admin',product_context:payload.context,assessment_facts:{}}];
  const result:any=await (await call('POST',root+'/shortlist',{synthetic:true},headers)).json();
  expect(result.brief).toBeNull();expect(result.results[0].state).toBe('unknown');
  expect(result.results[0].products.find((p:any)=>p.product==='response')).toMatchObject({state:'interested',contactAllowed:false,bookingAvailable:false});
 });
 it('rejects bad import rows individually and makes no provider calls',async()=>{
  tables.tenants=[{id:tenant}];
  const r=await call('POST',root+'/prospect-import',{synthetic:true,rows:[{email:'valid@example.invalid',company:'Fixture',reference:'source-1',rights_reference:'fixture-purpose',observed_at:payload.observed_at},{email:'bad'},{}]},headers);
  const result:any=await r.json();expect(r.status).toBe(200);expect(result.results.slice(1).every((r:any)=>r.state==='rejected')).toBe(true);
  expect(rpcCalls.filter(p=>p.endsWith('/import_review_lead'))).toHaveLength(1);
  expect(sentEmails).toHaveLength(0);expect(calendarEvents).toHaveLength(0);
 });
});

it('tenant imports cannot leak into the legacy public-intake Google Sheet',async()=>{
 tables.leads=[{id:'tenant-lead',tenant_id:'tenant-a',email:'fixture@example.invalid'}];
 tables.sheet_outbox=[{id:1,entity:'lead',entity_id:'tenant-lead',attempts:0,synced_at:null}];
 expect(await syncSheet(env)).toEqual({synced:1,failed:0});
 expect(sentEmails).toHaveLength(0);
});

it('unexpected database failures cannot expose source payloads in request logs',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 const secret='private-source-and-contact@example.invalid';
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({message:secret,details:secret}),{status:500}));
 try{
  const response=await call('POST','/api/admin/tenants/11111111-1111-4111-8111-111111111111/shortlist',{synthetic:true},{Authorization:'Bearer test-admin'});
  // Auth failure itself is rejected without passing untrusted provider text into logs.
  expect(response.status).toBe(401);
  vi.stubGlobal('fetch',async(input:any,init:any)=>String(input).includes('/auth/v1/user')||String(input).includes('/profiles?') ? fakeFetch(input,init) : new Response(JSON.stringify({message:secret,details:secret}),{status:500}));
  const failure=await call('POST','/api/admin/tenants/11111111-1111-4111-8111-111111111111/shortlist',{synthetic:true},{Authorization:'Bearer test-admin'});
  expect(failure.status).toBe(500);expect(JSON.stringify(log.mock.calls)).not.toContain(secret);expect(await failure.text()).not.toContain(secret);
  expect(log).toHaveBeenCalledWith('request_failed',expect.objectContaining({status:500}));
 }finally{log.mockRestore();}
});

it('campaign HTTP operations require staff, a loaded version and an enabled synthetic sink',async()=>{
 const tenant='11111111-1111-4111-8111-111111111111',campaign='22222222-2222-4222-8222-222222222222',path=`/api/admin/tenants/${tenant}/campaigns`;
 tables.tenants=[{id:tenant}];
 expect((await call('POST',path,{operation:'list'})).status).toBe(401);
 expect((await call('POST',path,{operation:'list'},{Authorization:'Bearer client-token'})).status).toBe(403);
 const headers={Authorization:'Bearer test-admin'};
 expect((await call('POST',path,{operation:'save',campaign_id:campaign,version:0,body:{steps:[]}},headers)).status).toBe(400);
 expect((await call('POST',path,{operation:'queue',campaign_id:campaign,version:1,body:{}},headers)).status).toBe(403);
 expect((await call('POST',path,{operation:'list'},headers)).status).toBe(200);
 expect((await call('POST',path,{operation:'save',campaign_id:campaign,version:0,body:{product:'revive',purpose:'reactivation',market:'AE',timezone:'UTC',steps:[{offsetHours:0,subject:'Fixture',body:'Is this a priority?',evidenceReference:'fixture-1'}]}},headers)).status).toBe(200);
 expect(rpcCalls.filter(p=>p.endsWith('/manage_campaign_plan'))).toHaveLength(1);expect(sentEmails).toHaveLength(0);
});

describe('calendar integration recovery',()=>{
 const inquiry=async()=> (await (await call('POST','/api/lead',{name:'Fixture',email:'calendar@example.invalid',website:'fixture.example',package:'revive',country:'United Arab Emirates',deal_band:2,consent:true})).json()) as any;
 it('keeps an uncertain reservation, blocks duplicate booking, and reconciles with a read only',async()=>{
  const lead=await inquiry();let ready=false;
  vi.stubGlobal('fetch',async(input:RequestInfo|URL,init:RequestInit={})=>{
   const url=new URL(String(input));
   if(url.pathname.includes('/calendar/v3/calendars/')&&init.method==='POST'){
    await fakeFetch(input,init);throw Error('response lost after Google created event');
   }
   if(url.pathname.includes('/calendar/v3/calendars/')&&(!init.method||init.method==='GET'))return ready?Response.json({...calendarEvents[0],status:'confirmed',hangoutLink:'https://meet.google.com/abc-defg-hij'}):new Response('',{status:404});
   return fakeFetch(input,init);
  });
  const result=await call('POST','/api/book',{lead_id:lead.lead_id,booking_token:lead.booking_token,start:lead.slots[0].start});
  expect(result.status).toBe(503);expect(await result.json()).toMatchObject({ok:false});
  const m=tables.meetings[0];expect(m.status).toBe('booked');expect(m.google_event_id).toBe(calendarEvents[0].id);expect(m.meet_url).toBeUndefined();
  const slots:any=await (await call('GET','/api/slots')).json();expect(slots.slots.some((s:any)=>s.start===m.start_at)).toBe(false);
  expect((await call('POST','/api/book',{lead_id:lead.lead_id,booking_token:lead.booking_token,start:lead.slots[1].start})).status).toBe(403);
  const path='/api/admin/meetings/'+m.id+'/reconcile';
  expect((await call('POST',path,{})).status).toBe(401);
  expect((await call('POST',path,{}, {Authorization:'Bearer client-token'})).status).toBe(403);
  const staff={Authorization:'Bearer test-admin'};
  expect((await call('POST',path,{},staff)).status).toBe(409);
  ready=true;await Promise.all(pending);const emailsBefore=sentEmails.length;
  expect((await call('POST',path,{},staff)).status).toBe(200);expect(m.meet_url).toBe('https://meet.google.com/abc-defg-hij');
  expect(tables.leads[0].status).toBe('meeting_booked');expect((await call('POST',path,{},staff)).status).toBe(200);
  expect(sentEmails).toHaveLength(emailsBefore);expect(calendarEvents).toHaveLength(1);
  expect(tables.activity_log.at(-1)).toMatchObject({actor:'admin-1',visible_to_client:false});
  m.tenant_id='11111111-1111-4111-8111-111111111111';expect((await call('POST',path,{},staff)).status).toBe(404);
 });
 it('preserves a reservation when database persistence fails after Google succeeds',async()=>{
  const lead=await inquiry();vi.stubGlobal('fetch',async(input:RequestInfo|URL,init:RequestInit={})=>{
   if(String(input).includes('/rest/v1/meetings?')&&init.method==='PATCH')return new Response('DB offline',{status:503});
   return fakeFetch(input,init);
  });
  expect((await call('POST','/api/book',{lead_id:lead.lead_id,booking_token:lead.booking_token,start:lead.slots[0].start})).status).toBe(503);
  expect(tables.meetings[0].status).toBe('booked');expect(tables.meetings[0].google_event_id).toBe(calendarEvents[0].id);
  expect(sentEmails.filter(e=>e.to==='calendar@example.invalid')).toHaveLength(0);
 });
 it('offers no slots when the configured calendar is missing or reports an error',async()=>{
  vi.stubGlobal('fetch',async(input:RequestInfo|URL,init:RequestInit={})=>String(input).endsWith('/freeBusy')?Response.json({calendars:{primary:{errors:[{reason:'notFound'}],busy:[]}}}):fakeFetch(input,init));
  const response=await call('GET','/api/slots');expect(response.status).toBe(500);expect(await response.json()).not.toHaveProperty('slots');
 });
 it('does not send global-account reminders for tenant meetings or unconfirmed conferences',async()=>{
  const {sendReminders}=await import('../src/jobs');
  const base={status:'booked',start_at:'2026-11-03T04:00:00.000Z',end_at:'2026-11-03T04:15:00.000Z',attendee_email:'fixture@example.invalid',google_event_id:'rpfixture',reminder_24h_at:null};
  tables.meetings=[{...base,id:uuid(),meet_url:null},{...base,id:uuid(),tenant_id:uuid(),meet_url:'https://meet.google.com/abc-defg-hij'}];
  expect((await sendReminders(env)).sent).toBe(0);expect(sentEmails).toHaveLength(0);expect(tables.meetings.every(m=>m.reminder_24h_at===null)).toBe(true);
 });
});

it('does not repair a booking whose attendee changes during the provider read',async()=>{
 const id=uuid(),leadId=uuid();const m={id,lead_id:leadId,status:'booked',google_event_id:'rpfixture',start_at:'2026-11-03T04:00:00.000Z',end_at:'2026-11-03T04:15:00.000Z',attendee_email:'original@example.invalid',meet_url:null};tables.meetings=[m];
 vi.stubGlobal('fetch',async(input:RequestInfo|URL,init:RequestInit={})=>{
  if(String(input).includes('/calendar/v3/calendars/')){
   const event={id:m.google_event_id,status:'confirmed',extendedProperties:{private:{ripe_meeting_id:id}},start:{dateTime:m.start_at},end:{dateTime:m.end_at},attendees:[{email:m.attendee_email}],hangoutLink:'https://meet.google.com/abc-defg-hij'};
   m.attendee_email='changed@example.invalid';return Response.json(event);
  }
  return fakeFetch(input,init);
 });
 expect((await call('POST','/api/admin/meetings/'+id+'/reconcile',{}, {Authorization:'Bearer test-admin'})).status).toBe(409);expect(m.meet_url).toBeNull();expect(sentEmails).toHaveLength(0);expect(tables.activity_log ?? []).toHaveLength(0);
});

describe('tenant read-only inbox integration',()=>{
 const tenant='11111111-1111-4111-8111-111111111111',lead='22222222-2222-4222-8222-222222222222';
 const root='/api/admin/tenants/'+tenant+'/connection',staff={Authorization:'Bearer test-admin'};
 const binding=()=>({id:'33333333-3333-4333-8333-333333333333',tenantId:tenant,mailbox:'staff@example.invalid',calendarId:'calendar@example.invalid',purposeReference:'approved-selected-threads',enabled:true,expiresAt:'2026-12-01T00:00:00Z',clientId:'tenant-client',clientSecret:'tenant-secret',refreshToken:'tenant-refresh'});
 const message=()=>({id:'message1',threadId:'thread1',internalDate:String(Date.now()-1000),sizeEstimate:100,labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'contact@business.example'},{name:'To',value:'staff@example.invalid'},{name:'Subject',value:'Business question'}],body:{data:btoa('Could we discuss the service?')}}});
 function setup(hook?:(url:URL)=>void){
  tables.tenants=[{id:tenant,status:'active'}];tables.leads=[{id:lead,tenant_id:tenant,email:'contact@business.example'}];env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([binding()]);
  const calls:URL[]=[];
  vi.stubGlobal('fetch',async(input:RequestInfo|URL,init:RequestInit={})=>{
   const url=new URL(String(input));calls.push(url);hook?.(url);
   if(url.pathname.endsWith('/users/me/profile'))return Response.json({emailAddress:'staff@example.invalid'});
   if(url.pathname.includes('/calendarList/'))return Response.json({id:'calendar@example.invalid',accessRole:'reader'});
   if(url.pathname.endsWith('/users/me/messages'))return Response.json({messages:[{id:'message1'}]});
   if(url.pathname.endsWith('/messages/message1'))return Response.json(message());
   return fakeFetch(input,init);
  });return calls;
 }
 it('requires staff and an explicit active binding, without falling back to founder credentials',async()=>{
  const calls=setup();expect((await call('POST',root,{operation:'check'})).status).toBe(401);expect((await call('POST',root,{operation:'check'},{Authorization:'Bearer client-token'})).status).toBe(403);
  delete env.GOOGLE_TENANT_CONNECTIONS;
  expect(await (await call('POST',root,{operation:'check'},staff)).json()).toMatchObject({state:'not_connected',canRead:false,canSend:false});
  expect(calls.some(u=>u.host.endsWith('googleapis.com'))).toBe(false);
 });
 it('checks identity, lists metadata, previews and imports a reviewed source into the existing response RPC',async()=>{
  setup();expect(await (await call('POST',root,{operation:'check'},staff)).json()).toMatchObject({state:'identity_verified',canSend:false});
  const listed:any=await (await call('POST',root,{operation:'list',lead_id:lead},staff)).json();expect(listed.messages.items[0].id).toBe('message1');expect(listed.messages.items[0]).not.toHaveProperty('excerpt');
  const preview:any=await (await call('POST',root,{operation:'preview',lead_id:lead,message_id:'message1'},staff)).json();expect(preview.message.excerpt).toContain('Could we discuss');expect(rpcCalls).toHaveLength(0);
  const payload={operation:'import',lead_id:lead,message_id:'message1',reviewed:true,digest:preview.message.digest};
  expect((await call('POST',root,{...payload,digest:'changed'},staff)).status).toBe(409);expect(rpcCalls).toHaveLength(0);
  const imported=await call('POST',root,payload,staff);expect(imported.status).toBe(201);expect(await imported.json()).toMatchObject({delivery:'not_sent',reviewState:'human'});
  expect(rpcBodies[0]).toMatchObject({p_tenant:tenant,p_lead:lead,p_actor:'admin-1',p_synthetic:false,p_rights:'approved-selected-threads',p_reference:'gmail:33333333-3333-4333-8333-333333333333:message1',p_context:{product:'response',kind:'reply',disposition:'human',need:'',authority:'',timing:''}});
  expect(JSON.stringify(rpcBodies)).not.toContain('tenant-secret');expect(sentEmails).toHaveLength(0);expect(calendarEvents).toHaveLength(0);
 });
 it('does not read another tenant contact or a synthetic contact from the mailbox',async()=>{
  const calls=setup();tables.leads[0].tenant_id='44444444-4444-4444-8444-444444444444';expect((await call('POST',root,{operation:'list',lead_id:lead},staff)).status).toBe(404);
  tables.leads[0].tenant_id=tenant;tables.leads[0].email='fixture@example.invalid';expect((await call('POST',root,{operation:'list',lead_id:lead},staff)).status).toBe(400);expect(calls.some(u=>u.pathname.endsWith('/messages'))).toBe(false);
 });
 it.each(['paused','revoked'])('discards a provider result when connection becomes %s',async mode=>{
  setup(url=>{if(url.searchParams.get('format')==='full'){if(mode==='paused')tables.tenants[0].status='paused';else env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([{...binding(),enabled:false}]);}});
  const response=await call('POST',root,{operation:'preview',lead_id:lead,message_id:'message1'},staff);expect(response.status).toBe(409);expect(JSON.stringify(await response.json())).not.toContain('Could we discuss');expect(rpcCalls).toHaveLength(0);
 });
 it('blocks a refresh token connected to the wrong mailbox before reading any messages',async()=>{
  setup();env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([{...binding(),mailbox:'other@example.invalid'}]);
  const response=await call('POST',root,{operation:'list',lead_id:lead},staff);expect(response.status).toBe(409);expect(rpcCalls).toHaveLength(0);
 });
});
