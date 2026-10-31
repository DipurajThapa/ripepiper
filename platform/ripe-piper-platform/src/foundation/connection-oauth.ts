/** OAuth (code + PKCE + single-use hashed state) onboarding of a tenant's own mailbox into the connection registry. Behind OAUTH_ENABLED. */
import type {Env} from '../env';
import {Db,DbError} from '../lib/db';
import {bad,html,json,readJson,requireTenant} from '../routes/http';
import {OAuthError,exchangeCode,fetchIdentity,grantedScopes,hashState,oauthEnabled,startAuthorization,type ConnectionPurpose,type OAuthProvider} from '../lib/oauth';
import {VaultError,connectionAad,open,seal} from '../lib/vault';
import {sealedArgs} from './connections';
const providerOf=(slug:string):OAuthProvider|null=>slug==='google'?'google_workspace':slug==='microsoft'?'microsoft_365':null;
const mailbox=/^[^\s@<>",;]{1,64}@[^\s@<>",;]{1,255}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const b64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
// The provider redirects the browser here: a plain page, no scripts, nothing from the query echoed back except our own messages.
const page=(message:string,status:number)=>{const r=html(`<!doctype html><meta charset="utf-8"><title>Mailbox connection</title><p>${escape(message)}</p>`,status);r.headers.set('Referrer-Policy','no-referrer');return r;};

/** POST /api/admin/tenants/{id}/connections/{google|microsoft}/authorize {purposes, account?}: returns the provider consent URL. */
export async function authorizeConnection(req:Request,env:Env,tenantId:string,slug:string){
 const provider=providerOf(slug);
 if(!oauthEnabled(env)||!provider)return bad('Not found.',404);
 const user=await requireTenant(req,env,tenantId,'operate'),b=await readJson(req);
 if(Object.keys(b).some(k=>!['purposes','account'].includes(k))||!Array.isArray(b.purposes)||!b.purposes.length||b.purposes.length>2||new Set(b.purposes).size!==b.purposes.length
  ||b.purposes.some((p:unknown)=>p!=='mail_send'&&p!=='calendar')||(b.account!==undefined&&(typeof b.account!=='string'||!mailbox.test(b.account))))return bad('Choose mail sending and/or calendar, and optionally the mailbox to connect.');
 const purposes=b.purposes as ConnectionPurpose[],account=b.account?.toLowerCase()??null;
 try{
  const start=await startAuthorization(env,provider,purposes);
  const verifier=await seal(env,connectionAad(tenantId.toLowerCase(),start.stateHash,provider),start.verifier);
  await new Db(env,8000).rpc('begin_oauth_state',{p_tenant:tenantId.toLowerCase(),p_actor:user.id,p_provider:provider,p_purposes:purposes,p_state_hash:start.stateHash,p_expected_identity:account,...sealedArgs(verifier)});
  return json({ok:true,url:account?`${start.url}&login_hint=${encodeURIComponent(account)}`:start.url,expiresInSeconds:600});
 }catch(e){
  if(e instanceof DbError&&e.body.includes('42501'))return bad('Not found.',404);
  if(e instanceof DbError&&e.body.includes('22023'))return bad('Too many connection attempts are pending. Wait ten minutes and try again.',429);
  if(e instanceof OAuthError||e instanceof VaultError)return bad('Mailbox connections are not configured yet.',503);
  throw e;
 }
}

/** GET /api/oauth/{google|microsoft}/callback?state&code: tenant, actor and purposes come only from the consumed state. */
export async function oauthCallback(req:Request,env:Env,slug:string){
 const provider=providerOf(slug);
 if(!oauthEnabled(env)||!provider)return bad('Not found.',404);
 const q=new URL(req.url).searchParams,state=q.get('state')??'',code=q.get('code');
 if(!/^[A-Za-z0-9_-]{43}$/.test(state))return page('This connection link is invalid. Start again from Connections.',400);
 const db=new Db(env,8000),stateHash=await hashState(state);
 const s=await db.rpc<any>('consume_oauth_state',{p_provider:provider,p_state_hash:stateHash});
 if(!s)return page('This connection link has expired or was already used. Start again from Connections.',400);
 if(q.has('error')||!code)return page('Consent was not completed, so nothing was connected. Start again from Connections.',400);
 const tenant=String(s.tenantId);
 if(!uuid.test(tenant)||!uuid.test(String(s.actorId))||s.provider!==provider)throw Error('Invalid OAuth state record');
 try{
  const verifier=await open(env,connectionAad(tenant,stateHash,provider),{keyId:s.keyId,iv:b64(s.iv),ciphertext:b64(s.ciphertext)});
  const tokens=await exchangeCode(env,provider,code,verifier),identity=await fetchIdentity(provider,tokens.accessToken);
  if(s.expectedIdentity&&identity!==s.expectedIdentity)return page('The signed-in account is not the mailbox requested, so nothing was connected. Sign in with that mailbox and start again.',409);
  const granted=grantedScopes(provider,s.purposes,tokens.scope);
  // The AAD binds the secret to its connection id: the existing row for this account, the chosen-but-pending row, or a new one.
  const [existing,pending]=await Promise.all([db.one<any>('tenant_connections',`tenant_id=eq.${tenant}&provider=eq.${provider}&account_identity=eq.${encodeURIComponent(identity)}&select=id`),
   db.one<any>('tenant_connections',`tenant_id=eq.${tenant}&provider=eq.${provider}&account_identity=is.null&select=id`)]);
  const id=existing?.id??pending?.id??crypto.randomUUID();
  const sealed=await seal(env,connectionAad(tenant,id,provider),tokens.refreshToken);
  const r=await db.rpc<any>('register_tenant_connection',{p_tenant:tenant,p_actor:s.actorId,p_connection:id,p_provider:provider,p_identity:identity,p_purposes:s.purposes,p_scopes:granted.scopes,...sealedArgs(sealed)});
  if(!r||r.connectionId!==id||r.status!=='connected')throw Error('Uncertain registration');
  const missing=(s.purposes as string[]).filter(p=>!granted.purposes.includes(p as ConnectionPurpose));
  return page(`Connected ${identity}.${missing.length?` Permission for ${missing.join(' and ').replace('mail_send','sending mail')} was not granted, so that stays off until you reconnect and allow it.`:''} You can close this tab.`,200);
 }catch(e){
  if(e instanceof OAuthError)return page('The provider did not confirm the connection, so nothing was connected. Start again from Connections.',502);
  if(e instanceof DbError&&(e.isConflict||e.body.includes('40001')))return page('The connection changed while you were signing in. Start again from Connections.',409);
  if(e instanceof DbError&&e.body.includes('42501'))return page('You no longer have access to connect this account.',403);
  if(e instanceof VaultError)return page('Mailbox connections are not configured yet.',503);
  throw e;
 }
}
