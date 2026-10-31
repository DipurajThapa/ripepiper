import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import worker from '../src/index';
import type {Env} from '../src/env';
import {businessIndicators,discoveryRegistry,discoveryUrl,discoveryParameters} from '../src/foundation/signal-discovery';
const t1='11111111-1111-4111-8111-111111111111',t2='22222222-2222-4222-8222-222222222222';
const sid=(n:number)=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`;
const params={industries:['Software'],geographies:['London'],keywords:['pipeline'],excludeKeywords:[],targetRoles:['Sales director'],lookbackDays:30};
const source=(n=1,kind='greenhouse',tenantId=t1)=>({id:sid(n),tenantId,kind,...(kind==='business_feed'?{url:'https://feed.publisher.io/evidence.json'}:{board:'fixture'}),company:'Publisher',companyDomain:'publisher.io',industries:['Software'],permissionReference:'reviewed-public-purpose',expiresAt:'2026-12-01T00:00:00Z',enabled:true,synthetic:true});
const post=(id='p1',indicator='company_post',patch:any={})=>({id,company:'Member '+id,companyDomain:id+'.business.io',sourceUrl:'https://'+id+'.business.io/news?version=1',publishedAt:'2026-10-25T00:00:00Z',title:'Pipeline update',text:'Our pipeline process '+id,location:'London',industry:'Software',indicator,deadline:indicator==='supplier_request'?'2026-11-01T00:00:00Z':null,...patch});
const gh=()=>({jobs:[{id:1,title:'Pipeline engineer',content:'<p>Build pipeline systems</p>',location:{name:'London'},absolute_url:'https://jobs.business.io/one?gh=1',updated_at:'2026-10-25T00:00:00Z'}],meta:{total:1}});
const lever=()=>[{id:'a',text:'Pipeline engineer',descriptionPlain:'Build pipeline systems',categories:{location:'London'},hostedUrl:'https://jobs.business.io/two'}];
let env:Env,calls:{url:URL;init:RequestInit}[],payloads:Map<string,()=>Response|Promise<Response>>,hook:(()=>void)|undefined,tenantReceipt:any,admin:boolean;
const invoke=(operation='discover',body:any={parameters:params,synthetic:true},tenant=t1,token='admin')=>worker.fetch(new Request(`https://app.business.io/api/admin/tenants/${tenant}/signal-source`,{method:'POST',headers:{Authorization:token?'Bearer '+token:'','Content-Type':'application/json'},body:JSON.stringify({operation,body})}),env,{} as any);
const urlFor=(kind:string)=>kind==='greenhouse'?'https://boards-api.greenhouse.io/v1/boards/fixture/jobs?content=true':kind==='lever'?'https://api.lever.co/v0/postings/fixture?mode=json&limit=100&skip=0':'https://feed.publisher.io/evidence.json';
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
 env={SUPABASE_URL:'https://db.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'secret',SUPABASE_ANON_KEY:'public',SIGNAL_DISCOVERY_SOURCES:JSON.stringify([source()]),SIGNAL_DISCOVERY_FEED_HOSTS:JSON.stringify(['feed.publisher.io'])} as Env;
 calls=[];payloads=new Map([[urlFor('greenhouse'),()=>Response.json(gh())],[urlFor('lever'),()=>Response.json(lever())],[urlFor('business_feed'),()=>Response.json({items:[post()],complete:true})]]);hook=undefined;tenantReceipt=undefined;admin=true;
 vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>{
  const url=new URL(input);calls.push({url,init});
  if(url.hostname==='db.supabase.invalid'){
   if(url.pathname==='/rest/v1/rpc/tenant_access')return Response.json(admin);
   if(init.method&&init.method!=='GET')throw Error('DENIED DATABASE WRITE');
   if(url.pathname==='/auth/v1/user')return Response.json({id:'actor',email:'actor@fixture.invalid'});
   if(url.pathname==='/rest/v1/profiles')return Response.json([{is_admin:admin}]);
   if(url.pathname==='/rest/v1/tenants'){const id=url.searchParams.get('id')?.slice(3);return Response.json(tenantReceipt===undefined?[{id,status:'active'}]:tenantReceipt);}
   throw Error('DENIED DATABASE PATH');
  }
  if(init.method!=='GET'||init.redirect!=='error'||!(init.signal instanceof AbortSignal))throw Error('DENIED PROVIDER METHOD');
  const run=payloads.get(url.href);if(!run)throw Error('DENIED UNEXPECTED NETWORK');hook?.();return run();
 });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('real Worker discovery dispatch and read-only isolation',()=>{
 it('requires staff authentication and exact active tenant receipts before source access',async()=>{
  expect((await invoke('discover',undefined,t1,'')).status).toBe(401);
  admin=false;expect((await invoke()).status).toBe(404);admin=true;
  tenantReceipt=[{id:t2,status:'active'}];expect((await invoke()).status).toBe(403);
  tenantReceipt=[{id:t1,status:'paused'}];expect((await invoke()).status).toBe(403);
  expect(calls.filter(c=>c.url.hostname!=='db.supabase.invalid')).toHaveLength(0);
 });
 it('lists only same-tenant enabled unexpired matching-mode safe identity and preserves legacy status',async()=>{
  env.SIGNAL_DISCOVERY_SOURCES=JSON.stringify([source(),{...source(2,'lever',t2),company:'Other'}, {...source(3,'greenhouse'),board:'real',synthetic:false}]);
  const a:any=await (await invoke('discovery-status',{synthetic:true})).json();expect(a.sources).toEqual([{id:sid(1),company:'Publisher',kind:'greenhouse',expiresAt:'2026-12-01T00:00:00Z'}]);
  const b:any=await (await invoke('discovery-status',{synthetic:true},t2)).json();expect(b.sources[0].id).toBe(sid(2));
  expect(a).toMatchObject({tenantId:t1,synthetic:true,contactAllowed:false,persisted:false,delivery:'not_sent'});
  expect(await (await invoke('status',{})).json()).toMatchObject({state:'not_connected'});
  expect(calls.filter(c=>c.url.hostname!=='db.supabase.invalid')).toHaveLength(0);
 });
 it('keeps the existing source preview and import review guard reachable through the real Worker',async()=>{
  env.SIGNAL_SOURCE_CONNECTIONS=JSON.stringify([{id:sid(9),tenantId:t1,url:'https://legacy.publisher.io/source',purposeReference:'legacy-review',expiresAt:'2026-12-01T00:00:00Z',enabled:true,synthetic:true}]);
  const saved=globalThis.fetch;
  vi.stubGlobal('fetch',async(input:string,init:RequestInit={})=>input==='https://legacy.publisher.io/source'?Response.json({items:[]}):saved(input,init));
  expect(await (await invoke('status',{})).json()).toMatchObject({state:'configured_unverified',sourceId:sid(9)});
  expect(await (await invoke('preview',{})).json()).toMatchObject({items:[],sourceId:sid(9)});
  expect((await invoke('import',{})).status).toBe(400);
  expect(calls.every(c=>c.url.pathname==='/rest/v1/rpc/tenant_access'||!c.init.method||c.init.method==='GET')).toBe(true);
 });
 it('runs all adapters for two tenants without contact invention or publisher attribution bleed',async()=>{
  env.SIGNAL_DISCOVERY_SOURCES=JSON.stringify([source(),source(2,'lever'),source(3,'business_feed'),{...source(4,'lever',t2),company:'Second client board'}]);
  payloads.set(urlFor('business_feed'),()=>Response.json({items:businessIndicators.map((i,n)=>post('p'+n,i)),complete:true}));
  const a:any=await (await invoke()).json(),b:any=await (await invoke('discover',undefined,t2)).json();
  expect(a.complete).toBe(true);expect(a.candidates).toHaveLength(11);expect(b.candidates).toHaveLength(1);expect(b.candidates[0].company).toBe('Second client board');
  expect(new Set(a.candidates.map((c:any)=>c.indicator))).toEqual(new Set(['job_posting',...businessIndicators]));
  expect(a.candidates.filter((c:any)=>c.sourceId===sid(3)).every((c:any)=>c.company.startsWith('Member'))).toBe(true);
  expect(a.candidates.find((c:any)=>c.sourceId===sid(1))).toMatchObject({indicator:'job_posting',dateKind:'updated'});
  expect(a.candidates.find((c:any)=>c.sourceId===sid(2))).toMatchObject({sourceDate:null,dateKind:'unknown',intent:'unverified',contactState:'unknown'});
  expect(JSON.stringify(a)).not.toContain('email');expect(calls.every(c=>c.url.pathname==='/rest/v1/rpc/tenant_access'||!c.init.method||c.init.method==='GET')).toBe(true);
 });
 it.each(['registry','hosts','paused','foreign_receipt','expiry'])('discards results after %s revocation during collection',async kind=>{
  hook=()=>{if(kind==='registry')env.SIGNAL_DISCOVERY_SOURCES='[]';if(kind==='hosts')env.SIGNAL_DISCOVERY_FEED_HOSTS='[]';if(kind==='paused')tenantReceipt=[{id:t1,status:'paused'}];if(kind==='foreign_receipt')tenantReceipt=[{id:t2,status:'active'}];if(kind==='expiry')vi.setSystemTime(new Date('2026-12-02'));};
  const r=await invoke();expect(r.status).toBe(503);expect(await r.text()).not.toContain('Pipeline engineer');
 });
});
describe('business evidence and literal research filtering',()=>{
 const analyse=(posts:any[],patch:any={})=>invoke('analyse-posts',{parameters:params,synthetic:true,permissionReference:'permitted-export',reviewed:true,posts,...patch});
 it('keeps all nine declared families and counts only distinct company posts',async()=>{
  const posts=businessIndicators.map((i,n)=>post('p'+n,i));posts.push({...posts[0],id:'repost'});
  const a:any=await (await analyse(posts)).json();expect(a.complete).toBe(true);expect(a.candidates).toHaveLength(9);expect(a.postingActivity).toEqual([{companyDomain:'p0.business.io',company:'Member p0',count:1,windowDays:30,sampleOnly:true}]);
  expect(a.candidates[0].id).toMatch(/^operator-export:[0-9a-f]{64}$/);expect(calls.filter(c=>c.url.hostname!=='db.supabase.invalid')).toHaveLength(0);
 });
 it('separates invalid and ordinary filtered evidence, retaining null-date directories',async()=>{
  const rows=[post('old','company_post',{publishedAt:'2026-01-01T00:00:00Z'}),post('future','company_post',{publishedAt:'2026-12-01T00:00:00Z'}),post('expired','supplier_request',{deadline:'2026-10-26T12:00:00Z'}),post('directory','directory_listing',{publishedAt:null}),post('bad','company_post',{sourceUrl:'https://127.0.0.1/x'}),post('other','company_post',{email:'person@business.io'}),post('geo','company_post',{location:'Paris'}),post('industry','company_post',{industry:'Other'})];
  const a:any=await (await analyse(rows)).json();expect(a.candidates).toHaveLength(1);expect(a.candidates[0]).toMatchObject({sourceDate:null,dateKind:'unknown',indicator:'directory_listing'});expect(a.sourceResults[0]).toMatchObject({invalid:3,filtered:4,excluded:7,state:'incomplete'});
 });
 it('uses literal phrases and exclusions, never applicant roles as buyer evidence',async()=>{
  const a:any=await (await analyse([post()],{parameters:{...params,excludeKeywords:['process']}})).json();expect(a.candidates).toEqual([]);expect(a.complete).toBe(true);
  const b:any=await (await analyse([post()],{parameters:{...params,geographies:['UK']}})).json();expect(b.candidates).toEqual([]);
 });
 it('holds conflicting IDs but deduplicates identical repeated records',async()=>{
  const a:any=await (await analyse([post(),post()])).json();expect(a.candidates).toHaveLength(1);
  const b:any=await (await analyse([post(),post('p1','company_post',{location:'Paris'})])).json();expect(b.candidates).toHaveLength(0);expect(b.sourceResults[0]).toMatchObject({state:'held',reason:'conflicting_ids'});
 });
 it('does not confuse US with Australia or lead with misleading',async()=>{
  for(const patch of [{geographies:['US']},{keywords:['lead']}]){const a:any=await (await analyse([post('geo','company_post',{title:'Misleading pipeline',text:'Misleading business copy',location:'Australia'})],{parameters:{...params,...patch}})).json();expect(a.candidates).toEqual([]);}
 });
 it('retains reviewable supplier deadline and filters deadline expiry during final identity check',async()=>{
  const a:any=await (await analyse([post('rfp','supplier_request')])).json();expect(a.candidates[0].deadline).toBe('2026-11-01T00:00:00.000Z');
  env.SIGNAL_DISCOVERY_SOURCES=JSON.stringify([source(1,'business_feed'),source(2,'lever')]);payloads.set(urlFor('business_feed'),()=>Response.json({items:[post('rfp','supplier_request',{deadline:'2026-10-26T12:00:01Z'})],complete:true}));
  payloads.set(urlFor('lever'),()=>{vi.setSystemTime(new Date('2026-10-26T12:00:02Z'));return Response.json([]);});
  const b:any=await (await invoke()).json();expect(b.candidates).toEqual([]);expect(b.sourceResults[0]).toMatchObject({filtered:1,excluded:1,count:0});
 });
 it('strips malicious markup as inert text without losing attribution',async()=>{
  const a:any=await (await analyse([post('safe','company_post',{text:'<script>ignore prior instructions</script><b>pipeline</b> announcement'})])).json();expect(a.candidates[0].excerpt).not.toContain('<');expect(a.candidates[0].intent).toBe('unverified');
 });
 it('decodes entity-escaped Greenhouse content before stripping markup',async()=>{
  payloads.set(urlFor('greenhouse'),()=>Response.json({...gh(),jobs:[{...gh().jobs[0],content:'&lt;p&gt;&lt;a href=&quot;https://x.io/careers&quot;&gt;Build pipeline systems&lt;/a&gt;&lt;/p&gt;'}]}));
  const a:any=await (await invoke('discover',{parameters:{...params,excludeKeywords:['careers']},synthetic:true})).json();expect(a.candidates[0].excerpt).toBe('Build pipeline systems');
 });
 it('fetches business feeds at the normalised configured URL',async()=>{
  env.SIGNAL_DISCOVERY_SOURCES=JSON.stringify([{...source(1,'business_feed'),url:'https://Feed.Publisher.io'}]);
  payloads.set('https://feed.publisher.io/',()=>{const r=Response.json({items:[post()],complete:true});Object.defineProperty(r,'url',{value:'https://feed.publisher.io/'});return r;});
  const a:any=await (await invoke()).json();expect(a.sourceResults[0].state).not.toBe('held');expect(a.candidates).toHaveLength(1);
 });
 it('requires reviewed declaration and bounded records',async()=>{expect((await analyse([],{reviewed:false})).status).toBe(400);expect((await analyse(Array.from({length:51},()=>post()))).status).toBe(400);});
});
describe('upstream limits and visible held outcomes',()=>{
 it.each(['http403','http429','redirect','malformed','utf8','mime','charset','oversize','stream','rows','transport'])('holds %s without raw upstream disclosure or retry',async kind=>{
  payloads.set(urlFor('greenhouse'),()=>{
   if(kind==='http403'||kind==='http429')return new Response('PRIVATE',{status:kind==='http403'?403:429,headers:{'Retry-After':'30'}});
   if(kind==='redirect')return new Response('',{status:302,headers:{Location:'http://localhost'}});
   if(kind==='malformed')return new Response('{',{headers:{'Content-Type':'application/json'}});
   if(kind==='utf8')return new Response(new Uint8Array([0xc3,0x28]),{headers:{'Content-Type':'application/json'}});
   if(kind==='mime')return new Response('{}',{headers:{'Content-Type':'text/html'}});
   if(kind==='charset')return new Response('{}',{headers:{'Content-Type':'application/json;charset=latin1'}});
   if(kind==='oversize')return new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'262145'}});
   if(kind==='stream')return new Response(' '.repeat(262145),{headers:{'Content-Type':'application/json'}});
   if(kind==='rows')return Response.json({jobs:Array.from({length:101},()=>gh().jobs[0]),meta:{total:101}});
   throw Error('PRIVATE token');
  });
  const a:any=await (await invoke()).json();expect(a.complete).toBe(false);expect(a.sourceResults[0].state).toBe('held');expect(JSON.stringify(a)).not.toContain('PRIVATE');expect(calls.filter(c=>c.url.hostname==='boards-api.greenhouse.io')).toHaveLength(1);if(kind==='http429')expect(a.sourceResults[0].retryAfterSeconds).toBe(30);
 });
 it('times out stalled streams within 15 seconds and cancels reading',async()=>{
  vi.useFakeTimers();const cancel=vi.fn();payloads.set(urlFor('greenhouse'),()=>new Response(new ReadableStream({start(){},cancel}),{headers:{'Content-Type':'application/json'}}));const run=invoke();await vi.advanceTimersByTimeAsync(15001);const a:any=await (await run).json();expect(a.sourceResults[0].reason).toBe('source_timeout');expect(cancel).toHaveBeenCalled();
 });
 it('caps combined output deterministically and reports full Lever and incomplete feed samples',async()=>{
  env.SIGNAL_DISCOVERY_SOURCES=JSON.stringify([source(),source(2,'lever'),source(3,'business_feed')]);
  payloads.set(urlFor('greenhouse'),()=>Response.json({jobs:Array.from({length:100},(_,i)=>({...gh().jobs[0],id:i})),meta:{total:100}}));
  payloads.set(urlFor('lever'),()=>Response.json(Array.from({length:100},(_,i)=>({...lever()[0],id:'x'+i}))));
  payloads.set(urlFor('business_feed'),()=>Response.json({items:[post()],complete:false}));
  const a:any=await (await invoke()).json();expect(a.candidates).toHaveLength(100);expect(a.complete).toBe(false);expect(a.sourceResults[1]).toMatchObject({count:0,state:'incomplete',reason:'candidate_limit'});expect(a.sourceResults[2].state).toBe('incomplete');
 });
 it('holds Greenhouse impossible total receipts and conflicts nested in a duplicate job location',async()=>{
  payloads.set(urlFor('greenhouse'),()=>Response.json({...gh(),meta:{total:0}}));expect((await (await invoke()).json() as any).sourceResults[0].state).toBe('held');
  payloads.set(urlFor('greenhouse'),()=>Response.json({jobs:[gh().jobs[0],{...gh().jobs[0],location:{name:'Paris'}}],meta:{total:2}}));expect((await (await invoke()).json() as any).sourceResults[0].reason).toBe('conflicting_ids');
 });
 it('reports provider truncation, unknown ages and empty source sets honestly',async()=>{
  payloads.set(urlFor('greenhouse'),()=>Response.json({...gh(),meta:{total:500}}));const a:any=await (await invoke()).json();expect(a.complete).toBe(false);expect(a.sourceResults[0].state).toBe('incomplete');
  env.SIGNAL_DISCOVERY_SOURCES='[]';const b:any=await (await invoke()).json();expect(b.complete).toBe(false);expect(b.candidates).toEqual([]);
 });
});
describe('configuration and URL validation',()=>{
 it.each(['https://localhost/x','https://127.0.0.1/x','https://2130706433/x','https://host.internal/x','https://host.corp/x','https://host.localdomain/x','https://host.test/x','https://example.com/x','https://name:password@business.io/x','https://business.io:443/x','https://business.io/x#fragment','https://business.io/\nx','https://business.io\\x'])('rejects unsafe reference %s',url=>expect(discoveryUrl(url)).toBeNull());
 it('allows reference query strings without fetching them',()=>expect(discoveryUrl('https://business.io/jobs?id=123')).toBe('https://business.io/jobs?id=123'));
 it.each(['duplicate','private','allowlist','mode','count','malformed'])('fails closed for %s config',kind=>{
  const rows:any[]=kind==='duplicate'?[source(),source()]:kind==='count'?Array.from({length:6},(_,i)=>({...source(i),board:'b'+i})):[source()];
  if(kind==='private')rows[0].companyDomain='localhost';if(kind==='mode')delete rows[0].synthetic;if(kind==='allowlist')rows[0]={...source(1,'business_feed'),url:'https://unapproved.io/a'};
  env.SIGNAL_DISCOVERY_SOURCES=kind==='malformed'?'bad':JSON.stringify(rows);expect(()=>discoveryRegistry(env)).toThrow();
 });
 it('does not reject naturally expired configuration, and rejects malformed parameters',()=>{
  env.SIGNAL_DISCOVERY_SOURCES=JSON.stringify([{...source(),expiresAt:'2020-01-01T00:00:00Z'}]);expect(discoveryRegistry(env)).toHaveLength(1);
  for(const patch of [{keywords:[]},{keywords:['pipeline','PIPELINE']},{lookbackDays:91},{keywords:['<script>']},{keywords:['%NAME%']},{url:'https://attacker.io'}])expect(discoveryParameters({...params,...patch})).toBeNull();
 });
});
