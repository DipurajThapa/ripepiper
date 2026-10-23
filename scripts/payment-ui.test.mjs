import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../site/assets/portal.js',import.meta.url),'utf8');
const start=code.indexOf('  function renderQuotes()'),end=code.indexOf('  function renderActivity()',start);
function render(quote,role='owner'){
 const node={innerHTML:''},context={state:{role,proposals:[],quotes:[{id:'fixture',items:[],currency:'AED',total:500,...quote}],payments:[]},cur:()=> 'AED',$:()=>node,RP:{esc:String,badge:s=>`<badge>${s}</badge>`,money:String,num:String,icon:()=>'',table:()=>''}};
 vm.runInNewContext(code.slice(start,end)+'\nrenderQuotes();',context);return node.innerHTML;
}
test('unpaid accepted quote resumes payment while sent quotes retain initial acceptance',()=>{assert.match(render({status:'sent'}),/>Accept and pay/);assert.match(render({status:'accepted'}),/>Continue to payment/);});
test('paid quotes display paid and cannot show checkout; viewers cannot accept or resume',()=>{const paid=render({status:'accepted',paid_at:'2026-10-23T00:00:00Z'});assert.match(paid,/<badge>paid<\/badge>/);assert.doesNotMatch(paid,/data-accept=/);for(const status of ['sent','accepted'])assert.doesNotMatch(render({status},'viewer'),/data-accept=/);});
