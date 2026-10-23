import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeRuntime} from './runtime-probe.mjs';
const origin='https://staging.example.invalid';
test('routing probe distinguishes the Worker identity from database and provider readiness',async()=>{
 let request;
 const result=await probeRuntime(origin,{fetcher:async(url,init)=>{request={url,init};return Response.json({ok:true,service:'ripe-piper-api',contract:1});}});
 assert.equal(request.init.method,'GET');assert.equal(request.init.redirect,'error');assert.equal(request.url.pathname,'/api/health');
 assert.deepEqual(result,{routing:'verified',database:'not_probed',providers:'not_probed',service:'ripe-piper-api',contract:1});
});
test('static fallback, wrong identity, failed HTTP and malformed/oversized responses cannot pass',async()=>{
 for(const response of [new Response('<html>static page</html>',{headers:{'content-type':'text/html'}}),Response.json({ok:true,service:'other'}),Response.json({ok:true},{status:503}),new Response('x'.repeat(4097),{headers:{'content-type':'application/json'}}),new Response('broken',{headers:{'content-type':'application/json'}})])
  await assert.rejects(probeRuntime(origin,{fetcher:async()=>response}));
});
test('probe refuses credential/query/path origins before making any request',async()=>{
 for(const url of ['http://example.invalid','https://name:secret@example.invalid','https://example.invalid/private','https://example.invalid/?key=value'])
  await assert.rejects(probeRuntime(url,{fetcher:()=>{throw Error('must not request');}}),/HTTPS origin/);
});
