/** Input validation and the qualify-then-book routing rules from the website blueprint. */

export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "icloud.com",
  "aol.com", "rediffmail.com", "proton.me", "protonmail.com", "zoho.com", "gmx.com", "mail.com",
]);
export const PACKAGES = ["revive", "signal", "response", "events", "unsure"] as const;
export type PackageKey = (typeof PACKAGES)[number];

export function cleanText(v: unknown, max = 200): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function cleanEmail(v: unknown): string | null {
  const e = cleanText(v, 254).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) ? e : null;
}

export function isFreeEmail(email: string): boolean {
  return FREE_EMAIL_DOMAINS.has(email.split("@")[1] ?? "");
}

export function cleanWebsite(v: unknown): string | null {
  let s = cleanText(v, 200).toLowerCase();
  if (!s) return null;
  if (!/^https?:\/\//.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.hostname.includes(".") ? u.hostname.replace(/^www\./, "") : null;
  } catch { return null; }
}

export type Route = "calendar" | "work_email" | "not_fit";

/** Same routing the website shows: personal email -> ask for work email; smallest deal band -> polite not-yet; else calendar. */
export function routeLead(email: string, dealBand: number): Route {
  if (isFreeEmail(email)) return "work_email";
  if (dealBand <= 0) return "not_fit";
  return "calendar";
}

/** Initial lead score (0-100) from the form answers. Refined later by the outreach engine. */
export function scoreLead(input: { dealBand: number; pkg: string; freeEmail: boolean; country: string }): number {
  let s = 30 + input.dealBand * 15;                         // 30, 45, 60, 75
  if (input.pkg !== "unsure") s += 10;
  if (["United Arab Emirates", "India", "AE", "IN"].includes(input.country)) s += 10;
  if (input.freeEmail) s -= 20;
  return Math.max(0, Math.min(100, s));
}

export interface UtmFields { utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string; gclid?: string; fbclid?: string; li_fat_id?: string; landing_page?: string }

/** Keep attribution data from the visit so it follows the lead to the deal (needed for honest ROI). */
export function pickUtm(body: Record<string, unknown>): UtmFields {
  const keys: (keyof UtmFields)[] = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "li_fat_id", "landing_page"];
  const out: UtmFields = {};
  for (const k of keys) { const v = cleanText(body[k], 300); if (v) out[k] = v; }
  return out;
}

/** WhatsApp number in E.164 (+ then 8-15 digits, no leading zero); spaces, dashes and brackets are ignored. */
export function e164(v: unknown): string | null {
  const s = cleanText(v, 40).replace(/[\s().-]/g, "");
  return /^\+[1-9][0-9]{7,14}$/.test(s) ? s : null;
}
