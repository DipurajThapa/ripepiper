import {describe,it,expect,vi} from 'vitest';
import type {Env} from '../src/env';
import {startAuthorization,exchangeCode,fetchIdentity,grantedScopes,pkceChallenge,hashState,requestedScopes} from '../src/lib/oauth';
const env={OAUTH_ENABLED:'true',SITE_URL:'https://ripepiper.example.invalid',GOOGLE_CLIENT_ID:'g-client',GOOGLE_CLIENT_SECRET:'g-secret',MS_CLIENT_ID:'m-client',MS_CLIENT_SECRET:'m-secret'} as Env;
const GMAIL='https://www.googleapis.com/auth/gmail.send',GCAL='https://www.googleapis.com/auth/calendar.events',GFREE='https://www.googleapis.com/auth/calendar.freebusy';
describe('OAuth helpers',()=>{
 it('derives the RFC 7636 S256 challenge and hashes state to 64 hex',async()=>{
  // RFC 7636 appendix B test vector.
  expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  expect(await hashState('s')).toMatch(/^[0-9a-f]{64}$/);
 });
 it('builds a Google URL with state, PKCE, offline access and exactly the requested scopes',async()=>{
  const a=await startAuthorization(env,'google_workspace',['mail_send']),u=new URL(a.url);
  expect(u.origin+u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(u.searchParams.get('state')).toBe(a.state);expect(a.stateHash).toBe(await hashState(a.state));
  expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(u.searchParams.get('code_challenge')).toBe(await pkceChallenge(a.verifier));
  expect(u.searchParams.get('code_challenge_method')).toBe('S256');expect(u.searchParams.get('access_type')).toBe('offline');
  expect(u.searchParams.get('include_granted_scopes')).toBe('true');
  expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['email','openid',GMAIL].sort());
  expect(u.searchParams.get('redirect_uri')).toBe('https://ripepiper.example.invalid/api/oauth/google/callback');
  expect(a.url).not.toContain('g-secret');
  const b=await startAuthorization(env,'google_workspace',['mail_send']);expect(b.state).not.toBe(a.state);expect(b.verifier).not.toBe(a.verifier);
 });
 it('builds a Microsoft URL with offline_access, Mail.Send and Calendars.ReadWrite',async()=>{
  const u=new URL((await startAuthorization(env,'microsoft_365',['mail_send','calendar'])).url);
  expect(u.host).toBe('login.microsoftonline.com');expect(u.searchParams.get('response_mode')).toBe('query');
  expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['Calendars.ReadWrite','Mail.Send','User.Read','email','offline_access','openid'].sort());
 });
 it('stays off unless exactly enabled and configured, and rejects unknown purposes',async()=>{
  const f=vi.fn();vi.stubGlobal('fetch',f);
  for(const flag of [undefined,'TRUE','1'])await expect(startAuthorization({...env,OAUTH_ENABLED:flag},'google_workspace',['mail_send'])).rejects.toThrow('OAuth is disabled');
  await expect(exchangeCode({...env,OAUTH_ENABLED:undefined},'google_workspace','code','v'.repeat(43))).rejects.toThrow('OAuth is disabled');
  await expect(startAuthorization({...env,MS_CLIENT_SECRET:''},'microsoft_365',['mail_send'])).rejects.toThrow('not configured');
  expect(()=>requestedScopes('google_workspace',['mail_read' as any])).toThrow('Unsupported');
  expect(()=>requestedScopes('google_workspace',[])).toThrow('Unsupported');
  expect(f).not.toHaveBeenCalled();
 });
 it('intersects granted scopes narrower than requested and never widens',()=>{
  expect(grantedScopes('google_workspace',['mail_send','calendar'],`openid ${GCAL} ${GFREE} email https://www.googleapis.com/auth/gmail.readonly`))
   .toEqual({scopes:['openid','email',GCAL,GFREE],purposes:['calendar']});
  // Event access without availability access is not a usable calendar connection.
  expect(grantedScopes('google_workspace',['calendar'],`openid email ${GCAL}`).purposes).toEqual([]);
  expect(grantedScopes('microsoft_365',['mail_send','calendar'],'https%3A%2F%2Fgraph.microsoft.com%2Fmail.send%20openid%20User.Read%20offline_access%20Mail.ReadWrite'))
   .toEqual({scopes:['openid','offline_access','User.Read','Mail.Send'],purposes:['mail_send']});
  expect(grantedScopes('microsoft_365',['mail_send'],'').purposes).toEqual([]);
 });
 it('exchanges code with verifier and secret, and keeps errors status-only',async()=>{
  const calls:{url:string;body:URLSearchParams}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,body:new URLSearchParams(String(init.body))});return Response.json({access_token:'at',refresh_token:'rt',scope:GMAIL,expires_in:3600});}));
  expect(await exchangeCode(env,'google_workspace','code-1','v'.repeat(43))).toEqual({accessToken:'at',refreshToken:'rt',scope:GMAIL});
  expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
  expect(Object.fromEntries(calls[0].body)).toEqual({client_id:'g-client',client_secret:'g-secret',code:'code-1',code_verifier:'v'.repeat(43),grant_type:'authorization_code',redirect_uri:'https://ripepiper.example.invalid/api/oauth/google/callback'});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"error":"invalid_grant","refresh":"PRIVATE"}',{status:400})));
  const e=await exchangeCode(env,'microsoft_365','code-1','v'.repeat(43)).catch(x=>x);expect(e.message).toBe('OAuth request failed (400)');expect(e.message).not.toContain('PRIVATE');
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({access_token:'at'})));
  await expect(exchangeCode(env,'microsoft_365','code-1','v'.repeat(43))).rejects.toThrow('Invalid OAuth token response');
  await expect(exchangeCode(env,'microsoft_365','bad code\n','v'.repeat(43))).rejects.toThrow('Invalid authorization response');
 });
 it('verifies identity from Google userinfo and Graph /me',async()=>{
  const seen:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{seen.push(url);expect((init.headers as any).Authorization).toBe('Bearer at');
   return url.startsWith('https://openidconnect.googleapis.com/')?Response.json({email:'Owner@Client.example',email_verified:true}):Response.json({mail:null,userPrincipalName:'Owner@Tenant.example'});}));
  expect(await fetchIdentity('google_workspace','at')).toBe('owner@client.example');
  expect(await fetchIdentity('microsoft_365','at')).toBe('owner@tenant.example');
  expect(seen[1]).toMatch(/^https:\/\/graph\.microsoft\.com\/v1\.0\/me\?/);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({email:'owner@client.example',email_verified:false})));
  await expect(fetchIdentity('google_workspace','at')).rejects.toThrow('could not be verified');
 });
});
