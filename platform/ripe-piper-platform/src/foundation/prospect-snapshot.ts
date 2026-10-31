import {validBrief, validInstant, type BusinessBrief, type Observation} from './prospecting';

export const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
export interface ProspectSnapshot {
 version:1; status:'complete'; tenantId:string; synthetic:boolean; snapshotAt:string;
 brief:null|{tenant_id:string;version:number;body:BusinessBrief;created_by:string;created_at:string};
 leads:{id:string;company:string|null;email:string;status:string}[];
 observations:Observation[]; stoppedLeadIds:string[]; owners:{id:string;label:string}[];
 leadCount:number; observationCount:number; ownerCount:number;
 /** Shared reference facts (tenant_reference_facts rows), kept apart from tenant evidence and never merged into assessment_facts. */
 reference?:ReferenceFact[];
}
export interface ReferenceFact {domain:string;legal_name:string|null;industry_code:string|null;industry_scheme:string|null;country:string|null;source:string;licence_reference:string;permitted_purposes:string[];verified_at:string;expires_at:string}
const REFERENCE_KEYS=['domain','legal_name','industry_code','industry_scheme','country','source','licence_reference','permitted_purposes','verified_at','expires_at'];
const SNAPSHOT_KEYS=['version','status','tenantId','synthetic','snapshotAt','brief','leads','observations','stoppedLeadIds','owners','leadCount','observationCount','ownerCount'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:any,expected:string[])=>object(v)&&Object.keys(v).length===expected.length&&expected.every(k=>Object.hasOwn(v,k));
const bytes=(v:string)=>new TextEncoder().encode(v).byteLength;
const string=(v:any,n:number)=>typeof v==='string'&&bytes(v)<=n;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const unique=(values:string[])=>new Set(values.map(v=>v.toLowerCase())).size===values.length;
const jsonBytes=(v:unknown)=>bytes(JSON.stringify(v));
export function snapshotFailure(value:unknown):403|404|409|null {
 if(!object(value)||!keys(value,['version','status'])||value.version!==1)return null;
 return value.status==='unauthorized'?403:value.status==='missing'?404:value.status==='capacity'?409:null;
}
/** Validate the whole receipt before any assessor sees a row. Unsupported object facts remain evidence, not truth. */
export function validProspectSnapshot(v:any,tenantId:string,synthetic:boolean,assessedAt:number):v is ProspectSnapshot {
 try { return validateSnapshot(v,tenantId,synthetic,assessedAt); } catch { return false; }
}
function validateSnapshot(v:any,tenantId:string,synthetic:boolean,assessedAt:number):v is ProspectSnapshot {
 if(!(keys(v,SNAPSHOT_KEYS)||keys(v,[...SNAPSHOT_KEYS,'reference']))||v.version!==1||v.status!=='complete'||!id(v.tenantId)||!same(v.tenantId,tenantId)||v.synthetic!==synthetic||!validInstant(v.snapshotAt))return false;
 const age=assessedAt-Date.parse(v.snapshotAt);if(!Number.isFinite(age)||age< -5000||age>60000)return false;
 if(!Array.isArray(v.leads)||v.leads.length>100||v.leadCount!==v.leads.length||!Array.isArray(v.observations)||v.observations.length>999||v.observationCount!==v.observations.length||!Array.isArray(v.owners)||v.owners.length>100||v.ownerCount!==v.owners.length||!Array.isArray(v.stoppedLeadIds)||v.stoppedLeadIds.length>v.leads.length)return false;
 let total=0;
 for(const l of v.leads){
  if(!keys(l,['id','company','email','status'])||!id(l.id)||(l.company!==null&&!string(l.company,8192))||!string(l.email,8192)||!string(l.status,8192))return false;
  const size=bytes(l.company??'')+bytes(l.email)+bytes(l.status);if(size>8192)return false;total+=size;
 }
 if(!unique(v.leads.map((l:any)=>l.id)))return false;
 const leadIds=new Set(v.leads.map((l:any)=>l.id.toLowerCase()));
 for(const o of v.observations){
  if(!keys(o,['id','tenant_id','lead_id','source','external_ref','observed_at','assessment_facts','assessment_excerpt','assessment_reviewed_by','synthetic','brief_version','product_context'])||!id(o.id)||!id(o.tenant_id)||!same(o.tenant_id,tenantId)||!id(o.lead_id)||!leadIds.has(o.lead_id.toLowerCase())||o.synthetic!==synthetic||!validInstant(o.observed_at)||!string(o.source,65536)||!string(o.external_ref,65536)||!object(o.assessment_facts)||(o.assessment_excerpt!==null&&!string(o.assessment_excerpt,65536))||(o.assessment_reviewed_by!==null&&!id(o.assessment_reviewed_by))||(o.brief_version!==null&&(!Number.isInteger(o.brief_version)||o.brief_version<1))||(o.product_context!==null&&!object(o.product_context)))return false;
  const size=bytes(o.source)+bytes(o.external_ref)+jsonBytes(o.assessment_facts)+bytes(o.assessment_excerpt??'')+(o.product_context===null?0:jsonBytes(o.product_context));if(size>65536)return false;total+=size;
 }
 if(!unique(v.observations.map((o:any)=>o.id))||!v.stoppedLeadIds.every((s:any)=>id(s)&&leadIds.has(s.toLowerCase()))||!unique(v.stoppedLeadIds))return false;
 if(v.leads.some((l:any)=>l.status==='unsubscribed'&&!v.stoppedLeadIds.includes(l.id)))return false;
 for(const o of v.owners){if(!keys(o,['id','label'])||!id(o.id)||typeof o.label!=='string'||Array.from(o.label).length>320||bytes(o.label)>4096)return false;total+=bytes(o.label);}
 if(!unique(v.owners.map((o:any)=>o.id)))return false;
 if(v.brief!==null){
  const b=v.brief;if(!keys(b,['tenant_id','version','body','created_by','created_at'])||!id(b.tenant_id)||!same(b.tenant_id,tenantId)||!Number.isInteger(b.version)||b.version<1||!id(b.created_by)||!validInstant(b.created_at)||!validBrief(b.body,assessedAt))return false;
  const size=jsonBytes(b.body);if(size>262144)return false;total+=size;
 }
 if(Object.hasOwn(v,'reference')){const size=validReference(v.reference,assessedAt);if(size<0)return false;total+=size;}
 return total<=1048576;
}
/** Exact keys, so a tenant_id (or any tenant field) inside the block is rejected. Returns its byte size, or -1. */
function validReference(r:any,assessedAt:number):number {
 if(!Array.isArray(r)||r.length>100||!unique(r.map((f:any)=>f?.domain??'')))return -1;
 const optional=(x:any,n:number)=>x===null||(string(x,n)&&x.length>0);
 for(const f of r)if(!keys(f,REFERENCE_KEYS)||!string(f.domain,253)||!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(f.domain)
  ||!optional(f.legal_name,300)||!optional(f.industry_code,40)||!optional(f.industry_scheme,40)||!(f.country===null||/^[A-Z]{2}$/.test(f.country))
  ||!string(f.source,200)||!f.source.trim()||!string(f.licence_reference,200)||!f.licence_reference.trim()
  ||!Array.isArray(f.permitted_purposes)||!f.permitted_purposes.length||!f.permitted_purposes.every((p:any)=>p==='prospect_research'||p==='icp_matching')||!f.permitted_purposes.includes('prospect_research')
  ||!validInstant(f.verified_at)||!validInstant(f.expires_at)||Date.parse(f.expires_at)<=assessedAt)return -1;
 return jsonBytes(r);
}
