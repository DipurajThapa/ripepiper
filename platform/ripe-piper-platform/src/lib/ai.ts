import type { Env } from "../env";
import { fixedScope, eventScope, advanceAmount, money, type Currency, type Plan, type Pkg } from "./pricing";

/** AI meeting analysis and pre-proposal drafting (Claude API). Prices always come from code, never from the model. */

export interface MeetingAnalysis {
  summary: string;
  notes: { pains: string[]; goals: string[]; current_process: string; lead_sources: string[]; budget: string; timeline: string; decision_makers: string[]; objections: string[] };
  minutes: { decisions: string[]; actions: { owner: string; action: string; due: string }[] };
  requirements: { recommended_plan: Plan; recommended_package: Pkg; icp: string; markets: string[]; customisations: string[]; risks: string[] };
}

async function claude(env: Env, system: string, user: string, maxTokens = 2500): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.AI_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`AI request failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { content: { type: string; text?: string }[] };
  return j.content.filter(c => c.type === "text").map(c => c.text).join("");
}

export const ANALYSIS_SYSTEM = `You analyse sales discovery calls for Ripe Piper, a B2B lead generation company serving the UAE and India.
Use only facts stated in the transcript. If something was not discussed, write "Not discussed". Never invent numbers, names or commitments.
Write in plain, complete English sentences.
Packages: revive (old leads), signal (new companies with buying signals), response (fast replies to inbound inquiries), events (exhibition follow-up).
Plans: sprint (14-day Revive test) or engine (monthly).
Return ONLY a JSON object with exactly these keys:
{"summary": string,
 "notes": {"pains": string[], "goals": string[], "current_process": string, "lead_sources": string[], "budget": string, "timeline": string, "decision_makers": string[], "objections": string[]},
 "minutes": {"decisions": string[], "actions": [{"owner": string, "action": string, "due": string}]},
 "requirements": {"recommended_plan": "sprint"|"engine", "recommended_package": "revive"|"signal"|"response"|"events", "icp": string, "markets": string[], "customisations": string[], "risks": string[]}}`;

/** Parse and check the model's JSON so a malformed answer never reaches the database. */
export function parseAnalysis(raw: string): MeetingAnalysis {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI answer did not contain JSON.");
  const a = JSON.parse(raw.slice(start, end + 1)) as MeetingAnalysis;
  const plans = ["sprint", "engine"], pkgs = ["revive", "signal", "response", "events"];
  if (typeof a.summary !== "string" || !a.notes || !a.minutes || !a.requirements) throw new Error("AI answer is missing required sections.");
  if (!plans.includes(a.requirements.recommended_plan)) a.requirements.recommended_plan = "engine";
  if (!pkgs.includes(a.requirements.recommended_package)) a.requirements.recommended_package = "revive";
  if (a.requirements.recommended_plan === "sprint" && a.requirements.recommended_package !== "revive") a.requirements.recommended_plan = "engine";
  for (const k of ["pains", "goals", "lead_sources", "decision_makers", "objections"] as const) if (!Array.isArray(a.notes[k])) a.notes[k] = [];
  if (!Array.isArray(a.minutes.decisions)) a.minutes.decisions = [];
  if (!Array.isArray(a.minutes.actions)) a.minutes.actions = [];
  for (const k of ["markets", "customisations", "risks"] as const) if (!Array.isArray(a.requirements[k])) a.requirements[k] = [];
  return a;
}

export async function analyseMeeting(env: Env, transcript: string, context: { company?: string; attendee?: string }): Promise<MeetingAnalysis> {
  const raw = await claude(env, ANALYSIS_SYSTEM,
    `Company: ${context.company ?? "Unknown"}\nAttendee: ${context.attendee ?? "Unknown"}\n\nTranscript:\n${transcript.slice(0, 120_000)}`, 3000);
  return parseAnalysis(raw);
}

export function minutesMarkdown(a: MeetingAnalysis, title: string, date: string): string {
  const li = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join("\n") : "- Not discussed");
  return `# Minutes: ${title}\n\nDate: ${date}\n\n## Summary\n${a.summary}\n\n## Decisions\n${li(a.minutes.decisions)}\n\n## Actions\n` +
    (a.minutes.actions.length ? a.minutes.actions.map(x => `- ${x.action} (owner: ${x.owner}, due: ${x.due})`).join("\n") : "- None recorded") + "\n";
}

/** Price block inserted by code into the pre-proposal. */
export function priceBlock(currency: Currency, plan: Plan, pkg: Pkg, singleEvent = false, advancePct = 10) {
  const scope = singleEvent ? eventScope(currency) : fixedScope(currency, plan, pkg);
  const adv = advanceAmount(scope.total, advancePct);
  const md = `| Item | Amount |\n|---|---|\n` + scope.lines.map(l => `| ${l.label} | ${money(l.amount, currency)} |`).join("\n") +
    `\n| **Fixed-scope total** | **${money(scope.total, currency)}** |\n| **Advance to start (${advancePct}%)** | **${money(adv, currency)}** |\n\n` +
    `Prices exclude ${currency === "AED" ? "UAE VAT" : "GST"}. Customisations are not included in this total. We will quote them separately after the proposal is confirmed.`;
  return { scope, advance: adv, md };
}

export async function draftPreProposal(env: Env, a: MeetingAnalysis, p: { company: string; contact: string; currency: Currency; singleEvent?: boolean }): Promise<string> {
  const { md: prices } = priceBlock(p.currency, a.requirements.recommended_plan, a.requirements.recommended_package, p.singleEvent);
  const body = await claude(env,
    `You write short pre-proposals for Ripe Piper. Use plain, complete, active-voice sentences and positive framing of the client.
Never mention prices, discounts or guarantees; the price table is added separately. Do not invent facts that are not in the notes.
Write Markdown with exactly these sections: "## Your situation", "## What we will do", "## What you will receive", "## Timeline", "## What we need from you", "## Customisations to quote separately".`,
    `Client company: ${p.company}\nContact: ${p.contact}\nMeeting analysis (JSON): ${JSON.stringify(a)}`, 2000);
  return `# Pre-proposal for ${p.company}\n\n${body.trim()}\n\n## Price and advance\n${prices}\n\n## Next step\nApprove this pre-proposal and pay the advance online. We then send the full proposal and start work within 3 business days.\n`;
}
