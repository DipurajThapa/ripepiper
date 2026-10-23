// Independent QA: RPC payloads must be actual booleans, not truthy assertions.
import {it,expect,vi} from 'vitest';
import {reserveAI,settleAI} from '../src/lib/build-budget';
import type {Env} from '../src/env';
const env={SUPABASE_URL:'https://fixture.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',AI_MODEL:'fixture-model',PAID_AI_ENABLED:'true',AI_COST_POLICY:JSON.stringify({model:'fixture-model',reference:'fixture-reviewed-price',expiresAt:'2099-01-01T00:00:00Z',inputMicroPerMillion:1000000,outputMicroPerMillion:2000000})} as Env;
it.each([{},'false',1])('refuses malformed truthy reservation receipt %j',async receipt=>{
 vi.stubGlobal('fetch',async()=>Response.json(receipt));
 await expect(reserveAI(env,'system','user',20)).rejects.toThrow();
});
it.each([{},'false',1])('refuses malformed truthy settlement receipt %j',async receipt=>{
 vi.stubGlobal('fetch',async()=>Response.json(true));const reservation=await reserveAI(env,'system','user',20);
 vi.stubGlobal('fetch',async()=>Response.json(receipt));
 await expect(settleAI(env,reservation,{input_tokens:1,output_tokens:1})).rejects.toThrow('reconciliation');
});
