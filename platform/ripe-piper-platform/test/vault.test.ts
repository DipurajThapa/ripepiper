import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {seal,open,connectionAad} from '../src/lib/vault';
// Synthetic fixture keys only.
const k=(n:number)=>btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));
const env=(keys:Record<string,string>,current:string)=>({CONNECTION_KEYS:JSON.stringify(keys),CONNECTION_KEY_CURRENT:current}) as Env;
const A=connectionAad('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','google_workspace');
const B=connectionAad('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','google_workspace');
describe('connection vault',()=>{
 it('round-trips with a fresh 12-byte IV and never stores plaintext',async()=>{
  const e=env({'k1':k(1)},'k1'),s=await seal(e,A,'refresh-fixture'),s2=await seal(e,A,'refresh-fixture');
  expect(s.keyId).toBe('k1');expect(s.iv).toHaveLength(12);expect(s.iv).not.toEqual(s2.iv);
  expect(new TextDecoder().decode(s.ciphertext)).not.toContain('refresh-fixture');
  expect(await open(e,A,s)).toBe('refresh-fixture');
 });
 it('fails for another tenant AAD and for tampered ciphertext or IV',async()=>{
  const e=env({'k1':k(1)},'k1'),s=await seal(e,A,'refresh-fixture');
  await expect(open(e,B,s)).rejects.toThrow('could not be opened');
  const c=s.ciphertext.slice();c[0]^=1;await expect(open(e,A,{...s,ciphertext:c})).rejects.toThrow('could not be opened');
  await expect(open(e,A,{...s,iv:s.iv.slice(0,8)})).rejects.toThrow('could not be opened');
 });
 it('throws on an unknown, malformed or missing kid without leaking key material',async()=>{
  const e=env({'k1':k(1)},'k1'),s=await seal(e,A,'x');
  await expect(open(e,A,{...s,keyId:'k9'})).rejects.toThrow('Connection key is not configured');
  await expect(seal(env({'k1':k(1)},'k9'),A,'x')).rejects.toThrow('Connection key is not configured');
  await expect(seal(env({'k1':btoa('short')},'k1'),A,'x')).rejects.toThrow('Connection key is not configured');
  await expect(seal(env({'BAD KID':k(1)},'BAD KID'),A,'x')).rejects.toThrow('Connection key is not configured');
  await expect(seal({CONNECTION_KEYS:'not json',CONNECTION_KEY_CURRENT:'k1'} as Env,A,'x')).rejects.toThrow('Connection key is not configured');
  await expect(seal(env({'toString':k(1)},'constructor'),A,'x')).rejects.toThrow('Connection key is not configured');
 });
 it('opens data sealed under an old kid after rotation and re-seals under the current kid',async()=>{
  const old=await seal(env({'k1':k(1)},'k1'),A,'refresh-fixture');
  const rotated=env({'k1':k(1),'k2':k(2)},'k2');
  const plain=await open(rotated,A,old),re=await seal(rotated,A,plain);
  expect(re.keyId).toBe('k2');expect(await open(rotated,A,re)).toBe('refresh-fixture');
  await expect(open(env({'k2':k(2)},'k2'),A,old)).rejects.toThrow('Connection key is not configured');
 });
 it('does not reuse a cached key after the secret changes on the same Env',async()=>{
  const e=env({'k1':k(1)},'k1'),s=await seal(e,A,'x');
  e.CONNECTION_KEYS=JSON.stringify({'k1':k(7)});
  await expect(open(e,A,s)).rejects.toThrow('could not be opened');
 });
});
