import type { Env } from "../env";
import { Db } from "../lib/db";

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export const bad = (message: string, status = 400) => json({ ok: false, error: message }, status);

export const html = (body: string, status = 200, cache = "no-store") =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache } });

export async function readJson(req: Request): Promise<Record<string, any>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 64_000) throw new HttpError(413, "Request is too large.");
  try {
    const body = await req.text();
    if (body.length > 64_000) throw new HttpError(413, "Request is too large.");
    const value: unknown = JSON.parse(body);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new HttpError(400, "Request body must be an object.");
    return value as Record<string, any>;
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, "Request body must be JSON."); }
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Cloudflare Turnstile check. Skipped when no secret is configured (local development). */
export async function verifyTurnstile(env: Env & { TURNSTILE_SECRET?: string }, token: unknown, req: Request): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return env.SITE_URL.startsWith("http://localhost:") || env.SITE_URL.startsWith("http://127.0.0.1:");
  if (typeof token !== "string" || !token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: req.headers.get("CF-Connecting-IP") ?? "" }),
  });
  return ((await res.json()) as { success: boolean }).success === true;
}

/** Signed-in user from the portal or admin pages (Supabase access token in the Authorization header). */
export async function requireUser(req: Request, env: Env, admin = false) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in.");
  const user = await new Db(env).userFromToken(token);
  if (!user) throw new HttpError(401, "Your session has expired. Please sign in again.");
  if (admin && !user.is_admin) throw new HttpError(403, "This action is for administrators only.");
  return user;
}

export type Capability = "read" | "operate" | "approve";
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Platform-level routes only (billing, go-live, safety stops): never confers tenant content access. */
export const requirePlatformAdmin = (req: Request, env: Env) => requireUser(req, env, true);

/** Tenant authority via the single SQL predicate (tenant_access -> can_operate). Denied and missing are the same 404. */
export async function tenantAccess(env: Env, user: { id: string }, tenantId: string, capability: Capability) {
  if (!uuidRe.test(tenantId) || await new Db(env).rpc<boolean>("tenant_access", { p_tenant: tenantId.toLowerCase(), p_actor: user.id, p_capability: capability }) !== true)
    throw new HttpError(404, "Not found.");
}

export async function requireTenant(req: Request, env: Env, tenantId: string, capability: Capability) {
  const user = await requireUser(req, env);
  await tenantAccess(env, user, tenantId, capability);
  return user;
}

/** Client admin (memberships owner) or platform admin; everyone else gets the tenant 404. Returns which authority applies. */
export async function requireOwnerOrPlatformAdmin(req: Request, env: Env, tenantId: string) {
  const user = await requireUser(req, env);
  const owner = uuidRe.test(tenantId) && !!await new Db(env).one("memberships", `tenant_id=eq.${tenantId.toLowerCase()}&user_id=eq.${user.id}&role=eq.owner&select=user_id`);
  if (!owner && !user.is_admin) throw new HttpError(404, "Not found.");
  return { user, owner };
}
