import {afterEach,it,expect,vi} from 'vitest';
import {prospectShortlist} from '../src/foundation/prospecting-routes';
import type {Env} from '../src/env';
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',lead='cccccccc-cccc-4ccc-8ccc-cccccccccccc',observation='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const env={SUPABASE_URL:'https://bounded.fixture.invalid',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test'} as Env;
const now=Date.parse('2026-10-27T18:00:00Z');
function receipt():any{return {version:1,status:'complete',tenantId:tenant,synthetic:true,snapshotAt:new Date(now).toISOString(),brief:null,leads:[{id:lead,company:null,email:'contact@fixture.invalid',status:'new'}],observations:[{id:observation,tenant_id:tenant,lead_id:lead,source:'fixture',external_ref:'fixture',observed_at:'2026-10-26T18:00:00Z',assessment_facts:{unsupported:['retained','ignored']},assessment_excerpt:null,assessment_reviewed_by:null,synthetic:true,brief_version:null,product_context:null}],stoppedLeadIds:[],owners:[],leadCount:1,observationCount:1,ownerCount:0};}
let calls:string[]=[];
function review(response:()=>Response|Promise<Response>,scope=tenant){
 vi.spyOn(Date,'now').mockReturnValue(now);calls=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const u=String(input);calls.push(u);
  if(u.includes('/auth/v1/user'))return Response.json({id:actor,email:'staff@fixture.invalid'});
  if(u.includes('/profiles?'))return Response.json([{is_admin:true}]);
  if(u.endsWith('/rpc/tenant_access')){expect(JSON.parse(String(init?.body))).toEqual({p_tenant:scope.toLowerCase(),p_actor:actor,p_capability:'read'});return Response.json(true);}
  if(u.endsWith('/review_prospect_snapshot')){expect(JSON.parse(String(init?.body))).toEqual({p_tenant:scope,p_actor:actor,p_synthetic:true});return response();}
  throw Error('Independent fallback reads forbidden');
 });
 return prospectShortlist(new Request('https://worker.fixture.invalid/shortlist',{method:'POST',headers:{Authorization:'Bearer staff','Content-Type':'application/json'},body:JSON.stringify({synthetic:true,p_actor:lead})}),env,scope);
}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it('preserves no-brief unknown and unsupported object evidence without fabricating facts',async()=>{const r=await review(()=>Response.json(receipt()));expect(r.status).toBe(200);expect((await r.json() as any).results[0]).toMatchObject({state:'unknown',contactAllowed:false});expect(calls).toHaveLength(4);});
it('accepts uppercase request UUID against canonical SQL scope',async()=>{const r=await review(()=>Response.json(receipt()),tenant.toUpperCase());expect(r.status).toBe(200);});
const mutations:[string,(v:any)=>void][]=[
 ['missing receipt key',v=>delete v.observations],['unknown receipt key',v=>v.extra=true],['foreign tenant',v=>v.tenantId=actor],['wrong mode',v=>v.synthetic=false],['count mismatch',v=>v.observationCount=0],['duplicate lead',v=>{v.leads.push(v.leads[0]);v.leadCount++;}],['duplicate observation',v=>{v.observations.push(v.observations[0]);v.observationCount++;}],['foreign evidence tenant',v=>v.observations[0].tenant_id=actor],['missing evidence lead',v=>v.observations[0].lead_id=actor],['wrong evidence mode',v=>v.observations[0].synthetic=false],['null facts',v=>v.observations[0].assessment_facts=null],['array facts',v=>v.observations[0].assessment_facts=[]],['invalid reviewer',v=>v.observations[0].assessment_reviewed_by='staff'],['array context',v=>v.observations[0].product_context=[]],['foreign stop',v=>v.stoppedLeadIds=[actor]],['duplicate stop',v=>v.stoppedLeadIds=[lead,lead]],['owner shape',v=>{v.owners=[{id:actor,label:'x',email:'leak'}];v.ownerCount=1;}],['duplicate owner',v=>{v.owners=[{id:actor,label:'x'},{id:actor,label:'x'}];v.ownerCount=2;}],['invalid brief',v=>v.brief={}],['stale snapshot',v=>v.snapshotAt=new Date(now-60001).toISOString()],['future snapshot',v=>v.snapshotAt=new Date(now+5001).toISOString()],['lead UTF8 cap',v=>v.leads[0].company='界'.repeat(3000)],['evidence bytes cap',v=>v.observations[0].assessment_facts={padding:'x'.repeat(65536)}],
];
it.each(mutations)('never emits assessment rows for %s',async(_label,mutate)=>{const v=receipt();mutate(v);const r=await review(()=>Response.json(v));expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('results');});
it.each([['unauthorized',403],['missing',404],['capacity',409]])('maps exact scalar %s status only',async(status,code)=>{const r=await review(()=>Response.json({version:1,status}));expect(r.status).toBe(code);expect(await r.json()).not.toHaveProperty('results');const polluted=await review(()=>Response.json({version:1,status,leads:[]}));expect(polluted.status).toBe(503);});
it.each(['null','{','[]'])('returns 503 for malformed/missing scalar %s',async body=>{const r=await review(()=>new Response(body));expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('results');});
it('rejects response greater than actual 8MiB ceiling before any assessment',async()=>{let cancelled=false;const r=await review(()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(8*1024*1024+1));},cancel(){cancelled=true;}})));expect(r.status).toBe(503);expect(cancelled).toBe(true);expect(await r.json()).not.toHaveProperty('results');});
it('returns 503 after eight seconds for stalled body, without independent reads',async()=>{vi.useFakeTimers();const pending=review(()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}})));await vi.advanceTimersByTimeAsync(8000);const r=await pending;expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('results');expect(calls).toHaveLength(4);});
it('maps permission/HTTP failures to unavailable rather than trusting provider error bodies',async()=>{const r=await review(()=>Response.json({version:1,status:'complete',secret:'untrusted'},{status:403}));expect(r.status).toBe(503);expect(await r.text()).not.toContain('untrusted');});

it('never emits partial assessments when malformed nested product values break a legacy validator',async()=>{const v=receipt();v.observations[0].assessment_reviewed_by=actor;v.observations[0].product_context={product:'response',kind:'conversation_review',threadRef:'fixture',ownerId:{toString:'invalid'}};const r=await review(()=>Response.json(v));expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('results');});

const fact=()=>({domain:'acme.example',legal_name:'Acme Fixture Ltd',industry_code:'4120',industry_scheme:'UK SIC 2007',country:'GB',source:'fixture registry',licence_reference:'fixture licence',permitted_purposes:['prospect_research'],verified_at:'2026-10-01T00:00:00+00:00',expires_at:'2027-03-30T00:00:00+00:00'});
it('accepts a separate licensed reference block without merging it into tenant evidence',async()=>{const v=receipt();v.reference=[fact()];const r=await review(()=>Response.json(v));expect(r.status).toBe(200);expect(JSON.stringify(await r.json())).not.toContain('Acme Fixture');});
it.each<[string,(f:any)=>void]>([
 ['tenant_id inside a fact',f=>f.tenant_id=tenant],['missing licence',f=>f.licence_reference=' '],['unknown purpose',f=>f.permitted_purposes=['marketing']],['not licensed for prospect research',f=>f.permitted_purposes=['icp_matching']],['expired fact',f=>f.expires_at='2026-10-27T17:59:59Z'],['unnormalised domain',f=>f.domain='WWW.Acme.example'],
])('rejects a reference block with %s',async(_label,mutate)=>{const v=receipt();const f=fact();mutate(f);v.reference=[f];const r=await review(()=>Response.json(v));expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('results');});
it('rejects a reference block that is not an array of facts',async()=>{const v=receipt();v.reference={tenant_id:tenant};const r=await review(()=>Response.json(v));expect(r.status).toBe(503);});
