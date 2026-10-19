import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fingerprint, claimReviewBudget } from '../server/claim-review.mjs';
import { auditBudget, validateAudit } from '../server/claim-audit.mjs';
import { checkArithmetic } from '../server/claim-arithmetic.mjs';
import { freshCases, freshOracles } from '../evals/claims/v2/cases.mjs';
import { planComparison, runComparison, inspectComparison, comparisonHTML } from '../evals/claims/v2/experiment.mjs';

test('comparison changes protocol while preserving source, original note, goal, actual budgets and equal candidate coverage',()=>{
  const plan=planComparison();assert.equal(plan.candidates.length,8);assert.equal(plan.maxCalls,16);assert.equal(plan.maxCompletionTokens,32768);
  assert.deepEqual(auditBudget,claimReviewBudget);assert.deepEqual(plan.budget,claimReviewBudget);
  for(const c of plan.cases) {
    const one=plan.candidates.find(p=>p.caseId===c.id&&p.arm==='v1'),two=plan.candidates.find(p=>p.caseId===c.id&&p.arm==='v2');
    assert.deepEqual(JSON.parse(one.messages[1].content),JSON.parse(two.messages[1].content).snapshot);
    assert.ok(!JSON.stringify(two.messages).includes('counterexample')); // No reference answer or case label.
    assert.ok(!JSON.stringify(two.messages).includes('freshOracles'));
    assert.equal(c.split,'development');
  }
  assert.deepEqual(plan.candidates.map(c=>c.arm),['v1','v2','v2','v1','v1','v2','v2','v1']);
  assert.throws(()=>planComparison(['unknown']));
});

test('new numeric probes satisfy the counterexample domain and independently verify determinant and normalization',()=>{
  const a=checkArithmetic(freshOracles.matrix);assert.equal(a.left,'0');assert.equal(a.right,'0');
  const values=Object.fromEntries(Object.entries(freshOracles.matrix.variables).map(([k,v])=>[k,Number(v)]));
  assert.ok(Object.values(values).every(v=>v!==0));assert.equal(values.a*values.d-values.b*values.c,0);
  const scaled=checkArithmetic(freshOracles.scale);assert.equal(scaled.left,'-1');assert.equal(scaled.right,'1');
  for(const multiplier of [-3,-1,1,4]) {
    const v=2,normalized=multiplier*v/Math.abs(multiplier*v);
    assert.equal(normalized,Math.sign(multiplier)*(v/Math.abs(v)));
  }
  assert.equal(freshCases.filter(c=>c.expected==='issue').length,2);assert.equal(freshCases.filter(c=>c.expected==='no-issue-found').length,2);
});

test('comparison simulation calls no external provider, keeps both protocols, renders math and checks replay integrity',async()=>{
  let called=0;const run=await runComparison(planComparison(),{fetcher:async()=>{called++;}}),report=inspectComparison(run);
  assert.equal(called,0);assert.equal(report.totals.calls,12);assert.equal(report.totals.failures,0);
  assert.equal(report.byArm.v1.calls,6);assert.equal(report.byArm.v2.calls,6);assert.equal(report.qualityConclusion,null);
  assert.equal(report.totals.promptTokens,null);
  const dom=new JSDOM(comparisonHTML(run));assert.equal(dom.window.document.querySelectorAll('article').length,4);
  assert.equal(dom.window.document.querySelectorAll('[data-candidate]').length,8);assert.ok(dom.window.document.querySelectorAll('.math-node svg').length>20);
  assert.equal(dom.window.document.querySelectorAll('.provider-trace').length,8);assert.equal(dom.window.document.querySelectorAll('script').length,0);dom.window.close();
  const changed=structuredClone(run);changed.candidates.pop();assert.throws(()=>inspectComparison(changed),/hash/);
  const forged=structuredClone(run);forged.candidates[0].result.snapshot.goal+='x';const {artifactHash,...body}=forged;forged.artifactHash=fingerprint(body);
  assert.throws(()=>inspectComparison(forged),/identity/);
});

test('changed plans and implicit paid comparison runs are refused before any provider call',async()=>{
  const plan=planComparison();plan.policy.v2.review+='changed';let calls=0;
  await assert.rejects(runComparison(plan,{mode:'live',fetcher:async()=>{calls++;}}),/plan changed/);assert.equal(calls,0);
  assert.throws(()=>execFileSync(process.execPath,['scripts/evaluate-claims.mjs','--compare','--live'],{cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,stdio:'pipe'}),e=>e.status===1&&/require --case/.test(e.stderr));
});

const archived=()=>JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-v2/run.json',import.meta.url),'utf8'));
test('real paired trial retains pre-call plan, both failures, true costs and no automatic quality conclusion',()=>{
  const run=archived(),report=inspectComparison(run);
  assert.equal(run.gitRevision,'15db0ea9c933cbb2f45353828a9c9c23f44ef4e1');assert.equal(run.gitDirty,false);
  assert.equal(fingerprint(run.plan),fingerprint(planComparison()));
  assert.deepEqual(report.byArm,{v1:{candidates:4,calls:6,promptTokens:4070,completionTokens:1087,failures:1},v2:{candidates:4,calls:5,promptTokens:5200,completionTokens:2722,failures:1}});
  assert.equal(report.totals.calls,11);assert.equal(report.qualityConclusion,null);assert.equal(report.semanticJudgment,'unverified');
  for(const arm of ['v1','v2'])assert.equal(report.rows.filter(r=>r.arm===arm&&r.labelAgreement).length,arm==='v1'?3:2);
  assert.ok(run.candidates.every(c=>c.result.trace.every(t=>t.response.choices[0].finish_reason==='stop')));
  const wrongJSON=run.candidates.find(c=>c.id==='normalization-valid/v2').result;
  assert.equal(wrongJSON.error.code,'SyntaxError');assert.throws(()=>JSON.parse(wrongJSON.trace[0].response.choices[0].message.content));
  assert.equal(wrongJSON.usage.completion_tokens,944);assert.equal(wrongJSON.proposal,null);
});

test('real unsupported directional inference is stopped without being relabeled as a correct diagnosis; arithmetic is scoped',()=>{
  const run=archived(),stopped=run.candidates.find(c=>c.id==='normalization-overclaim/v2').result;
  const audit=validateAudit(stopped.snapshot,stopped.audit.raw),conclusion=audit.claims[1];
  assert.equal(conclusion.support.kind,'derived');assert.equal(conclusion.route,'needs-source');
  assert.ok(conclusion.support.steps.includes('乘以 ±1 不改变非零向量的方向'));
  assert.equal(conclusion.premises[1].noteEvidence.length,0);assert.equal(conclusion.premises[1].sourceEvidence.length,0);
  assert.equal(stopped.status,'needs-source');assert.equal(stopped.preview,null);assert.equal(stopped.usage.calls,1);
  assert.equal(audit.claims[0].route,'qualify'); // Recorded limitation: a derivation fact was treated as a missing scope condition.
  const matrix=run.candidates.find(c=>c.id==='matrix-overclaim/v2').result,c=matrix.audit.claims[1];
  assert.equal(c.arithmetic.status,'arithmetic-checked');assert.equal(c.arithmetic.sourceMapping,'unverified');assert.equal(c.arithmetic.domainAssumptions,'unverified');
  assert.deepEqual(checkArithmetic(c.support.refutation.arithmetic),c.arithmetic);
  const vars=Object.fromEntries(Object.entries(c.support.refutation.arithmetic.variables).map(([k,v])=>[k,Number(v)]));
  assert.ok(Object.values(vars).every(v=>v!==0));assert.equal(vars.a*vars.d-vars.b*vars.c,0);
  assert.ok(matrix.preview.blocks[0].text.startsWith(matrix.audit.claims[0].text));
});

test('provisional paired findings quote every candidate including malformed raw JSON without repairing archived evidence',()=>{
  const run=archived(),findings=JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-v2/findings.json',import.meta.url),'utf8'));
  assert.equal(findings.runArtifactHash,run.artifactHash);assert.equal(findings.status,'provisional-ai-review');assert.equal(findings.semanticJudgment,'unverified');
  assert.deepEqual([...new Set(findings.findings.flatMap(f=>f.candidates))].sort(),run.candidates.map(c=>c.id).sort());
  for(const f of findings.findings)for(const e of f.evidence) {
    assert.ok(f.candidates.includes(e.candidateId));const c=run.candidates.find(c=>c.id===e.candidateId);
    const raw=c.result.trace.find(t=>t.stage===e.stage).response.choices[0].message.content;
    const field=e.path==='$raw'?raw:e.path.split('.').reduce((o,k)=>o?.[k],JSON.parse(raw));
    assert.equal(typeof field,'string');assert.ok(field.includes(e.quote));
  }
});
