import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, graph, ledger } from "../harness/evaluate.mjs";
const copy=x=>structuredClone(x);
const emptyLedger=()=>({...copy(ledger),stages:Object.fromEntries(Object.entries(ledger.stages).map(([id,entry])=>[id,{...entry,status:"not_started",pm_reviewed:false,qa_reviewed:false,qa_run_ref:"",evidence:{}}]))});
test("all unverified stages stay blocked without invented evidence",()=>{
 const r=evaluate(graph,emptyLedger());assert.equal(r.length,graph.stages.length);assert.equal(r.filter(x=>x.accepted).length,0);
});
test("a self-declared verified stage cannot bypass QA and PM",()=>{
 const l=emptyLedger();l.stages.baseline.status="verified";const r=evaluate(graph,l);
 assert.equal(r.find(x=>x.id==="baseline").accepted,false);
 assert.equal(r.find(x=>x.id==="isolated-db").accepted,false);
});
test("complete evidence plus independent QA and PM accepts baseline only",()=>{
 const l=emptyLedger();Object.assign(l.stages.baseline,{status:"verified",pm_reviewed:true,qa_reviewed:true,qa_run_ref:"https://example.invalid/ci/123",evidence:{source_sha:"abc",backlog_ref:"docs/DELIVERY.md"}});
 const r=evaluate(graph,l);assert.equal(r.find(x=>x.id==="baseline").accepted,true);
 assert.equal(r.find(x=>x.id==="isolated-db").accepted,false);
});
test("cyclic dependency rejected",()=>{
 const g=copy(graph);g.stages[0].dependsOn=["project-handover"];
 assert.throws(()=>evaluate(g,ledger),/Graph cycle/);
});
test("release is blocked without explicit owner decision even if evidence exists",()=>{
 const l=emptyLedger();const entry=l.stages["operational-release"];
 Object.assign(entry,{status:"verified",pm_reviewed:true,qa_reviewed:true,qa_run_ref:"qa-1",evidence:Object.fromEntries(graph.stages.find(x=>x.id==="operational-release").evidence.map(k=>[k,"reviewed"]))});
 const r=evaluate(graph,l);assert.equal(r.find(x=>x.id==="operational-release").accepted,false);
 assert.match(r.find(x=>x.id==="operational-release").blockers.join(";"),/owner authorization/i);
});

test("each pending stage exposes an actionable PM next step",()=>{
 const results=evaluate(graph,ledger);
 assert.ok(results.every(x=>x.accepted || x.nextAction.startsWith("PM:")));
 assert.ok(results.some(x=>x.nextAction.includes("independent prerequisites")));
});

test("offline verification can advance without accepting hosted operational stages",()=>{
 const l=emptyLedger();
 for(const id of ["baseline","offline-provider-reliability","offline-provider-qa"]){
  const stage=graph.stages.find(s=>s.id===id);assert.ok(stage);Object.assign(l.stages[id],{status:"verified",pm_reviewed:true,qa_reviewed:true,qa_run_ref:"independent-fixture-run",evidence:Object.fromEntries(stage.evidence.map(k=>[k,"synthetic-fixture-reference"]))});
 }
 const result=evaluate(graph,l);
 assert.equal(result.find(s=>s.id==="offline-provider-qa").accepted,true);
 for(const id of ["isolated-db","shared-provider-reliability","operational-release"]){assert.equal(result.find(s=>s.id===id).accepted,false);}
});
