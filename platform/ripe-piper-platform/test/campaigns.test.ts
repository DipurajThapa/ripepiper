import {describe,it,expect} from 'vitest';
import {planError} from '../src/foundation/campaigns';
const step={offsetHours:0,subject:'Reviewing your enquiry',body:'Is this still a priority?',evidenceReference:'interview:1'};
const plan={product:'revive',purpose:'reactivation',market:'AE',timezone:'Asia/Dubai',steps:[step]};
describe('message plan validation',()=>{
 it('permits reviewed plain-text plans and rejects missing evidence or malformed scopes',()=>{
  expect(planError(plan)).toBeNull();
  for(const p of [{...plan,product:'other'},{...plan,timezone:'invalid'},{...plan,steps:[{...step,evidenceReference:''}]},{...plan,steps:[{...step,subject:'Header\nBcc: other'}]}])expect(planError(p)).not.toBeNull();
 });
 it('caps the sequence, separates messages and requires immediate first step',()=>{
  expect(planError({...plan,steps:[step,{...step,offsetHours:72},{...step,offsetHours:168}]})).toBeNull();
  for(const steps of [[],[step,step],[{...step,offsetHours:1}],[step,{...step,offsetHours:721}],[step,{...step,offsetHours:24},{...step,offsetHours:48},{...step,offsetHours:72}]])expect(planError({...plan,steps})).not.toBeNull();
 });
});
