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
});
