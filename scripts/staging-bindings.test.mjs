import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stagingBindings} from './staging-bindings.mjs';
const key=(role,ref='wgomywhuzyboxlckopca')=>'fixture.'+Buffer.from(JSON.stringify({role,ref})).toString('base64url')+'.synthetic';
const config=()=>({CLOUDFLARE_API_TOKEN:'fixture-token',CLOUDFLARE_ACCOUNT_ID:'e888301f7b7d01c16eb17c947ff57e5e',RIPEPIPER_STAGING_SUPABASE_URL:'https://wgomywhuzyboxlckopca.supabase.co',RIPEPIPER_STAGING_SERVICE_ROLE_KEY:key('service_role'),RIPEPIPER_STAGING_ANON_KEY:key('anon')});
test('staging bindings accept only the isolated database, account and correct key roles',()=>{
 assert.deepEqual(Object.keys(stagingBindings(config())),['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY']);
 for(const change of [{CLOUDFLARE_API_TOKEN:''},{CLOUDFLARE_ACCOUNT_ID:'other'},{RIPEPIPER_STAGING_SUPABASE_URL:'https://production.supabase.co'},{RIPEPIPER_STAGING_SERVICE_ROLE_KEY:key('anon')},{RIPEPIPER_STAGING_ANON_KEY:key('anon','foreign')},{RIPEPIPER_STAGING_SERVICE_ROLE_KEY:'secret-private-fixture'}]){
  assert.throws(()=>stagingBindings({...config(),...change}),error=>{assert.doesNotMatch(error.message,/secret-private-fixture|fixture-token/);return true;});
 }
});
