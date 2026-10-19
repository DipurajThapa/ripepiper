import type { Env } from "../env";
import { googleToken } from "./google";

/** Read-only ad reporting. Each function returns normalised daily rows for one ad account. */
export interface AdRow { day: string; campaign_ref: string; campaign_name: string; spend: number; currency: string; impressions: number; clicks: number; conversions: number }

/** Google Ads API: GAQL via searchStream. Spend comes back in micros. */
export async function googleAdsRows(env: Env, customerId: string, from: string, to: string, apiVersion = "v21"): Promise<AdRow[]> {
  const token = await googleToken(env);
  const query = `SELECT segments.date, campaign.id, campaign.name, customer.currency_code, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
                 FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;
  const res = await fetch(`https://googleads.googleapis.com/${apiVersion}/customers/${customerId.replace(/-/g, "")}/googleAds:searchStream`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN, "login-customer-id": env.GOOGLE_ADS_LOGIN_CUSTOMER_ID, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Google Ads ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const chunks = (await res.json()) as any[];
  return chunks.flatMap(c => c.results ?? []).map((r: any) => ({
    day: r.segments.date, campaign_ref: String(r.campaign.id), campaign_name: r.campaign.name,
    spend: Number(r.metrics.costMicros ?? 0) / 1e6, currency: r.customer.currencyCode,
    impressions: Number(r.metrics.impressions ?? 0), clicks: Number(r.metrics.clicks ?? 0), conversions: Number(r.metrics.conversions ?? 0),
  }));
}

/** Meta Marketing API insights, one row per campaign per day. */
export async function metaRows(env: Env, adAccountId: string, from: string, to: string, apiVersion = "v23.0"): Promise<AdRow[]> {
  const out: AdRow[] = [];
  const params = new URLSearchParams({
    level: "campaign", time_increment: "1", time_range: JSON.stringify({ since: from, until: to }),
    fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency", limit: "500", access_token: env.META_ACCESS_TOKEN,
  });
  let url: string | null = `https://graph.facebook.com/${apiVersion}/act_${adAccountId.replace(/^act_/, "")}/insights?${params}`;
  while (url) {
    const res: Response = await fetch(url);
    const j = (await res.json()) as any;
    if (!res.ok) throw new Error(`Meta ${res.status}: ${j.error?.message ?? "error"}`);
    for (const r of j.data ?? []) {
      const leads = (r.actions ?? []).filter((a: any) => ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"].includes(a.action_type))
        .reduce((s: number, a: any) => s + Number(a.value), 0);
      out.push({ day: r.date_start, campaign_ref: r.campaign_id, campaign_name: r.campaign_name, spend: Number(r.spend ?? 0), currency: r.account_currency,
        impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), conversions: leads });
    }
    url = j.paging?.next ?? null;
  }
  return out;
}

/** LinkedIn adAnalytics by campaign and day (requires r_ads_reporting and a role on the client's ad account). */
export async function linkedinRows(env: Env, accountId: string, from: string, to: string, version = "202610"): Promise<AdRow[]> {
  const [fy, fm, fd] = from.split("-").map(Number), [ty, tm, td] = to.split("-").map(Number);
  const q = `q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=(start:(year:${fy},month:${fm},day:${fd}),end:(year:${ty},month:${tm},day:${td}))` +
    `&accounts=List(urn%3Ali%3AsponsoredAccount%3A${accountId})&fields=dateRange,pivotValues,costInLocalCurrency,impressions,clicks,oneClickLeads,externalWebsiteConversions`;
  const res = await fetch(`https://api.linkedin.com/rest/adAnalytics?${q}`, {
    headers: { Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`, "LinkedIn-Version": version, "X-Restli-Protocol-Version": "2.0.0" },
  });
  const j = (await res.json()) as any;
  if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${j.message ?? "error"}`);
  return (j.elements ?? []).map((e: any) => {
    const s = e.dateRange.start;
    return {
      day: `${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`,
      campaign_ref: String(e.pivotValues?.[0] ?? "").split(":").pop() ?? "", campaign_name: "",
      spend: Number(e.costInLocalCurrency ?? 0), currency: "", impressions: Number(e.impressions ?? 0), clicks: Number(e.clicks ?? 0),
      conversions: Number(e.oneClickLeads ?? 0) + Number(e.externalWebsiteConversions ?? 0),
    };
  });
}

/** Convert spend into the client's currency so cost and ROI add up. Rates are supplied by the caller (AED per unit). */
export function toTenantCurrency(amount: number, from: string, to: "AED" | "INR", aedPer: Record<string, number>): number {
  if (!from || from === to) return amount;
  const inAed = amount * (from === "AED" ? 1 : aedPer[from] ?? NaN);
  const out = to === "AED" ? inAed : inAed / (aedPer["INR"] ?? NaN);
  if (!Number.isFinite(out)) throw new Error(`No exchange rate for ${from} to ${to}.`);
  return Math.round(out * 100) / 100;
}
