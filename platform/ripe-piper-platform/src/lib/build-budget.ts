import type { Env } from '../env';
import { Db } from './db';
export class PaidUseBlocked extends Error { constructor(){super('Paid AI is unavailable until budget, pricing and scoped authorization are verified.');} }
type Policy={model:string;reference:string;expiresAt:string;inputMicroPerMillion:number;outputMicroPerMillion:number};
const rate=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<=1_000_000_000;
export function paidPolicy(env:Env):Policy {
 if(env.PAID_AI_ENABLED!=='true')throw new PaidUseBlocked();
 let p:any;try{p=JSON.parse(env.AI_COST_POLICY??'');}catch{throw new PaidUseBlocked();}
 if(!p||p.model!==env.AI_MODEL||typeof p.reference!=='string'||!p.reference.trim()||p.reference.length>240||
 typeof p.expiresAt!=='string'||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.now()||
 !rate(p.inputMicroPerMillion)||!rate(p.outputMicroPerMillion))throw new PaidUseBlocked();
 return p;
}
export function costMicro(p:Policy,input:number,output:number){return Math.ceil((input*p.inputMicroPerMillion+output*p.outputMicroPerMillion)/1_000_000);}
/** tenantId null means Ripe Piper's own records; a tenant scope is attributed to the reservation before any network. */
export type AIScope={tenantId:string|null};
/** No network until default-off configuration and current reviewed price policy pass. */
export async function reserveAI(env:Env,system:string,user:string,maxTokens:number,scope:AIScope){
 const policy=paidPolicy(env);
 const bytes=new TextEncoder().encode(system+user).length;
 if(bytes>130_000||!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>4000)throw new PaidUseBlocked();
 // Token upper bound includes message framing; current model/tokenizer/tariff must
 // be verified in the referenced policy before this configuration is enabled.
 const inputBound=bytes+1024,maximum=costMicro(policy,inputBound,maxTokens),id=crypto.randomUUID();
 if((await new Db(env).rpc<boolean>('reserve_build_usage',{p_id:id,p_model:policy.model,p_pricing:policy.reference,p_max_micro:maximum}))!==true)throw new PaidUseBlocked();
 // A failed attribution is still pre-network: block (retryable) rather than spend unattributed.
 if(scope?.tenantId&&(await new Db(env).update('build_usage',`id=eq.${id}&tenant_id=is.null`,{tenant_id:scope.tenantId}).catch(()=>[])).length!==1)throw new PaidUseBlocked();
 return {id,policy,inputBound,maxTokens,maximum};
}
export async function settleAI(env:Env,reservation:Awaited<ReturnType<typeof reserveAI>>,usage:any){
 if(!usage||!Number.isSafeInteger(usage.input_tokens)||usage.input_tokens<0||!Number.isSafeInteger(usage.output_tokens)||usage.output_tokens<0||
 usage.input_tokens>reservation.inputBound||usage.output_tokens>reservation.maxTokens||
 (usage.cache_creation_input_tokens??0)!==0||(usage.cache_read_input_tokens??0)!==0){
 await new Db(env).rpc('hold_build_budget',{p_id:reservation.id});
 throw new Error('AI usage requires budget reconciliation.');
 }
 const actual=costMicro(reservation.policy,usage.input_tokens,usage.output_tokens);
 if((await new Db(env).rpc<boolean>('settle_build_usage',{p_id:reservation.id,p_actual_micro:actual}))!==true)throw new Error('AI usage requires budget reconciliation.');
}
