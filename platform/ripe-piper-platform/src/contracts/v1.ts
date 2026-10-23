/** Shared, transport-independent contracts for the managed product workflows.
 * No provider call or database write is authorized by passing these checks.
 * The foundation must re-evaluate rights and approval at execution time.
 */
export const CONTRACT_VERSION = 1 as const;
export type Capability = "revive" | "signal" | "response" | "events";
export type Channel = "email" | "phone" | "whatsapp" | "event";
export type Role = "operator" | "owner" | "viewer";
export type ActionState = "queued" | "claimed" | "delivered" | "failed" | "cancelled";
export type QualificationDecision = "yes" | "no" | "unknown";

export interface Actor { userId: string; tenantId: string; role: Role }
export interface SourceEvidence { source: string; observedAt: string; reference: string; rightsReference?: string }
export interface ContactIdentity { id: string; tenantId: string; normalizedEmail?: string; normalizedPhone?: string; sources: SourceEvidence[] }
export interface Campaign {
  id: string; tenantId: string; capability: Capability; ownerId: string;
  offer: string; audience: string; channel: Channel; market: string;
  timezone: string; maxActions: number; startsAt: string; endsAt: string;
  status: "draft" | "review" | "approved" | "paused" | "ended";
  approvalVersion?: number;
}
export interface Interaction {
  id: string; tenantId: string; leadId: string; campaignId?: string; channel: Channel;
  direction: "inbound" | "outbound"; occurredAt: string; providerRef?: string;
  result: "queued" | "sent" | "delivered" | "failed" | "replied" | "opted_out";
}
export interface Qualification {
  tenantId: string; leadId: string; criteriaVersion: number;
  fit: QualificationDecision; engagement: QualificationDecision;
  mql: QualificationDecision; sql: QualificationDecision;
  evidence: SourceEvidence[]; unknowns: string[]; reviewerId?: string; overrideReason?: string;
}
export interface Asset {
  id: string; tenantId: string; campaignId: string; audience: string; purpose: string;
  version: number; claimEvidence: SourceEvidence[];
  status: "draft" | "approved" | "published" | "retired";
}
export interface Appointment {
  id: string; tenantId: string; leadId: string; campaignId?: string;
  kind: "consultation" | "client_handoff"; ownerId: string;
  startsAt: string; endsAt: string; timezone: string; providerRef?: string;
  status: "requested" | "confirmed" | "rescheduled" | "cancelled" | "attended" | "no_show" | "attendance_unknown";
}
export interface DataRequest {
  id: string; tenantId: string; contactId: string; type: "access" | "correct" | "object" | "erase" | "restrict" | "export";
  receivedAt: string; state: "pending_verification" | "open" | "fulfilled" | "rejected";
  ownerId: string; deadlineAt?: string; resolutionReference?: string;
}
export interface RetentionInstruction {
  tenantId: string; contactId: string; purpose: string; dueAt: string;
  state: "scheduled" | "held" | "completed"; holdReference?: string;
}
export interface ContactRights {
  tenantId: string; contactId: string; version: number; source: SourceEvidence;
  purposes: string[]; channels: Channel[]; markets: string[];
  decision: "permitted" | "denied" | "unknown"; reviewerId?: string;
  noticeReference?: string; consentAt?: string; withdrawnAt?: string;
  objectedAt?: string; suppressedAt?: string; expiresAt?: string;
}
export interface CampaignApproval {
  tenantId: string; campaignId: string; version: number; assetVersion: number;
  status: "approved" | "draft" | "paused" | "expired" | "revoked";
  channels: Channel[]; markets: string[]; purposes: string[];
  approverId: string; expiresAt: string;
}
export interface Handoff {
  schemaVersion: typeof CONTRACT_VERSION; id: string; tenantId: string;
  leadId: string; campaignId?: string; source: Capability; destination: Capability | "operator";
  type: "candidate" | "inbound" | "follow_up" | "appointment" | "escalation";
  correlationKey: string; occurredAt: string; createdAt: string;
  evidence: SourceEvidence[]; payload: Record<string, unknown>;
}
export type ContractError = "invalid" | "forbidden" | "tenant_mismatch" | "duplicate" | "out_of_order" | "ambiguous_identity" | "not_authorized";
export type Check = { ok: true } | { ok: false; error: ContractError };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (s: string) => typeof s === "string" && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d\d-\d\dT/.test(s);

/** Untrusted handoff boundary. A durable unique (tenant, correlationKey) claim is still required. */
export function checkHandoff(h: Handoff, actor: Actor, existingKeys: ReadonlySet<string>, lastOccurredAt?: string): Check {
  if (!h || h.schemaVersion !== CONTRACT_VERSION || !uuid.test(h.id ?? "") || !uuid.test(h.leadId ?? "") ||
      !uuid.test(h.tenantId ?? "") || (h.campaignId && !uuid.test(h.campaignId)) ||
      !["revive", "signal", "response", "events"].includes(h.source) ||
      !["revive", "signal", "response", "events", "operator"].includes(h.destination) ||
      !["candidate", "inbound", "follow_up", "appointment", "escalation"].includes(h.type) ||
      !h.correlationKey?.trim() || h.correlationKey.length > 160 ||
      !iso(h.occurredAt) || !iso(h.createdAt) || !Array.isArray(h.evidence) ||
      h.evidence.some(e => !e.source || !iso(e.observedAt) || !e.reference) ||
      !h.payload || typeof h.payload !== "object" || Array.isArray(h.payload)) return { ok: false, error: "invalid" };
  if (actor.tenantId !== h.tenantId) return { ok: false, error: "tenant_mismatch" };
  if (actor.role === "viewer") return { ok: false, error: "forbidden" };
  if (existingKeys.has(`${h.tenantId}:${h.correlationKey}`)) return { ok: false, error: "duplicate" };
  if (lastOccurredAt && Date.parse(h.occurredAt) < Date.parse(lastOccurredAt)) return { ok: false, error: "out_of_order" };
  return { ok: true };
}

/** Multiple matching IDs require operator review; never silently merge cross-channel identities. */
export function resolveIdentity(tenantId: string, candidates: readonly ContactIdentity[]): { id: string } | { error: ContractError } {
  if (candidates.some(c => c.tenantId !== tenantId)) return { error: "tenant_mismatch" };
  const ids = new Set(candidates.map(c => c.id));
  if (ids.size !== 1) return { error: ids.size === 0 ? "invalid" : "ambiguous_identity" };
  return { id: candidates[0].id };
}

/** A copied handoff flag never grants contact permission. Pass fresh stored rows just before dispatch. */
export function checkContact(params: {
  tenantId: string; contactId: string; campaignId: string; approvalVersion: number; assetVersion: number;
  purpose: string; channel: Channel; market: string; now: string;
  rights: ContactRights; approval: CampaignApproval; tenantStopped: boolean; globalStopped: boolean;
}): Check {
  if (!params?.rights || !params.approval) return { ok: false, error: "invalid" };
  const { rights: r, approval: a, ...p } = params;
  if (!iso(p.now) || !iso(a.expiresAt) || (r.expiresAt && !iso(r.expiresAt)) || !p.purpose || !p.market || !p.channel ||
      !Number.isInteger(p.approvalVersion) || !Number.isInteger(p.assetVersion) ||
      !Array.isArray(r.purposes) || !Array.isArray(r.channels) || !Array.isArray(r.markets) ||
      !Array.isArray(a.purposes) || !Array.isArray(a.channels) || !Array.isArray(a.markets)) return { ok: false, error: "invalid" };
  if (r.tenantId !== p.tenantId || a.tenantId !== p.tenantId || r.contactId !== p.contactId || a.campaignId !== p.campaignId) return { ok: false, error: "tenant_mismatch" };
  if (p.globalStopped || p.tenantStopped || r.objectedAt || r.withdrawnAt || r.suppressedAt ||
      r.decision !== "permitted" || !r.reviewerId || !r.noticeReference ||
      (r.expiresAt && Date.parse(r.expiresAt) <= Date.parse(p.now)) ||
      a.status !== "approved" || Date.parse(a.expiresAt) <= Date.parse(p.now) ||
      a.version !== p.approvalVersion || a.assetVersion !== p.assetVersion ||
      !r.purposes.includes(p.purpose) || !r.channels.includes(p.channel) || !r.markets.includes(p.market) ||
      !a.purposes.includes(p.purpose) || !a.channels.includes(p.channel) || !a.markets.includes(p.market)) return { ok: false, error: "not_authorized" };
  return { ok: true };
}

export function nextActionState(current: ActionState, event: "claim" | "deliver" | "fail" | "cancel"): ActionState | null {
  const transitions: Record<ActionState, Partial<Record<typeof event, ActionState>>> = {
    queued: { claim: "claimed", cancel: "cancelled" },
    claimed: { deliver: "delivered", fail: "failed", cancel: "cancelled" },
    failed: { claim: "claimed", cancel: "cancelled" },
    delivered: {}, cancelled: {},
  };
  return transitions[current]?.[event] ?? null;
}
