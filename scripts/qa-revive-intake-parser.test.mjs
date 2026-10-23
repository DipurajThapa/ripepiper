import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={window:{RP:{}}};
vm.runInNewContext(readFileSync(new URL('../site/assets/contact-import.js',import.meta.url),'utf8'),context);
const parse=(text,options={})=>context.window.RP.contactImport.parse(text,{format:'csv',synthetic:true,now:Date.parse('2026-10-23T12:00:00Z'),...options});
const line='qa@example.invalid,QA company,qa-source,qa-rights,2026-10-22';
test('independent parser handles BOM, reordered case-insensitive header, escaped quotes, comma and CRLF within quoted company',()=>{
 const result=parse('\uFEFFCOMPANY,email,observed_at,rights_reference,reference\r\n"QA, ""quoted""\r\ncompany",QA@EXAMPLE.INVALID,2026-10-22,qa-rights,qa-source\r\n',{header:true});
 assert.equal(result.valid,true);assert.equal(result.rows.length,1);assert.equal(result.rows[0].company,'QA, "quoted"\ncompany');assert.equal(result.rows[0].email,'qa@example.invalid');assert.equal(result.rows[0].observed_at,'2026-10-22T00:00:00Z');
});
test('independent parser refuses duplicate or unknown/extra headers instead of dropping fields',()=>{
 for(const header of ['email,email,reference,rights_reference,observed_at','email,company,reference,permission,observed_at','email,company,reference,rights_reference,observed_at,last_contact'])assert.throws(()=>parse(header+'\n'+line,{header:true}));
});
test('independent parser never silently repairs malformed quotes or a sixth field',()=>{
 for(const value of ['qa@example.invalid,"unclosed,ref,rights,2026-10-22','qa@example.invalid,"closed"oops,ref,rights,2026-10-22'])assert.throws(()=>parse(value));
 assert.equal(parse(line+',private-extra-history').valid,false);
});
test('independent parser preserves exactly 50 contacts and rejects 51 or oversized multibyte input',()=>{
 const rows=Array.from({length:50},(_,i)=>`qa${i}@example.invalid,QA company,source-${i},rights,2026-10-22`);
 assert.equal(parse(rows.join('\n')).rows.length,50);assert.throws(()=>parse([...rows,line].join('\n')));
 assert.throws(()=>parse('界'.repeat(22000)),/64 KiB/);
});
test('independent parser exposes date, mode and control failures rather than creating an importable preview',()=>{
 for(const value of [line.replace('2026-10-22','2026-02-29'),line.replace('2026-10-22','2026-10-24'),line.replace('example.invalid','business.example'),line.replace('qa-rights','bad\u0000rights')])assert.equal(parse(value).valid,false);
});
test('independent parser blocks reused source references but permits one identity with genuinely distinct sources',()=>{
 const collision=parse(line+'\n'+line.replace('qa@example.invalid','qa2@example.invalid'));assert.equal(collision.valid,false);assert.equal(collision.rows.length,2);
 const linked=parse(line+'\n'+line.replace('qa-source','qa-source-2'));assert.equal(linked.valid,true);assert.equal(linked.warningCount,1);assert.match(linked.reports[1].warnings[0],/preserved/);
});
test('independent parser marks existing identity as a link without changing its saved company',()=>{
 const existing={email:'QA@EXAMPLE.INVALID',company:'Saved company'};const result=parse(line,{existing:[existing]});assert.equal(result.valid,true);assert.match(result.reports[0].warnings[0],/without overwriting/);assert.equal(existing.company,'Saved company');
});
test('independent parser accepts TSV as selected format and discloses skipped blank lines',()=>{
 const result=parse('\r\n'+line.replaceAll(',','\t')+'\r\n\r\n',{format:'tsv'});assert.equal(result.valid,true);assert.equal(result.rows.length,1);assert.equal(result.blankRows,2);
});
