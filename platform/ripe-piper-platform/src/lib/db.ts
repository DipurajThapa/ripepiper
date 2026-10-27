import type { Env } from "../env";

/** Minimal Supabase (PostgREST) client using the service role. Server-side only. */
export class Db {
  constructor(private env: Env, private requestTimeoutMs?: number, private maxResponseBytes?: number) {}

  private headers(extra: Record<string, string> = {}) {
    return {
      apikey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async call<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    // The deadline includes a stalled response body, not only response headers.
    const deadline = new Promise<never>((_, reject) => {
      if (this.requestTimeoutMs) timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => {});
        reject(new Error('Database response deadline exceeded'));
      }, this.requestTimeoutMs);
    });
    const request = async () => {
      const res = await fetch(`${this.env.SUPABASE_URL}/rest/v1/${path}`, { ...init,
        ...(this.requestTimeoutMs ? { signal: controller.signal } : {}),
      });
      let text: string;
      if (this.maxResponseBytes !== undefined) {
        reader = res.body?.getReader();
        const decoder = new TextDecoder('utf-8', {fatal:true,ignoreBOM:false});
        const chunks: string[] = [];
        let bytes = 0;
        if (reader) {
          while (true) {
            const {done,value} = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > this.maxResponseBytes) {
              void reader.cancel().catch(() => {});
              throw new Error('Database response byte limit exceeded');
            }
            chunks.push(decoder.decode(value,{stream:true}));
          }
        }
        chunks.push(decoder.decode());
        text = chunks.join('');
      } else text = await res.text();
      if (!res.ok) throw new DbError(res.status, text);
      return (text ? JSON.parse(text) : null) as T;
    };
    try { return await Promise.race([request(),deadline]); }
    catch (error) { void reader?.cancel().catch(() => {}); throw error; }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }

  select<T = any>(table: string, query: string): Promise<T[]> {
    return this.call<T[]>(`${table}?${query}`, { headers: this.headers() });
  }

  async one<T = any>(table: string, query: string): Promise<T | null> {
    const rows = await this.select<T>(table, `${query}&limit=1`);
    return rows[0] ?? null;
  }

  insert<T = any>(table: string, row: object | object[]): Promise<T[]> {
    return this.call<T[]>(table, { method: "POST", headers: this.headers({ Prefer: "return=representation" }), body: JSON.stringify(row) });
  }

  upsert<T = any>(table: string, row: object | object[], onConflict: string): Promise<T[]> {
    return this.call<T[]>(`${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: this.headers({ Prefer: "return=representation,resolution=merge-duplicates" }),
      body: JSON.stringify(row),
    });
  }

  update<T = any>(table: string, query: string, patch: object): Promise<T[]> {
    return this.call<T[]>(`${table}?${query}`, { method: "PATCH", headers: this.headers({ Prefer: "return=representation" }), body: JSON.stringify(patch) });
  }

  rpc<T>(name: string, args: object): Promise<T> {
    return this.call<T>(`rpc/${name}`, { method: "POST", headers: this.headers(), body: JSON.stringify(args) });
  }

  /** Verify a Supabase access token from the portal/admin and return the profile. */
  async userFromToken(token: string): Promise<{ id: string; email: string; is_admin: boolean } | null> {
    const res = await fetch(`${this.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: this.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { id: string; email: string };
    const p = await this.one<{ is_admin: boolean }>("profiles", `id=eq.${u.id}&select=is_admin`);
    return { id: u.id, email: u.email, is_admin: !!p?.is_admin };
  }
}

export class DbError extends Error {
  constructor(public status: number, public body: string) { super(`Database error ${status}: ${body}`); }
  get isConflict() { return this.status === 409 || this.body.includes("23505") || this.body.includes("23P01"); }
}
