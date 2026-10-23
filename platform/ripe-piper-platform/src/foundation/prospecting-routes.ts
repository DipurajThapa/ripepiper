import type { Env } from "../env";
import { Db, DbError } from "../lib/db";
import { bad, json, readJson, requireUser } from "../routes/http";
import { assessProspect, validBrief, validDate, validFacts, type Observation } from "./prospecting";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded = (s: unknown, n: number): s is string => typeof s === "string" && !!s.trim() && s.length <= n;

export async function saveBrief(req: Request, env: Env, tenantId: string) {
  const user = await requireUser(req, env, true);
  const b = await readJson(req);
  if (!validBrief(b.brief) || !Number.isInteger(b.expected_version) || b.expected_version < 0) return bad("Complete the brief, source and current version.");
  const db = new Db(env);
  if (!await db.one("tenants", `id=eq.${tenantId}&select=id`)) return bad("Client not found.",404);
  try {
    const version = await db.rpc<number>("save_business_brief", {p_tenant_id:tenantId,p_expected_version:b.expected_version,p_body:b.brief,p_actor:user.id});
    return json({ok:true,version});
  } catch (e) {
    if (e instanceof DbError && e.body.includes("40001")) return bad("The brief changed. Reload before saving.",409);
    throw e;
  }
}

export async function addProspectEvidence(req: Request, env: Env, tenantId: string) {
  const user = await requireUser(req, env, true);
  const b = await readJson(req);
  if (!uuid.test(b.lead_id ?? "") || !bounded(b.source,80) || !bounded(b.reference,240) || !bounded(b.rights_reference,240) ||
      !validDate(b.observed_at,Date.now()) || !validFacts(b.facts,b.excerpt) || typeof b.synthetic !== "boolean")
    return bad("Provide a lead, dated source, permitted-use reference and facts present in its excerpt.");
  const db = new Db(env);
  const lead = await db.one<any>("leads",`id=eq.${b.lead_id}&tenant_id=eq.${tenantId}&select=id,email`);
  if (!lead) return bad("Lead not found in this client account.",404);
  if (b.synthetic && !lead.email.toLowerCase().endsWith(".invalid")) return bad("Synthetic evidence requires a .invalid test contact.");
  try {
    const [row] = await db.insert("lead_observations", {tenant_id:tenantId,lead_id:lead.id,source:b.source.trim(),external_ref:b.reference.trim(),
      observed_at:b.observed_at,original_purpose:"prospect assessment",rights_reference:b.rights_reference.trim(),synthetic:b.synthetic,
      assessment_facts:b.facts,assessment_excerpt:b.excerpt,assessment_reviewed_by:user.id});
    return json({ok:true,id:row.id},201);
  } catch (e) {
    if (e instanceof DbError && e.isConflict) return bad("This source reference already exists. Use a dated correction reference for new evidence.",409);
    throw e;
  }
}

/** Recompute from current evidence and brief; no stale cached score and no sending. */
export async function prospectShortlist(req: Request, env: Env, tenantId: string) {
  await requireUser(req,env,true);
  const b = await readJson(req);
  if (typeof b.synthetic !== "boolean") return bad("Choose synthetic or business evidence.");
  const db = new Db(env);
  if (!await db.one("tenants",`id=eq.${tenantId}&select=id`)) return bad("Client not found.",404);
  const brief = await db.one<any>("business_briefs",`tenant_id=eq.${tenantId}&order=version.desc&select=*`);
  const leads = await db.select<any>("leads",`tenant_id=eq.${tenantId}&select=id,company,email,status&order=id&limit=101`);
  if (leads.length>100) return bad("This review supports up to 100 leads per client. A paginated review is required for this account.",409);
  if (!brief) return json({ok:true,brief:null,leads,results:[],synthetic:b.synthetic});
  const observations = await db.select<Observation>("lead_observations",`tenant_id=eq.${tenantId}&synthetic=eq.${b.synthetic}&select=*&limit=1001`);
  // Default PostgREST row caps can truncate at 1000; never present a partial evidence set as complete.
  if (observations.length>=1000) return bad("Too much evidence for one review. Narrow the evidence set before assessing.",409);
  const stops = leads.length ? await db.select<any>("lead_suppression",`tenant_id=eq.${tenantId}&lead_id=in.(${leads.map(l=>l.id).join(',')})&select=lead_id`) : [];
  const emailFilter = encodeURIComponent(`(${leads.map(l=>JSON.stringify(l.email.toLowerCase())).join(',')})`);
  const globalStops = leads.length ? await db.select<any>("suppression",`email=in.${emailFilter}&select=email`) : [];
  const results = [];
  for (const lead of leads) {
    if (b.synthetic !== lead.email.toLowerCase().endsWith(".invalid")) continue;
    results.push({...assessProspect(tenantId,lead.id,brief.body,observations.filter(o=>o.lead_id===lead.id),{
      now:Date.now(),synthetic:b.synthetic,suppressed:lead.status==="unsubscribed" || globalStops.some(s=>s.email===lead.email.toLowerCase()) || stops.some(s=>s.lead_id===lead.id),
    }),company:lead.company || lead.email});
  }
  const latest = await db.one<any>("business_briefs",`tenant_id=eq.${tenantId}&order=version.desc&select=version`);
  if (latest?.version !== brief.version) return bad("The brief changed during assessment. Refresh the shortlist.",409);
  const order:Record<string,number>={candidate:0,review:1,unknown:2,excluded:3};
  results.sort((a,b)=>order[a.state]-order[b.state] || (b.score ?? -1)-(a.score ?? -1) || a.leadId.localeCompare(b.leadId));
  return json({ok:true,brief,leads,results,synthetic:b.synthetic,rulesVersion:1,assessedAt:new Date().toISOString(),externalCalls:0});
}
