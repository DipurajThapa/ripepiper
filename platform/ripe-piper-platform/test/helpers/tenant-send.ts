import type {Db} from '../../src/lib/db';
import type {Env} from '../../src/env';
import type {TenantConnection} from '../../src/foundation/tenant-send';

/** Synthetic tenant send fixtures: one in-memory outbound action behind a fake service-role Db; no network. */
export const actor='a2222222-2222-4222-8222-222222222222';
export function brandSetup(name:string,email:string,overrides:Record<string,unknown>={}){
 return {website:null,supportedClaims:[],sourceInventory:[{type:'interview',reference:'review:interview',rightsReference:'source-use:client'}],relationshipSummary:{text:'Previous enquiry deferred by the buyer.',reference:'crm:review'},
  senderName:name,senderEmail:email,ownerId:actor,market:'AE',language:'en',timezone:'Asia/Kolkata',salesCapacityPerWeek:4,outcomeWindowDays:30,workingDays:[1,2,3,4,5],startMinute:540,endMinute:1020,dailyContactCap:5,
  replyTo:null,signature:`${name}\nHead of Sales`,booking:null,legalFooter:{postalAddress:`1 ${name} Street, Dubai, AE`,reference:'legal:reviewed'},...overrides} as any;
}
export function setupContext(tenant:string,body:any){
 return {tenantId:tenant,setup:{version:1,briefVersion:1,state:'reviewed',body,createdBy:actor,createdAt:new Date().toISOString()},currentBriefVersion:1,ready:true,missing:[],owners:[{id:actor,label:'Verified staff'}],
  brief:{version:1,body:{offer:'project recovery',industries:['construction'],markets:['AE'],roles:['owner'],needs:['project recovery'],excludedIndustries:[],maxAgeDays:30,source:{reference:'review:brief',excerpt:'Reviewed business offer',observedAt:new Date(Date.now()-86400000).toISOString()}}}};
}
export const googleConnection=(tenant:string,identity:string,refreshToken:string,calendar:string):TenantConnection=>({provider:'google_workspace',connectionId:crypto.randomUUID(),version:2,identity,
 env:{GOOGLE_CLIENT_ID:'platform-google',GOOGLE_CLIENT_SECRET:'platform-google-secret',GOOGLE_REFRESH_TOKEN:refreshToken,GOOGLE_CALENDAR_ID:calendar,MAIL_FROM:'Ripe Piper <hello@ripepiper.com>'} as Env});
export const microsoftConnection=(identity:string,refreshToken:string):TenantConnection=>({provider:'microsoft_365',connectionId:crypto.randomUUID(),version:5,identity,account:{refreshToken}});
export function fakeDb(tenant:string,setup:any,opts:{name?:string;current?:boolean}={}){
 const row:any={id:crypto.randomUUID(),tenant_id:tenant,campaign_id:crypto.randomUUID(),lead_id:crypto.randomUUID(),message_step:0,state:'queued',dispatch_token:null,provider_ref:null,acknowledged_at:null,lease_until:null,error_code:null,approval_version:1,asset_version:1,connection_id:null,connection_version:null};
 const calls:{op:string;name:string;args:any}[]=[];
 const db={
  async one(table:string,q:string){calls.push({op:'one',name:table,args:q});
   if(!q.includes(`tenant_id=eq.${tenant}`)&&!q.includes(`id=eq.${tenant}`))return null;
   return ({outbound_actions:row,tenants:{name:opts.name??'Fixture Co',execution_version:3},campaigns:{operator_id:actor},
    campaign_assets:{steps:[{subject:'Following up',body:'Hello,\n\nIs the deferred project still relevant?'}]},leads:{email:'buyer@prospect.example'}} as any)[table]??null;},
  async update(table:string,q:string,patch:any){calls.push({op:'update',name:table,args:{q,patch}});
   if(table!=='outbound_actions'||!q.includes(`dispatch_token=eq.${row.dispatch_token}`)||!q.includes(`state=eq.${row.state}`)||(q.includes('connection_id=is.null')&&row.connection_id))return [];
   Object.assign(row,patch);return [row];},
  async rpc(name:string,a:any){calls.push({op:'rpc',name,args:a});
   if(name==='claim_fenced_synthetic_action'){if(row.state!=='queued')return null;row.state='claimed';row.dispatch_token=a.p_token;return {token:a.p_token,approvalVersion:1,assetVersion:1};}
   if(name==='complete_fenced_synthetic_action'){row.state='tested';row.provider_ref='test-sink:'+row.id;row.acknowledged_at=new Date().toISOString();return true;}
   if(name==='expire_fenced_synthetic_action'){if(row.state!=='claimed'||row.dispatch_token!==a.p_token)return false;row.state='review';row.error_code='uncertain_result';return true;}
   if(name==='revive_setup_context')return setupContext(tenant,setup);
   if(name==='issue_tenant_unsubscribe')return {version:1,status:'issued',expiresAt:new Date(Date.now()+86400000).toISOString()};
   if(name==='tenant_connection_current')return opts.current??true;
   throw Error('Unexpected RPC '+name);}
 };
 return {db:db as unknown as Db,row,calls};
}
export const baseEnv=(flag?:string)=>({SUPABASE_URL:'https://fixture.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-secret',SITE_URL:'https://ripepiper.com',SYNTHETIC_SINK_ENABLED:'true',
 MS_CLIENT_ID:'platform-ms',MS_CLIENT_SECRET:'platform-ms-secret',MAIL_FROM:'Ripe Piper <hello@ripepiper.com>',...(flag?{TENANT_SEND_ENABLED:flag}:{})}) as unknown as Env;
