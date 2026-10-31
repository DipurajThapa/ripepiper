import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../site/assets/crm-dashboard.js',import.meta.url),'utf8');
const window={RP:{}};
vm.runInNewContext(source,{window});
const {model,render}=window.RP.crmDashboard;
const now='2026-10-24T12:00:00Z';
const build=(data={},opts={})=>JSON.parse(JSON.stringify(model(data,{now,...opts})));
const at=(status,start_at,extra={})=>({status,start_at,...extra});

test('empty/malformed collections produce honest zero counts and fourteen UTC days',()=>{
 const m=build({leads:null,meetings:'bad',proposals:[null,0,[]],tenants:{}});
 assert.deepEqual(m.kpis,{inquiries:0,calls:0,drafts:0,active:0});
 assert.equal(m.trend.length,14);assert.equal(m.trend[0].date,'2026-10-11');assert.equal(m.trend[13].date,'2026-10-24');
 assert.equal(m.trendTotal,0);assert.ok(m.trend.every(d=>d.count===0&&d.percent===0));assert.equal(m.upcoming.length,0);
});
test('KPI totals are exact loaded records with exact draft and active statuses',()=>{
 const m=build({leads:[{},{}],proposals:[{status:'draft'},{status:'sent'},{status:'paid'},{status:'DRAFT'},{}],tenants:[{status:'active'},{status:'paused'},{status:'onboarding'},{status:'prospect'},{status:'ended'}]});
 assert.deepEqual(m.kpis,{inquiries:2,calls:0,drafts:1,active:1});assert.equal(m.review.clients,2);
 assert.deepEqual(m.counts,{leads:2,meetings:0,proposals:5,tenants:5});
});
test('current status distribution preserves every loaded inquiry, including unknown/missing status as Other',()=>{
 const m=build({leads:[{status:'new'},{status:'new'},{status:'won'},{status:'unsubscribed'},{status:'custom'},{}]});
 assert.equal(m.statuses.reduce((n,g)=>n+g.count,0),6);
 assert.equal(m.statuses.find(g=>g.key==='new').count,2);assert.equal(m.statuses.find(g=>g.key==='other').count,2);
 assert.equal(m.statuses.find(g=>g.key==='new').percent,33);assert.equal(m.review.leads,2);
});
test('capability mix includes all account states and unknown/unassigned package once',()=>{
 const m=build({tenants:[{package:'revive',status:'active'},{package:'revive',status:'ended'},{package:'events'},{package:'legacy'},{}, {package:['signal']}]});
 assert.equal(m.capabilities.find(g=>g.key==='revive').count,2);assert.equal(m.capabilities.find(g=>g.key==='events').count,1);
 assert.equal(m.capabilities.find(g=>g.key==='other').count,3);assert.equal(m.capabilities.reduce((n,g)=>n+g.count,0),6);
});
test('trend uses UTC day boundaries and excludes old, future and invalid dates without changing KPI',()=>{
 const leads=[
  {created_at:'2026-10-10T23:59:59Z'}, {created_at:'2026-10-11T00:00:00Z'},
  {created_at:'2026-10-10T21:00:00-04:00'}, {created_at:now},
  {created_at:'2026-10-24T12:00:01Z'}, {created_at:'2026-10-25T01:00:00Z'},
  {created_at:'2026-02-30T12:00:00Z'}, {created_at:'not a date'}, {},
  {created_at:'2026-10-24'}, {created_at:123}, {created_at:'2026-10-24T10:00:00'}
 ];
 const m=build({leads});assert.equal(m.kpis.inquiries,12);assert.equal(m.trendTotal,3);
 assert.equal(m.trend[0].count,2);assert.equal(m.trend[13].count,1);assert.equal(m.trend[0].percent,100);
 assert.equal(m.invalidDates,6);assert.equal(m.futureDates,2);
});
test('upcoming booked KPI excludes past, current, cancelled and invalid starts and list sorts earliest three',()=>{
 const m=build({meetings:[
  at('booked','2026-10-28T09:00:00Z',{attendee_name:'fourth'}),at('booked','2026-10-25T09:00:00Z',{attendee_name:'first'}),
  at('booked','2026-10-27T09:00:00Z',{attendee_name:'third'}),at('booked','2026-10-26T09:00:00Z',{attendee_email:'second@test.invalid'}),
  at('booked',now),at('booked','2026-10-23T12:00:00Z'),at('cancelled','2026-10-25T08:00:00Z'),
  at('held','2026-10-25T08:00:00Z'),at('booked','2026-02-30T12:00:00Z'),at('booked',null)
 ]});
 assert.equal(m.kpis.calls,4);assert.deepEqual(m.upcoming.map(m=>m.name),['first','second@test.invalid','third']);assert.equal(m.upcoming.length,3);
});
test('upcoming names fall back safely and no external meeting URL becomes a navigation target',()=>{
 const m=build({meetings:[at('booked','2026-10-25T09:00:00Z',{attendee_name:{bad:true},attendee_email:[],meet_url:'javascript:attack()'})]});
 assert.equal(m.upcoming[0].name,'Unnamed attendee');assert.equal(m.upcoming[0].calendarPending,false);assert.equal(Object.hasOwn(m.upcoming[0],'meet_url'),false);
});
test('review work counts do not certify unreviewed attendance or fabricate client activation',()=>{
 const m=build({meetings:[
  at('booked','2026-10-25T09:00:00Z',{meet_url:'https://test.invalid'}),
  at('booked','2026-10-25T09:00:00Z'),at('booked','2026-10-22T09:00:00Z',{meet_url:'https://test.invalid'}),
  at('booked','broken',{meet_url:'https://test.invalid'}),at('attendance_unknown','2026-10-22T09:00:00Z'),
  at('held','2026-10-22T09:00:00Z'),at('no_show','2026-10-22T09:00:00Z',{attendance_review:{state:'needs_review'}}),
  at('held','2026-10-22T09:00:00Z',{attendance_review:{state:'reviewed',classification:'held',verified:true}}),at('cancelled','2026-10-22T09:00:00Z')
 ]});assert.equal(m.review.meetings,6);assert.equal(m.kpis.calls,2);
});
test('partial flags remain explicit supplied booleans and query limits are disclosed separately',()=>{
 const m=build({leads:[{}]},{partial:{leads:true,meetings:false,proposals:'yes'},limits:{leads:500,meetings:null,tenants:1000,proposals:-4}});
 assert.deepEqual(m.partial,{leads:true,meetings:false,proposals:false,tenants:false});
 assert.deepEqual(m.limits,{leads:500,meetings:null,proposals:200,tenants:1000});assert.equal(m.kpis.inquiries,1);
});
test('model is deterministic, read-only and does not mutate record ordering or arrays',()=>{
 const data={leads:[{created_at:now,status:'new'}],meetings:[at('booked','2026-10-28T09:00:00Z'),at('booked','2026-10-25T09:00:00Z')],tenants:[{package:'revive'}]};
 const before=JSON.stringify(data);const a=build(data),b=build(data);assert.deepEqual(a,b);assert.equal(JSON.stringify(data),before);
});
test('render escapes record text, exposes accessible text counts and uses only internal delegated links',()=>{
 const container={innerHTML:''};render(container,{leads:[{status:'<script>attack()</script>'}],meetings:[at('booked','2026-10-25T09:00:00Z',{attendee_name:'<img src=x onerror=attack()> & "name"',meet_url:'javascript:attack()'})]}, {now,demo:true,loadedAt:now,partial:{leads:true}});
 const html=container.innerHTML;assert.match(html,/Sample data/);assert.match(html,/Partial result/);assert.match(html,/not a conversion funnel/);
 assert.match(html,/&lt;img src=x onerror=attack\(\)&gt; &amp; &quot;name&quot;/);assert.doesNotMatch(html,/<img|<script|javascript:/);
 assert.equal((html.match(/data-crm-kpi=/g)||[]).length,4);assert.equal((html.match(/class="crm-trend-column"/g)||[]).length,14);
 for(const match of html.matchAll(/href="([^"]+)" data-crm-go="([^"]+)"/g))assert.equal(match[1],'#'+match[2]);
 assert.match(html,/datetime="2026-10-25T09:00:00.000Z"/);assert.match(html,/UTC calendar days/);
});
test('connected empty overview discloses scope and zero chart states, never asserts total or revenue',()=>{
 const container={innerHTML:''};render(container,{}, {now,demo:false,loadedAt:'invalid'});
 assert.match(container.innerHTML,/Connected data/);assert.match(container.innerHTML,/Refresh time unavailable/);
 assert.match(container.innerHTML,/query limit 300/);assert.match(container.innerHTML,/not totals across the database/);
 assert.match(container.innerHTML,/No website inquiries loaded/);assert.match(container.innerHTML,/No upcoming booked calls/);
 assert.doesNotMatch(container.innerHTML,/Sample data|revenue|conversion rate/i);
 assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|\.api\s*\(|RP\.sb\.from\s*\(|localStorage|sessionStorage/);
});

test('accepted reviewed attendance is not flagged while mismatched or incomplete review evidence remains actionable',()=>{
 const m=build({meetings:[
  at('held','2026-10-22T09:00:00Z',{attendance_review:{state:'reviewed',classification:'held',verified:true}}),
  at('no_show','2026-10-22T09:00:00Z',{attendance_review:{state:'reviewed',classification:'no_show',verified:true,rosterComplete:true}}),
  at('held','2026-10-22T09:00:00Z',{attendance_review:{state:'accepted',classification:'held',verified:true}}),
  at('held','2026-10-22T09:00:00Z',{attendance_review:{state:'reviewed',classification:'unknown',verified:true}}),
  at('held','2026-10-22T09:00:00Z',{attendance_review:{state:'reviewed',classification:'held',verified:false}}),
  at('no_show','2026-10-22T09:00:00Z',{attendance_review:{state:'reviewed',classification:'no_show',verified:true,rosterComplete:false}})
 ]});assert.equal(m.review.meetings,4);
});
test('coverage details follow cards and compact trend dates retain full accessible UTC labels',()=>{
 const container={innerHTML:''};render(container,{}, {now,loadedAt:now});
 const html=container.innerHTML;assert.ok(html.indexOf('class="crm-scope"')>html.indexOf('data-crm-upcoming'));
 assert.match(html,/<details class="crm-scope"><summary>Data coverage and definitions<\/summary><p class="hint" data-crm-scope>/);
 assert.match(html,/<time datetime="2026-10-11" aria-label="2026-10-11 UTC" title="2026-10-11 UTC">11<\/time>/);
 assert.match(html,/<time datetime="2026-10-24" aria-label="2026-10-24 UTC" title="2026-10-24 UTC">24<\/time>/);
});

const portalSources=await Promise.all(['app-common.js','portal.js'].map(f=>readFile(new URL('../site/assets/'+f,import.meta.url),'utf8')));
function bootPortal(){
 const els={},on={},blobs=[],el=id=>els[id]??={id,innerHTML:'',textContent:'',value:'',hidden:true,dataset:{},addEventListener(){}};
 const document={getElementById:el,querySelector:()=>el('q'),querySelectorAll:s=>s==='[data-tab]'?[{dataset:{tab:'overview'},setAttribute(){},addEventListener(){}}]:[],
  addEventListener:(t,f)=>(on[t]??=[]).push(f),createElement:()=>({click(){}})};
 const ctx={window:{RP_CONFIG:{}},document,location:{hash:'',origin:'',pathname:''},history:{replaceState(){}},Blob,URL:{createObjectURL:b=>(blobs.push(b),'blob:test'),revokeObjectURL(){}}};
 for(const s of portalSources)vm.runInNewContext(s,ctx);
 const fire=(t,target)=>on[t].forEach(f=>f({target}));
 const csv=async()=>{fire('click',{closest:s=>s==='#downloadCsv'?{}:null});return (await blobs.at(-1).text()).split('\r\n').filter(Boolean);};
 return {els,fire,csv};
}
test('portal funnel shows the engine outcome counts after the sending counts',()=>{
 const html=bootPortal().els.funnel.innerHTML,labels=[...html.matchAll(/<div class="f-row"><span>([^<]+)<\/span>.*?<span class="mono">([^<]+)</g)].map(m=>m[1]+'='+m[2]);
 assert.deepEqual(labels,['Emails sent=1,700','Emails delivered=1,675','Qualified conversations=44','Meetings held=11','Opportunities=5','Won=1']);
 assert.doesNotMatch(html,/Interested replies|Meetings booked/);
});
test('portal records CSV has a header and one row per deal',async()=>{
 const rows=await bootPortal().csv();
 assert.equal(rows[0],'"record","date","name","status","amount","currency","detail"');
 assert.equal(rows.filter(r=>r.startsWith('"deal",')).length,4);assert.ok(rows.includes('"deal","2026-10-08","Head office fit-out, Business Bay","won","95000","AED","outreach"'));
 assert.ok(rows.some(r=>r.startsWith('"fee",'))&&rows.some(r=>r.startsWith('"payment",'))&&rows.some(r=>r.startsWith('"activity",')));
 assert.ok(rows.includes('"outcome","2026-10-01","meeting_held","","11","","distinct contacts"'));
});
test('portal moving a deal out of won or lost clears closed_at',async()=>{
 const p=bootPortal();p.fire('change',{id:'',dataset:{deal:'d1',f:'stage'},value:'proposal'});
 assert.ok((await p.csv()).includes('"deal","","Head office fit-out, Business Bay","proposal","95000","AED","outreach"'));
});
test('portal records CSV neutralises spreadsheet formulas in text cells',async()=>{
 const p=bootPortal();p.fire('change',{id:'',dataset:{deal:'d2',f:'name'},value:'=HYPERLINK("x")'});
 assert.ok((await p.csv()).includes(`"deal","","'=HYPERLINK(""x"")","proposal","140000","AED","linkedin"`));
});
