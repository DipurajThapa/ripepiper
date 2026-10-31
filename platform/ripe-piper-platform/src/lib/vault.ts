import type { Env } from "../env";

/** AES-GCM sealing for tenant connection credentials. Plaintext and key material never leave the Worker or reach errors/logs. */
export type Sealed = { keyId: string; iv: Uint8Array; ciphertext: Uint8Array };
type KeyEntry = { source: string; keys: Map<string, Promise<CryptoKey>> };
// Cache imported keys within one runtime configuration (google.ts token pattern); a changed secret invalidates the entry.
const cache = new WeakMap<Env, KeyEntry>();
const KID = /^[a-z0-9-]{1,32}$/;
export class VaultError extends Error {}

/** Binds a ciphertext to its tenant, connection and provider: a row copied elsewhere fails to open. */
export const connectionAad = (tenantId: string, connectionId: string, provider: string) => `${tenantId}|${connectionId}|${provider}`;

function key(env: Env, kid: string): Promise<CryptoKey> {
  const source = env.CONNECTION_KEYS ?? "";
  let entry = cache.get(env);
  if (!entry || entry.source !== source) { entry = { source, keys: new Map() }; cache.set(env, entry); }
  let found = entry.keys.get(kid);
  if (!found) {
    let raw: Uint8Array | undefined;
    try {
      const keys = JSON.parse(source);
      if (KID.test(kid) && keys && typeof keys === "object" && Object.hasOwn(keys, kid) && typeof keys[kid] === "string")
        raw = Uint8Array.from(atob(keys[kid]), c => c.charCodeAt(0));
    } catch { /* malformed secret: same failure as unknown kid */ }
    if (raw?.length !== 32) throw new VaultError("Connection key is not configured");
    found = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    entry.keys.set(kid, found);
  }
  return found;
}

export async function seal(env: Env, aad: string, plaintext: string): Promise<Sealed> {
  const keyId = env.CONNECTION_KEY_CURRENT ?? "", iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, await key(env, keyId), new TextEncoder().encode(plaintext));
  return { keyId, iv, ciphertext: new Uint8Array(ciphertext) };
}

/** Throws on an unknown kid, a malformed IV, or any AAD/ciphertext mismatch. Callers re-seal when keyId is not current. */
export async function open(env: Env, aad: string, sealed: Sealed): Promise<string> {
  const k = await key(env, sealed.keyId);
  if (sealed.iv.length !== 12) throw new VaultError("Sealed credential could not be opened");
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv, additionalData: new TextEncoder().encode(aad) }, k, sealed.ciphertext)); }
  catch { throw new VaultError("Sealed credential could not be opened"); }
}
