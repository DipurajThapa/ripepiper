import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, graph, ledger } from "../harness/evaluate.mjs";
const copy=x=>structuredClone(x);
test("all unverified stages stay blocked without invented evidence",()=>{
 const r=evaluate(graph,ledger);assert.equal(r.length,graph.stages.length);assert.equal(r.filter(x=>x.accepted).length,0);
});
test("a self-declared verified stage cannot bypass QA and PM",()=>{
 const l=copy(ledger);l.stages.baseline.status="verified";const r=evaluate(graph,l);
 assert.equal(r.find(x=>x.id==="baseline").accepted,false);
 assert.equal(r.find(x=>x.id==="isolated-db").accepted,false);
});
test("complete evidence plus independent QA and PM accepts baseline only",()=>{
 const l=copy(ledger);Object.assign(l.stages.baseline,{status:"verified",pm_reviewed:true,qa_reviewed:true,qa_run_ref:"https://example.invalid/ci/123",evidence:{source_sha:"abc",backlog_ref:"docs/DELIVERY.md"}});
 const r=evaluate(graph,l);assert.equal(r.find(x=>x.id==="baseline").accepted,true);
 assert.equal(r.find(x=>x.id==="isolated-db").accepted,false);
});
test("cyclic dependency rejected",()=>{
 const g=copy(graph);g.stages[0].dependsOn=["project-handover"];
 assert.throws(()=>evaluate(g,ledger),/Graph cycle/);
});
test("release is blocked without explicit owner decision even if evidence exists",()=>{
 const l=copy(ledger);const entry=l.stages["operational-release"];
 Object.assign(entry,{status:"verified",pm_reviewed:true,qa_reviewed:true,qa_run_ref:"qa-1",evidence:Object.fromEntries(graph.stages.find(x=>x.id==="operational-release").evidence.map(k=>[k,"reviewed"]))});
 const r=evaluate(graph,l);assert.equal(r.find(x=>x.id==="operational-release").accepted,false);
 assert.match(r.find(x=>x.id==="operational-release").blockers.join(";"),/owner authorization/i);
});
