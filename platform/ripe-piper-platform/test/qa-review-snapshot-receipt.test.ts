import {afterEach,describe,it,expect,vi} from 'vitest';
import {prospectShortlist} from '../src/foundation/prospecting-routes';
import {validProspectSnapshot} from '../src/foundation/prospect-snapshot';
import type {Env} from '../src/env';
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',lead='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const now=Date.parse('2026-10-27T12:00:00Z');
const env={SUPABASE_URL:'https://qa-snapshot.example.invalid',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'} as Env;
function receipt():any{return {version:1,status:'complete',tenantId:tenant,synthetic:true,snapshotAt:new Date(now).toISOString(),brief:{tenant_id:tenant,version:1,created_by:actor,created_at:'2026-10-26T12:00:00Z',body:{offer:'Fixture',industries:['construction'],markets:['AE'],roles:['owner'],needs:['follow-up'],excludedIndustries:[],maxAgeDays:90,source:{reference:'fixture',excerpt:'construction AE owner follow-up',observedAt:'2026-10-26T12:00:00Z'}}},leads:[{id:lead,email:'fixture@example.invalid',company:null,status:'new'}],observations:[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',tenant_id:tenant,lead_id:lead,source:'fixture',external_ref:'first',observed_at:'2026-10-26T12:00:00Z',assessment_facts:{industry:'construction',market:'AE',role:'owner',need:'follow-up'},assessment_excerpt:'construction AE owner follow-up',assessment_reviewed_by:actor,synthetic:true,brief_version:1,product_context:null}],owners:[{id:actor,label:'Fixture staff'}],stoppedLeadIds:[],leadCount:1,observationCount:1,ownerCount:1};}
async function review(value:any,raw?:string){
 vi.spyOn(Date,'now').mockReturnValue(now);
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
   const u=String(input);
   if(u.includes('/auth/v1/user'))return Response.json({id:actor,email:'staff@example.invalid'});
   if(u.includes('/rest/v1/profiles?'))return Response.json([{is_admin:true}]);
   if(u.endsWith('/rpc/review_prospect_snapshot')){expect(JSON.parse(String(init?.body))).toEqual({p_tenant:tenant,p_actor:actor,p_synthetic:true});return raw===undefined?Response.json(value):new Response(raw);}
   throw new Error('Independent QA rejects fallback reads: '+u);
 });
 return prospectShortlist(new Request('https://worker.example.invalid/shortlist',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({synthetic:true,p_actor:'forged'})}),env,tenant);
}
afterEach(()=>vi.restoreAllMocks());
describe('independent snapshot receipt adversaries',()=>{
 it.each(['__proto__','constructor','toString'])('rejects prototype status %s with unavailable response',async status=>{expect((await review({version:1,status})).status).toBe(503);});
 it('fails unavailable for deeply nested bounded-byte receipt JSON without throwing',async()=>{
   const v=receipt();v.observations[0].assessment_facts={payload:'qa_nested'};
   const raw=JSON.stringify(v).replace('"qa_nested"','{"x":'.repeat(8000)+'0'+'}'.repeat(8000));
   expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(65536);
   expect((await review(v,raw)).status).toBe(503);
 });
 it('preserves the existing candidate assessor and single evaluation instant',async()=>{const response=await review(receipt());expect(response.status).toBe(200);const body:any=await response.json();expect(body.results[0]).toMatchObject({state:'candidate',contactAllowed:false,score:null});expect(body.assessedAt).toBe(new Date(now).toISOString());expect(body.snapshotAt).toBe(body.assessedAt);});
 it('never drops a conflicting observation solely because UUID letter case differs',async()=>{
   const v=receipt();v.observations.push({...v.observations[0],id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',lead_id:lead.toUpperCase(),external_ref:'conflicting',assessment_facts:{industry:'retail'},assessment_excerpt:'retail'});v.observationCount=2;
   const response=await review(v);if(response.status===503)return;expect(response.status).toBe(200);expect((await response.json() as any).results[0].state).toBe('review');
 });
 it('handles equivalent tenant UUID case by canonical validation or consistent assessment',async()=>{
   const v=receipt();v.observations[0].tenant_id=tenant.toUpperCase();
   const response=await review(v);if(response.status===503)return;expect(response.status).toBe(200);expect((await response.json() as any).results[0].state).toBe('candidate');
 });
 it('cannot turn an explicitly unsubscribed contact into a candidate when stopped IDs are malformed',async()=>{
   const v=receipt();v.leads[0].status='unsubscribed';
   const response=await review(v);if(response.status===503)return;expect(response.status).toBe(200);expect((await response.json() as any).results[0].state).toBe('excluded');
 });
 it('discards a previously assessed candidate if a later contact has malformed nested product values',async()=>{
   const v=receipt(),second='ffffffff-ffff-4fff-8fff-ffffffffffff';
   v.leads.push({...v.leads[0],id:second,email:'second@example.invalid'});v.leadCount=2;
   v.observations.push({...v.observations[0],id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',lead_id:second,product_context:{product:'response',kind:'conversation_review',threadRef:'fixture',ownerId:{toString:'invalid'}}});v.observationCount=2;
   const response=await review(v);expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty('results');
 });
 it('admits exact timestamp tolerances and rejects one millisecond outside',()=>{
   for(const age of [-5000,60000]){const v=receipt();v.snapshotAt=new Date(now-age).toISOString();expect(validProspectSnapshot(v,tenant,true,now)).toBe(true);}
   for(const age of [-5001,60001]){const v=receipt();v.snapshotAt=new Date(now-age).toISOString();expect(validProspectSnapshot(v,tenant,true,now)).toBe(false);}
 });
});



