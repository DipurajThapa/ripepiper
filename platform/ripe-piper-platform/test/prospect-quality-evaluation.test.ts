import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {loadQualityDataset,validateQualityDataset,assessQualityDataset,scoreQualityDataset,runQualityEvaluation} from '../../../scripts/prospect-quality-evaluation.mjs';
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const dataset=loadQualityDataset();
describe('frozen offline prospect-quality baseline',()=>{
 it('repeats the exact artifact and binds data, rules, evaluator and both brief versions',()=>{
  const report=runQualityEvaluation(dataset);
  expect(runQualityEvaluation(copy(dataset))).toEqual(report);
  expect(report).toEqual(JSON.parse(readFileSync(new URL('../../../docs/evidence/PROSPECT_QUALITY_REVIVE_INTAKE_2026-10-23.json',import.meta.url),'utf8')));
  expect(report.passed).toBe(true);expect(report.provenance.dataset.version).toBe('2026-10-23.v1');
  for(const value of [report.provenance.dataset.canonicalSha256,report.provenance.rules.assessorSha256,report.provenance.rules.shortlistModuleSha256,report.provenance.evaluatorSha256,...report.provenance.briefs.map((b:any)=>b.canonicalSha256)])expect(value).toMatch(/^[a-f0-9]{64}$/);
  expect(report.provenance.briefs).toHaveLength(2);expect(report.costs).toEqual({externalCalls:0,modelCalls:0,incrementalProviderChargesUsd:0});expect(report.commercialOutcomes).toMatchObject({measured:false,conversionUplift:null,operatorCorrectionRate:null});
 });
 it('uses actual labelled denominators within each tenant, with pending feedback separate',()=>{
  const r=runQualityEvaluation(dataset);expect(r.top20).toMatchObject({limitPerTenant:20,selectedCount:12,pendingCount:2,reviewedDenominator:10,acceptedSuitableCount:10,precision:1});
  for(const tenant of r.top20.perTenant){expect(tenant).toMatchObject({candidatePool:6,selectedCount:6,pendingCount:1,reviewedDenominator:5,acceptedSuitableCount:5,precision:1});expect(tenant.selectedCaseIds.every((id:string)=>id.startsWith(tenant.tenantId.startsWith('a')?'a-':'b-'))).toBe(true);}
  expect(r.coverage).toMatchObject({cases:30,assessedCases:28,scopeRejectedCases:2,labelledFitCases:26,pendingCases:2,stateChecks:28,stateMatches:28,decisionCoverage:0.692308});
 });
 it('rejects wrong labels, contradictory labels, missing categories, duplicates and insufficient corpus coverage',()=>{
  const badLabel=copy(dataset);badLabel.cases[0].label.fit='probably_good';expect(()=>validateQualityDataset(badLabel)).toThrow('case');
  const contradiction=copy(dataset);contradiction.cases[0].label.fit='unsuitable';expect(()=>validateQualityDataset(contradiction)).toThrow('contradict');
  const missingTag=copy(dataset);missingTag.cases.forEach((c:any)=>c.tags=c.tags.filter((tag:string)=>tag!=='injected'));expect(()=>validateQualityDataset(missingTag)).toThrow('coverage');
  const duplicate=copy(dataset);duplicate.cases[1].id=duplicate.cases[0].id;expect(()=>validateQualityDataset(duplicate)).toThrow('duplicate');
  const tooFew=copy(dataset);tooFew.cases=tooFew.cases.slice(0,5);expect(()=>validateQualityDataset(tooFew)).toThrow('insufficient');
  const missingFit=copy(dataset);missingFit.cases.filter((c:any)=>c.label.fit==='suitable').forEach((c:any)=>c.label.fit='pending');expect(()=>validateQualityDataset(missingFit)).toThrow('coverage');
 });
 it('cannot pass an empty or incomplete prediction run',()=>{
  expect(()=>scoreQualityDataset(dataset,[])).toThrow('count');const predictions=assessQualityDataset(dataset);predictions.pop();expect(()=>scoreQualityDataset(dataset,predictions)).toThrow('count');
  const duplicate=assessQualityDataset(dataset);duplicate[1].caseId=duplicate[0].caseId;expect(()=>scoreQualityDataset(dataset,duplicate)).toThrow('identity');
 });
 it('fails the minimum coverage gate if the engine returns no candidates',()=>{
  const predictions=assessQualityDataset(dataset);for(const p of predictions)if(p.assessment)p.assessment.state='unknown';
  const r=scoreQualityDataset(dataset,predictions);expect(r.passed).toBe(false);expect(r.top20.precision).toBeNull();expect(r.top20.reviewedDenominator).toBe(0);expect(r.coverage.suitableRecall).toBe(0);
  expect(r.checks.find((c:any)=>c.id==='non_empty_reviewed_top').passed).toBe(false);
 });
 it('detects a hard-exclusion bypass rather than accepting a plausible aggregate precision',()=>{
  const predictions=assessQualityDataset(dataset),target=dataset.cases.find((c:any)=>c.label.hardExcluded);predictions.find((p:any)=>p.caseId===target.id).assessment.state='candidate';
  const r=scoreQualityDataset(dataset,predictions);expect(r.passed).toBe(false);expect(r.safety.falseHardExclusionPass).toBe(1);expect(r.checks.find((c:any)=>c.id==='hard_exclusions').passed).toBe(false);
 });
 it('detects foreign identity and citation leakage in otherwise passing predictions',()=>{
  const predictions=assessQualityDataset(dataset),target=predictions.find((p:any)=>p.assessment?.state==='candidate');target.assessment.leadId='foreign-lead';
  const other=predictions.find((p:any)=>p.assessment?.state==='candidate'&&p.caseId.startsWith('b-'));target.assessment.fields[0].evidence=copy(other.assessment.fields[0].evidence);
  const r=scoreQualityDataset(dataset,predictions);expect(r.passed).toBe(false);expect(r.safety.tenantLeaks).toBeGreaterThan(0);expect(r.safety.unsupportedClaims).toBeGreaterThan(0);
 });
 it('rejects invented source citations, unsupported values and contact permission grants',()=>{
  const predictions=assessQualityDataset(dataset),target=predictions.find((p:any)=>p.assessment?.state==='candidate');target.assessment.contactAllowed=true;target.assessment.fields[0].values=['invented opportunity'];target.assessment.fields[0].evidence[0].excerpt='fabricated source';
  const r=scoreQualityDataset(dataset,predictions);expect(r.passed).toBe(false);expect(r.safety.permissionGrants).toBe(1);expect(r.safety.unsupportedClaims).toBeGreaterThan(0);
 });
 it('counts a reviewed false positive in precision and checks candidate qualification independently',()=>{
  const predictions=assessQualityDataset(dataset),negative=dataset.cases.find((c:any)=>c.label.fit==='undetermined'&&!c.label.scopeViolation);predictions.find((p:any)=>p.caseId===negative.id).assessment.state='candidate';
  const r=scoreQualityDataset(dataset,predictions);expect(r.top20.reviewedDenominator).toBe(11);expect(r.top20.acceptedSuitableCount).toBe(10);expect(r.top20.precision).toBe(0.909091);expect(r.safety.unsafeCandidatePass).toBe(1);expect(r.passed).toBe(false);
 });
 it('rejects duplicated candidate fields that omit required qualification dimensions',()=>{
  const predictions=assessQualityDataset(dataset),target=predictions.find((p:any)=>p.assessment?.state==='candidate');
  const industry=target.assessment.fields.find((f:any)=>f.field==='industry');target.assessment.fields=Array.from({length:4},()=>copy(industry));
  const r=scoreQualityDataset(dataset,predictions);expect(r.safety.unsupportedClaims).toBe(0);expect(r.safety.unsafeCandidatePass).toBe(1);expect(r.checks.find((c:any)=>c.id==='candidate_requires_four_supported_matches').passed).toBe(false);expect(r.passed).toBe(false);
 });
 it('rejects a forged match state for a cited value outside the tenant brief',()=>{
  const predictions=assessQualityDataset(dataset),target=predictions.find((p:any)=>p.caseId==='a-06-outside-industry');
  target.assessment.state='candidate';for(const field of target.assessment.fields)field.state='match';
  const r=scoreQualityDataset(dataset,predictions);expect(r.top20.precision).toBe(0.909091);expect(r.coverage.stateAccuracy).toBe(0.964286);expect(r.safety.unsupportedClaims).toBe(0);expect(r.safety.unsafeCandidatePass).toBe(1);expect(r.passed).toBe(false);
 });
 it('rejects candidate promotion from ambiguous or conflicting current evidence',()=>{
  for(const caseId of ['a-10-ambiguous-source','a-11-conflicting-source']){
   const predictions=assessQualityDataset(dataset),target=predictions.find((p:any)=>p.caseId===caseId),scenario=dataset.cases.find((c:any)=>c.id===caseId);
   target.assessment.state='candidate';for(const field of target.assessment.fields){field.state='match';field.values=[scenario.observations[0].assessment_facts[field.field].toLowerCase()];}
   const r=scoreQualityDataset(dataset,predictions);expect(r.safety.unsupportedClaims).toBe(0);expect(r.safety.unsafeCandidatePass).toBe(1);expect(r.passed).toBe(false);
  }
 });
 it('changes the dataset fingerprint when labels change, and refuses a foreign scope mislabel',()=>{
  const changed=copy(dataset);changed.cases[0].label.reason+=' Clarified hypothetical judgement.';
  expect(runQualityEvaluation(changed).provenance.dataset.canonicalSha256).not.toBe(runQualityEvaluation(dataset).provenance.dataset.canonicalSha256);
  const wrongScope=copy(dataset);wrongScope.cases.find((c:any)=>c.label.scopeViolation).label.scopeViolation=false;expect(()=>validateQualityDataset(wrongScope)).toThrow('Scope');
 });
});
