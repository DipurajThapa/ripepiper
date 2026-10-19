/** Published price list (must match the website). Prices are set in code, never by AI. */
export type Currency = "AED" | "INR";
export type Plan = "sprint" | "engine";
export type Pkg = "revive" | "signal" | "response" | "events";

export const PRICES = {
  AED: { sprint: 3500, setup: 5000, engine: 7500, event: 3500 },
  INR: { sprint: 35000, setup: 50000, engine: 75000, event: 35000 },
} as const;

export const MIN_TERM_MONTHS = 3;
export const DEFAULT_ADVANCE_PCT = 10;

export interface FixedScope { currency: Currency; plan: Plan; pkg: Pkg; lines: { label: string; amount: number }[]; total: number }

/**
 * Fixed-scope amount used by the pre-proposal. The 10% advance is calculated from this total.
 * - Revive Sprint: the sprint fee.
 * - Events (single event): the event fee.
 * - Monthly engine: setup fee + the minimum term of monthly fees.
 * Customisations are not included here; they are quoted separately after the proposal is locked.
 */
export function fixedScope(currency: Currency, plan: Plan, pkg: Pkg): FixedScope {
  const p = PRICES[currency];
  let lines: { label: string; amount: number }[];
  if (plan === "sprint") {
    if (pkg !== "revive") throw new Error("The 14-day sprint is available for Ripe Revive only.");
    lines = [{ label: "Ripe Revive 14-day sprint", amount: p.sprint }];
  } else {
    lines = [
      { label: "One-time setup", amount: p.setup },
      { label: `Monthly engine, ${MIN_TERM_MONTHS}-month minimum term (${MIN_TERM_MONTHS} × ${p.engine.toLocaleString("en-US")})`, amount: p.engine * MIN_TERM_MONTHS },
    ];
  }
  return { currency, plan, pkg, lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

export function eventScope(currency: Currency): FixedScope {
  const amount = PRICES[currency].event;
  return { currency, plan: "engine", pkg: "events", lines: [{ label: "Ripe Events, one event up to 1,000 contacts", amount }], total: amount };
}

export function advanceAmount(total: number, pct = DEFAULT_ADVANCE_PCT): number {
  if (!(pct > 0 && pct <= 100)) throw new Error("Advance percentage must be between 0 and 100.");
  return Math.round(total * pct) / 100;
}

/** Quote total for customisations: sum of quantity × unit price, rounded to 2 decimals. */
export function quoteTotal(items: { description: string; quantity: number; unit_price: number }[]): number {
  for (const i of items) {
    if (!i.description || !(i.quantity > 0) || !(i.unit_price >= 0)) throw new Error("Each quote item needs a description, a positive quantity and a price.");
  }
  return Math.round(items.reduce((s, i) => s + i.quantity * i.unit_price, 0) * 100) / 100;
}

export function money(amount: number, currency: Currency): string {
  return currency === "AED" ? `AED ${amount.toLocaleString("en-US")}` : `₹${amount.toLocaleString("en-IN")}`;
}
