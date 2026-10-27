import {afterEach,describe,expect,it,vi} from 'vitest';
import {Db} from '../src/lib/db';
import type {Env} from '../src/env';

// Independent Goldfish tests exercise the actual transport rather than a Db mock.
const env={SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic'} as Env;
const encode=(s:string)=>new TextEncoder().encode(s);
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe('independent snapshot transport adversaries',()=>{
  it('counts UTF-8 bytes across chunks and accepts exactly the response ceiling',async()=>{
    const bytes=encode(JSON.stringify({label:'é界'}));
    vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}})));
    expect(await new Db(env,8000,bytes.length).rpc('fixture',{})).toEqual({label:'é界'});
    await expect(new Db(env,8000,bytes.length-1).rpc('fixture',{})).rejects.toThrow('byte limit');
  });
  it('cancels an over-ceiling stream without reading its remainder',async()=>{
    let cancelled=false;
    vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(new ReadableStream({start(c){c.enqueue(encode('123456'));},cancel(){cancelled=true;}})));
    await expect(new Db(env,8000,5).rpc('fixture',{})).rejects.toThrow('byte limit');
    expect(cancelled).toBe(true);
  });
  it('keeps the same deadline active after headers while the body stalls',async()=>{
    vi.useFakeTimers();let cancelled=false;let signal:AbortSignal|null|undefined;
    vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{signal=init?.signal;return new Response(new ReadableStream({start(c){c.enqueue(encode('{'));},cancel(){cancelled=true;}}));});
    const pending=new Db(env,8000,8*1024*1024).rpc('fixture',{});
    const rejected=expect(pending).rejects.toThrow('deadline');
    await vi.advanceTimersByTimeAsync(7999);expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);await rejected;
    expect(signal?.aborted).toBe(true);expect(cancelled).toBe(true);
  });
  it('times out a fetch that never returns headers even if the adapter ignores abort',async()=>{
    vi.useFakeTimers();vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(()=>{}));
    const rejected=expect(new Db(env,8000,8*1024*1024).rpc('fixture',{})).rejects.toThrow('deadline');
    await vi.advanceTimersByTimeAsync(8000);await rejected;
  });
  it('rejects malformed UTF-8 and truncated JSON',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(Uint8Array.of(0x22,0xc3,0x22)))
      .mockResolvedValueOnce(new Response('{"status":'));
    await expect(new Db(env,8000,1024).rpc('fixture',{})).rejects.toThrow();
    await expect(new Db(env,8000,1024).rpc('fixture',{})).rejects.toThrow();
  });
  it('applies the ceiling to error response bodies too',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('over-limit',{status:503}));
    await expect(new Db(env,8000,5).rpc('fixture',{})).rejects.toThrow('byte limit');
  });
});
