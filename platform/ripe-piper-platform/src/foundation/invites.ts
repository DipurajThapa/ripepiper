import type { Env } from "../env";
import { Db } from "../lib/db";
import { json, requireUser } from "../routes/http";

/** Redeem only invitations for the verified identity behind this access token. */
export async function acceptInvites(req: Request, env: Env) {
  const user = await requireUser(req, env);
  const count = await new Db(env).rpc<number>("accept_verified_invites", { p_user_id: user.id });
  return json({ ok: true, accepted: count });
}
