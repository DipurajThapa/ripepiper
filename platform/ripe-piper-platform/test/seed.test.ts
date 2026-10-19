import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { renderMarkdown } from "../src/lib/blog";

it("seeds the two launch articles and they render as clean HTML", async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
  for (const f of ["0001_core.sql", "0002_security_and_views.sql", "0003_fx_rates.sql", "../seed.sql"]) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8"));
  }
  const rows = (await db.query<any>(`select slug, title, body_md from posts where status = 'published' order by slug`)).rows;
  expect(rows.map(r => r.slug)).toEqual(["cold-email-rules-uae-india", "reactivate-old-b2b-leads"]);
  for (const r of rows) {
    const html = renderMarkdown(r.body_md);
    expect(html).toContain("<h2 id=");
    expect(html).toContain("<table>");
    expect(html).not.toMatch(/<script|onerror=/i);
  }
});
