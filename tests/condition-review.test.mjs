import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fingerprint } from '../server/claim-review.mjs';
import { auditUnits } from '../server/claim-audit.mjs';
import { conditionPrompt, buildConditionMessages, validateConditions } from '../server/condition-review.mjs';
import { focusedCases, conditionFixture } from '../evals/claims/focused/cases.mjs';
import { diagnosticBudget, runDiagnostic, planFocused, runFocused, inspectFocused, focusedHTML } from '../evals/claims/focused/experiment.mjs';

const config={apiKey:'not-a-real-key',baseUrl:'https://example.invalid',model:'fixture'};
const example=()=>structuredClone(focusedCases.find(c=>c.id==='log-domain-valid'));
const response=(value,finish_reason='stop')=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:typeof value==='string'?value:JSON.stringify(value)}}]}));

test('focused protocol anchors exact units without asking for repeated assertions, premises or proof inventories',()=>{
  const c=example(),raw=conditionFixture(c),d=validateConditions(c.snapshot,raw);
  assert.deepEqual(d.checks.map(k=>k.text),auditUnits(c.snapshot).filter(u=>u.target).map(u=>u.text));
  assert.ok(d.checks.every(k=>k.route==='preserve'));assert.equal(d.semanticStatus,'model-proposal-unverified');
  assert.equal(buildConditionMessages(c.snapshot)[0].content,conditionPrompt);
  assert.ok(!Object.hasOwn(d.checks[0],'assertion'));assert.ok(!Object.hasOwn(d.checks[0],'premises'));
  for(const k of d.checks)assert.equal(c.snapshot.blocks[0].text.slice(k.start,k.end),k.text);
});

test('focused checks require complete, unique target coverage and refuse foreign context units or edits',()=>{
  const c=example();c.snapshot.blocks.push({id:'context',text:'这是上下文。',sourcePages:[1]});
  for(const change of [r=>r.checks.pop(),r=>r.checks.push(r.checks[0]),r=>r.checks[0].unitId='context:s1',r=>r.checks[0].unitId='unknown',r=>r.checks[0].after='改写']) {
    const raw=conditionFixture(c);change(raw);assert.throws(()=>validateConditions(c.snapshot,raw));
  }
});

test('condition proposals require exact allowed source quotes and concrete scope consequence; derivation absence alone grants no edit',()=>{
  const c=example(),raw=conditionFixture(c);
  raw.checks[1]={unitId:'p1:s2',verdict:'missing-condition',condition:'需要正输入',consequence:'否则实数对数未定义',evidence:[{page:1,quote:'For x>0 and y>0, ln(xy)=ln(x)+ln(y).'}]};
  const valid=validateConditions(c.snapshot,raw);assert.equal(valid.checks[1].route,'review-correction');
  // Literal anchoring does not certify semantics: context already states this
  // condition. Retain the error as unverified instead of claiming verification.
  assert.equal(valid.semanticStatus,'model-proposal-unverified');assert.ok(!('proposal' in valid));
  for(const mutate of [r=>r.checks[1].evidence[0].quote='not in source',r=>r.checks[1].evidence[0].page=2,r=>r.checks[1].evidence=[],r=>delete r.checks[1].consequence]) {
    const bad=structuredClone(raw);mutate(bad);assert.throws(()=>validateConditions(c.snapshot,bad));
  }
  c.snapshot.source.push({number:2,text:'outside allowed pages'});raw.checks[1].evidence=[{page:2,quote:'outside allowed pages'}];
  assert.throws(()=>validateConditions(c.snapshot,raw),/allowed source/);
});

test('unknown theorem stays a source gap; absence of evidence is not a counterexample',()=>{
  const c=focusedCases.find(c=>c.id==='theorem-unavailable'),raw=conditionFixture(c),d=validateConditions(c.snapshot,raw);
  assert.equal(d.checks[1].route,'needs-source');assert.equal(d.checks[0].route,'preserve');
  raw.checks[1]={unitId:'p1:s2',verdict:'contradiction',conflict:'没有证明'};
  assert.throws(()=>validateConditions(c.snapshot,raw));
});

test('single-call diagnosis keeps raw errors, never repairs format, and caps provider retries on truncation',async()=>{
  const c=example(),raw=conditionFixture(c);let calls=0;
  const ok=await runDiagnostic('focused',c.snapshot,{config,fetcher:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(body.max_tokens,2048);assert.equal(body.temperature,0);return response(raw);
  }});
  assert.equal(ok.status,'diagnosed');assert.equal(calls,1);assert.ok(!JSON.stringify(ok).includes(config.apiKey));
  for(const [reply,finish] of [['{invalid','stop'],[raw,'length']]) {
    calls=0;const failed=await runDiagnostic('focused',c.snapshot,{config:{...config,baseUrl:'https://api.deepseek.com'},fetcher:async()=>{calls++;return response(reply,finish);}});
    assert.equal(failed.status,'failed');assert.equal(failed.diagnostic,null);assert.equal(calls,1);assert.equal(failed.trace.length,1);
    if(finish==='length')assert.equal(failed.error.code,'EVAL_CALL_BUDGET');
  }
});

test('pre-cancelled and late cancelled diagnostics never accept a response or mutate the snapshot',async()=>{
  const c=example(),before=fingerprint(c.snapshot),controller=new AbortController();controller.abort();let calls=0;
  const early=await runDiagnostic('focused',c.snapshot,{config,signal:controller.signal,fetcher:async()=>{calls++;}});
  assert.equal(early.status,'failed');assert.equal(calls,0);
  const late=new AbortController();const r=await runDiagnostic('focused',c.snapshot,{config,signal:late.signal,fetcher:async()=>{late.abort();return response(conditionFixture(c));}});
  assert.equal(r.status,'failed');assert.equal(r.diagnostic,null);assert.equal(fingerprint(c.snapshot),before);
});

test('paired plan freezes identical model-facing materials and budgets, splits known regressions, and excludes reference labels',()=>{
  const plan=planFocused();assert.equal(plan.candidates.length,12);assert.equal(plan.maxCalls,12);assert.equal(plan.maxCompletionTokens,24576);
  assert.deepEqual(plan.budget,diagnosticBudget);assert.equal(plan.cases.filter(c=>c.split==='known-regression').length,2);
  for(const c of plan.cases) {
    const candidates=plan.candidates.filter(p=>p.caseId===c.id);
    assert.equal(candidates[0].messages[1].content,candidates[1].messages[1].content);
    const data=JSON.parse(candidates[0].messages[1].content);assert.deepEqual(Object.keys(data),['snapshot','units']);
    assert.ok(!JSON.stringify(data).includes(c.id));assert.ok(!JSON.stringify(data).includes(c.reference.reason));
  }
});

test('new domain fixtures are logically paired: positive products do not ensure both real logarithms exist',()=>{
  assert.equal((-1)*(-1),1);assert.ok(Number.isNaN(Math.log(-1)));
  for(const [x,y] of [[1,2],[0.25,4],[3,5]])assert.ok(Math.abs(Math.log(x*y)-Math.log(x)-Math.log(y))<1e-12);
  const cases=focusedCases.filter(c=>c.id.startsWith('log-'));assert.deepEqual(cases[0].snapshot.source,cases[1].snapshot.source);
});

test('focused simulation uses no external provider, produces escaped math report and verifies raw-response provenance',async()=>{
  let called=0;const run=await runFocused(planFocused(),{fetcher:async()=>{called++;}}),r=inspectFocused(run);
  assert.equal(called,0);assert.equal(r.totals.calls,12);assert.equal(r.totals.failures,0);assert.equal(r.totals.promptTokens,null);assert.equal(r.qualityConclusion,null);
  assert.ok(r.rows.every(row=>row.labelAgreement));
  const dom=new JSDOM(focusedHTML(run));assert.equal(dom.window.document.querySelectorAll('article').length,6);assert.equal(dom.window.document.querySelectorAll('[data-candidate]').length,12);
  assert.ok(dom.window.document.querySelectorAll('.math-node svg').length>20);assert.equal(dom.window.document.querySelectorAll('script').length,0);dom.window.close();
  const changed=structuredClone(run);changed.candidates.pop();assert.throws(()=>inspectFocused(changed),/hash/);
  const forged=structuredClone(run);forged.candidates[0].result.diagnostic.claims[0].text+='x';
  const {artifactHash,...rest}=forged;forged.artifactHash=fingerprint(rest);assert.throws(()=>inspectFocused(forged),/raw provider/);
});

test('changed plans and implicit paid batches are rejected before calling a model',async()=>{
  const p=planFocused();p.policy.focused+='x';let called=0;
  await assert.rejects(runFocused(p,{mode:'live',fetcher:async()=>{called++;}}),/plan changed/);assert.equal(called,0);
  for(const args of [['--focused','--live'],['--focused','--compare'],['--focused','--inspect','missing.json']])
    assert.throws(()=>execFileSync(process.execPath,['scripts/evaluate-claims.mjs',...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,stdio:'pipe'}),e=>e.status===1);
});

const archived=()=>JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-focused/run.json',import.meta.url),'utf8'));
test('real focused trial preserves pre-call plan, all twelve raw responses, true cost and three distinct failures',()=>{
  const run=archived(),r=inspectFocused(run);
  assert.equal(run.gitRevision,'e885e6695b1f9fdbdc52ad4847d93049092e6bea');assert.equal(run.gitDirty,false);
  assert.deepEqual(r.byArm,{v2:{candidates:6,calls:6,promptTokens:5622,completionTokens:2949,failures:3},focused:{candidates:6,calls:6,promptTokens:4524,completionTokens:491,failures:0}});
  assert.equal(r.totals.calls,12);assert.equal(r.qualityConclusion,null);assert.equal(r.semanticJudgment,'unverified');
  assert.ok(run.candidates.every(c=>c.result.trace[0].response.choices[0].finish_reason==='stop'));
  const failures=run.candidates.filter(c=>c.result.status==='failed');assert.deepEqual(failures.map(c=>c.result.error.code),['SyntaxError','AUDIT_SOURCE','ZodError']);
  const raw=id=>run.candidates.find(c=>c.id===id).result.trace[0].response.choices[0].message.content;
  assert.throws(()=>JSON.parse(raw('normalization-valid/v2')));
  const domain=JSON.parse(raw('log-domain-overclaim/v2')),gap=JSON.parse(raw('theorem-unavailable/v2'));
  assert.equal(domain.blocks[0].claims[1].support.kind,'contradicted');
  assert.equal(gap.blocks[0].claims[1].support.kind,'insufficient');assert.equal(typeof gap.blocks[0].claims[1].support.missing,'string');
});

test('a coincidentally matching aggregate label is not credited as correct targeting; focused preserves the formula and flags the conclusion',()=>{
  const run=archived(),report=inspectFocused(run),bad=run.candidates.find(c=>c.id==='normalization-overclaim/v2').result.diagnostic;
  assert.equal(report.rows.find(r=>r.id==='normalization-overclaim/v2').labelAgreement,true);
  assert.equal(bad.claims[0].route,'qualify');assert.equal(bad.claims[1].route,'preserve');
  assert.ok(bad.claims[1].support.steps.includes('乘以 ±1 不改变向量方向'));
  const focused=run.candidates.find(c=>c.id==='normalization-overclaim/focused').result.diagnostic;
  assert.equal(focused.checks[0].route,'preserve');assert.equal(focused.checks[1].unitId,'p1:s2');
  assert.equal(focused.checks[1].route,'review-correction');assert.match(focused.checks[1].conflict,/相反方向/);
  assert.equal((-1*2)/Math.abs(-1*2),-1);assert.equal(2/Math.abs(2),1);
  for(const c of run.candidates.filter(c=>c.arm==='focused'))assert.equal(c.result.status,'diagnosed');
});

test('provisional focused findings cover every candidate and cite raw fields including invalid JSON without silent repair',()=>{
  const run=archived(),findings=JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-focused/findings.json',import.meta.url),'utf8'));
  assert.equal(findings.runArtifactHash,run.artifactHash);assert.equal(findings.status,'provisional-ai-review');assert.equal(findings.semanticJudgment,'unverified');
  assert.deepEqual([...new Set(findings.findings.flatMap(f=>f.candidates))].sort(),run.candidates.map(c=>c.id).sort());
  for(const finding of findings.findings)for(const evidence of finding.evidence) {
    assert.ok(finding.candidates.includes(evidence.candidateId));const candidate=run.candidates.find(c=>c.id===evidence.candidateId);
    const raw=candidate.result.trace[0].response.choices[0].message.content;
    const field=evidence.path==='$raw'?raw:evidence.path.split('.').reduce((o,k)=>o?.[k],JSON.parse(raw));
    assert.equal(typeof field,'string');assert.ok(field.includes(evidence.quote));
  }
});
