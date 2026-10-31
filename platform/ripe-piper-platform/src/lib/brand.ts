/** Per-tenant sender identity and sign-off. Agency templates (lib/email.ts) keep the Ripe Piper brand and env.MAIL_FROM. */
export type BrandSetup = { senderName?: string | null; signature?: string | null; legalFooter?: { postalAddress: string } | null };

/** Quoted display name; buildMime RFC 2047-encodes it when non-ASCII and rejects CR/LF. */
export function brandFrom(name: string, email: string): string {
  if (/[\r\n<>]/.test(name) || !/^[^\s@<>",;]+@[^\s@<>",;]+$/.test(email.trim())) throw new Error("Invalid sender identity");
  return `"${name.trim().replace(/["\\]/g, "\\$&")}" <${email.trim()}>`;
}

/** Signature (or sender name plus tenant name), then the postal address, then the stop line. */
export function brandSignoff(setup: BrandSetup, tenantName: string, unsubscribeLine: string): string {
  const signature = setup.signature?.trim() || [setup.senderName?.trim(), tenantName.trim()].filter(Boolean).join("\n");
  return [signature, setup.legalFooter?.postalAddress?.trim(), unsubscribeLine.trim()].filter(Boolean).join("\n\n");
}
