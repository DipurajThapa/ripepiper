import { describe, it, expect } from "vitest";
import { checkHandoff, checkContact, nextActionState, resolveIdentity, type Actor, type CampaignApproval, type ContactRights, type Handoff } from "../src/contracts/v1";

const tenant = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const contact = "33333333-3333-4333-8333-333333333333";
const campaign = "44444444-4444-4444-8444-444444444444";
const at = "2026-10-22T10:00:00Z";
const actor: Actor = { userId: "operator", tenantId: tenant, role: "operator" };
const source = { source: "client import", reference: "synthetic-batch-1", observedAt: at, rightsReference: "synthetic-review-1" };
const handoff: Handoff = { schemaVersion: 1, id: "55555555-5555-4555-8555-555555555555", tenantId: tenant, leadId: contact, campaignId: campaign, source: "revive", destination: "response", type: "candidate", correlationKey: "batch-1:row-2", occurredAt: at, createdAt: at, evidence: [source], payload: { reason: "reply" } };
const rights: ContactRights = { tenantId: tenant, contactId: contact, version: 1, source, purposes: ["appointment"], channels: ["email"], markets: ["AE"], decision: "permitted", reviewerId: "privacy-reviewer", noticeReference: "notice-1", expiresAt: "2026-11-22T10:00:00Z" };
const approval: CampaignApproval = { tenantId: tenant, campaignId: campaign, version: 2, assetVersion: 3, status: "approved", channels: ["email"], markets: ["AE"], purposes: ["appointment"], approverId: "client-approver", expiresAt: "2026-11-22T10:00:00Z" };
const contactCheck = { tenantId: tenant, contactId: contact, campaignId: campaign, approvalVersion: 2, assetVersion: 3, purpose: "appointment", channel: "email" as const, market: "AE", now: at, rights, approval, tenantStopped: false, globalStopped: false };

describe("shared v1 handoff boundary", () => {
  it("accepts a valid synthetic handoff but not a missing field", () => {
    expect(checkHandoff(handoff, actor, new Set())).toEqual({ ok: true });
    expect(checkHandoff({ ...handoff, correlationKey: "" }, actor, new Set())).toEqual({ ok: false, error: "invalid" });
  });
  it("rejects cross-tenant and viewer actions", () => {
    expect(checkHandoff(handoff, { ...actor, tenantId: other }, new Set())).toEqual({ ok: false, error: "tenant_mismatch" });
    expect(checkHandoff(handoff, { ...actor, role: "viewer" }, new Set())).toEqual({ ok: false, error: "forbidden" });
  });
  it("rejects a repeated key and reordered event", () => {
    expect(checkHandoff(handoff, actor, new Set([`${tenant}:batch-1:row-2`]))).toEqual({ ok: false, error: "duplicate" });
    expect(checkHandoff(handoff, actor, new Set(), "2026-10-22T11:00:00Z")).toEqual({ ok: false, error: "out_of_order" });
  });
  it("does not merge ambiguous or foreign-tenant contacts", () => {
    const a = { id: contact, tenantId: tenant, sources: [source] };
    expect(resolveIdentity(tenant, [a, { ...a, id: campaign }])).toEqual({ error: "ambiguous_identity" });
    expect(resolveIdentity(tenant, [a, { ...a, tenantId: other }])).toEqual({ error: "tenant_mismatch" });
    expect(resolveIdentity(tenant, [a, a])).toEqual({ id: contact });
  });
});

describe("shared v1 execution eligibility", () => {
  it("accepts matching current authority only", () => expect(checkContact(contactCheck)).toEqual({ ok: true }));
  it("blocks a different tenant or an outdated approval/message version", () => {
    expect(checkContact({ ...contactCheck, rights: { ...rights, tenantId: other } })).toEqual({ ok: false, error: "tenant_mismatch" });
    expect(checkContact({ ...contactCheck, approvalVersion: 1 })).toEqual({ ok: false, error: "not_authorized" });
    expect(checkContact({ ...contactCheck, assetVersion: 2 })).toEqual({ ok: false, error: "not_authorized" });
  });
  it("blocks an objection during a queued action, a stop, and expired approval", () => {
    expect(checkContact({ ...contactCheck, rights: { ...rights, objectedAt: at } })).toEqual({ ok: false, error: "not_authorized" });
    expect(checkContact({ ...contactCheck, globalStopped: true })).toEqual({ ok: false, error: "not_authorized" });
    expect(checkContact({ ...contactCheck, approval: { ...approval, expiresAt: at } })).toEqual({ ok: false, error: "not_authorized" });
  });
  it("does not reuse permission after a market, purpose, or channel change", () => {
    expect(checkContact({ ...contactCheck, market: "IN" })).toEqual({ ok: false, error: "not_authorized" });
    expect(checkContact({ ...contactCheck, purpose: "newsletter" })).toEqual({ ok: false, error: "not_authorized" });
    expect(checkContact({ ...contactCheck, channel: "whatsapp" })).toEqual({ ok: false, error: "not_authorized" });
  });
  it("refuses invalid dates rather than treating them as an approval", () => {
    expect(checkContact({ ...contactCheck, approval: { ...approval, expiresAt: "not-a-date" } })).toEqual({ ok: false, error: "invalid" });
  });
  it("does not reverse delivered or cancelled actions on late retries", () => {
    expect(nextActionState("queued", "claim")).toBe("claimed");
    expect(nextActionState("claimed", "fail")).toBe("failed");
    expect(nextActionState("failed", "claim")).toBe("claimed");
    expect(nextActionState("delivered", "deliver")).toBeNull();
    expect(nextActionState("delivered", "cancel")).toBeNull();
    expect(nextActionState("cancelled", "claim")).toBeNull();
  });
});
