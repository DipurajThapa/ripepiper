// Runs the real migrations on an in-memory Postgres (PGlite) with a stub of Supabase's auth schema,
// then proves tenant isolation, admin access, booking overlap protection, dedupe and the KPI view maths.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
`;
const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const U1 = "00000000-0000-0000-0000-0000000000c1";
const U2 = "00000000-0000-0000-0000-0000000000c2";
let db: PGlite;
let T1 = "", T2 = "";

async function as(user: string, sql: string) {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub', '${user}', false);`);
  try { return (await db.query(sql)).rows as any[]; } finally { await db.exec(`reset role;`); }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(STUB);
  for (const f of ["0001_core.sql", "0002_security_and_views.sql"]) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8"));
  }
  T1 = (await db.query<any>(`insert into tenants (name, slug, country, currency, created_at) values ('Gulf Interiors','gulf-interiors','AE','AED', now() - interval '40 days') returning id`)).rows[0].id;
  T2 = (await db.query<any>(`insert into tenants (name, slug, country, currency) values ('Pune Tech','pune-tech','IN','INR') returning id`)).rows[0].id;
  await db.query(`insert into invites (tenant_id, email, role) values ($1, 'owner@gulfinteriors.ae', 'owner'), ($2, 'cfo.punetech@gmail.com', 'viewer')`, [T1, T2]);
  await db.exec(`insert into auth.users (id, email) values ('${ADMIN}','dipuraj@ripepiper.com'), ('${U1}','OWNER@gulfinteriors.ae'), ('${U2}','cfo.punetech@gmail.com');`);
  await db.exec(`update profiles set is_admin = true where id = '${ADMIN}';`);
  await db.query(`insert into leads (tenant_id, source, email, status) values ($1,'outreach','a@x.ae','qualified'), ($1,'outreach','b@x.ae','new'), ($2,'outreach','c@y.in','qualified'), (null,'book_form','prospect@z.com','new')`, [T1, T2]);
  await db.query(`insert into fees (tenant_id, month, type, amount, currency) values ($1, date_trunc('month', now()), 'retainer', 7500, 'AED')`, [T1]);
  await db.query(`insert into ad_metrics_daily (tenant_id, platform, day, campaign_ref, spend, currency) values ($1, 'google_ads', current_date, 'c1', 2500, 'AED')`, [T1]);
  await db.query(`insert into outreach_weekly (tenant_id, week_start, sent, delivered, replies, meetings_held) values ($1, current_date, 400, 390, 30, 4)`, [T1]);
  await db.query(`insert into deals (tenant_id, name, stage, value, currency, closed_at) values ($1, 'Office fit-out', 'won', 60000, 'AED', current_date), ($1, 'Warehouse', 'proposal', 90000, 'AED', null)`, [T1]);
});

describe("tenant isolation (row-level security)", () => {
  it("links invited users to their tenant on first sign-in, case-insensitively", async () => {
    const r = await db.query<any>(`select tenant_id, role from memberships where user_id = $1`, [U1]);
    expect(r.rows).toEqual([{ tenant_id: T1, role: "owner" }]);
  });
  it("a client sees only its own leads", async () => {
    const rows = await as(U1, `select email from leads order by email`);
    expect(rows.map(r => r.email)).toEqual(["a@x.ae", "b@x.ae"]);
  });
  it("a client never sees Ripe Piper's own pipeline", async () => {
    const rows = await as(U2, `select email from leads`);
    expect(rows.map(r => r.email)).toEqual(["c@y.in"]);
  });
  it("a client cannot read another tenant's dashboard", async () => {
    const rows = await as(U2, `select tenant_id from v_tenant_monthly`);
    expect(rows.every(r => r.tenant_id === T2)).toBe(true);
  });
  it("a viewer cannot change deals; an owner can", async () => {
    const before = await as(U2, `update deals set value = 1 returning id`);
    expect(before.length).toBe(0);
    const owner = await as(U1, `update deals set value = 61000 where name = 'Office fit-out' returning value`);
    expect(Number(owner[0].value)).toBe(61000);
    await db.query(`update deals set value = 60000 where name = 'Office fit-out'`);
  });
  it("the admin sees every lead", async () => {
    const rows = await as(ADMIN, `select count(*)::int n from leads`);
    expect(rows[0].n).toBe(4);
  });
  it("anonymous visitors read only published posts", async () => {
    await db.query(`insert into posts (slug, title, description, body_md, status, published_at) values ('live-post','Live','d','b','published', now()), ('draft-post','Draft','d','b','draft', null)`);
    await db.exec(`set role anon;`);
    const r = await db.query<any>(`select slug from posts`);
    await db.exec(`reset role;`);
    expect(r.rows.map(x => x.slug)).toEqual(["live-post"]);
  });
});

describe("data rules", () => {
  it("rejects a duplicate lead email in the same pipeline", async () => {
    await expect(db.query(`insert into leads (tenant_id, source, email) values ($1,'outreach','A@X.AE')`, [T1])).rejects.toThrow();
  });
  it("prevents two overlapping sales calls", async () => {
    await db.query(`insert into meetings (start_at, end_at, attendee_email) values ('2026-11-02 10:00+04','2026-11-02 10:15+04','one@a.com')`);
    await expect(db.query(`insert into meetings (start_at, end_at, attendee_email) values ('2026-11-02 10:10+04','2026-11-02 10:25+04','two@b.com')`)).rejects.toThrow();
  });
  it("calculates the 10% advance from the fixed price", async () => {
    const r = await db.query<any>(`insert into proposals (kind, plan, package, currency, fixed_amount, content_md, client_email) values ('pre','engine','signal','AED', 12500, 'x', 'c@d.com') returning advance_amount`);
    expect(Number(r.rows[0].advance_amount)).toBe(1250);
  });
  it("queues every new lead for the Google Sheet CRM", async () => {
    const r = await db.query<any>(`select count(*)::int n from sheet_outbox where entity = 'lead'`);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(4);
  });
});

describe("dashboard maths", () => {
  it("computes cost per meeting and ROI for the current month", async () => {
    const rows = await as(U1, `select fees, ad_spend, total_cost, cost_per_meeting, won_revenue, roi_pct, reply_rate_pct from v_tenant_monthly where month = date_trunc('month', now())::date`);
    const m = rows[0];
    expect(Number(m.total_cost)).toBe(10000);            // 7,500 fees + 2,500 ad spend
    expect(Number(m.cost_per_meeting)).toBe(2500);       // 10,000 / 4 meetings held
    expect(Number(m.roi_pct)).toBe(500);                 // (60,000 - 10,000) / 10,000
    expect(Number(m.reply_rate_pct)).toBeCloseTo(7.69, 2);
  });
});
