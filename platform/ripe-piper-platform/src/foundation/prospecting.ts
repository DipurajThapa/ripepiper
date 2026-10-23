/** Deterministic evidence assessment shared by the managed products. No model or provider calls. */
export const FACT_FIELDS = ["industry", "market", "role", "need"] as const;
export type Field = typeof FACT_FIELDS[number];
export interface BusinessBrief {
  offer: string; industries: string[]; markets: string[]; roles: string[]; needs: string[];
  aliases?: Partial<Record<Field, Record<string, string[]>>>;
  excludedIndustries: string[]; maxAgeDays: number;
  source: { reference: string; excerpt: string; observedAt: string };
}
export interface Observation {
  id: string; tenant_id: string; lead_id: string; source: string; external_ref: string; observed_at: string;
  assessment_facts: Partial<Record<Field, string>>; assessment_excerpt: string | null;
  assessment_reviewed_by: string | null; synthetic: boolean;
  brief_version?: number | null;
  product_context?: import("./products").ProductContext | null;
}
const norm = (s: string) => s.trim().toLowerCase();
const text = (s: unknown, max: number): s is string => typeof s === "string" && !!s.trim() && s.length <= max;
export function validInstant(value: unknown): value is string {
  if(typeof value !== "string")return false;
  const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if(!m || !Number.isFinite(Date.parse(value)))return false;
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  return year>=1000 && month>=1 && month<=12 && day>=1 && day<=new Date(Date.UTC(year,month,0)).getUTCDate() && Number(m[4])<=23 && Number(m[5])<=59 && Number(m[6])<=59;
}
export function validDate(value: unknown, now: number): value is string {
  return validInstant(value) && Date.parse(value) <= now;
}
export function validBrief(b: any, now = Date.now()): b is BusinessBrief {
  if (!b || !text(b.offer, 500) || !Number.isInteger(b.maxAgeDays) || b.maxAgeDays < 1 || b.maxAgeDays > 365 ||
      !text(b.source?.reference, 240) || !text(b.source?.excerpt, 2000) || !validDate(b.source?.observedAt, now)) return false;
  for (const field of ["industries", "markets", "roles", "needs", "excludedIndustries"] as const) {
    const values = b[field];
    if (!Array.isArray(values) || values.length > 20 || (field !== "excludedIndustries" && !values.length) ||
        values.some((v: unknown) => !text(v, 100)) || new Set(values.map(norm)).size !== values.length) return false;
  }
  if (b.aliases !== undefined) {
    if (!b.aliases || typeof b.aliases !== "object" || Array.isArray(b.aliases)) return false;
    const targets: Record<Field, string[]> = {industry:b.industries,market:b.markets,role:b.roles,need:b.needs};
    for (const [field, groups] of Object.entries(b.aliases)) {
      if (!FACT_FIELDS.includes(field as Field) || !groups || typeof groups !== "object" || Array.isArray(groups)) return false;
      const seen = new Set(targets[field as Field].map(norm));
      for (const [canonical, values] of Object.entries(groups)) {
        if (!targets[field as Field].map(norm).includes(norm(canonical)) || !Array.isArray(values) || values.length > 20) return false;
        for (const v of values) { if (!text(v,100) || seen.has(norm(v)) || (field === "industry" && b.excludedIndustries.map(norm).includes(norm(v)))) return false; seen.add(norm(v)); }
      }
    }
  }
  return !b.industries.some((v: string) => b.excludedIndustries.map(norm).includes(norm(v)));
}
// Conservative screening, not semantic proof. Ambiguous/negative text is retained for review.
export function ambiguousExcerpt(excerpt: string): boolean {
  return /\b(no|not|never|without|neither|denied|unknown|uncertain|maybe|might|possibly|former|previously|competitor|hypothetical|example)\b|n['’]t\b|\?/i.test(excerpt);
}
function mentions(excerpt: string, value: string): boolean {
  const escaped = norm(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^\\p{L}\\p{N}])" + escaped + "($|[^\\p{L}\\p{N}])", "u").test(norm(excerpt));
}
function canonical(brief: BusinessBrief, field: Field, value: string): string {
  const entry = Object.entries(brief.aliases?.[field] ?? {}).find(([,aliases]) => aliases.map(norm).includes(norm(value)));
  return norm(entry ? entry[0] : value);
}
export function validFacts(facts: any, excerpt: unknown): facts is Observation["assessment_facts"] {
  return facts && typeof facts === "object" && !Array.isArray(facts) && text(excerpt, 2000) &&
    Object.keys(facts).length > 0 && Object.entries(facts).every(([k, v]) =>
      FACT_FIELDS.includes(k as Field) && text(v, 100) && mentions(excerpt, v));
}

export function assessProspect(tenantId: string, leadId: string, brief: BusinessBrief, observations: Observation[], options: {
  now: number; suppressed: boolean; synthetic: boolean;
}) {
  if (!validBrief(brief, options.now)) throw new Error("Invalid business brief");
  if (observations.some(o => o.tenant_id !== tenantId || o.lead_id !== leadId)) throw new Error("Evidence scope mismatch");
  const wanted: Record<Field, string[]> = { industry: brief.industries, market: brief.markets, role: brief.roles, need: brief.needs };
  const weights: Record<Field, number> = { industry: 25, market: 20, role: 20, need: 25 };
  const cutoff = options.now - brief.maxAgeDays * 86400_000;
  const current = observations.filter(o => o.synthetic === options.synthetic && o.assessment_reviewed_by &&
    validFacts(o.assessment_facts, o.assessment_excerpt) && validDate(o.observed_at, options.now) && Date.parse(o.observed_at) >= cutoff);
  const ambiguous = current.filter(o => ambiguousExcerpt(o.assessment_excerpt!));
  const usable = current.filter(o => !ambiguousExcerpt(o.assessment_excerpt!));
  const fields = FACT_FIELDS.map(field => {
    const sources = usable.filter(o => o.assessment_facts[field]);
    const values = [...new Set(sources.map(o => canonical(brief,field,o.assessment_facts[field]!)))];
    const state = ambiguous.some(o => o.assessment_facts[field]) ? "review" : values.length > 1 ? "conflict" : !values.length ? "unknown" : wanted[field].map(norm).includes(values[0]) ? "match" : "mismatch";
    return { field, state, values, evidence: current.filter(o => o.assessment_facts[field]).map(o => ({ id: o.id, reference: o.external_ref, source: o.source, observedAt: o.observed_at, excerpt: o.assessment_excerpt })) };
  });
  const excluded = usable.some(o => o.assessment_facts.industry && brief.excludedIndustries.map(norm).includes(norm(o.assessment_facts.industry)));
  const expiredBrief = Date.parse(brief.source.observedAt) < cutoff;
  const conflict = fields.some(f => f.state === "conflict" || f.state === "review");
  const unknown = fields.some(f => f.state === "unknown");
  const mismatch = fields.some(f => f.state === "mismatch");
  const state = options.suppressed || excluded ? "excluded" : expiredBrief || conflict ? "review" : mismatch ? "excluded" : unknown ? "unknown" : "candidate";
  // Freshness uses the oldest supporting observation, never the newest cherry-picked claim.
  const oldest = usable.length ? Math.min(...usable.map(o=>Date.parse(o.observed_at))) : cutoff;
  const freshnessPoints = Math.max(0, Math.round(10 * (1 - (options.now-oldest)/(brief.maxAgeDays*86400_000))));
  return { leadId, state, score: null,
    fitPoints: fields.reduce((sum,f) => sum + (f.state === "match" ? weights[f.field] : 0),0), freshnessPoints,
    scoreMeaning: "Separate qualification dimensions; no conversion probability", fields,
    readiness: "unknown", engagement: "unknown", contactAllowed: false,
    reasons: [options.suppressed && "suppressed", excluded && "excluded_industry", expiredBrief && "brief_needs_refresh", conflict && "conflicting_or_ambiguous_evidence", unknown && "missing_current_evidence", mismatch && "outside_brief"].filter(Boolean),
    ignoredEvidence: observations.length - usable.length, synthetic: options.synthetic, nextAction: state === "candidate" ? "Operator review; contact rights remain separate" : "Review evidence or exclusion" };
}
