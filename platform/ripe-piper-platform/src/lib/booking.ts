/** Consultation capability is short-lived, one-use and bound to one lead. */
export const BOOKING_TOKEN_TTL_MS = 15 * 60_000;
export function newBookingToken(): string { return crypto.randomUUID(); }
export async function hashBookingToken(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
export function validBookingToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
}
