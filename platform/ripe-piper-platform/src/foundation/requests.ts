import type { Env } from "../env";
import { Db } from "../lib/db";
import { bad, json, readJson, requireUser } from "../routes/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(["access", "correct", "object", "erase", "restrict", "export"]);

/** Staff records a request; the database trigger freezes contact on objection.
 * Fulfilment, identity verification and controller routing remain operator work.
 */
export async function recordSubjectRequest(req: Request, env: Env) {
  await requireUser(req, env, true);
  const b = await readJson(req);
  if (!UUID.test(String(b.tenant_id)) || !UUID.test(String(b.lead_id)) || !KINDS.has(b.kind))
    return bad("Choose a tenant, a lead and a request type.");
  const db = new Db(env);
  const lead = await db.one("leads", `id=eq.${b.lead_id}&tenant_id=eq.${b.tenant_id}&select=id`);
  if (!lead) return bad("Lead not found in this tenant.", 404);
  const [row] = await db.insert<{ id: string; state: string }>("subject_requests", {
    tenant_id: b.tenant_id, lead_id: b.lead_id, kind: b.kind, state: "pending_verification",
  });
  return json({ ok: true, request: { id: row.id, state: row.state } }, 201);
}
