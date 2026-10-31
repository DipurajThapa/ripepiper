import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,json,readJson,requireUser} from '../routes/http';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function meetingSnapshot(m:any){return {id:m.id,tenantId:m.tenant_id??null,leadId:m.lead_id??null,kind:m.kind??'discovery',startAt:new Date(m.start_at).toISOString(),endAt:new Date(m.end_at).toISOString(),email:m.attendee_email,name:m.attendee_name??null,eventId:m.google_event_id??null,meetUrl:m.meet_url??null,meetCode:m.meet_code??null};}
export async function saveMeetingDraft(db:Db,m:any,draft:{transcript?:string;notes?:any;minutes?:string;requirements?:any},reason:'transcript_unverified'|'attendance_source_unavailable'|'analysis_unavailable'){
 const result=await db.rpc<any>('save_meeting_draft',{p_meeting:m.id,p_snapshot:meetingSnapshot(m),p_transcript:draft.transcript?.slice(0,256000)??null,p_notes:draft.notes??null,p_minutes:draft.minutes??null,p_requirements:draft.requirements??null,p_reason:reason});
 if(result?.meetingId!==m.id||!Number.isSafeInteger(result.reviewVersion)||result.reviewVersion<0||!['unknown','held','no_show'].includes(result.attendance)||typeof result.notesReady!=='boolean')throw Error('Meeting draft acknowledgement is uncertain');
 return {meetingId:m.id,reviewVersion:result.reviewVersion,attendance:result.attendance,notesReady:result.notesReady};
}
export async function reviewConsultation(req:Request,env:Env,id:string){
 const actor=await requireUser(req,env,true),b=await readJson(req);
 if(!Number.isSafeInteger(b.expected_version)||b.expected_version<0||b.expected_version>2147483646||!b.snapshot||typeof b.snapshot!=='object'||Array.isArray(b.snapshot)||!['held','no_show','unknown'].includes(b.classification)||typeof b.evidence_reference!=='string'||b.evidence_reference.trim().length<8||b.evidence_reference.length>500||typeof b.reason!=='string'||b.reason.trim().length<8||b.reason.length>1000||typeof b.evidence_verified!=='boolean'||typeof b.roster_complete!=='boolean'||!uuid.test(b.request_id??'')||(b.classification!=='unknown'&&!b.evidence_verified)||(b.classification==='no_show'&&!b.roster_complete))return bad('Review the current meeting with authoritative evidence, a reason and the required attendance confirmation.');
 try{
  const receipt=await new Db(env).rpc<any>('review_consultation_attendance',{p_meeting:id,p_actor:actor.id,p_expected:b.expected_version,p_snapshot:b.snapshot,p_classification:b.classification,p_evidence:b.evidence_reference.trim(),p_reason:b.reason.trim(),p_verified:b.evidence_verified,p_roster:b.roster_complete,p_request:b.request_id});
  if(receipt?.meetingId!==id||receipt.version!==b.expected_version+1||receipt.classification!==b.classification||typeof receipt.replayed!=='boolean')return bad('Attendance review result is uncertain. Retry the same request or reload before changing it.',503);
  return json({ok:true,review:{meetingId:id,version:receipt.version,classification:receipt.classification,replayed:receipt.replayed},delivery:'not_sent'});
 }catch(error){if(error instanceof DbError){if(error.body.includes('40001'))return bad('The meeting or review changed. Reload before reviewing again.',409);if(error.body.includes('42501'))return bad('Current staff identity is required.',403);if(error.body.includes('22023'))return bad('Authoritative attendance evidence and a completed meeting are required.',409);}throw error;}
}
