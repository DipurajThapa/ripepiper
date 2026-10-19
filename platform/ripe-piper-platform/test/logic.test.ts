import { describe, it, expect } from "vitest";
import { routeLead, cleanWebsite, cleanEmail, scoreLead } from "../src/lib/validate";
import { fixedScope, eventScope, advanceAmount, quoteTotal, money } from "../src/lib/pricing";
import { freeSlots, dueReminder, isOfferedSlot } from "../src/lib/slots";
import { verifyStripe, verifyRazorpay, parseStripeEvent, parseRazorpayEvent } from "../src/lib/payments";
import { parseAnalysis, priceBlock } from "../src/lib/ai";
import { findRow, TABS, gst } from "../src/lib/sheets";
import { renderMarkdown, fillShell, postPage } from "../src/lib/blog";
import { toTenantCurrency } from "../src/lib/ads";
import { buildMime } from "../src/lib/google";

async function hmac(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)))].map(b => b.toString(16).padStart(2, "0")).join("");
}

describe("lead routing (same rules as the website form)", () => {
  it("asks personal-email users for a work email", () => expect(routeLead("me@gmail.com", 2)).toBe("work_email"));
  it("politely declines the smallest deal band", () => expect(routeLead("ceo@acme.ae", 0)).toBe("not_fit"));
  it("sends everyone else to the calendar", () => expect(routeLead("ceo@acme.ae", 1)).toBe("calendar"));
  it("normalises websites and rejects junk", () => {
    expect(cleanWebsite("WWW.Acme.ae/contact")).toBe("acme.ae");
    expect(cleanWebsite("not a site")).toBeNull();
  });
  it("rejects invalid emails and strips markup", () => {
    expect(cleanEmail("Bob@Acme.AE ")).toBe("bob@acme.ae");
    expect(cleanEmail("<script>@x")).toBeNull();
  });
  it("keeps scores between 0 and 100", () => {
    expect(scoreLead({ dealBand: 3, pkg: "signal", freeEmail: false, country: "India" })).toBe(95);
    expect(scoreLead({ dealBand: 0, pkg: "unsure", freeEmail: true, country: "Other" })).toBe(10);
  });
});

describe("pricing and the 10% advance", () => {
  it("sprint: 3,500 AED, advance 350", () => {
    const s = fixedScope("AED", "sprint", "revive");
    expect(s.total).toBe(3500); expect(advanceAmount(s.total)).toBe(350);
  });
  it("engine: setup + 3-month minimum term", () => {
    expect(fixedScope("AED", "engine", "signal").total).toBe(5000 + 3 * 7500);
    expect(fixedScope("INR", "engine", "response").total).toBe(50000 + 3 * 75000);
    expect(advanceAmount(275000)).toBe(27500);
  });
  it("single event", () => expect(eventScope("INR").total).toBe(35000));
  it("refuses a sprint for packages other than Revive", () => expect(() => fixedScope("AED", "sprint", "signal")).toThrow());
  it("quote totals are computed server-side and validated", () => {
    expect(quoteTotal([{ description: "Arabic copy", quantity: 2, unit_price: 1250.5 }, { description: "CRM sync", quantity: 1, unit_price: 3000 }])).toBe(5501);
    expect(() => quoteTotal([{ description: "", quantity: 1, unit_price: 1 }])).toThrow();
  });
  it("formats money in local style", () => {
    expect(money(27500, "AED")).toBe("AED 27,500");
    expect(money(275000, "INR")).toBe("₹2,75,000");
  });
});

describe("booking slots (Gulf Standard Time)", () => {
  // Monday 2 November 2026, 08:00 GST = 04:00 UTC
  const now = new Date("2026-11-02T04:00:00Z");
  it("offers weekday slots from 10:00 GST with 2 hours' notice", () => {
    const s = freeSlots(now, []);
    expect(s[0].label).toBe("Mon 2 Nov, 10:00 GST");
    expect(s[0].start).toBe("2026-11-02T06:00:00.000Z");
    expect(s.every(x => !x.label.startsWith("Sat") && !x.label.startsWith("Sun"))).toBe(true);
  });
  it("skips slots that clash with a busy time, including the buffer", () => {
    const busy = [{ start: new Date("2026-11-02T06:00:00Z"), end: new Date("2026-11-02T06:45:00Z") }];
    expect(freeSlots(now, busy)[0].label).toBe("Mon 2 Nov, 11:00 GST");   // busy ends 10:45 + 15-minute buffer
  });
  it("only accepts a start time that is actually offered", () => {
    expect(isOfferedSlot("2026-11-02T06:00:00Z", now, [])).not.toBeNull();
    expect(isOfferedSlot("2026-11-02T06:05:00Z", now, [])).toBeNull();
  });
  it("sends the 24-hour reminder, then the 1-hour reminder, once each", () => {
    const start = new Date("2026-11-03T06:00:00Z");
    expect(dueReminder(start, new Date("2026-11-02T06:02:00Z"), false, false)).toBe("24h");
    expect(dueReminder(start, new Date("2026-11-02T06:02:00Z"), true, false)).toBeNull();
    expect(dueReminder(start, new Date("2026-11-03T05:00:00Z"), true, false)).toBe("1h");
    expect(dueReminder(start, new Date("2026-11-03T05:00:00Z"), true, true)).toBeNull();
    expect(dueReminder(start, new Date("2026-11-03T06:01:00Z"), false, false)).toBeNull();
  });
});

describe("payment webhooks", () => {
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", amount_total: 275000, currency: "aed", metadata: { proposal_id: "p1", quote_id: "" } } } });
  it("accepts a correctly signed Stripe event", async () => {
    const t = 1_800_000_000;
    const sig = await hmac("whsec_test", `${t}.${body}`);
    expect(await verifyStripe(body, `t=${t},v1=${sig}`, "whsec_test", t + 10)).toBe(true);
  });
  it("rejects a tampered, unsigned or old Stripe event", async () => {
    const t = 1_800_000_000;
    const sig = await hmac("whsec_test", `${t}.${body}`);
    expect(await verifyStripe(body + " ", `t=${t},v1=${sig}`, "whsec_test", t)).toBe(false);
    expect(await verifyStripe(body, null, "whsec_test", t)).toBe(false);
    expect(await verifyStripe(body, `t=${t},v1=${sig}`, "whsec_test", t + 600)).toBe(false);
  });
  it("verifies Razorpay signatures", async () => {
    const raw = '{"event":"payment_link.paid"}';
    expect(await verifyRazorpay(raw, await hmac("rzp", raw), "rzp")).toBe(true);
    expect(await verifyRazorpay(raw, "00", "rzp")).toBe(false);
  });
  it("normalises paid events", () => {
    expect(parseStripeEvent(JSON.parse(body))).toEqual({ proposalId: "p1", quoteId: undefined, ref: "cs_1", amount: 2750, currency: "AED", status: "paid" });
    expect(parseRazorpayEvent({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_1", amount_paid: 2750000, currency: "INR", notes: { proposal_id: "p2", quote_id: "q9" } } } } }))
      .toEqual({ proposalId: "p2", quoteId: "q9", ref: "plink_1", amount: 27500, currency: "INR", status: "paid" });
    expect(parseStripeEvent({ type: "customer.created" })).toBeNull();
  });
});

describe("AI output checks", () => {
  it("extracts JSON and repairs invalid plan choices", () => {
    const raw = 'Here you go: {"summary":"S","notes":{"pains":["slow replies"]},"minutes":{"decisions":[],"actions":[]},"requirements":{"recommended_plan":"sprint","recommended_package":"signal"}} done';
    const a = parseAnalysis(raw);
    expect(a.requirements.recommended_plan).toBe("engine");   // sprint is only for Revive
    expect(a.notes.goals).toEqual([]);
  });
  it("refuses answers without JSON", () => expect(() => parseAnalysis("no json here")).toThrow());
  it("price table comes from code and includes the advance", () => {
    const p = priceBlock("AED", "engine", "signal");
    expect(p.advance).toBe(2750);
    expect(p.md).toContain("AED 27,500");
    expect(p.md).toContain("Advance to start (10%)");
  });
});

describe("Google Sheet CRM mapping", () => {
  it("finds the existing row for a record so updates do not duplicate", () => {
    expect(findRow([["Record_ID"], ["a"], ["b"]], "b")).toBe(3);
    expect(findRow([["Record_ID"]], "z")).toBeNull();
  });
  it("lead rows match the header length", () => {
    const row = TABS.lead.row({ id: "1", created_at: "2026-10-19T10:00:00Z", email: "x@y.ae", status: "new", source: "book_form", deal_band: 2 });
    expect(row.length).toBe(TABS.lead.header.length);
    expect(row[8]).toBe("AED 50k–250k / ₹12L–60L");
  });
  it("shows times in GST", () => expect(gst("2026-11-02T06:00:00Z")).toBe("2026-11-02 10:00"));
});

describe("blog rendering", () => {
  it("never outputs raw HTML from a post", () => {
    const out = renderMarkdown("Hello <script>alert(1)</script>\n\n## Step 1: Clean");
    expect(out).not.toContain("<script>");
    expect(out).toContain('<h2 id="step-1-clean">');
  });
  it("fills the page shell with title, canonical and structured data", () => {
    const page = postPage("https://ripepiper.com", { slug: "a-post", title: "A <b>post</b>", description: "D", body_md: "## One\ntext", cover_path: null, cover_alt: null, author_name: "Dipuraj Thapa", published_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" });
    const out = fillShell("<title>{{TITLE}}</title><link rel=canonical href={{CANONICAL}}>{{JSONLD}}<main>{{BODY}}</main>", page);
    expect(out).toContain("<title>A &lt;b&gt;post&lt;/b&gt; | Ripe Piper</title>");
    expect(out).toContain("https://ripepiper.com/blog/a-post");
    expect(out).toContain('"@type":"Article"');
  });
});

describe("ads currency and email encoding", () => {
  it("converts USD spend into AED and INR", () => {
    expect(toTenantCurrency(100, "USD", "AED", { USD: 3.6725 })).toBe(367.25);
    expect(toTenantCurrency(100, "USD", "INR", { USD: 3.6725, INR: 0.044 })).toBe(8346.59);
    expect(() => toTenantCurrency(1, "EUR", "AED", {})).toThrow();
  });
  it("encodes non-ASCII subjects for Gmail", () => {
    expect(buildMime("a@b.com", "c@d.com", "₹ price", "body")).toContain("Subject: =?UTF-8?B?");
  });
});
