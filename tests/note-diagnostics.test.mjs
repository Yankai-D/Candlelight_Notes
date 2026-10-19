import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { artifactHash, hash, planExperiment, runExperiment } from '../evals/notes/experiment.mjs';
import { inspectRun, diagnosticsMarkdown, validateFindings } from '../evals/notes/diagnostics.mjs';
import { createReview, summarizeReview } from '../evals/notes/review.mjs';

const runFile = new URL('../evals/notes/runs/2026-10-17-pilot/run.json',import.meta.url);
const findingsFile = new URL('../evals/notes/runs/2026-10-17-pilot/findings.json',import.meta.url);
const recorded = () => JSON.parse(readFileSync(runFile,'utf8'));
const findings = () => JSON.parse(readFileSync(findingsFile,'utf8'));
const seal = run => {run.planHash=hash(run.plan);run.artifactHash=artifactHash(run);return run;};

test('archived live evidence reproduces the wire budget and totals without implying teaching quality',()=>{
  const run=recorded(), report=inspectRun(run);
  assert.equal(report.totals.candidates,6);assert.equal(report.totals.calls,6);
  assert.equal(report.totals.promptTokens,16144);assert.equal(report.totals.completionTokens,7963);
  assert.equal(report.qualityConclusion,null);assert.equal(report.recordedLimitsPassed,true);
  assert.deepEqual(report.missingCandidates,[]);
  assert.ok(report.candidates.every(c=>c.attempts[0].effectiveMaxTokens===2048 && c.attempts[0].requestedMaxTokens===32768));
  assert.equal(summarizeReview(run,createReview(run).review).status,'awaiting-human-review');
  assert.match(diagnosticsMarkdown(report),/2048/);
  // Diagnostics derives usage from provider traces, not editable summary fields.
  const stale=structuredClone(run);stale.candidates[0].usage={calls:99,promptTokens:0,completionTokens:0};
  assert.equal(inspectRun(seal(stale)).totals.completionTokens,7963);
  const damaged=recorded();damaged.candidates[0].result.blocks[0].text='tampered';
  assert.throws(()=>inspectRun(damaged),/hash mismatch/);
});

test('unknown use remains unknown and failures and missing candidates remain visible',async()=>{
  const run=await runExperiment(planExperiment({materialIds:['diagonal-penalty'],selectedProfiles:['foundation']}));
  run.candidates[0].status='failed';run.candidates[0].error={code:'MODEL_NETWORK'};
  delete run.candidates[0].result;
  const report=inspectRun(seal(run));
  assert.equal(report.totals.failed,1);assert.equal(report.totals.candidates,2);
  assert.equal(report.totals.promptTokens,null);assert.equal(report.totals.completionTokens,null);
  assert.equal(report.candidates[0].reservedOrReportedCompletionTokens,2048);
  assert.equal(report.candidates[0].errorCode,'MODEL_NETWORK');
  run.candidates.pop();assert.equal(inspectRun(seal(run)).missingCandidates.length,1);
  run.candidates.push(run.candidates[0]);assert.throws(()=>inspectRun(seal(run)),/duplicate/);
});

test('inspection flags recorded budget violations rather than trusting a successful status',()=>{
  const run=recorded();run.candidates[0].trace[0].response.usage.completion_tokens=2049;
  let report=inspectRun(seal(run));assert.equal(report.recordedLimitsPassed,false);
  assert.ok(report.candidates[0].violations.includes('attempt-1:reported-overrun'));
  run.plan.budget.totalCompletionTokens=1000;
  report=inspectRun(seal(run));
  assert.ok(report.candidates[0].violations.includes('attempt-1:reservation-limit'));
  assert.ok(report.candidates[0].violations.includes('total-output-limit'));
});

test('AI findings bind actual paragraph, source and attachment evidence and never become human review',()=>{
  const run=recorded(), f=findings();
  assert.deepEqual(validateFindings(run,f),{status:'evidence-linked',semanticJudgment:'unverified',findings:3});
  const changed=findings();changed.findings[0].noteEvidence[0].quote='not in any note';
  assert.throws(()=>validateFindings(run,changed),/Note evidence/);
  const source=findings();source.findings[0].sourceEvidence[0].quote='not in source';
  assert.throws(()=>validateFindings(run,source),/Source evidence/);
  const anchor=findings();anchor.findings[1].noteEvidence[0].attachedSourceQuote='wrong anchor';
  assert.throws(()=>validateFindings(run,anchor),/Attached source/);
  const mislabeled=findings();mislabeled.reviewKind='human-reviewed';
  assert.throws(()=>validateFindings(run,mislabeled),/provisional provenance/);
});

test('a numerical counterexample distinguishes the stated equation from the erroneous prose order',()=>{
  const {w,g,D,alpha,lambda,sourceUpdate,literalSequentialUpdate}=findings().findings[0].counterexample;
  const separate=w.map((v,i)=>(1-alpha*lambda)*v-alpha*D[i]*g[i]);
  const sequential=w.map((v,i)=>(1-alpha*lambda)*(v-alpha*D[i]*g[i]));
  separate.forEach((v,i)=>assert.ok(Math.abs(v-sourceUpdate[i])<1e-12));
  sequential.forEach((v,i)=>{
    assert.ok(Math.abs(v-literalSequentialUpdate[i])<1e-12);
    assert.ok(Math.abs((v-separate[i])-alpha**2*lambda*D[i]*g[i])<1e-12);
    assert.ok(Math.abs(v-separate[i])>1e-6);
  });
  // Valid control: shrink the ORIGINAL w and then subtract the frozen gradient.
  const shrinkFirst=w.map((v,i)=>(v-alpha*lambda*v)-alpha*D[i]*g[i]);
  shrinkFirst.forEach((v,i)=>assert.ok(Math.abs(v-separate[i])<1e-12));
});

test('inspection CLI replays without model configuration, preserves originals and refuses overwrite or mixed live mode',async t=>{
  const args=['scripts/evaluate-notes.mjs','--inspect','evals/notes/runs/2026-10-17-pilot/run.json','--findings','evals/notes/runs/2026-10-17-pilot/findings.json'];
  const options={cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,DEEPSEEK_API_KEY:'',DEEPSEEK_MODEL:'',DEEPSEEK_BASE_URL:''}};
  const output=execFileSync(process.execPath,args,options);
  assert.match(output,/evidence-linked/);assert.match(output,/9192/);
  assert.throws(()=>execFileSync(process.execPath,[...args,'--live'],{...options,stdio:'pipe'}),error=>error.status===1 && /read-only/.test(error.stderr));
  const directory=await mkdtemp(join(tmpdir(),'note-inspect-'));
  t.after(async()=>{
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\') || resolve(directory).startsWith(resolve(tmpdir())+'/'));
    await rm(directory,{recursive:true,force:true});
  });
  const out=join(directory,'replay'), before=await readFile(runFile,'utf8');
  execFileSync(process.execPath,[...args,'--out',out],options);
  assert.equal(await readFile(runFile,'utf8'),before);
  const summary=JSON.parse(await readFile(join(out,'summary.json'),'utf8'));
  assert.equal(summary.status,'awaiting-human-review');assert.equal(summary.qualityConclusion,null);
  assert.equal(JSON.parse(await readFile(join(out,'private-run.json'),'utf8')).artifactHash,recorded().artifactHash);
  assert.ok((await readFile(join(out,'review.html'),'utf8')).includes('math-node'));
  assert.throws(()=>execFileSync(process.execPath,[...args,'--out',out],{...options,stdio:'pipe'}),error=>error.status===1 && /EEXIST/.test(error.stderr));
});
