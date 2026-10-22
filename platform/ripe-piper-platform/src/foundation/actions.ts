import type { Env } from "../env";
import { Db } from "../lib/db";
import { bad, json, requireUser } from "../routes/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Explicit staff test sink. No channel provider is invoked and `tested` is not delivery. */
export async function testAction(req: Request, env: Env, id: string) {
  await requireUser(req, env, true);
  if (env.SYNTHETIC_SINK_ENABLED !== "true") return bad("The synthetic action sink is disabled.", 403);
  if (!UUID.test(id)) return bad("Invalid action ID.");
  const db = new Db(env), now = new Date().toISOString();
  const claimed = await db.rpc<boolean>("claim_synthetic_action", { p_id: id, p_now: now });
  if (!claimed) return bad("Action is unavailable or current authority does not permit this test.", 409);
  const completed = await db.rpc<boolean>("complete_synthetic_action", { p_id: id, p_now: new Date().toISOString() });
  if (!completed) return bad("The action needs operator review; no test result was recorded.", 409);
  return json({ ok: true, state: "tested", action_id: id });
}
