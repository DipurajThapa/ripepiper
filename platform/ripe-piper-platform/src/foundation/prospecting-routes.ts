import type { Env } from "../env";
import { Db, DbError } from "../lib/db";
import { bad, json, readJson, requireUser } from "../routes/http";
import { assessProspect, validBrief, validDate, validFacts, type Observation } from "./prospecting";
import { productError, reviewProducts } from "./products";
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
  const actor=await requireUser(req,env,true);
  const b = await readJson(req);
  if (typeof b.synthetic !== "boolean") return bad("Choose synthetic or business evidence.");
  const db = new Db(env);
  if (!await db.one("tenants",`id=eq.${tenantId}&select=id`)) return bad("Client not found.",404);
  const brief = await db.one<any>("business_briefs",`tenant_id=eq.${tenantId}&order=version.desc&select=*`);
  const leads = await db.select<any>("leads",`tenant_id=eq.${tenantId}&select=id,company,email,status&order=id&limit=101`);
  if (leads.length>100) return bad("This review supports up to 100 leads per client. A paginated review is required for this account.",409);
  const observations = await db.select<Observation>("lead_observations",`tenant_id=eq.${tenantId}&synthetic=eq.${b.synthetic}&select=*&limit=1001`);
  // Default PostgREST row caps can truncate at 1000; never present a partial evidence set as complete.
  if (observations.length>=1000) return bad("Too much evidence for one review. Narrow the evidence set before assessing.",409);
  const stops = leads.length ? await db.select<any>("lead_suppression",`tenant_id=eq.${tenantId}&lead_id=in.(${leads.map(l=>l.id).join(',')})&select=lead_id`) : [];
  const emailFilter = encodeURIComponent(`(${leads.map(l=>JSON.stringify(l.email.toLowerCase())).join(',')})`);
  const globalStops = leads.length ? await db.select<any>("suppression",`email=in.${emailFilter}&select=email`) : [];
  const reviewOwners=observations.some(o=>o.product_context?.kind==='conversation_review')?await db.rpc<{id:string;label:string}[]>('response_review_owners',{p_tenant:tenantId,p_actor:actor.id}):undefined;
  const results = [];
  for (const lead of leads) {
    if (b.synthetic !== lead.email.toLowerCase().endsWith(".invalid")) continue;
    const suppressed = lead.status==="unsubscribed" || globalStops.some(s=>s.email===lead.email.toLowerCase()) || stops.some(s=>s.lead_id===lead.id);
    const assessment = brief ? assessProspect(tenantId,lead.id,brief.body,observations.filter(o=>o.lead_id===lead.id),{
      now:Date.now(),synthetic:b.synthetic,suppressed:lead.status==="unsubscribed" || globalStops.some(s=>s.email===lead.email.toLowerCase()) || stops.some(s=>s.lead_id===lead.id),
    }) : {leadId:lead.id,state:suppressed?"excluded":"unknown",score:null,fields:[],contactAllowed:false,reasons:suppressed?["suppressed"]:["brief_required"],nextAction:"Save a business brief before assessing fit."};
    results.push({...assessment,company:lead.company || lead.email,products:reviewProducts(observations.filter(o=>o.lead_id===lead.id),Date.now(),assessment.reasons.includes("suppressed"),assessment.state,reviewOwners)});
  }
  const latest = await db.one<any>("business_briefs",`tenant_id=eq.${tenantId}&order=version.desc&select=version`);
  if (latest?.version !== brief?.version) return bad("The brief changed during assessment. Refresh the shortlist.",409);
  const order:Record<string,number>={candidate:0,review:1,unknown:2,excluded:3};
  results.sort((a,b)=>order[a.state]-order[b.state] || a.leadId.localeCompare(b.leadId));
  return json({ok:true,brief,leads,results,synthetic:b.synthetic,rulesVersion:2,assessedAt:new Date().toISOString(),externalCalls:0});
}

/** Staff-reviewed records only. Atomic persistence and reply stops are enforced by PostgreSQL. */
export async function recordProductEvent(req: Request, env: Env, tenantId: string) {
  const user=await requireUser(req,env,true), b=await readJson(req);
  if(!uuid.test(b.lead_id??"") || !bounded(b.reference,240) || !bounded(b.rights_reference,240) || !bounded(b.excerpt,2000) || typeof b.synthetic!=="boolean") return bad("Provide an existing lead, source reference, permitted-use reference and reviewed excerpt.");
  const error=productError(b.context,b.observed_at,Date.now(),true);
  if(error) return bad(error);
  const db=new Db(env);
  const lead=await db.one<any>("leads",`tenant_id=eq.${tenantId}&id=eq.${b.lead_id}&select=id,email`);
  if(!lead) return bad("Lead not found in this client account.",404);
  if(b.synthetic !== lead.email.toLowerCase().endsWith(".invalid")) return bad("Evidence mode must match the contact.");
  if(b.context.kind==='outcome' && ['response','events'].includes(b.context.product)) {
    const field=b.context.product==='response'?'threadRef':'eventRef';
    const kinds=b.context.product==='response'?'enquiry,reply':'registration,attendance';
    const source=await db.one("lead_observations",`tenant_id=eq.${tenantId}&lead_id=eq.${lead.id}&synthetic=eq.${b.synthetic}&assessment_reviewed_by=not.is.null&product_context->>product=eq.${b.context.product}&product_context->>kind=in.(${kinds})&product_context->>${field}=eq.${encodeURIComponent(b.context[field])}&observed_at=lte.${encodeURIComponent(b.observed_at)}&select=id`);
    if(!source) return bad("Record reviewed evidence for this conversation or event before attributing an outcome.",409);
  }
  try {
    const id=await db.rpc<string>("record_product_event",{p_tenant:tenantId,p_lead:lead.id,p_actor:user.id,p_reference:b.reference.trim(),p_rights:b.rights_reference.trim(),p_excerpt:b.excerpt.trim(),p_observed:b.observed_at,p_synthetic:b.synthetic,p_context:b.context});
    if(typeof id!=="string" || !uuid.test(id)) return bad("The evidence receipt is uncertain. Inspect or retry the same source reference; do not create another outcome.",503);
    return json({ok:true,id,delivery:"not_sent"},201);
  } catch(e) {
    if(e instanceof DbError && e.isConflict) return bad("This reference is already attached to different evidence. Reload or use a new correction reference.",409);
    if(e instanceof DbError && (e.body.includes('22023') || e.body.includes('23514') || e.body.includes('23503'))) return bad("Outcome evidence does not match this account, contact, campaign, action receipt or observation time.",409);
    throw e;
  }
}

export async function importReviewLeads(req:Request,env:Env,tenantId:string) {
 const user=await requireUser(req,env,true),b=await readJson(req);
 if(typeof b.synthetic!=='boolean' || !Array.isArray(b.rows) || !b.rows.length || b.rows.length>50) return bad('Import between 1 and 50 rows and select the evidence mode.');
 const db=new Db(env);
 if(!await db.one('tenants',`id=eq.${tenantId}&select=id`))return bad('Client not found.',404);
 const results=[];
 for(let index=0;index<b.rows.length;index++) {
  const r=b.rows[index];
  if(!r || !bounded(r.email,254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()) || !bounded(r.company,240) || !bounded(r.reference,240) || !bounded(r.rights_reference,240) || !validDate(r.observed_at,Date.now()) || b.synthetic!==r.email.trim().toLowerCase().endsWith('.invalid')) {
   results.push({row:index+1,state:'rejected',reason:'invalid_identity_provenance_date_or_mode'});continue;
  }
  try {
   const result=await db.rpc<any>('import_review_lead',{p_tenant:tenantId,p_actor:user.id,p_email:r.email.trim().toLowerCase(),p_company:r.company.trim(),p_reference:r.reference.trim(),p_rights:r.rights_reference.trim(),p_observed:r.observed_at,p_synthetic:b.synthetic});
   // A missing/malformed acknowledgement may follow a committed write. Stop the
   // batch and retain its source references for reconciliation; never guess success.
   if(!result || typeof result!=='object' || Array.isArray(result) ||
      !['created','linked','duplicate'].includes(result.state) ||
      typeof result.lead_id!=='string' || !uuid.test(result.lead_id) ||
      typeof result.observation_id!=='string' || !uuid.test(result.observation_id)) {
    results.push({row:index+1,state:'review',reason:'result_uncertain_retry_same_reference'});
    return json({ok:false,results,nextRow:index+2,contactAllowed:false},503);
   }
   results.push({row:index+1,state:result.state,lead_id:result.lead_id,observation_id:result.observation_id});
  }catch(e){
   if(e instanceof DbError && e.isConflict) results.push({row:index+1,state:'rejected',reason:'reference_conflict'});
   else if(e instanceof DbError && e.body.includes('22023'))results.push({row:index+1,state:'rejected',reason:'invalid_row_or_capacity'});
   else {results.push({row:index+1,state:'review',reason:'result_uncertain_retry_same_reference'});return json({ok:false,results,nextRow:index+2},503);}
  }
 }
 return json({ok:true,results,contactAllowed:false});
}
