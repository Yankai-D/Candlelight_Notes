import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fingerprint } from '../server/claim-review.mjs';
import { auditUnits } from '../server/claim-audit.mjs';
import { validateConditions } from '../server/condition-review.mjs';
import { meaningSuffix } from '../evals/claims/meaning/policy.mjs';
import { meaningCases, meaningFixture } from '../evals/claims/meaning/cases.mjs';
import { planMeaning, runMeaning, inspectMeaning, meaningMarkdown } from '../evals/claims/meaning/experiment.mjs';
import { runDiagnostic } from '../evals/claims/focused/experiment.mjs';

const config={apiKey:'test-only',model:'fixture',baseUrl:'https://api.deepseek.com'};
const reply=raw=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}));
const rehash=run=>{const {artifactHash,...body}=run;run.artifactHash=fingerprint(body);return run;};

test('meaning experiment varies exactly one system suffix, keeps references off the wire, and freezes the paid ceiling',()=>{
  const plan=planMeaning();assert.equal(plan.maxCalls,12);assert.equal(plan.maxCompletionTokens,24576);
  for(const c of plan.cases) {
    const pair=plan.candidates.filter(p=>p.caseId===c.id),base=pair.find(p=>p.arm==='focused'),variant=pair.find(p=>p.arm==='meaning');
    assert.equal(variant.messages[0].content,base.messages[0].content+meaningSuffix);
    assert.deepEqual(variant.messages.slice(1),base.messages.slice(1));
    const wire=JSON.parse(base.messages[1].content);assert.deepEqual(Object.keys(wire),['snapshot','units']);
    assert.deepEqual(wire.snapshot,c.snapshot);assert.ok(!base.messages[1].content.includes(c.reference.reason));
    assert.ok(!base.messages[1].content.includes(c.id));
  }
  assert.deepEqual(plan.candidates.map(p=>p.arm),['focused','meaning','meaning','focused','focused','meaning','meaning','focused','focused','meaning','meaning','focused']);
});

test('observed mean keeps the entire actual window and controls change only the offending phrase',()=>{
  const field=JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-field/run.json',import.meta.url),'utf8'));
  const original=meaningCases[0].snapshot;
  assert.deepEqual(original,field.reviews.find(w=>w.windowId==='w4'||w.id==='w4').result.snapshot);
  assert.equal(fingerprint(original),'fb0373b047586cd6f5680a09e1857a8cd45ae6fea00548652cdcf1d216fccfab');
  for(const c of meaningCases.slice(1,3)) {
    assert.deepEqual(c.snapshot.source,original.source);assert.deepEqual(c.snapshot.targetIds,original.targetIds);
    assert.deepEqual(c.snapshot.blocks.filter(b=>b.id!=='b7'),original.blocks.filter(b=>b.id!=='b7'));
    const before=auditUnits(original).filter(u=>u.target),after=auditUnits(c.snapshot).filter(u=>u.target);
    assert.deepEqual(before.map(u=>u.id),after.map(u=>u.id));
    for(const unit of before)if(unit.id!=='b7:s2')assert.equal(unit.text,after.find(u=>u.id===unit.id).text);
  }
});

test('specific numerical oracles distinguish contribution, coefficient, weighted mean and operation order',()=>{
  const values=[1,3],n=values.length,mean=values.reduce((a,b)=>a+b,0)/n;
  assert.equal(mean,2);assert.equal(values.reduce((a,x)=>a+x*x,0)/n,5);
  assert.equal(values.reduce((a,x)=>a+x*x,0)/values.reduce((a,b)=>a+b),2.5);
  const weights=[1,2];assert.equal(values.reduce((sum,x,i)=>sum+weights[i]*x,0)/3,7/3);
  const delta=4;assert.equal(((values[0]+delta)+values[1])/n-mean,delta/n);
  const [x,a,b]=[10,2,4];assert.equal((x-a)/b,2);assert.equal(x/b-a,0.5);assert.equal(x/b-a/b,2);
  for(const c of meaningCases)assert.equal(validateConditions(c.snapshot,meaningFixture(c)).checks.length,auditUnits(c.snapshot).filter(u=>u.target).length);
});

test('offline run uses no external provider, retains per-unit references and produces no quality certification',async()=>{
  let calls=0;const run=await runMeaning(planMeaning(),{fetcher:async()=>{calls++;}}),r=inspectMeaning(run);
  assert.equal(calls,0);assert.equal(r.totals.calls,12);assert.equal(r.totals.failures,0);assert.equal(r.totals.promptTokens,null);
  assert.ok(r.rows.every(row=>row.allUnitsAgree));assert.equal(r.qualityConclusion,null);assert.equal(r.semanticJudgment,'unverified');
  assert.match(meaningMarkdown(run),/0 次真实模型调用/);
});

test('wrong-target issue and a separate missed issue remain visible instead of cancelling in an aggregate label',async()=>{
  const c=meaningCases[0],raw=meaningFixture(c);
  raw.checks.find(u=>u.unitId==='b7:s2').verdict='retain';
  raw.checks=raw.checks.map(u=>u.unitId==='b7:s2'?{unitId:u.unitId,verdict:'retain'}:u);
  raw.checks[0]={unitId:'b7:s1',verdict:'needs-source',missing:'测试中的错误定位'};
  const run=await runMeaning(planMeaning([c.id]),{mode:'live',config,fetcher:async()=>reply(raw)}),r=inspectMeaning(run);
  for(const row of r.rows) {
    assert.equal(row.allUnitsAgree,false);
    assert.deepEqual(row.units.filter(u=>u.referenceAgreement===false).map(u=>u.unitId),['b7:s1','b7:s2']);
  }
});

test('raw response, budget and frozen plan tampering are rejected independently of the outer hash',async()=>{
  const run=await runMeaning(planMeaning(['center-order-control']));
  for(const mutate of [r=>r.candidates[0].result.diagnostic.checks[0].text+='changed',r=>r.candidates[0].result.trace[0].request.max_tokens=4096,r=>r.plan.policy.meaning+='changed']) {
    const changed=structuredClone(run);mutate(changed);rehash(changed);assert.throws(()=>inspectMeaning(changed));
  }
  const changed=planMeaning();changed.cases[0].snapshot.goal+='changed';let calls=0;
  await assert.rejects(runMeaning(changed,{mode:'live',config,fetcher:async()=>{calls++;}}),/plan changed/);assert.equal(calls,0);
});

test('meaning uses the existing single-call boundary and preserves format failures without retries',async()=>{
  const c=meaningCases[4];let calls=0;
  const r=await runDiagnostic('meaning',c.snapshot,{config,fetcher:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(body.max_tokens,2048);assert.equal(body.temperature,0);
    return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{invalid'}}]}));
  }});
  assert.equal(calls,1);assert.equal(r.status,'failed');assert.equal(r.diagnostic,null);assert.equal(r.error.code,'EVAL_CALL_BUDGET');
  assert.ok(!JSON.stringify(r).includes(config.apiKey));
});

test('CLI rejects implicit paid matrix and conflicting protocol flags before any model call',()=>{
  for(const args of [['--meaning','--live'],['--meaning','--focused'],['--meaning','--compare'],['--meaning','--inspect','absent.json']])
    assert.throws(()=>execFileSync(process.execPath,['scripts/evaluate-claims.mjs',...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,stdio:'pipe'}),e=>e.status===1);
});

const archived=()=>JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-meaning/run.json',import.meta.url),'utf8'));
test('real trial preserves pre-call revision, all twelve responses, negative result and extra token cost',()=>{
  const run=archived(),r=inspectMeaning(run);
  assert.equal(run.gitRevision,'7a83ff8f099fdc5706d64ce08b788930c4cbf2f4');assert.equal(run.gitDirty,false);
  assert.equal(run.artifactHash,'9cd892e41f20b1eab5d77a7eb34a7cc98eb9f7083bd38fbe467f6ca6bb1f4d2d');
  assert.deepEqual(r.byArm,{focused:{candidates:6,calls:6,promptTokens:11391,completionTokens:473,failures:0},meaning:{candidates:6,calls:6,promptTokens:11979,completionTokens:518,failures:0}});
  assert.equal(r.byArm.meaning.promptTokens-r.byArm.focused.promptTokens,588);
  assert.equal(r.byArm.meaning.completionTokens-r.byArm.focused.completionTokens,45);
  assert.equal(r.totals.promptTokens,23370);assert.equal(r.totals.completionTokens,991);
  for(const c of run.plan.cases) {
    const pair=r.rows.filter(row=>row.caseId===c.id);assert.deepEqual(pair[0].units,pair[1].units);
    assert.equal(pair[0].allUnitsAgree,c.id!=='mean-observed');
  }
  assert.equal(r.rows.reduce((n,row)=>n+row.units.length,0),48);
  assert.ok(run.candidates.every(c=>c.result.trace[0].response.choices[0].finish_reason==='stop'));
  assert.equal(r.qualityConclusion,null);assert.equal(r.semanticJudgment,'unverified');
});

test('actual numerical witness is valid without crediting a diagnosis the baseline already found',()=>{
  const run=archived(),bad=run.candidates.filter(c=>c.caseId==='center-order-mismatch');
  for(const c of bad)assert.deepEqual(c.result.diagnostic.checks.map(k=>[k.unitId,k.verdict]),[['p1:s1','retain'],['p1:s2','contradiction']]);
  const reasoning=bad.find(c=>c.arm==='meaning').result.diagnostic.checks[1].conflict;
  assert.ok(reasoning.includes('x=1,a=1,b=2'));assert.ok(reasoning.includes('1/2-1=-0.5'));assert.ok(reasoning.includes('(1-1)/2=0'));
  assert.equal(1/2-1,-0.5);assert.equal((1-1)/2,0);assert.ok(2>0);
  for(const c of run.candidates.filter(c=>c.caseId==='mean-observed'))assert.equal(c.result.diagnostic.checks.find(k=>k.unitId==='b7:s2').verdict,'retain');
});

test('provisional observations cite raw fields for every candidate and do not populate human judgments',()=>{
  const run=archived(),findings=JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-meaning/findings.json',import.meta.url),'utf8'));
  assert.equal(findings.runArtifactHash,run.artifactHash);assert.equal(findings.status,'provisional-ai-review');assert.equal(findings.semanticJudgment,'unverified');assert.equal(findings.humanReview,null);
  assert.deepEqual([...new Set(findings.findings.flatMap(f=>f.candidates))].sort(),run.candidates.map(c=>c.id).sort());
  for(const finding of findings.findings)for(const e of finding.evidence) {
    assert.ok(finding.candidates.includes(e.candidateId));
    const raw=JSON.parse(run.candidates.find(c=>c.id===e.candidateId).result.trace[0].response.choices[0].message.content);
    const field=e.path.split('.').reduce((o,k)=>o?.[k],raw);assert.equal(typeof field,'string');assert.ok(field.includes(e.quote));
  }
});
