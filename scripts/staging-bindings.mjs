// Validate the dedicated staging target and pass secrets only through a child stdin.
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url);
export function stagingBindings(env){
 if(env.RIPEPIPER_STAGING_SUPABASE_URL!=='https://wgomywhuzyboxlckopca.supabase.co')throw Error('Use the approved isolated staging database URL.');
 if(!env.CLOUDFLARE_API_TOKEN||env.CLOUDFLARE_ACCOUNT_ID!=='e888301f7b7d01c16eb17c947ff57e5e')throw Error('Dedicated staging Cloudflare credentials are missing or target another account.');
 for(const [name,role] of [['RIPEPIPER_STAGING_SERVICE_ROLE_KEY','service_role'],['RIPEPIPER_STAGING_ANON_KEY','anon']]){
  let claims;try{claims=JSON.parse(Buffer.from((env[name]??'').split('.')[1]??'','base64url').toString());}catch{throw Error('Invalid staging '+role+' key.');}
  if(claims.role!==role||claims.ref!=='wgomywhuzyboxlckopca')throw Error('Key does not belong to the approved staging database and role.');
 }
 return {SUPABASE_URL:env.RIPEPIPER_STAGING_SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:env.RIPEPIPER_STAGING_SERVICE_ROLE_KEY,SUPABASE_ANON_KEY:env.RIPEPIPER_STAGING_ANON_KEY};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{
  const values=stagingBindings(process.env);
  if(process.argv[2]!=='--apply'){console.log('Staging target and embedded key claims matched. Authentication remains unverified. Secret values are not printed.');}
  else{
   const child=spawn(process.execPath,[fileURLToPath(new URL('platform/ripe-piper-platform/node_modules/wrangler/bin/wrangler.js',root)),'secret','bulk','--config','wrangler.staging.toml'],{cwd:fileURLToPath(new URL('platform/ripe-piper-platform/',root)),env:process.env,stdio:['pipe','inherit','inherit']});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(values));child.on('error',()=>{console.error('Staging secret binding failed.');process.exitCode=1;});child.on('close',code=>{process.exitCode=code??1;});
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
