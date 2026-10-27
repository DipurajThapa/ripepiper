import {validBrief, validInstant, type BusinessBrief, type Observation} from './prospecting';

export const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
export interface ProspectSnapshot {
 version:1; status:'complete'; tenantId:string; synthetic:boolean; snapshotAt:string;
 brief:null|{tenant_id:string;version:number;body:BusinessBrief;created_by:string;created_at:string};
 leads:{id:string;company:string|null;email:string;status:string}[];
 observations:Observation[]; stoppedLeadIds:string[]; owners:{id:string;label:string}[];
 leadCount:number; observationCount:number; ownerCount:number;
}
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
 if(!keys(v,['version','status','tenantId','synthetic','snapshotAt','brief','leads','observations','stoppedLeadIds','owners','leadCount','observationCount','ownerCount'])||v.version!==1||v.status!=='complete'||!id(v.tenantId)||!same(v.tenantId,tenantId)||v.synthetic!==synthetic||!validInstant(v.snapshotAt))return false;
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
 return total<=1048576;
}
