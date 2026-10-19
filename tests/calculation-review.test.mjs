import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fingerprint } from '../server/claim-review.mjs';
import { auditUnits } from '../server/claim-audit.mjs';
import { buildExtractionMessages, buildCalculationMessages, validateExtraction, validateCalculationReview, runCalculationReview, calculationStageBudget } from '../server/calculation-review.mjs';
import { calculationCases, extractionFixture, comparisonFixture } from '../evals/claims/calculation/cases.mjs';
import { planCalculation, runCalculationExperiment, inspectCalculation, inspectCalculationExecution, calculationMarkdown } from '../evals/claims/calculation/experiment.mjs';

const sample=id=>structuredClone(calculationCases.find(c=>c.id===id));
const config={apiKey:'offline-test-only',baseUrl:'https://api.deepseek.com',model:'fixture'};
const response=(raw,finish_reason='stop')=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:typeof raw==='string'?raw:JSON.stringify(raw)}}]}));
const rehash=r=>{const {artifactHash,...body}=r;r.artifactHash=fingerprint(body);return r;};
const extraction=c=>validateExtraction(c.snapshot,extractionFixture(c));

test('first stage sees exact note context but no source text, source pages or developer references',()=>{
  const c=sample('mean-observed'),messages=buildExtractionMessages(c.snapshot),wire=JSON.parse(messages[1].content);
  assert.deepEqual(Object.keys(wire),['note','units']);assert.deepEqual(wire.units,auditUnits(c.snapshot));
  assert.deepEqual(wire.note.blocks,c.snapshot.blocks.map(({id,text})=>({id,text})));
  assert.ok(!Object.hasOwn(wire.note,'source'));assert.ok(!messages[1].content.includes('sourcePages'));
  for(const page of c.snapshot.source)assert.ok(!messages[1].content.includes(page.text.slice(0,50)));
  assert.ok(!messages[1].content.includes(c.reference.reason));
  const changed=structuredClone(c.snapshot);changed.source[0].text='A different source body';
  assert.deepEqual(buildExtractionMessages(changed),messages);
  assert.notEqual(extraction(c).snapshotHash,validateExtraction(changed,extractionFixture(c)).snapshotHash);
});

test('extraction coverage and quotes bind interpretations to exact target units, including mixed prose',()=>{
  const c=sample('mean-observed'),raw=extractionFixture(c),valid=extraction(c);
  const target=valid.units.find(u=>u.unitId==='b7:s2');assert.equal(target.kind,'calculation');assert.equal(target.rules[0].expression,'sum(x_i*x_i)/n');
  assert.equal(target.text,c.snapshot.blocks.find(b=>b.id==='b7').text.slice(target.start,target.end));
  for(const mutate of [r=>r.units.pop(),r=>r.units.push(r.units[0]),r=>r.units[0].unitId='b5:s1',r=>r.units[1].rules[0].quote='not in note',r=>r.units[1].rules=[],r=>r.units[1].verdict='retain']) {
    const bad=structuredClone(raw);mutate(bad);assert.throws(()=>validateExtraction(c.snapshot,bad));
  }
});

test('source comparison uses the frozen intermediate result and rejects changed snapshots or interpretations',()=>{
  const c=sample('center-order-mismatch'),e=extraction(c),messages=buildCalculationMessages(c.snapshot,e),wire=JSON.parse(messages[1].content);
  assert.deepEqual(wire.extraction,e.raw);assert.deepEqual(wire.snapshot,c.snapshot);
  for(const mutate of [v=>v.raw.units[1].rules[0].expression='(x-a)/b',v=>v.units[1].rules[0].expression='(x-a)/b',v=>v.snapshotHash='changed',v=>v.extractionHash='changed']) {
    const bad=structuredClone(e);mutate(bad);assert.throws(()=>buildCalculationMessages(c.snapshot,bad),/changed interpretation/);
  }
  const changed=structuredClone(c.snapshot);changed.goal+='changed';assert.throws(()=>buildCalculationMessages(changed,e),/changed interpretation/);
});

test('each calculation gets exactly one comparison and source must be literal on an allowed page',()=>{
  const c=sample('center-order-mismatch'),e=extraction(c),raw=comparisonFixture(c,e.raw);
  const valid=validateCalculationReview(c.snapshot,e,raw);assert.equal(valid.extractionHash,e.extractionHash);assert.equal(valid.comparisons[0].relation,'conflict');
  for(const mutate of [r=>r.comparisons=[],r=>r.comparisons.push(r.comparisons[0]),r=>r.comparisons[0].unitId='p1:s1',r=>r.comparisons[0].ruleIndex=1,r=>r.comparisons[0].source.quote='invented source',r=>r.comparisons[0].source.page=2,r=>r.comparisons[0].sourceExpression='']) {
    const bad=structuredClone(raw);mutate(bad);assert.throws(()=>validateCalculationReview(c.snapshot,e,bad));
  }
  c.snapshot.source.push({number:2,text:raw.comparisons[0].source.quote});const e2=extraction(c);raw.comparisons[0].source.page=2;
  assert.throws(()=>validateCalculationReview(c.snapshot,e2,raw),/allowed source/);
});

test('a recorded conflict cannot be silently retained and missing definitions cannot become contradictions',()=>{
  const c=sample('mean-observed'),e=extraction(c),raw=comparisonFixture(c,e.raw);
  raw.checks=raw.checks.map(u=>({unitId:u.unitId,verdict:'retain'}));assert.throws(()=>validateCalculationReview(c.snapshot,e,raw),/recorded comparison/);
  const missing=sample('undefined-transform'),me=extraction(missing),mr=comparisonFixture(missing,me.raw);
  assert.equal(validateCalculationReview(missing.snapshot,me,mr).checks[1].verdict,'needs-source');
  mr.checks[1]={unitId:'p1:s2',verdict:'retain'};assert.throws(()=>validateCalculationReview(missing.snapshot,me,mr),/recorded comparison/);
});

test('intuition and unresolved language have explicit exits instead of fabricated numerical rules',()=>{
  const c=sample('balance-metaphor'),e=extraction(c),raw=comparisonFixture(c,e.raw);
  assert.ok(e.units.every(u=>u.kind==='intuition'));assert.equal(raw.comparisons.length,0);
  assert.ok(validateCalculationReview(c.snapshot,e,raw).checks.every(u=>u.verdict==='retain'));
  const unresolved=extractionFixture(c);unresolved.units[0].kind='unresolved';
  const ue=validateExtraction(c.snapshot,unresolved);assert.throws(()=>validateCalculationReview(c.snapshot,ue,raw),/recorded comparison/);
  raw.checks[0]={unitId:'p1:s1',verdict:'needs-source',missing:'需澄清原句的计算含义'};
  assert.equal(validateCalculationReview(c.snapshot,ue,raw).checks[0].route,'needs-source');
});

test('two bounded stages preserve raw contexts, checkpoint intermediate interpretation and never edit the input',async()=>{
  const c=sample('mean-observed'),before=fingerprint(c.snapshot);let calls=0;const stages=[];
  const r=await runCalculationReview(c.snapshot,{config,onStage:async r=>stages.push({status:r.status,extraction:!!r.extraction,diagnostic:!!r.diagnostic}),fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.max_tokens,2048);assert.equal(body.temperature,0);
    return response(calls++===0?extractionFixture(c):comparisonFixture(c,extractionFixture(c)));
  }});
  assert.equal(calls,2);assert.equal(r.status,'diagnosed');assert.equal(fingerprint(c.snapshot),before);
  assert.deepEqual(stages,[{status:'running',extraction:true,diagnostic:false},{status:'diagnosed',extraction:true,diagnostic:true}]);
  inspectCalculationExecution(r,{snapshot:c.snapshot,model:config.model});assert.ok(!JSON.stringify(r).includes(config.apiKey));
});

test('malformed or truncated extraction stops before comparison with one actual request and no repair',async()=>{
  const c=sample('mean-observed');
  for(const [raw,finish] of [['{invalid','stop'],[extractionFixture(c),'length']]) {
    let calls=0;const r=await runCalculationReview(c.snapshot,{config,fetcher:async()=>{calls++;return response(raw,finish);}});
    assert.equal(calls,1);assert.equal(r.status,'failed');assert.equal(r.extraction,null);assert.equal(r.diagnostic,null);assert.equal(r.stages.length,1);
    if(finish==='length')assert.equal(r.error.code,'EVAL_CALL_BUDGET');
    inspectCalculationExecution(r,{snapshot:c.snapshot,model:config.model});
  }
});

test('late comparison failure retains the accepted extraction and cancellation never sends the next request',async()=>{
  const c=sample('center-order-control');let calls=0;
  const failed=await runCalculationReview(c.snapshot,{config,fetcher:async()=>response(calls++===0?extractionFixture(c):'{invalid')});
  assert.equal(calls,2);assert.equal(failed.error.stage,'compare');assert.ok(failed.extraction);assert.equal(failed.diagnostic,null);
  inspectCalculationExecution(failed,{snapshot:c.snapshot,model:config.model});
  const controller=new AbortController();calls=0;
  const cancelled=await runCalculationReview(c.snapshot,{config,signal:controller.signal,fetcher:async()=>{calls++;return response(extractionFixture(c));},onStage:async r=>{if(r.stages.length===1)controller.abort();}});
  assert.equal(calls,1);assert.equal(cancelled.error.stage,'compare');assert.ok(cancelled.extraction);assert.equal(cancelled.diagnostic,null);
  inspectCalculationExecution(cancelled,{snapshot:c.snapshot,model:config.model});
});

test('experiment distinguishes stage budgets and extra calls, keeps all baseline materials and excludes references',async()=>{
  const plan=planCalculation();assert.equal(plan.cases.length,8);assert.equal(plan.maxCalls,24);assert.equal(plan.maxCompletionTokens,49152);
  assert.equal(plan.budgets.focused.maxCalls,1);assert.equal(plan.budgets.calculation.maxCalls,2);assert.deepEqual(plan.budgets.stage,calculationStageBudget);
  const previous=JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-meaning/run.json',import.meta.url),'utf8'));
  for(const c of plan.cases.slice(0,6))assert.deepEqual(c.snapshot,previous.plan.cases.find(p=>p.id===c.id).snapshot);
  for(const p of plan.candidates){const c=plan.cases.find(c=>c.id===p.caseId);assert.ok(!p.firstMessages[1].content.includes(c.reference.reason));assert.ok(!p.firstMessages[1].content.includes(c.id));}
  let calls=0;const run=await runCalculationExperiment(plan,{fetcher:async()=>{calls++;}}),report=inspectCalculation(run);
  assert.equal(calls,0);assert.equal(report.totals.calls,24);assert.equal(report.totals.failures,0);assert.equal(report.qualityConclusion,null);assert.ok(report.rows.every(r=>r.allUnitsAgree));
  assert.equal(report.byArm.focused.calls,8);assert.equal(report.byArm.calculation.calls,16);
  assert.match(calculationMarkdown(run),/0 次真实模型调用/);
});

test('replay detects changed intermediate text, second-stage input, raw output and budget independently of outer hashes',async()=>{
  const run=await runCalculationExperiment(planCalculation(['mean-observed']));
  for(const mutate of [r=>r.candidates[1].result.extraction.units[1].rules[0].expression='changed',r=>r.candidates[1].result.stages[1].trace[0].request.messages[1].content='changed',r=>r.candidates[1].result.diagnostic.comparisons=[],r=>r.candidates[1].result.stages[1].trace[0].request.max_tokens=4096]) {
    const bad=structuredClone(run);mutate(bad);bad.candidates[1].result.trace=bad.candidates[1].result.stages.flatMap(s=>s.trace);assert.throws(()=>inspectCalculation(rehash(bad)));
  }
  const p=planCalculation();p.policy.extract+='changed';let calls=0;
  await assert.rejects(runCalculationExperiment(p,{mode:'live',config,fetcher:async()=>{calls++;}}),/plan changed/);assert.equal(calls,0);
});

test('CLI rejects implicit paid batches and ambiguous experiment flags before any model request',()=>{
  for(const args of [['--calculation','--live'],['--calculation','--meaning'],['--calculation','--focused'],['--calculation','--inspect','absent.json']])
    assert.throws(()=>execFileSync(process.execPath,['scripts/evaluate-claims.mjs',...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,stdio:'pipe'}),e=>e.status===1);
});

const archived=()=>JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-calculation/run.json',import.meta.url),'utf8'));
const stageRaw=(c,name)=>JSON.parse((name==='focused'?c.result.trace:c.result.stages.find(s=>s.name===name).trace)[0].response.choices[0].message.content);
test('real trial keeps frozen revision, all 22 responses, unequal costs and three stage failures',()=>{
  const run=archived(),r=inspectCalculation(run);
  assert.equal(run.gitRevision,'27b1c449898214563f1f6f801b4971d1757a00cd');assert.equal(run.gitDirty,false);
  assert.equal(run.artifactHash,'1f855adac664265b0da654747a90de8a409be26884e96f8ca25621a5ca39bce9');
  assert.deepEqual(r.byArm,{focused:{candidates:8,calls:8,promptTokens:12675,completionTokens:625,failures:0},calculation:{candidates:8,calls:14,promptTokens:18522,completionTokens:2554,failures:3}});
  assert.equal(r.totals.calls,22);assert.equal(r.totals.promptTokens,31197);assert.equal(r.totals.completionTokens,3179);assert.equal(r.qualityConclusion,null);
  assert.ok(run.candidates.flatMap(c=>c.result.trace).every(t=>t.response.choices[0].finish_reason==='stop'));
  assert.deepEqual(run.candidates.filter(c=>c.result.status==='failed').map(c=>c.result.error),[{stage:'compare',code:'CALCULATION_SOURCE'},{stage:'extract',code:'ZodError'},{stage:'extract',code:'ZodError'}]);
});

test('real interpretation preserves the quote but changes its operational meaning; whitespace rejection is not a semantic catch',()=>{
  const run=archived(),c=run.candidates.find(c=>c.id==='mean-observed/calculation');
  const rule=c.result.extraction.units.find(u=>u.unitId==='b7:s2').rules[0];
  assert.ok(rule.quote.includes('以自身大小为权重'));assert.ok(rule.expression.includes('(Σ 各观测值) / 观测个数'));
  assert.ok(!rule.expression.includes('权重'));assert.equal(c.result.diagnostic,null);
  const raw=stageRaw(c,'compare');assert.equal(raw.checks[1].verdict,'retain');assert.equal(raw.comparisons[0].relation,'compatible');
  const source=c.result.snapshot.source.find(p=>p.number===4).text,quote=raw.comparisons[0].source.quote;
  assert.ok(!source.includes(quote));assert.ok(source.replace(/\s+/g,' ').includes(quote.replace(/\s+/g,' ')));
  assert.equal((1+3)/2,2);assert.equal((1*1+3*3)/2,5);
  const report=calculationMarkdown(run);assert.ok(report.includes('CALCULATION_SOURCE'));assert.ok(report.includes('以自身大小为权重'));assert.ok(report.includes('sourceExpression'));
});

test('extra fields remain rejected, metaphor stays non-calculational and missing definition is not silently relabeled correct',()=>{
  const run=archived();
  for(const id of ['mean-equal-control','mean-contribution-control']) {
    const c=run.candidates.find(c=>c.id===id+'/calculation'),raw=stageRaw(c,'extract');
    assert.ok(raw.units[1].quote);assert.equal(c.result.stages.length,1);assert.equal(c.result.extraction,null);
    assert.throws(()=>validateExtraction(c.result.snapshot,raw),e=>e.issues?.every(i=>i.code==='unrecognized_keys'&&i.keys.includes('quote')));
  }
  const metaphor=run.candidates.find(c=>c.id==='balance-metaphor/calculation').result;
  assert.deepEqual(metaphor.extraction.units.map(u=>u.kind),['intuition','context']);assert.equal(metaphor.diagnostic.comparisons.length,0);
  const gap=run.candidates.find(c=>c.id==='undefined-transform/calculation').result;
  assert.equal(gap.diagnostic.checks[1].verdict,'needs-source');assert.equal(gap.diagnostic.comparisons[0].relation,'needs-source');
  assert.equal(run.candidates.find(c=>c.id==='undefined-transform/focused').result.diagnostic.checks[1].verdict,'contradiction');
  const bad=run.candidates.find(c=>c.id==='center-order-mismatch/calculation').result;
  assert.deepEqual(bad.diagnostic.checks.map(c=>c.verdict),['retain','contradiction']);assert.ok(bad.diagnostic.checks[1].conflict.includes('x=2,a=1,b=2'));
  assert.equal((2-1)/2,0.5);assert.equal(2/2-1,0);
});

test('every provisional finding is bound to raw evidence including rejected stages, with human judgments still empty',()=>{
  const run=archived(),findings=JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-calculation/findings.json',import.meta.url),'utf8'));
  assert.equal(findings.runArtifactHash,run.artifactHash);assert.equal(findings.status,'provisional-ai-review');assert.equal(findings.semanticJudgment,'unverified');assert.equal(findings.humanReview,null);
  assert.deepEqual([...new Set(findings.findings.flatMap(f=>f.candidates))].sort(),run.candidates.map(c=>c.id).sort());
  for(const f of findings.findings)for(const e of f.evidence) {
    assert.ok(f.candidates.includes(e.candidateId));
    const raw=stageRaw(run.candidates.find(c=>c.id===e.candidateId),e.stage),field=e.path.split('.').reduce((o,k)=>o?.[k],raw);
    assert.equal(typeof field,'string');assert.ok(field.includes(e.quote));
  }
});
