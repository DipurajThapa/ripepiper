// Manual, isolated fixture acceptance. No deployment, migration, mail or provider access.
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stagingBindings} from './staging-bindings.mjs';
import {probeRuntime} from './runtime-probe.mjs';
export const STAGING_WORKER='https://ripe-piper-api-staging.dipuraj-thapa.workers.dev';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tables=['tenants','profiles','memberships','leads','campaigns','lead_observations','outbound_actions','sheet_outbox'];
export async function stagingHttpAcceptance(env,{apply=false,workerOrigin=STAGING_WORKER,fetcher=fetch,onProgress=()=>{},clock=Date.now}={}){
 const bindings=stagingBindings(env);
 if(workerOrigin!==STAGING_WORKER)throw Error('Only the approved staging Worker origin is allowed.');
 if(!apply)return {status:'validated_only',execution:'PENDING explicit --apply',target:workerOrigin};
 const base=bindings.SUPABASE_URL,service=bindings.SUPABASE_SERVICE_ROLE_KEY,anon=bindings.SUPABASE_ANON_KEY;
 const run=randomUUID(),tenantIds=[randomUUID(),randomUUID()],leadIds=[randomUUID(),randomUUID(),randomUUID()];
 const emails=[0,1,2].map(i=>`http-${run}-${i}@fixture.invalid`),users=[],attemptedEmails=[];
 const evidence={run,target:workerOrigin,status:'running',scope:'onboarding_auth_rls_and_staff_owner_lookup_only',notTested:['tenant_activation','outbound_execution','provider_delivery'],checks:[],cleanup:{status:'not_started',tenantIds,leadIds,userIds:[],unresolvedEmails:[]}};
 let phase='baseline',requests=0,writes=false,failure=false,cleanupDeadline=0;const executionDeadline=clock()+180000;
 async function call(origin,path,{method='GET',key=service,token=key,body,status=[200],cleanup=false}={}){
  if(++requests>(cleanup?120:75))throw Error('Request budget exceeded');
  const remaining=(cleanup?cleanupDeadline:executionDeadline)-clock();if(remaining<=0)throw Error('Execution deadline exceeded');
  const headers={apikey:key,Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json',Prefer:'return=representation'};
  const res=await fetcher(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(Math.min(10000,remaining))});
  const reader=res.body?.getReader();let text='',size=0;try{if(reader)for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('Response size limit');text+=new TextDecoder().decode(value);}}finally{await reader?.cancel();}
  if(!status.includes(res.status))throw Error(`Unexpected HTTP status ${res.status}`);
  let data;try{data=text?JSON.parse(text):null;}catch{throw Error('Invalid JSON response');}return {status:res.status,data};
 }
 const rest=(path,options)=>call(base,'/rest/v1/'+path,options);
 const auth=(path,options)=>call(base,'/auth/v1/'+path,options);
 const ensure=(condition)=>{if(!condition)throw Error('Acceptance assertion failed');};
 try{
  const listed=(await auth('admin/users?page=1&per_page=1000')).data;ensure(Array.isArray(listed?.users)&&listed.users.length===0);
  for(const table of tables){const{data}=await rest(table+'?select=*&limit=1');ensure(Array.isArray(data)&&data.length===0);}
  await probeRuntime(workerOrigin,{fetcher});evidence.checks.push('empty_baseline_and_worker_identity');
  phase='auth_fixtures';onProgress({event:'fixture_manifest',run,target:workerOrigin,tenantIds:[...tenantIds],leadIds:[...leadIds],emails:[...emails]});writes=true;
  for(const email of emails){
   const password=randomBytes(32).toString('base64url');attemptedEmails.push(email);
   const {data}=await auth('admin/users',{method:'POST',body:{email,password,email_confirm:true},status:[200,201]});
   ensure(uuid.test(data?.id??'')&&data.email===email&&!!data.email_confirmed_at&&!users.some(u=>u.id===data.id));
   users.push({id:data.id,email,password});evidence.cleanup.userIds.push(data.id);onProgress({event:'auth_fixture_created',run,userId:data.id,email});
  }
  phase='database_fixtures';
  // Auth/RLS and owner lookup work during onboarding; no activation or execution is needed.
  await rest('tenants',{method:'POST',status:[201],body:tenantIds.map((id,i)=>({id,name:'HTTP acceptance synthetic '+i,slug:`http-${run}-${i}`,country:'AE',currency:'AED',status:'onboarding'}))});
  await rest('profiles?id=eq.'+users[2].id,{method:'PATCH',body:{is_admin:true}});
  await rest('memberships',{method:'POST',status:[201],body:tenantIds.map((tenant_id,i)=>({tenant_id,user_id:users[i].id,role:'owner'}))});
  await rest('leads',{method:'POST',status:[201],body:leadIds.map((id,i)=>({id,tenant_id:tenantIds[i]??null,source:'import',email:`lead-${run}-${i}@fixture.invalid`}))});
  phase='password_sessions';const tokens=[];
  for(const user of users){const{data}=await auth('token?grant_type=password',{method:'POST',key:anon,body:{email:user.email,password:user.password}});ensure(typeof data?.access_token==='string'&&data.access_token.length>20&&data.user?.id===user.id);tokens.push(data.access_token);const verified=(await auth('user',{key:anon,token:data.access_token})).data;ensure(verified?.id===user.id);}
  evidence.checks.push('admin_create_confirmed_users_password_sessions');
  phase='postgrest_rls';
  for(let i=0;i<2;i++){
   const options={key:anon,token:tokens[i]};const own=(await rest('leads?select=id&tenant_id=eq.'+tenantIds[i],options)).data;ensure(Array.isArray(own)&&own.length===1&&own[0].id===leadIds[i]);
   for(const filter of ['tenant_id=eq.'+tenantIds[1-i],'tenant_id=is.null']){const{data}=await rest('leads?select=id&'+filter,options);ensure(Array.isArray(data)&&data.length===0);}
   const denied=await rest('rpc/response_review_owners',{...options,method:'POST',body:{p_tenant:tenantIds[i],p_actor:users[i].id},status:[401,403]});ensure(denied.data?.code==='42501');
  }
  evidence.checks.push('two_owner_sessions_own_foreign_null_rls_and_rpc_denial');
  phase='worker_requireUser';const path='/api/admin/tenants/'+tenantIds[0]+'/conversation-review';
  const worker=(token,status)=>call(workerOrigin,path,{method:'POST',key:anon,token,body:{operation:'owners'},status});
  ensure((await worker(tokens[0],[403])).data?.ok===false);
  const result=(await worker(tokens[2],[200])).data;ensure(result?.ok===true&&Array.isArray(result.owners));const ids=result.owners.map(o=>o.id).sort();ensure(JSON.stringify(ids)===JSON.stringify([users[0].id,users[2].id].sort()));
  const missing=(await call(workerOrigin,'/api/admin/tenants/'+randomUUID()+'/conversation-review',{method:'POST',key:anon,token:tokens[2],body:{operation:'owners'},status:[404]})).data;ensure(missing?.ok===false);
  evidence.checks.push('worker_real_staff_session_scoped_owners_client_denied_missing_tenant');evidence.status='passed';
 }catch{failure=true;evidence.status='failed';evidence.failedPhase=phase;}
 finally{
  if(writes){
   cleanupDeadline=clock()+90000;const cleanupErrors=[];
   // Recover only exact attempted run identities if an Admin create response was lost.
   try{const{data}=await auth('admin/users?page=1&per_page=1000',{cleanup:true});ensure(Array.isArray(data?.users)&&data.users.length<=1000);for(const email of attemptedEmails){const matches=data.users.filter(u=>u.email===email);ensure(matches.length<=1&&(!matches.length||uuid.test(matches[0].id??'')));if(matches.length&&!evidence.cleanup.userIds.includes(matches[0].id)){evidence.cleanup.userIds.push(matches[0].id);onProgress({event:'auth_fixture_recovered',run,userId:matches[0].id,email});}}}catch{cleanupErrors.push('auth_identity_recovery');evidence.cleanup.unresolvedEmails=attemptedEmails.filter(email=>!users.some(u=>u.email===email));}
   try{const filter='entity=eq.lead&entity_id=in.('+leadIds.join(',')+')';await rest('sheet_outbox?'+filter,{method:'DELETE',cleanup:true});const{data}=await rest('sheet_outbox?select=id&'+filter,{cleanup:true});ensure(Array.isArray(data)&&data.length===0);}catch{cleanupErrors.push('sheet_outbox');}
   for(const [table,ids] of [['leads',leadIds],['tenants',tenantIds]])try{await rest(table+'?id=in.('+ids.join(',')+')',{method:'DELETE',cleanup:true});const{data}=await rest(table+'?select=id&id=in.('+ids.join(',')+')',{cleanup:true});ensure(Array.isArray(data)&&data.length===0);}catch{cleanupErrors.push(table);}
   for(const id of evidence.cleanup.userIds)try{await auth('admin/users/'+id,{method:'DELETE',body:{should_soft_delete:false},cleanup:true});await auth('admin/users/'+id,{status:[404],cleanup:true});}catch{cleanupErrors.push('auth_user:'+id);}
   evidence.cleanup.status=cleanupErrors.length?'failed':'verified';if(cleanupErrors.length){evidence.cleanup.errors=cleanupErrors;failure=true;evidence.status='failed';}
  }else evidence.cleanup.status='no_writes';
 }
 evidence.requests=requests;
 if(failure){const error=new Error('Staging HTTP acceptance failed; see redacted evidence.');error.evidence=evidence;throw error;}
 return evidence;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{if(process.argv.slice(2).some(a=>a!=='--apply'))throw Error('Usage: node scripts/staging-http-acceptance.mjs [--apply]');console.log(JSON.stringify(await stagingHttpAcceptance(process.env,{apply:process.argv.includes('--apply'),onProgress:value=>console.log(JSON.stringify(value))}),null,2));}
 catch(error){console.error(JSON.stringify(error.evidence??{status:'failed',error:error.message},null,2));process.exitCode=1;}
}
