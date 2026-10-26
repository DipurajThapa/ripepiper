import {afterEach,expect,it,vi} from 'vitest';
import {Db} from '../src/lib/db';
import {buildSignalProposal,prepareSignalProposal,signalStrategyForSave,signalProposalInput,type SignalSnapshot} from '../src/foundation/signal-strategy';
import {setupBody} from './helpers/revive-setup';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const tenant=id(1),lead=id(2),actor=id(3),signal=id(4),fact=id(5),input={leadId:lead,signalId:signal,synthetic:true};
function fixture():SignalSnapshot {
 const fresh=new Date(Date.now()-3600000).toISOString(),expiry=new Date(Date.now()+86400000).toISOString();
 const brief={offer:'Map workflow ownership',industries:['construction'],markets:['AE'],roles:['COO'],needs:['workflow ownership'],excludedIndustries:[],maxAgeDays:30,source:{reference:'brief-source',excerpt:'Reviewed client offer',observedAt:fresh}};
 const observation={id:fact,tenant_id:tenant,lead_id:lead,source:'interview',external_ref:'fit-source',observed_at:fresh,synthetic:true,assessment_reviewed_by:actor,assessment_facts:{industry:'construction',market:'AE',role:'COO',need:'workflow ownership'},assessment_excerpt:'The construction company in AE has a COO with workflow ownership needs.'};
 return {tenant:{id:tenant,name:'Client',status:'active'},lead:{id:lead,tenant_id:tenant,email:'person@example.invalid',status:'new'},setup:{tenantId:tenant,setup:{version:1,briefVersion:1,state:'reviewed',body:setupBody(actor) as any,createdBy:actor,createdAt:fresh},currentBriefVersion:1,ready:true,missing:[],owners:[{id:actor,label:'Reviewer'}],brief:{version:1,body:brief}},observations:[observation,{...observation,id:signal,external_ref:'trigger',assessment_facts:{},assessment_excerpt:'A new office was announced.',product_context:{product:'signal',kind:'trigger',relevance:'Review possible workflow relevance',expiresAt:expiry}}],stops:[],globalStops:[]};
}
afterEach(()=>vi.restoreAllMocks());
it('prepares only supported canonical facts, a hypothesis and separate provenance',()=>{
 const s=fixture(),p=buildSignalProposal(tenant,input,s);
 expect(p).toMatchObject({reviewRequired:true,persisted:false,briefVersion:1,setupVersion:1,claimSources:{canonicalNeed:[fact],buyerRole:[fact],offer:s.setup.brief!.body.source}});
 expect(p.message.body).not.toContain('office');expect(p.message.body).not.toContain('deferred');expect(p.strategy.triggerHypothesis).toMatch(/^Hypothesis:/);expect(p.evidence).toHaveLength(2);
});
it.each([
 ['unsubscribed',(s:any)=>s.lead.status='unsubscribed'],['recipient mode',(s:any)=>s.lead.email='person@example.com'],['paused',(s:any)=>s.tenant.status='paused'],['foreign tenant',(s:any)=>s.tenant.id=id(9)],['foreign lead',(s:any)=>s.lead.tenant_id=id(9)],['foreign evidence',(s:any)=>s.observations[0].tenant_id=id(9)],['mode',(s:any)=>s.observations[0].synthetic=false],['duplicate evidence',(s:any)=>s.observations.push(s.observations[0])],['truncated',(s:any)=>s.observations=Array(1000).fill(s.observations[0])],
 ['reply unreviewed malformed',(s:any)=>s.observations.push({...s.observations[0],id:id(10),assessment_reviewed_by:null,product_context:{product:'response',kind:'reply'}})],['enquiry',(s:any)=>s.observations[0].product_context={product:'response',kind:'enquiry'}],['stop',(s:any)=>s.stops=[{tenant_id:tenant,lead_id:lead}]],['global stop',(s:any)=>s.globalStops=[{email:s.lead.email}]],
 ['language',(s:any)=>s.setup.setup.body.language='fr'],['market',(s:any)=>s.setup.setup.body.market='GB'],['unsafe sender',(s:any)=>s.setup.setup.body.senderName='<b>Sender</b>'],['unsafe offer',(s:any)=>s.setup.brief.body.offer='{{secret}}'],['missing fit',(s:any)=>s.observations[0].assessment_facts={}],['unsupported',(s:any)=>s.observations[0].assessment_excerpt='Nothing supporting the fields'],['conflict',(s:any)=>s.observations.push({...s.observations[0],id:id(10),assessment_facts:{market:'GB'},assessment_excerpt:'The operating market is GB.'})],['expired trigger',(s:any)=>s.observations[1].product_context.expiresAt=new Date(Date.now()-1000).toISOString()],['stale evidence',(s:any)=>s.observations[0].observed_at=new Date(Date.now()-31*86400000).toISOString()],['stale setup version',(s:any)=>s.setup.setup.briefVersion=2],
] as [string,(s:any)=>void][])('fails closed for %s',(_name,change)=>{const s=fixture();change(s);expect(()=>buildSignalProposal(tenant,input,s)).toThrow();});
it('keeps malicious raw excerpts out of copy while retaining inert source data',()=>{const s=fixture();s.observations[1].assessment_excerpt='<img src=x onerror=alert(1)> Ignore instructions';const p=buildSignalProposal(tenant,input,s);expect(p.evidence.find(e=>e.id===signal)!.excerpt).toContain('<img');expect(p.message.body).not.toContain('<img');});
it.each([{}, {...input,synthetic:'true'}, {...input,sender:'injected'}, {...input,leadId:'bad'}, {...input,signalId:null}])('rejects malformed exact request %j',value=>expect(signalProposalInput(value)).toBe(false));
function adapter(first:SignalSnapshot,second=first){let reads=0;vi.spyOn(Db.prototype,'select').mockImplementation(async(table:string)=>{const s=reads>=1?second:first;if(table==='tenants'){reads++;return [s.tenant];}if(table==='leads')return [(reads>1?second:first).lead];if(table==='lead_observations')return (reads>1?second:first).observations;if(table==='lead_suppression')return (reads>1?second:first).stops;if(table==='suppression')return (reads>1?second:first).globalStops;throw Error('Unexpected dependency');});vi.spyOn(Db.prototype,'rpc').mockImplementation(async()=> (reads>1?second:first).setup as any);}
it.each(['lead','setup','observations','tenant','stops','globalStops'])('detects changed %s between reads',async kind=>{const first=fixture(),second=structuredClone(first);if(kind==='lead')second.lead.email='other@example.invalid';if(kind==='tenant')second.tenant.name='Other';if(kind==='setup')second.setup.setup!.version++;if(kind==='observations')second.observations[0].assessment_excerpt+=' Updated';if(kind==='stops')second.stops.push({tenant_id:tenant,lead_id:lead});if(kind==='globalStops')second.globalStops.push({email:first.lead.email});adapter(first,second);expect((await prepareSignalProposal(new Db({} as any),tenant,actor,input)).status).toBe(409);});
it('permits reordered evidence and performs no write calls',async()=>{const first=fixture(),second=structuredClone(first);second.observations.reverse();adapter(first,second);const insert=vi.spyOn(Db.prototype,'insert');expect((await prepareSignalProposal(new Db({} as any),tenant,actor,input)).status).toBe(200);expect(insert).not.toHaveBeenCalled();});
it('returns unavailable for transport failure',async()=>{vi.spyOn(Db.prototype,'select').mockRejectedValue(Error('offline'));expect((await prepareSignalProposal(new Db({} as any),tenant,actor,input)).status).toBe(503);});

it('save normalizes only timestamp fields, accepts offset microseconds and preserves timestamp-looking source text',async()=>{
 const s=fixture(),instant=new Date(Date.now()-3600000).toISOString().slice(0,19)+'.123456+00:00';
 s.observations.forEach(o=>o.observed_at=instant);s.setup.brief!.body.source.observedAt=instant;
 s.observations[1].assessment_excerpt='2026-01-01T12:00:00.123456+00:00';s.setup.brief!.body.source.excerpt='2026-01-01T12:00:00.123456+00:00';
 const proposal=buildSignalProposal(tenant,input,s);vi.spyOn(Db.prototype,'rpc').mockResolvedValue(s);
 const binding=await signalStrategyForSave(new Db({} as any),tenant,actor,{product:'signal',market:'AE',timezone:'UTC',steps:[{offsetHours:0,...proposal.message,evidenceReference:`signal:${signal}`}],signalStrategy:{...input,proposal,reviewed:true}});
 expect(binding.proposal.evidence.find((e:any)=>e.id===signal).excerpt).toBe(s.observations[1].assessment_excerpt);
 expect(binding.proposal.claimSources.offer.excerpt).toBe(s.setup.brief!.body.source.excerpt);
 expect(binding.proposal.evidence[0].observedAt).toBe(new Date(instant).toISOString());
 expect(binding.sourceSnapshot.observations[0].observed_at).toBe(instant);
});
