// Read-only route identity check. This does not verify database/provider health.
import {pathToFileURL} from 'node:url';
export async function probeRuntime(base,{fetcher=fetch}={}){
 const origin=new URL(base);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('Use an HTTPS origin without credentials, path or query.');
 const response=await fetcher(new URL('/api/health',origin),{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('API route did not return successful JSON; static HTML is not a backend.');
 const reader=response.body?.getReader();if(!reader)throw Error('Health response missing.');
 let total=0,body='';const decoder=new TextDecoder();
 try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>4096)throw Error('Health response exceeds limit.');body+=decoder.decode(value,{stream:true});}}
 finally{await reader.cancel();}
 let value;try{value=JSON.parse(body);}catch{throw Error('Malformed health JSON.');}
 if(value.ok!==true||value.service!=='ripe-piper-api'||value.contract!==1)throw Error('Unexpected API identity.');
 return {routing:'verified',database:'not_probed',providers:'not_probed',service:value.service,contract:value.contract};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{if(process.argv.length!==3)throw Error('Usage: node scripts/runtime-probe.mjs https://approved-staging-origin');console.log(JSON.stringify(await probeRuntime(process.argv[2]),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
