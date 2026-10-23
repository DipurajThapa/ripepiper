import {it,expect,vi,afterEach} from 'vitest';
vi.mock('../src/lib/google',async()=>({...await vi.importActual<any>('../src/lib/google'),meetTranscript:vi.fn(),sendEmail:vi.fn()}));
vi.mock('../src/lib/ai',()=>({analyseMeeting:vi.fn(),minutesMarkdown:()=> 'Synthetic summary'}));
import {meetTranscript} from '../src/lib/google';
import {analyseMeeting} from '../src/lib/ai';
import {processFinishedMeetings} from '../src/jobs';
import type {Env} from '../src/env';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
it.each([
 {status:'no_record'},
 {status:'no_transcript',participants:2},
 {status:'ready',participants:2,text:'Synthetic transcript text. '.repeat(20)},
])('never infers prospect attendance from transcript availability or participant count: %j',async transcript=>{
 vi.mocked(meetTranscript).mockResolvedValue(transcript as any);
 vi.mocked(analyseMeeting).mockResolvedValue({summary:'Fixture',notes:{},requirements:{},minutes:{decisions:[],actions:[]}} as any);
 const changes:any[]=[];
 vi.stubGlobal('fetch',async(input:any,init:RequestInit={})=>{
  const u=new URL(String(input));
  if(u.host!=='fixture.supabase.co')throw Error('Unexpected external access');
  if(u.pathname.endsWith('/rpc/save_meeting_draft')){const body=JSON.parse(String(init.body));changes.push({table:'draft_rpc',body});return Response.json({meetingId:body.p_meeting,reviewVersion:1,attendance:'unknown',notesReady:body.p_notes!==null});}
  if(init.method==='PATCH'){changes.push({table:u.pathname.split('/').pop(),body:JSON.parse(String(init.body))});return Response.json([{}]);}
  if(u.pathname.endsWith('/meetings'))return Response.json([{id:'00000000-0000-4000-8000-000000000010',tenant_id:null,status:'booked',start_at:'2026-10-22T06:00:00Z',end_at:'2026-10-22T06:30:00Z',meet_code:'fixture',attendee_email:'fixture@example.invalid',lead_id:'00000000-0000-4000-8000-000000000020',attendance_version:0}]);
  if(u.pathname.endsWith('/leads'))return Response.json([{company:'Fixture'}]);
  throw Error('Unexpected database operation');
 });
 const result=await processFinishedMeetings({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',ADMIN_ALERT_EMAIL:'staff@example.invalid'} as Env,new Date('2026-10-23T12:00:00Z'));
 expect(result).toMatchObject({review:1,waiting:0,no_show:0});
 expect(changes.filter(c=>c.table==='draft_rpc')).toHaveLength(1);
 expect(changes.filter(c=>c.table==='meetings'&&['held','no_show'].includes(c.body.status))).toHaveLength(0);
 expect(changes.filter(c=>c.table==='leads'&&c.body.status==='meeting_held')).toHaveLength(0);
});
