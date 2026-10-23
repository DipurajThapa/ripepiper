/** Deterministic evidence assessment shared by the managed products. No model or provider calls. */
export const FACT_FIELDS = ["industry", "market", "role", "need"] as const;
type Field = typeof FACT_FIELDS[number];
export interface BusinessBrief {
  offer: string; industries: string[]; markets: string[]; roles: string[]; needs: string[];
  excludedIndustries: string[]; maxAgeDays: number;
  source: { reference: string; excerpt: string; observedAt: string };
}
export interface Observation {
  id: string; tenant_id: string; lead_id: string; source: string; external_ref: string; observed_at: string;
  assessment_facts: Partial<Record<Field, string>>; assessment_excerpt: string | null;
  assessment_reviewed_by: string | null; synthetic: boolean;
}
const norm = (s: string) => s.trim().toLowerCase();
const text = (s: unknown, max: number): s is string => typeof s === "string" && !!s.trim() && s.length <= max;
export function validDate(value: unknown, now: number): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;
}
export function validBrief(b: any, now = Date.now()): b is BusinessBrief {
  if (!b || !text(b.offer, 500) || !Number.isInteger(b.maxAgeDays) || b.maxAgeDays < 1 || b.maxAgeDays > 365 ||
      !text(b.source?.reference, 240) || !text(b.source?.excerpt, 2000) || !validDate(b.source?.observedAt, now)) return false;
  for (const field of ["industries", "markets", "roles", "needs", "excludedIndustries"] as const) {
    const values = b[field];
    if (!Array.isArray(values) || values.length > 20 || (field !== "excludedIndustries" && !values.length) ||
        values.some((v: unknown) => !text(v, 100)) || new Set(values.map(norm)).size !== values.length) return false;
  }
  return !b.industries.some((v: string) => b.excludedIndustries.map(norm).includes(norm(v)));
}
export function validFacts(facts: any, excerpt: unknown): facts is Observation["assessment_facts"] {
  return facts && typeof facts === "object" && !Array.isArray(facts) && text(excerpt, 2000) &&
    Object.keys(facts).length > 0 && Object.entries(facts).every(([k, v]) =>
      FACT_FIELDS.includes(k as Field) && text(v, 100) && norm(excerpt).includes(norm(v)));
}

export function assessProspect(tenantId: string, leadId: string, brief: BusinessBrief, observations: Observation[], options: {
  now: number; suppressed: boolean; synthetic: boolean;
}) {
  if (!validBrief(brief, options.now)) throw new Error("Invalid business brief");
  if (observations.some(o => o.tenant_id !== tenantId || o.lead_id !== leadId)) throw new Error("Evidence scope mismatch");
  const wanted: Record<Field, string[]> = { industry: brief.industries, market: brief.markets, role: brief.roles, need: brief.needs };
  const weights: Record<Field, number> = { industry: 25, market: 20, role: 20, need: 25 };
  const cutoff = options.now - brief.maxAgeDays * 86400_000;
  const usable = observations.filter(o => o.synthetic === options.synthetic && o.assessment_reviewed_by &&
    validFacts(o.assessment_facts, o.assessment_excerpt) && validDate(o.observed_at, options.now) && Date.parse(o.observed_at) >= cutoff);
  const fields = FACT_FIELDS.map(field => {
    const sources = usable.filter(o => o.assessment_facts[field]);
    const values = [...new Set(sources.map(o => norm(o.assessment_facts[field]!)))];
    const state = values.length > 1 ? "conflict" : !values.length ? "unknown" : wanted[field].map(norm).includes(values[0]) ? "match" : "mismatch";
    return { field, state, values, evidence: sources.map(o => ({ id: o.id, reference: o.external_ref, source: o.source, observedAt: o.observed_at, excerpt: o.assessment_excerpt })) };
  });
  const excluded = usable.some(o => o.assessment_facts.industry && brief.excludedIndustries.map(norm).includes(norm(o.assessment_facts.industry)));
  const expiredBrief = Date.parse(brief.source.observedAt) < cutoff;
  const conflict = fields.some(f => f.state === "conflict");
  const unknown = fields.some(f => f.state === "unknown");
  const mismatch = fields.some(f => f.state === "mismatch");
  const state = options.suppressed || excluded ? "excluded" : expiredBrief || conflict ? "review" : mismatch ? "excluded" : unknown ? "unknown" : "candidate";
  // Freshness uses the oldest supporting observation, never the newest cherry-picked claim.
  const oldest = usable.length ? Math.min(...usable.map(o=>Date.parse(o.observed_at))) : cutoff;
  const freshnessPoints = Math.max(0, Math.round(10 * (1 - (options.now-oldest)/(brief.maxAgeDays*86400_000))));
  return { leadId, state, score: state === "candidate" ? 90 + freshnessPoints : null,
    fitPoints: fields.reduce((sum,f) => sum + (f.state === "match" ? weights[f.field] : 0),0), freshnessPoints,
    scoreMeaning: "Evidence fit only; not conversion probability", fields, contactAllowed: false,
    reasons: [options.suppressed && "suppressed", excluded && "excluded_industry", expiredBrief && "brief_needs_refresh", conflict && "conflicting_evidence", unknown && "missing_current_evidence", mismatch && "outside_brief"].filter(Boolean),
    ignoredEvidence: observations.length - usable.length, synthetic: options.synthetic, nextAction: state === "candidate" ? "Operator review; contact rights remain separate" : "Review evidence or exclusion" };
}
