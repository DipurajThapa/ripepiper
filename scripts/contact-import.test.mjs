import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../site/assets/contact-import.js',import.meta.url),'utf8');
const window={RP:{}};vm.runInNewContext(source,{window});
const parse=(text,extra={})=>window.RP.contactImport.parse(text,{format:'csv',header:true,synthetic:true,now:Date.parse('2026-10-23T12:00:00Z'),...extra});
const header='email,company,reference,rights_reference,observed_at';
const row=(i=1)=>`fixture${i}@test.invalid,Company,source-${i},permitted-use,2026-10-22`;
test('CSV accepts UTF-8 BOM, reordered headers, CRLF, quoted commas, escaped quotes and company newlines',()=>{
 const r=parse('\ufeffcompany,REFERENCE,email,observed_at,rights_reference\r\n"Company, ""Trade""\r\nDivision",source-1,TEAM@TEST.INVALID,2026-10-22,reviewed-source\r\n');
 assert.equal(r.valid,true);assert.equal(r.rows.length,1);assert.equal(r.rows[0].company,'Company, "Trade"\nDivision');assert.equal(r.rows[0].email,'team@test.invalid');assert.equal(r.rows[0].observed_at,'2026-10-22T00:00:00Z');
});
test('headerless spreadsheet TSV preserves quoted tabs and reports ignored blank lines',()=>{
 const r=parse('\r\nfixture@test.invalid\t"Company\tDivision"\tsource-1\tpermitted\t2026-10-22\r\n\r\n',{format:'tsv',header:false});
 assert.equal(r.valid,true);assert.equal(r.rows[0].company,'Company\tDivision');assert.equal(r.blankRows,2);
});
test('malformed quoting, unsupported delimiters and broken row widths never silently discard fields',()=>{
 for(const text of [header+'\n"unterminated',header+'\n"name"surprise,x,x,x,x',header+'\nna"me,x,x,x,x'])assert.throws(()=>parse(text),/quote|quotation/i);
 assert.throws(()=>parse(header+'\n'+row(),{format:'semicolon'}),/Choose CSV/);
 assert.equal(parse(header+'\n'+row()+',extra').valid,false);
 assert.equal(parse(header+'\nfixture@test.invalid,Company,source-1,rights').valid,false);
});
test('unknown CRM history columns, duplicate headers and missing headers are rejected before import',()=>{
 for(const h of ['email,company,reference,rights_reference,last_contact_at','email,company,reference,reference,observed_at','email,company,reference,rights_reference,observed_at,previous_interest'])assert.throws(()=>parse(h+'\n'+row()),/header|five columns/i);
 assert.throws(()=>parse(''),/Choose a file/);assert.throws(()=>parse(header),/between 1 and 50/);
});
test('same identity with distinct source links is valid and visible, duplicate source references block the batch',()=>{
 const identity='fixture@test.invalid,Company';
 const r=parse(header+'\n'+identity+',source-1,rights,2026-10-22\n'+identity+',source-2,rights,2026-10-22');
 assert.equal(r.valid,true);assert.equal(r.warningCount,1);assert.match(r.reports[1].warnings[0],/Same contact as row 1/);
 const duplicate=parse(header+'\n'+row()+'\n'+row());assert.equal(duplicate.valid,false);assert.match(duplicate.reports[1].errors.join(' '),/Source reference also appears/);
});
test('existing identity is reported without mutating the existing lead or pretending to overwrite company data',()=>{
 const existing=[{email:'FIXTURE1@TEST.INVALID',company:'Saved company'}];const original=JSON.stringify(existing);
 const r=parse(header+'\n'+row(),{existing});assert.equal(r.valid,true);assert.match(r.reports[0].warnings.join(' '),/without overwriting/);assert.equal(JSON.stringify(existing),original);assert.equal(r.rows[0].company,'Company');
});
test('invalid identity, evidence mode, missing rights and impossible/future dates invalidate all rows',()=>{
 for(const data of ['bad,Company,source,rights,2026-10-22','fixture@test.com,Company,source,rights,2026-10-22','fixture@test.invalid,,source,rights,2026-10-22','fixture@test.invalid,Company,source,,2026-10-22','fixture@test.invalid,Company,source,rights,2026-02-29','fixture@test.invalid,Company,source,rights,2026-10-24'])assert.equal(parse(header+'\n'+data).valid,false);
 assert.equal(parse(header+'\nfixture@test.invalid,Company,source,rights,2024-02-29').valid,true);
 assert.equal(parse(header+'\nfixture@test.com,Company,source,rights,2026-10-22',{synthetic:false}).valid,true);
});
test('row, UTF-8 byte and encoded payload limits bound preparation',()=>{
 assert.equal(parse(header+'\n'+Array.from({length:50},(_,i)=>row(i)).join('\n')).rows.length,50);
 assert.throws(()=>parse(header+'\n'+Array.from({length:51},(_,i)=>row(i)).join('\n')),/50/);
 assert.throws(()=>parse('a'.repeat(65537)),/64 KiB/);assert.throws(()=>parse('💡'.repeat(16385)),/64 KiB/);
});
test('control characters are invalid, untrusted text stays data and no rights/send authority is manufactured',()=>{
 const r=parse(header+'\nfixture@test.invalid,"<script>attack()</script>",source,rights,2026-10-22');assert.equal(r.valid,true);assert.equal(r.rows[0].company,'<script>attack()</script>');
 assert.deepEqual(Object.keys(r.rows[0]).sort(),['company','email','observed_at','reference','rights_reference']);
 assert.equal(parse(header+'\nfixture@test.invalid,Company,source\u0000,rights,2026-10-22').valid,false);
 assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/);
});
