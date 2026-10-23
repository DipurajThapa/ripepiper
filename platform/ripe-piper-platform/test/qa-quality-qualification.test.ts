import {it,expect} from 'vitest';
import {loadQualityDataset,assessQualityDataset,scoreQualityDataset} from '../../../scripts/prospect-quality-evaluation.mjs';
it('rejects a candidate with repeated supported dimension replacing the other required dimensions',()=>{
 const d=loadQualityDataset(),p=assessQualityDataset(d),a=p.find(x=>x.assessment?.state==='candidate').assessment;
 a.fields=Array.from({length:4},()=>structuredClone(a.fields[0]));
 const report=scoreQualityDataset(d,p);
 expect(report.safety.unsafeCandidatePass).toBeGreaterThan(0);
 expect(report.passed).toBe(false);
});
it('rejects an otherwise supported outside-brief value relabelled as a candidate match',()=>{
 const d=loadQualityDataset(),p=assessQualityDataset(d),a=p.find(x=>x.caseId==='a-06-outside-industry').assessment;
 a.state='candidate';a.fields.forEach(f=>f.state='match');
 const report=scoreQualityDataset(d,p);
 expect(report.safety.unsafeCandidatePass).toBeGreaterThan(0);
 expect(report.passed).toBe(false);
});
it('does not accept a candidate whose sole cited source explicitly carries unresolved ambiguity',()=>{
 const d=loadQualityDataset(),p=assessQualityDataset(d),c=d.cases.find(x=>x.id==='a-10-ambiguous-source'),a=p.find(x=>x.caseId===c.id).assessment;
 a.state='candidate';
 for(const f of a.fields){f.state='match';f.values=[c.observations[0].assessment_facts[f.field].toLowerCase()];}
 const report=scoreQualityDataset(d,p);
 expect(report.safety.unsafeCandidatePass).toBeGreaterThan(0);
 expect(report.passed).toBe(false);
});
