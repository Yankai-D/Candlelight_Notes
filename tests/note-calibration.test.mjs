import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { buildMessages, validateResult } from '../server/harness.mjs';
import { calibrationCases, requestFor, rawText, failureTypes } from '../evals/notes/calibration/cases.mjs';
import { createCalibrationPack, verifyFrozen, assessCalibration, runCalibrationRegressions } from '../evals/notes/calibration/suite.mjs';
import { calibrationHTML } from '../evals/notes/calibration/page.mjs';
import { rubric } from '../evals/notes/review.mjs';

function completedReview(pack) {
  const review=structuredClone(pack.review);review.reviewer='Test fixture, not an independent human review';review.reviewedAt='2026-10-17T00:00:00.000Z';
  for(const record of review.records){const a=pack.answers[record.id];Object.assign(record,{verdict:a.acceptable?'acceptable':'revise',score:a.score[0],critical:a.critical,failureCode:a.failureCode,quote:a.quote,reason:a.reason});}
  return review;
}

test('calibration covers every rubric dimension, verifies evidence, freezes contracts and keeps judgments out of prompts',()=>{
  const pack=createCalibrationPack();
  assert.equal(pack.packet.tasks.length,8);assert.equal(pack.packet.records.length,16);
  assert.deepEqual(new Set(pack.packet.tasks.map(t=>t.dimension)),new Set(rubric.map(d=>d.id)));
  assert.deepEqual(new Set(calibrationCases.map(t=>t.failure)),new Set(failureTypes.map(t=>t.id)));
  assert.equal(pack.packet.corpusHash,createCalibrationPack().packet.corpusHash);
  assert.equal(verifyFrozen(JSON.parse(JSON.stringify(pack.frozen))).packet.corpusHash,pack.packet.corpusHash);
  const modified=structuredClone(pack.frozen);modified.cases[0].source+=' changed';assert.throws(()=>verifyFrozen(modified),/hash/);
  const invalid=structuredClone(calibrationCases);invalid[0].candidates[0].expected.quote='NONEXISTENT';assert.throws(()=>createCalibrationPack(invalid),/evidence/);
  for(const item of calibrationCases){
    const probe={...item,expected:'PRIVATE_CALIBRATION_JUDGMENT_SENTINEL'};
    assert.ok(!JSON.stringify(buildMessages(requestFor(probe))).includes(probe.expected));
  }
  assert.equal(pack.packet.provenance.reviewStatus,'awaiting-independent-review');
});

test('semantic counterexamples pass the real compiler without becoming automatic quality successes',async()=>{
  for(const item of calibrationCases)for(const candidate of item.candidates){
    const result=validateResult(requestFor(item),candidate.raw);
    assert.ok(result.rendering.blocks.length);
  }
  const unsupported=calibrationCases.find(c=>c.id==='unsupported-claim');
  const raw=unsupported.candidates.find(c=>!c.expected.acceptable).raw;
  const result=validateResult(requestFor(unsupported),raw);
  assert.equal(result.blocks.at(-1).sourceQuote,raw.blocks.at(-1).sourceQuote,'A real quote may contradict rather than support a claim');
  assert.match(rawText(raw),/必然收敛/);assert.match(unsupported.source,/no convergence/);
  const report=await runCalibrationRegressions();
  assert.equal(report.semanticBoundary.authoredNeedsRevision,8);assert.equal(report.semanticBoundary.mechanicallyAccepted,16);assert.equal(report.qualityConclusion,null);
});

test('independent arithmetic checks the authored variance, paper note, screening and lecture evidence',()=>{
  const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
  const values=[1,2,3],squares=values.reduce((total,x)=>total+(x-mean(values))**2,0);
  assert.equal(mean(values),2);assert.equal(squares,2);assert.equal(squares/(values.length-1),1);assert.equal(squares/values.length,2/3);
  assert.ok(calibrationCases.find(c=>c.id==='lecture-substance').source.includes(`s^2=${squares}/${values.length-1}=1`));
  assert.equal(3/Math.sqrt(4),1.5);assert.match(calibrationCases.find(c=>c.id==='variance-conditions').source,/standard error is 1.5/);
  assert.equal(10/Math.sqrt(25),2);assert.equal(10/Math.sqrt(100),1);
  assert.match(calibrationCases.find(c=>c.id==='paper-note').source,/n=25 gives SE=2 and n=100 gives SE=1/);
  const tp=8,fp=2,fn=12,tn=78;assert.equal((tp+tn)/(tp+fp+fn+tn),.86);assert.equal(tp/(tp+fp),.8);assert.equal(tp/(tp+fn),.4);
  const source=calibrationCases.find(c=>c.id==='goal-focus').source;for(const value of [.86,.8,.4])assert.ok(source.includes(`=${value}`));
});

test('mechanical negatives and positive controls use production boundaries, bounded repair and zero real fetches',async()=>{
  const original=globalThis.fetch;let external=0;globalThis.fetch=async()=>{external++;throw new Error('Unexpected network call');};
  try{
    const report=await runCalibrationRegressions();
    assert.equal(report.passed,true,JSON.stringify(report.checks.filter(c=>!c.pass)));
    assert.equal(report.checks.length,11);assert.equal(external,0);assert.equal(report.actualModelCalls,0);
    assert.ok(report.checks.every(c=>c.inputUnchanged));
    assert.equal(report.checks.find(c=>c.id==='repair-exhausted').calls,5);
    assert.equal(report.checks.find(c=>c.id==='truncation-exhausted').calls,2);
    assert.equal(report.checks.find(c=>c.id==='paper-insertion').outcome,'inserted');
  }finally{globalThis.fetch=original;}
});

test('calibration review binds evidence and corpus, preserves disagreements and never reports model quality',()=>{
  const pack=createCalibrationPack(),review=completedReview(pack);
  const result=assessCalibration(pack,review);assert.equal(result.status,'calibration-reviewed');assert.equal(result.disagreements.length,0);assert.equal(result.qualityConclusion,null);
  assert.equal(result.referenceStatus,'awaiting-independent-review');
  const bad=structuredClone(review);bad.records[0].quote='THIS IS NOT IN THE NOTE';assert.equal(assessCalibration(pack,bad).status,'awaiting-calibration-review');
  const missing=structuredClone(review);missing.records.pop();assert.equal(assessCalibration(pack,missing).status,'awaiting-calibration-review');
  const duplicate=structuredClone(review);duplicate.records.push(duplicate.records[0]);assert.throws(()=>assessCalibration(pack,duplicate),/duplicate/);
  const wrong=structuredClone(review);wrong.corpusHash='different';assert.throws(()=>assessCalibration(pack,wrong),/different/);
  const critical=review.records.find(r=>r.critical);critical.critical=false;critical.score=4;critical.verdict='acceptable';
  review.revealed=[critical.id];const disagreement=assessCalibration(pack,review);
  assert.equal(disagreement.status,'calibration-reviewed');assert.equal(disagreement.disagreements.length,1);
  assert.equal(disagreement.disagreements[0].checks.critical,false);assert.equal(disagreement.disagreements[0].referenceRevealed,true);
  assert.equal(disagreement.qualityConclusion,null,'Agreement with author judgments is not a model quality metric');
});

test('standalone calibration page escapes content, exports draft judgments and tracks reference exposure',async()=>{
  const pack=createCalibrationPack();pack.packet.tasks[0].title='<script>window.PWNED=1</script>';
  const dom=new JSDOM(calibrationHTML(pack),{url:'https://calibration.invalid/',runScripts:'dangerously',beforeParse:window=>{window.structuredClone=structuredClone;}}),doc=dom.window.document;
  assert.equal(dom.window.PWNED,undefined);assert.equal(doc.querySelectorAll('script').length,1);assert.ok(doc.querySelector('[role="math"] svg'));
  assert.equal(doc.querySelectorAll('[data-answers]:not([hidden])').length,0);
  let blob;dom.window.URL.createObjectURL=value=>{blob=value;return 'blob:test';};dom.window.URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){};
  doc.getElementById('reviewer').value='Local reviewer';
  const card=doc.querySelector('[data-record]'),id=card.dataset.record,a=pack.answers[id];
  for(const [field,value] of Object.entries({verdict:a.acceptable?'acceptable':'revise',score:a.score[0],critical:a.critical,failureCode:a.failureCode,quote:a.quote,reason:a.reason}))card.querySelector(`[data-field="${field}"]`).value=String(value);
  doc.querySelector('[data-reveal]').click();doc.getElementById('download').click();
  const exported=await new Promise(resolve=>{const reader=new dom.window.FileReader();reader.onload=()=>resolve(JSON.parse(reader.result));reader.readAsText(blob);});
  assert.equal(exported.reviewer,'Local reviewer');assert.equal(exported.records.find(r=>r.id===id).quote,a.quote);assert.equal(exported.revealed.length,2);
  assert.equal(doc.querySelectorAll('[data-answers]:not([hidden])').length,1);
  assert.ok(dom.window.localStorage.getItem('pangzhu-calibration:'+pack.packet.corpusHash));
  assert.equal(assessCalibration(pack,exported).status,'awaiting-calibration-review');dom.window.close();
});

test('CLI freezes a fresh package, rejects live mode and overwrites, and summarizes without losing prior reviews',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pangzhu-calibration-')),out=join(directory,'pack'),run=promisify(execFile);
  const cli=args=>run(process.execPath,['scripts/calibrate-notes.mjs',...args],{windowsHide:true,timeout:30000});
  try {
    await assert.rejects(cli(['--live']),/Unknown option/);
    await cli(['--out',out]);
    const corpus=JSON.parse(await readFile(join(out,'corpus.json'),'utf8')),pack=verifyFrozen(corpus);
    const original=await readFile(join(out,'manifest.json'),'utf8');
    await assert.rejects(cli(['--out',out]),/EEXIST/);assert.equal(await readFile(join(out,'manifest.json'),'utf8'),original);
    const file=join(directory,'review.json');await writeFile(file,JSON.stringify(pack.review));
    await assert.rejects(cli(['--summarize',out,'--review',file]),error=>error.code===1&&error.stdout.includes('awaiting-calibration-review'));
    await writeFile(file,JSON.stringify(completedReview(pack)));await cli(['--summarize',out,'--review',file]);
    const summaries=(await readdir(out)).filter(name=>name.startsWith('review-summary-'));assert.equal(summaries.length,2);
    const reports=await Promise.all(summaries.map(async name=>JSON.parse(await readFile(join(out,name),'utf8'))));
    assert.deepEqual(new Set(reports.map(r=>r.status)),new Set(['awaiting-calibration-review','calibration-reviewed']));
    assert.ok(reports.every(r=>r.qualityConclusion===null));
  }finally{
    if(dirname(resolve(directory))!==resolve(tmpdir())||!directory.includes('pangzhu-calibration-'))throw new Error('Unexpected temporary directory');
    await rm(directory,{recursive:true,force:true});
  }
});
