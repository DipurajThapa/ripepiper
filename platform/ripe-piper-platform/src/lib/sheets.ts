import type { Env } from "../env";
import { Db } from "./db";
import { sheetEnsureTab, sheetValues, sheetWrite, sheetAppend } from "./google";

/**
 * Google Sheet CRM sync. The database is the source of truth; every change is copied to the
 * B2B Outbound Engine spreadsheet. The existing "Sheet1" (outbound engine) is never modified.
 * Each entity has its own tab. Column A holds the record id, so updates overwrite the same row.
 */
export const TABS = {
  lead: {
    tab: "Website_Leads",
    header: ["Record_ID", "Created_At", "Name", "Email", "Company", "Website", "Country", "Package_Interest", "Deal_Band", "Score", "Status", "Source", "UTM_Source", "UTM_Campaign", "Landing_Page"],
    row: (l: any) => [l.id, l.created_at, l.name ?? "", l.email, l.company ?? "", l.website ?? "", l.country ?? "", l.package_interest ?? "", DEAL_BANDS[l.deal_band] ?? "", l.score ?? "", l.status, l.source, l.utm_source ?? "", l.utm_campaign ?? "", l.landing_page ?? ""],
    table: "leads", where: "tenant_id=is.null",
  },
  meeting: {
    tab: "Meetings",
    header: ["Record_ID", "Start_GST", "Attendee", "Email", "Status", "Meet_Link", "Reminder_24h", "Reminder_1h", "AI_Summary", "Recommended_Plan", "Recommended_Package"],
    row: (m: any) => [m.id, gst(m.start_at), m.attendee_name ?? "", m.attendee_email, m.status, m.meet_url ?? "", m.reminder_24h_at ? "Sent" : "", m.reminder_1h_at ? "Sent" : "",
      m.notes?.summary ?? "", m.requirements?.recommended_plan ?? "", m.requirements?.recommended_package ?? ""],
    table: "meetings", where: "tenant_id=is.null",
  },
  proposal: {
    tab: "Proposals",
    header: ["Record_ID", "Created_At", "Kind", "Client_Email", "Plan", "Package", "Currency", "Fixed_Amount", "Advance_%", "Advance_Amount", "Status", "Sent_At", "Approved_At", "Paid_At"],
    row: (p: any) => [p.id, p.created_at, p.kind, p.client_email, p.plan, p.package, p.currency, p.fixed_amount, p.advance_pct, p.advance_amount, p.status, p.sent_at ?? "", p.approved_at ?? "", p.paid_at ?? ""],
    table: "proposals", where: "",
  },
  payment: {
    tab: "Payments",
    header: ["Record_ID", "Created_At", "Provider", "Provider_Ref", "Purpose", "Amount", "Currency", "Status", "Proposal_ID"],
    row: (p: any) => [p.id, p.created_at, p.provider, p.provider_ref, p.purpose, p.amount, p.currency, p.status, p.proposal_id ?? ""],
    table: "payments", where: "",
  },
} as const;

export const DEAL_BANDS = ["Under AED 10k / ₹2.5L", "AED 10k–50k / ₹2.5L–12L", "AED 50k–250k / ₹12L–60L", "Over AED 250k / ₹60L"];

export function gst(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 4 * 3600_000);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/** Row number (1-based) for a record id in column A, or null when the record is new. */
export function findRow(columnA: string[][], id: string): number | null {
  const i = columnA.findIndex(r => r[0] === id);
  return i >= 0 ? i + 1 : null;
}

/** Default-off outbox sync. Uncertain appends/concurrent runs still require operator recovery. */
export async function syncSheet(env: Env, batch = 40): Promise<{ synced: number; failed: number; disabled?: boolean }> {
  if(env.SHEETS_SYNC_ENABLED!=="true")return {synced:0,failed:0,disabled:true};
  const db = new Db(env);
  const pending = await db.select<any>("sheet_outbox", `synced_at=is.null&attempts=lt.8&order=created_at.asc&limit=${batch}`);
  if (!pending.length) return { synced: 0, failed: 0 };
  // Several outbox rows can point at the same record; sync each record once.
  const unique = new Map<string, any[]>();
  for (const p of pending) unique.set(`${p.entity}:${p.entity_id}`, [...(unique.get(`${p.entity}:${p.entity_id}`) ?? []), p]);
  const ensured = new Set<string>();
  const colA = new Map<string, string[][]>();
  let synced = 0, failed = 0;
  for (const [key, items] of unique) {
    const [entity, id] = key.split(":") as [keyof typeof TABS, string];
    const cfg = TABS[entity];
    try {
      const rec = await db.one<any>(cfg.table, `id=eq.${id}${cfg.where ? "&" + cfg.where : ""}&select=*`);
      if (rec) {
        if (!ensured.has(cfg.tab)) { await sheetEnsureTab(env, cfg.tab, [...cfg.header]); ensured.add(cfg.tab); }
        if (!colA.has(cfg.tab)) colA.set(cfg.tab, await sheetValues(env, `${cfg.tab}!A:A`));
        const rows = colA.get(cfg.tab)!;
        const n = findRow(rows, id);
        const values = [cfg.row(rec as any).map(v => (v === null || v === undefined ? "" : v))];
        if (n) await sheetWrite(env, `${cfg.tab}!A${n}`, values as any);
        else { await sheetAppend(env, cfg.tab, values as any); rows.push([id]); }
      }
      await db.update("sheet_outbox", `id=in.(${items.map(i => i.id).join(",")})`, { synced_at: new Date().toISOString() });
      synced++;
    } catch (e) {
      failed++;
      await db.update("sheet_outbox", `id=in.(${items.map(i => i.id).join(",")})`, { attempts: (items[0].attempts ?? 0) + 1, last_error: String(e).slice(0, 500) });
    }
  }
  return { synced, failed };
}
