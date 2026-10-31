import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// Production has the three initial 20261019 migrations. The fixture here models
// their repository equivalents and rehearses every later migration in order.
// Never connect this test to a remote database or import operational customer data.
const directory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const files = readdirSync(directory).filter(f => f.endsWith(".sql")).sort();
const initial = ["0001_core.sql", "0002_security_and_views.sql", "0003_fx_rates.sql"];
const subsequent = files.filter(f => !initial.includes(f));
const stub = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`;

describe("production-baseline-to-head schema rehearsal (isolated PGlite)", () => {
  it("upgrades an empty baseline in order without provisioning a real tenant", async () => {
    const db = new PGlite({ extensions: { btree_gist } });
    try {
      expect(initial.every(f => files.includes(f))).toBe(true);
      expect(subsequent.length).toBeGreaterThan(0);
      await db.exec(stub);
      for (const file of initial) await db.exec(readFileSync(join(directory, file), "utf8"));
      expect((await db.query("select count(*)::int as n from tenants")).rows[0]).toEqual({ n: 0 });
      for (const file of subsequent) {
        try { await db.exec(readFileSync(join(directory, file), "utf8")); }
        catch (error) { throw new Error(`Migration rehearsal failed: ${file}: ${String(error)}`); }
      }
      expect((await db.query("select count(*)::int as n from tenants")).rows[0]).toEqual({ n: 0 });
      const tables = (await db.query<{tablename: string}>("select tablename from pg_tables where schemaname='public'")).rows.map(x => x.tablename);
      for (const name of ["tenants", "leads", "contact_rights", "campaigns", "outbound_actions", "lead_observations"]) expect(tables).toContain(name);
      const protectedTables = (await db.query<{relname:string, relrowsecurity:boolean}>(
        "select relname, relrowsecurity from pg_class where relname = any(array['tenants','leads','contact_rights','campaigns','outbound_actions'])"
      )).rows;
      expect(protectedTables).toHaveLength(5);
      expect(protectedTables.every(x => x.relrowsecurity)).toBe(true);
    } finally { await db.close(); }
  });
  it("backfills the Google pilot into the connection registry with its version and status", async () => {
    const db = new PGlite({ extensions: { btree_gist } });
    try {
      await db.exec(stub);
      const registry = "20261101000004_tenant_connections.sql";
      for (const file of files.filter(f => f < registry)) await db.exec(readFileSync(join(directory, file), "utf8"));
      const actor = "11111111-1111-4111-8111-111111111111", live = "22222222-2222-4222-8222-222222222222", gone = "33333333-3333-4333-8333-333333333333";
      await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'staff@example.invalid',now())", [actor]);
      const tenants = (await db.query<{id:string}>("insert into tenants(name,slug,country,currency,status) values('Upgrade A','upgrade-a','AE','AED','active'),('Upgrade B','upgrade-b','AE','AED','active') returning id")).rows.map(r => r.id);
      await db.query(`insert into tenant_google_authority(tenant_id,connection_id,version,binding_hash,mailbox,calendar_id,purpose_reference,expires_at,verified_at,verified_by) values($1,$2,1,$3,'a@example.invalid','cal-a','pilot',now()+interval '1 day',now(),$4),($5,$6,1,$3,'b@example.invalid','cal-b','pilot',now()+interval '1 day',now(),$4)`, [tenants[0], live, "a".repeat(64), actor, tenants[1], gone]);
      // Pre-upgrade history: A re-verified twice (version 3), B revoked (version 2).
      await db.query("update tenant_google_authority set version=version+1 where tenant_id=$1", [tenants[0]]);
      await db.query("update tenant_google_authority set version=version+1 where tenant_id=$1", [tenants[0]]);
      await db.query("update tenant_google_authority set version=version+1,revoked=true where tenant_id=$1", [tenants[1]]);
      for (const file of files.filter(f => f >= registry)) await db.exec(readFileSync(join(directory, file), "utf8"));
      const rows = (await db.query<any>("select tenant_id,account_identity,status,version,purposes from tenant_connections order by account_identity")).rows;
      expect(rows).toEqual([
        { tenant_id: tenants[0], account_identity: "a@example.invalid", status: "connected", version: 3, purposes: ["mail_read", "calendar"] },
        { tenant_id: tenants[1], account_identity: "b@example.invalid", status: "revoked", version: 2, purposes: ["mail_read", "calendar"] },
      ]);
      // After the upgrade the next pilot write moves the registry forward by exactly one.
      await db.query("update tenant_google_authority set version=version+1,revoked=true where tenant_id=$1", [tenants[0]]);
      expect((await db.query<any>("select status,version from tenant_connections where tenant_id=$1", [tenants[0]])).rows[0]).toEqual({ status: "revoked", version: 4 });
      expect((await db.query<any>("select count(*)::int n from ripepiper_private.tenant_connection_secrets")).rows[0].n).toBe(0);
    } finally { await db.close(); }
  });
});
