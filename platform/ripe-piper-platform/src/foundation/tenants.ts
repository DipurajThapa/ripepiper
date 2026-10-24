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

/** Explicit staff activation; never resumes a campaign or grants contact rights. */
export async function activateTenant(req: Request, env: Env, id: string) {
  const actor = await requireUser(req, env, true);
  const b = await readJson(req);
  const reason = cleanText(b.reason, 500);
  if (!["onboarding", "paused"].includes(b.expected_status) || !Number.isInteger(b.expected_version) || b.expected_version < 0 ||
      !Number.isInteger(b.brief_version) || b.brief_version < 1 || reason.length < 8)
    return bad("Load the current account and brief, and give a reason for activation or resumption.");
  try {
    const result = await new Db(env).rpc<{id:string;status:string;version:number;briefVersion:number}>("activate_tenant_execution", {
      p_tenant: id, p_actor: actor.id, p_status: b.expected_status, p_version: b.expected_version,
      p_brief: b.brief_version, p_reason: reason,
    });
    if (!result || result.id !== id || result.status !== "active" || result.version !== b.expected_version + 1 || result.briefVersion !== b.brief_version)
      return bad("Activation acknowledgement is uncertain. Reload the account before taking another action.", 503);
    return json({ok:true,tenant:result,delivery:"not_sent"});
  } catch (e) {
    if (e instanceof DbError) {
      if (e.body.includes("40001")) return bad("The account or brief changed. Reload before continuing.",409);
      if (e.body.includes("23503")) return bad("Client not found.",404);
      if (e.body.includes("22023") || e.body.includes("23514")) return bad("Activation requires an onboarding or paused account and a current reviewed business brief.",409);
    }
    throw e;
  }
}
