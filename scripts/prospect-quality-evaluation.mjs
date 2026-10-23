// Offline regression evaluation of the existing assessment engine. No model/network/provider calls.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {assessProspect,validBrief,validInstant,validFacts,ambiguousExcerpt} from '../platform/ripe-piper-platform/src/foundation/prospecting.ts';
export const QUALITY_GATE=Object.freeze({minCases:20,maxCases:30,minTenants:2,minSuitablePerTenant:3,minUnsuitablePerTenant:3,minReviewedTop:6,minReviewedPerTenant:3,minSuitableRecall:0.8,minPrecision:0.9,minStateAccuracy:0.95});
const fixtureURL=new URL('../platform/ripe-piper-platform/test/fixtures/prospect-quality.v1.json',import.meta.url);
const root=new URL('../',import.meta.url);
const states=new Set(['candidate','excluded','review','unknown','scope_rejected']);
const labels=new Set(['suitable','unsuitable','undetermined','pending']);
const requiredTags=['fit','nonfit','ambiguous','stale','injected','cross_tenant'];
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(stable(value))).digest('hex');
const ratio=(a,b)=>b?Math.round(a/b*1e6)/1e6:null;
const text=v=>typeof v==='string'&&!!v.trim();
export function loadQualityDataset(){return JSON.parse(readFileSync(fixtureURL,'utf8'));}
export function validateQualityDataset(d){
 if(!d||d.schemaVersion!==1||d.rulesVersion!==2||!text(d.id)||!text(d.version)||!text(d.labelSource)||!validInstant(d.now)||!Array.isArray(d.cases)||d.cases.length<QUALITY_GATE.minCases||d.cases.length>QUALITY_GATE.maxCases||!Array.isArray(d.briefs)||d.briefs.length<QUALITY_GATE.minTenants)throw Error('Invalid or insufficient frozen evaluation corpus.');
 const briefs=new Map(),ids=new Set(),leadScopes=new Set(),sourceIds=new Set();
 for(const b of d.briefs){if(!b||!text(b.tenantId)||briefs.has(b.tenantId)||!Number.isInteger(b.version)||b.version<1||!validBrief(b.body,Date.parse(d.now)))throw Error('Invalid or duplicate versioned evaluation brief.');briefs.set(b.tenantId,b);}
 for(const c of d.cases){
  const b=briefs.get(c?.tenantId);
  if(!c||!text(c.id)||ids.has(c.id)||!text(c.leadId)||leadScopes.has(c.tenantId+':'+c.leadId)||!b||c.briefVersion!==b.version||c.synthetic!==true||typeof c.suppressed!=='boolean'||!Array.isArray(c.observations)||c.observations.length>6||!Array.isArray(c.tags)||!c.tags.length||!c.tags.every(text)||!c.label||!labels.has(c.label.fit)||!states.has(c.label.expectedState)||typeof c.label.hardExcluded!=='boolean'||typeof c.label.scopeViolation!=='boolean'||!text(c.label.reason))throw Error('Invalid, duplicate or unlabelled evaluation case.');
  if((c.label.fit==='suitable'&&c.label.expectedState!=='candidate')||(c.label.fit==='unsuitable'&&c.label.expectedState!=='excluded')||(c.label.fit==='undetermined'&&!['review','unknown','scope_rejected'].includes(c.label.expectedState)))throw Error('Fit and state labels contradict each other.');
  ids.add(c.id);leadScopes.add(c.tenantId+':'+c.leadId);
  if(c.observations.some(o=>!o||!text(o.id)||!text(o.tenant_id)||!text(o.lead_id)||!text(o.external_ref)||!text(o.source)||typeof o.synthetic!=='boolean'||!text(o.observed_at)||!o.assessment_facts||typeof o.assessment_facts!=='object'||Array.isArray(o.assessment_facts)||typeof o.assessment_excerpt!=='string'||o.assessment_excerpt.length>2000))throw Error('Malformed evaluation source.');
  for(const o of c.observations){if(sourceIds.has(o.id))throw Error('Duplicate source identity.');sourceIds.add(o.id);}
  const foreign=c.observations.some(o=>o.tenant_id!==c.tenantId||o.lead_id!==c.leadId);
  if(c.label.scopeViolation!==foreign||foreign!==(c.label.expectedState==='scope_rejected')||(c.suppressed&&!c.label.hardExcluded))throw Error('Scope or suppression labels contradict the input.');
 }
 for(const tag of requiredTags)if(!d.cases.some(c=>c.tags.includes(tag)))throw Error('Evaluation coverage missing: '+tag);
 if(!d.cases.some(c=>c.label.fit==='pending'))throw Error('Pending feedback coverage missing.');
 for(const tenant of briefs.keys()){
  if(d.cases.filter(c=>c.tenantId===tenant&&c.label.fit==='suitable').length<QUALITY_GATE.minSuitablePerTenant||d.cases.filter(c=>c.tenantId===tenant&&c.label.fit==='unsuitable').length<QUALITY_GATE.minUnsuitablePerTenant||!d.cases.some(c=>c.tenantId===tenant&&c.label.hardExcluded))throw Error('Insufficient labelled fit/exclusion coverage per tenant.');
 }
 return d;
}
export function assessQualityDataset(d){
 validateQualityDataset(d);const briefs=new Map(d.briefs.map(b=>[b.tenantId,b]));
 return d.cases.map(c=>{
  try{return {caseId:c.id,assessment:assessProspect(c.tenantId,c.leadId,briefs.get(c.tenantId).body,c.observations,{now:Date.parse(d.now),suppressed:c.suppressed,synthetic:c.synthetic})};}
  catch(error){return {caseId:c.id,error:String(error).includes('Evidence scope mismatch')?'scope_rejected':'assessment_failed'};}
 });
}
const norm=v=>v.trim().toLowerCase();
const canonicalValue=(brief,field,raw)=>{const alias=Object.entries(brief.aliases?.[field]??{}).find(([,values])=>values.map(norm).includes(norm(raw)));return norm(alias?alias[0]:raw);};
function literalMention(excerpt,value){const escaped=norm(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(^|[^\\p{L}\\p{N}])'+escaped+'($|[^\\p{L}\\p{N}])','u').test(norm(excerpt));}
/** Independent accounting/citation audit, also usable to challenge a saved prediction set. */
export function scoreQualityDataset(d,predictions){
 validateQualityDataset(d);
 if(!Array.isArray(predictions)||predictions.length!==d.cases.length)throw Error('Prediction count does not cover the frozen corpus.');
 const indexed=new Map();for(const p of predictions){if(!p||!text(p.caseId)||indexed.has(p.caseId)||!d.cases.some(c=>c.id===p.caseId))throw Error('Invalid or duplicate prediction identity.');indexed.set(p.caseId,p);}
 const counters={hardExcluded:0,falseHardExclusionPass:0,scopeCases:0,scopeRejected:0,tenantLeaks:0,permissionGrants:0,citationChecks:0,supportedCitations:0,unsupportedClaims:0,unsafeCandidatePass:0,unexpectedErrors:0};
 const caseResults=[],ranked=[],allSources=d.cases.flatMap(c=>c.observations);let suitableTotal=0,suitableCandidates=0,labelled=0,decisive=0,stateChecks=0,stateMatches=0,assessed=0;
 for(const c of d.cases){
  const p=indexed.get(c.id);if(!p)throw Error('Missing prediction.');
  const actual=p.assessment?.state??p.error??'assessment_failed',pending=c.label.fit==='pending';
  if(!pending){stateChecks++;if(actual===c.label.expectedState)stateMatches++;}
  if(c.label.hardExcluded){counters.hardExcluded++;if(actual!=='excluded')counters.falseHardExclusionPass++;}
  if(c.label.scopeViolation){counters.scopeCases++;if(actual==='scope_rejected')counters.scopeRejected++;else counters.tenantLeaks++;}
  else{
   if(!pending){labelled++;if(['candidate','excluded'].includes(actual))decisive++;}
   if(c.label.fit==='suitable'){suitableTotal++;if(actual==='candidate')suitableCandidates++;}
  }
  if(p.assessment){
   assessed++;const a=p.assessment,b=d.briefs.find(b=>b.tenantId===c.tenantId).body;
   const wanted={industry:b.industries,market:b.markets,role:b.roles,need:b.needs};let unsafeCandidate=false;
   if(a.leadId!==c.leadId)counters.tenantLeaks++;
   if(a.contactAllowed!==false)counters.permissionGrants++;
   if(!['candidate','excluded','review','unknown'].includes(a.state)||!Array.isArray(a.fields))counters.unexpectedErrors++;
   if(a.state==='candidate'&&(!Array.isArray(a.fields)||a.fields.length!==4||!['industry','market','role','need'].every(name=>a.fields.filter(f=>f.field===name).length===1)||a.fields.some(f=>f.state!=='match'||!Array.isArray(f.values)||f.values.length!==1||typeof f.values[0]!=='string'||!(wanted[f.field]??[]).map(norm).includes(norm(f.values[0]))||!Array.isArray(f.evidence)||!f.evidence.length)))unsafeCandidate=true;
   for(const field of a.fields??[]){
    if(!['industry','market','role','need'].includes(field.field)||!Array.isArray(field.values)||!Array.isArray(field.evidence)){counters.unsupportedClaims++;continue;}
    const backed=[];
    if(a.state==='candidate'){
     const current=c.observations.filter(o=>o.tenant_id===c.tenantId&&o.lead_id===c.leadId&&o.synthetic===c.synthetic&&o.assessment_reviewed_by&&validFacts(o.assessment_facts,o.assessment_excerpt)&&validInstant(o.observed_at)&&Date.parse(o.observed_at)<=Date.parse(d.now)&&Date.parse(o.observed_at)>=Date.parse(d.now)-b.maxAgeDays*86400000&&o.assessment_facts[field.field]);
     if(current.some(o=>ambiguousExcerpt(o.assessment_excerpt))||new Set(current.filter(o=>!ambiguousExcerpt(o.assessment_excerpt)).map(o=>canonicalValue(b,field.field,o.assessment_facts[field.field]))).size!==1)unsafeCandidate=true;
    }
    for(const citation of field.evidence){
     counters.citationChecks++;const source=c.observations.find(o=>o.id===citation.id);
     const raw=source?.assessment_facts?.[field.field];
     const valid=!!source&&source.tenant_id===c.tenantId&&source.lead_id===c.leadId&&source.synthetic===c.synthetic&&!!source.assessment_reviewed_by&&typeof raw==='string'&&literalMention(source.assessment_excerpt,raw)&&source.source===citation.source&&source.external_ref===citation.reference&&source.observed_at===citation.observedAt&&source.assessment_excerpt===citation.excerpt&&validInstant(source.observed_at)&&Date.parse(source.observed_at)<=Date.parse(d.now)&&Date.parse(source.observed_at)>=Date.parse(d.now)-b.maxAgeDays*86400000;
     if(valid){counters.supportedCitations++;backed.push(canonicalValue(b,field.field,raw));}
     else{counters.unsupportedClaims++;const origin=source??allSources.find(o=>o.id===citation.id);if(origin&&(origin.tenant_id!==c.tenantId||origin.lead_id!==c.leadId))counters.tenantLeaks++;}
    }
    for(const value of field.values)if(typeof value!=='string'||!backed.includes(norm(value)))counters.unsupportedClaims++;
   }
   if(unsafeCandidate)counters.unsafeCandidatePass++;
   if(actual==='candidate')ranked.push({caseId:c.id,leadId:c.leadId,tenantId:c.tenantId,label:c.label.fit});
  }else if(!c.label.scopeViolation||actual!=='scope_rejected')counters.unexpectedErrors++;
  caseResults.push({id:c.id,label:c.label.fit,predictedState:actual,expectedState:c.label.expectedState,matched:actual===c.label.expectedState,pendingLabel:pending,scopeViolation:c.label.scopeViolation});
 }
 // Rank independently per tenant, exactly as each current shortlist; never combine client queues.
 const selected=[],perTenant=[];
 for(const brief of d.briefs){
  const candidates=ranked.filter(c=>c.tenantId===brief.tenantId).sort((a,b)=>a.leadId<b.leadId?-1:a.leadId>b.leadId?1:0),top=candidates.slice(0,20),reviewed=top.filter(c=>c.label!=='pending'),suitable=reviewed.filter(c=>c.label==='suitable');
  selected.push(...top);perTenant.push({tenantId:brief.tenantId,limit:20,candidatePool:candidates.length,selectedCount:top.length,pendingCount:top.length-reviewed.length,reviewedDenominator:reviewed.length,acceptedSuitableCount:suitable.length,precision:ratio(suitable.length,reviewed.length),selectedCaseIds:top.map(c=>c.caseId)});
 }
 const reviewed=selected.filter(c=>c.label!=='pending'),suitable=reviewed.filter(c=>c.label==='suitable');
 const top20={limitPerTenant:20,perTenant,candidatePool:ranked.length,selectedCount:selected.length,pendingCount:selected.length-reviewed.length,reviewedDenominator:reviewed.length,acceptedSuitableCount:suitable.length,precision:ratio(suitable.length,reviewed.length),precisionMeaning:'Micro-average of labelled selected candidates from independent tenant top-20 lists.'};
 const coverage={cases:d.cases.length,tenants:d.briefs.length,assessedCases:assessed,scopeRejectedCases:counters.scopeRejected,labelledFitCases:labelled,pendingCases:d.cases.filter(c=>c.label.fit==='pending').length,labelCoverage:ratio(labelled,d.cases.filter(c=>!c.label.scopeViolation).length),decisiveCases:decisive,decisionCoverage:ratio(decisive,labelled),suitableLabelCount:suitableTotal,suitableCandidateCount:suitableCandidates,suitableRecall:ratio(suitableCandidates,suitableTotal),stateChecks,stateMatches,stateAccuracy:ratio(stateMatches,stateChecks)};
 const checks=[
  {id:'non_empty_reviewed_top',passed:reviewed.length>=QUALITY_GATE.minReviewedTop&&perTenant.every(t=>t.reviewedDenominator>=QUALITY_GATE.minReviewedPerTenant),actual:reviewed.length,required:QUALITY_GATE.minReviewedTop},
  {id:'synthetic_label_precision',passed:top20.precision!==null&&top20.precision>=QUALITY_GATE.minPrecision,actual:top20.precision,required:QUALITY_GATE.minPrecision},
  {id:'suitable_candidate_coverage',passed:coverage.suitableRecall!==null&&coverage.suitableRecall>=QUALITY_GATE.minSuitableRecall,actual:coverage.suitableRecall,required:QUALITY_GATE.minSuitableRecall},
  {id:'expected_state_regression',passed:coverage.stateAccuracy!==null&&coverage.stateAccuracy>=QUALITY_GATE.minStateAccuracy,actual:coverage.stateAccuracy,required:QUALITY_GATE.minStateAccuracy},
  {id:'hard_exclusions',passed:counters.hardExcluded>0&&counters.falseHardExclusionPass===0,actual:counters.falseHardExclusionPass,required:0},
  {id:'tenant_and_identity_isolation',passed:counters.scopeCases>0&&counters.scopeRejected===counters.scopeCases&&counters.tenantLeaks===0,actual:counters.tenantLeaks,required:0},
  {id:'cited_fact_support',passed:counters.citationChecks>0&&counters.supportedCitations===counters.citationChecks&&counters.unsupportedClaims===0,actual:counters.unsupportedClaims,required:0},
  {id:'candidate_requires_four_supported_matches',passed:counters.unsafeCandidatePass===0,actual:counters.unsafeCandidatePass,required:0},
  {id:'no_contact_permission_grants',passed:counters.permissionGrants===0,actual:counters.permissionGrants,required:0},
  {id:'no_unexpected_assessment_errors',passed:counters.unexpectedErrors===0,actual:counters.unexpectedErrors,required:0}
 ];
 return {reportVersion:1,kind:'offline_synthetic_regression_baseline',passed:checks.every(c=>c.passed),evaluatedAt:d.now,
  provenance:{dataset:{id:d.id,version:d.version,canonicalSha256:hash(d),labelSource:d.labelSource},rules:{version:d.rulesVersion,assessorSha256:hash(readFileSync(new URL('platform/ripe-piper-platform/src/foundation/prospecting.ts',root),'utf8')),shortlistModuleSha256:hash(readFileSync(new URL('platform/ripe-piper-platform/src/foundation/prospecting-routes.ts',root),'utf8')),ranking:'independent per-tenant candidate-first then lead ID ascending'},evaluatorSha256:hash(readFileSync(new URL(import.meta.url),'utf8')),briefs:d.briefs.map(b=>({tenantId:b.tenantId,version:b.version,canonicalSha256:hash(b.body)}))},
  top20,coverage,safety:{...counters,lexicalCitationSupportRate:ratio(counters.supportedCitations,counters.citationChecks)},checks,caseResults,
  costs:{externalCalls:0,modelCalls:0,incrementalProviderChargesUsd:0},commercialOutcomes:{measured:false,conversionUplift:null,operatorCorrectionRate:null,modelComparison:null},
  limitations:['Synthetic scenario labels are regression expectations, not customer-accepted prospects.','Lexical citation checks establish source traceability, not the truth of source claims or buying intent.','Pending fit labels are excluded from precision failures; unknown commercial outcomes are not losses.','No live source, provider, model variant or conversion cohort was exercised.']};
}
export function runQualityEvaluation(d=loadQualityDataset()){return scoreQualityDataset(d,assessQualityDataset(d));}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--output'))throw Error('Usage: node scripts/prospect-quality-evaluation.mjs [--output file.json]');
 const start=performance.now(),report=runQualityEvaluation();if(args.length)writeFileSync(args[1],JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,top20:report.top20,coverage:report.coverage,safety:report.safety,checks:report.checks,runtimeMs:Math.round((performance.now()-start)*1000)/1000},null,2));
 if(!report.passed)process.exitCode=1;
}
