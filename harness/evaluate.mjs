#!/usr/bin/env node
// Read-only, fail-closed project delivery graph. No credentials, network, model calls or deploys.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("./", import.meta.url);
export const graph = JSON.parse(readFileSync(new URL("graph.json", root), "utf8"));
export const ledger = JSON.parse(readFileSync(new URL("ledger.json", root), "utf8"));
const roles = new Set(["pm","development","qa","cto"]);
const states = new Set(["not_started","in_progress","verified","blocked"]);
export function evaluate(g, l) {
  if (g.version !== 1 || l.version !== 1 || !Array.isArray(g.stages) || !l.stages) throw Error("Invalid schema");
  const index = new Map();
  for (const s of g.stages) {
    if (index.has(s.id) || !roles.has(s.owner) || !Array.isArray(s.dependsOn) || !Array.isArray(s.evidence)) throw Error("Invalid graph stage");
    index.set(s.id,s);
  }
  if (Object.keys(l.stages).some(id=>!index.has(id))) throw Error("Untracked stage in ledger");
  const out = new Map(), visiting=new Set();
  function visit(id) {
    if (out.has(id)) return out.get(id);
    if (visiting.has(id)) throw Error("Graph cycle");
    const s=index.get(id); if(!s) throw Error("Missing dependency: "+id);
    const entry=l.stages[id]; if(!entry || entry.owner!==s.owner || !states.has(entry.status)) throw Error("Missing or invalid PM ledger record: "+id);
    visiting.add(id);
    const parents=s.dependsOn.map(visit);
    visiting.delete(id);
    const missing=s.evidence.filter(k=>typeof entry.evidence?.[k]!=="string" || !entry.evidence[k].trim());
    const blockers=[];
    if(parents.some(p=>!p.accepted)) blockers.push("Dependencies not verified");
    if(missing.length) blockers.push("Missing evidence: "+missing.join(", "));
    if(entry.pm_reviewed!==true) blockers.push("PM acceptance missing");
    if(entry.qa_reviewed!==true) blockers.push("Independent QA acceptance missing");
    if(typeof entry.qa_run_ref!=="string" || !entry.qa_run_ref.trim()) blockers.push("QA run reference missing");
    if(id==="operational-release" && entry.owner_authorized!==true) blockers.push("Explicit owner authorization missing");
    const accepted=entry.status==="verified" && blockers.length===0;
    if(entry.status==="verified" && !accepted) blockers.push("Verified status rejected by fail-closed gate");
    const value={id,owner:s.owner,reported:entry.status,accepted,blockers};
    out.set(id,value);return value;
  }
  for(const s of g.stages) visit(s.id);
  return [...out.values()];
}
if (process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  const result=evaluate(graph,ledger);
  console.log(JSON.stringify({project:graph.project,verified:result.filter(x=>x.accepted).length,total:result.length,stages:result},null,2));
  if (process.argv.includes("--require-ready") && !result.every(x=>x.accepted)) process.exitCode=1;
}
