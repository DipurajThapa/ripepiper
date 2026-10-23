import type { Env } from "../env";
import { Db, DbError } from "../lib/db";
import { cleanText } from "../lib/validate";
import { bad, json, readJson, requireUser } from "../routes/http";

/** Staff-only preparation after a consultation. No activation or provider connection. */
export async function prepareTenant(req: Request, env: Env) {
  await requireUser(req, env, true);
  const b = await readJson(req);
  const name = cleanText(b.name, 160);
  const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase() : "";
  const country = b.country;
  const currency = b.currency;
  const pkg = b.package;
  if (!name || !/^[a-z0-9-]{2,60}$/.test(slug) || !["AE", "IN", "SA", "QA", "OTHER"].includes(country) ||
      !["AED", "INR"].includes(currency) || !["revive", "signal", "response", "events"].includes(pkg))
    return bad("Enter a name, slug, country, currency and selected capability.");
  try {
    const [row] = await new Db(env).insert<{ id: string; slug: string; status: string }>("tenants", {
      name, slug, country, currency, package: pkg, plan: "engine", ownership: "managed", status: "onboarding",
    });
    return json({ ok: true, tenant: { id: row.id, slug: row.slug, status: row.status } }, 201);
  } catch (e) {
    if (e instanceof DbError && e.isConflict) return bad("That tenant slug is already in use.", 409);
    throw e;
  }
}

/** Staff emergency stop, recorded in the tenant's durable execution state. */
export async function pauseTenant(req: Request, env: Env, id: string) {
  await requireUser(req, env, true);
  const body = await readJson(req);
  const reason = cleanText(body.reason, 500);
  if (reason.length < 8) return bad("Give a reason for pausing this client.");
  const paused = await new Db(env).rpc<boolean>("pause_tenant_execution", { p_tenant_id: id, p_reason: reason });
  if (!paused) return bad("Client not found or already ended.", 404);
  return json({ ok: true, status: "paused" });
}
