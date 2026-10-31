import type { Env } from "../env";

/** OAuth authorization code + PKCE for tenant mailboxes. No DB access: state persistence and registration are the caller's. */
export type OAuthProvider = "google_workspace" | "microsoft_365";
export type ConnectionPurpose = "mail_send" | "calendar";
export const PROVIDERS = {
  google_workspace: {
    slug: "google", authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token",
    identity: "https://openidconnect.googleapis.com/v1/userinfo", base: ["openid", "email"],
    // Sensitive scopes only; restricted Gmail read scopes are deliberately absent.
    // calendar.events books meetings; calendar.freebusy is what the freeBusy availability query accepts.
    scopes: { mail_send: ["https://www.googleapis.com/auth/gmail.send"], calendar: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"] },
  },
  microsoft_365: {
    slug: "microsoft", authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    identity: "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", base: ["openid", "email", "offline_access", "User.Read"],
    // Mail.Send alone covers sendMail with MIME; no mailbox read access is requested.
    scopes: { mail_send: ["Mail.Send"], calendar: ["Calendars.ReadWrite"] },
  },
} as const;
export class OAuthError extends Error {
  constructor(public status: number, message = "OAuth request failed") { super(`${message} (${status})`); }
}
export const oauthEnabled = (env: Env) => env.OAUTH_ENABLED === "true";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
export const hashState = async (state: string) => Array.from(await sha256(state), b => b.toString(16).padStart(2, "0")).join("");
export const pkceChallenge = async (verifier: string) => b64url(await sha256(verifier));
export const redirectUri = (env: Env, provider: OAuthProvider) => new URL(`/api/oauth/${PROVIDERS[provider].slug}/callback`, env.SITE_URL).href;

function client(env: Env, provider: OAuthProvider) {
  if (!oauthEnabled(env)) throw new OAuthError(0, "OAuth is disabled");
  const [id, secret] = provider === "google_workspace" ? [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET] : [env.MS_CLIENT_ID, env.MS_CLIENT_SECRET];
  if (!id?.trim() || !secret?.trim()) throw new OAuthError(0, "OAuth client is not configured");
  return { id, secret };
}
export function requestedScopes(provider: OAuthProvider, purposes: readonly ConnectionPurpose[]): string[] {
  const p = PROVIDERS[provider];
  if (!purposes.length || purposes.some(x => !Object.hasOwn(p.scopes, x))) throw new OAuthError(0, "Unsupported connection purpose");
  return [...new Set([...p.base, ...purposes.flatMap(x => p.scopes[x])])];
}

/** Returns the state (sent to the provider) with its hash and the verifier (both stored server-side by the caller). */
export async function startAuthorization(env: Env, provider: OAuthProvider, purposes: readonly ConnectionPurpose[]) {
  const { id } = client(env, provider), state = random(), verifier = random();
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirectUri(env, provider), response_type: "code", scope: requestedScopes(provider, purposes).join(" "),
    state, code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256" });
  // Google issues a refresh token only with offline access; consent is forced so a reconnect returns one again.
  if (provider === "google_workspace") { q.set("access_type", "offline"); q.set("include_granted_scopes", "true"); q.set("prompt", "consent"); }
  else q.set("response_mode", "query");
  return { state, stateHash: await hashState(state), verifier, url: `${PROVIDERS[provider].authorize}?${q}` };
}

async function post(url: string, init: RequestInit): Promise<any> {
  let res: Response;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new OAuthError(0, "OAuth response is uncertain"); }
  // Provider bodies can carry tokens or account details: status only.
  if (!res.ok) throw new OAuthError(res.status);
  try { return await res.json(); } catch { throw new OAuthError(0, "Invalid OAuth response"); }
}

export async function exchangeCode(env: Env, provider: OAuthProvider, code: string, verifier: string) {
  const { id, secret } = client(env, provider);
  if (!/^[\x21-\x7e]{1,4096}$/.test(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new OAuthError(400, "Invalid authorization response");
  const j = await post(PROVIDERS[provider].token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri(env, provider) }) });
  if (typeof j?.access_token !== "string" || !j.access_token || typeof j.refresh_token !== "string" || !j.refresh_token)
    throw new OAuthError(0, "Invalid OAuth token response");
  return { accessToken: j.access_token as string, refreshToken: j.refresh_token as string, scope: typeof j.scope === "string" ? j.scope : "" };
}

/** The verified mailbox of the consenting account, lowercased. Unverified Google addresses are refused. */
export async function fetchIdentity(provider: OAuthProvider, accessToken: string): Promise<string> {
  const j = await post(PROVIDERS[provider].identity, { headers: { Authorization: `Bearer ${accessToken}` } });
  const email = provider === "google_workspace" ? (j?.email_verified === true ? j.email : null) : (j?.mail || j?.userPrincipalName);
  if (typeof email !== "string" || !/^[^\s@<>",;]{1,64}@[^\s@<>",;]{1,255}$/.test(email)) throw new OAuthError(0, "Account identity could not be verified");
  return email.toLowerCase();
}

/** Requested scopes the provider actually granted, and the purposes fully covered by them. Never widens the request. */
export function grantedScopes(provider: OAuthProvider, purposes: readonly ConnectionPurpose[], scopeField: string) {
  // Microsoft may return the field URL-encoded and Graph scopes with their resource prefix; its scopes are case-insensitive.
  const norm = (s: string) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase();
  let field = scopeField; try { field = decodeURIComponent(scopeField.replace(/\+/g, " ")); } catch { /* keep raw */ }
  const granted = new Set(field.split(/\s+/).filter(Boolean).map(norm));
  const scopes = requestedScopes(provider, purposes).filter(s => granted.has(norm(s)));
  return { scopes, purposes: purposes.filter(p => PROVIDERS[provider].scopes[p].every(s => scopes.includes(s))) };
}
