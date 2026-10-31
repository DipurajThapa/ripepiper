import {describe,it,expect} from 'vitest';
import {brandFrom,brandSignoff} from '../src/lib/brand';
const stop='Reply "stop" to opt out.';
describe('tenant brand renderer',()=>{
 it('orders signature, postal address, then stop line',()=>{
  expect(brandSignoff({senderName:'Ana',signature:'Ana Ruiz\nHead of Sales, Acme',legalFooter:{postalAddress:'1 Main St, Dubai'}},'Acme',stop)).toBe(`Ana Ruiz\nHead of Sales, Acme\n\n1 Main St, Dubai\n\n${stop}`);
 });
 it('falls back to sender name plus tenant name, and omits a missing address',()=>{
  expect(brandSignoff({senderName:'Ana',signature:null,legalFooter:null},'Acme',stop)).toBe(`Ana\nAcme\n\n${stop}`);
  expect(brandSignoff({signature:'  '},'Acme',stop)).toBe(`Acme\n\n${stop}`);
 });
 it('quotes the display name and escapes quotes',()=>{
  expect(brandFrom(' Ana "AR" Ruiz ','ana@acme.invalid')).toBe('"Ana \\"AR\\" Ruiz" <ana@acme.invalid>');
  expect(()=>brandFrom('Ana','a@b.invalid>, x@y.invalid')).toThrow();
 });
});
