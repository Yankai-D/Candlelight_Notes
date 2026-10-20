import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fingerprint } from '../server/claim-review.mjs';
import { auditUnits } from '../server/claim-audit.mjs';
import { conditionPrompt } from '../server/condition-review.mjs';
import { planField, planWindows, runField, inspectField } from '../evals/claims/field/experiment.mjs';
import { createFieldReview, validateFieldReview, summarizeFieldReview } from '../evals/claims/field/review.mjs';
import { fieldReviewHTML } from '../evals/claims/field/page.mjs';
import { currentMessagesFromV010 } from './support/prompt-history.mjs';

const config={apiKey:'mock-only-secret',model:'mock',baseUrl:'https://api.deepseek.com'};
const response=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:typeof value==='string'?value:JSON.stringify(value)}}]}));
const note=n=>({blocks:[{type:'heading',text:'均值与观测',sourcePages:[4],sourceQuote:''},...Array.from({length:n},(_,i)=>({type:'paragraph',text:`这是第 ${i+1} 段。样本均值描述当前样本。需要结合总体理解。`,sourcePages:[4],sourceQuote:''}))],summary:'模拟长文'});
const stamp=run=>{const {artifactHash,...body}=run;run.artifactHash=fingerprint(body);return run;};

test('field trial freezes licensed source, production template and unchanged diagnostic prompt, with no reference judgments',()=>{
  const p=planField();assert.equal(p.material.provenance.kind,'licensed-textbook-extract');assert.equal(p.material.provenance.license,'CC-BY-SA-3.0');
  assert.deepEqual(p.request.document.pages.map(p=>p.number),[4,5]);assert.equal(p.reviewPrompt,conditionPrompt);
  assert.equal(p.maxCalls,10);assert.equal(p.maxCompletionTokens,24576);
  const context=JSON.parse(p.generationMessages[1].content);assert.ok(!('criteria' in context));
  assert.ok(!JSON.stringify(p.generationMessages).includes(p.material.criteria[0]));
});

test('window planner covers every exact unit once, retains adjacent paragraphs, and distinguishes review evidence scope from generated citations',()=>{
  const p=planField(),original=note(14),before=fingerprint(original),plan=planWindows(p.request,original);
  assert.ok(plan.windows.length>1);assert.equal(fingerprint(original),before);
  const targets=plan.windows.flatMap(w=>auditUnits(w.snapshot).filter(u=>u.target));
  assert.deepEqual(targets.map(u=>u.id),plan.units.map(u=>u.id));assert.equal(new Set(targets.map(u=>u.id)).size,plan.units.length);
  for(const w of plan.windows)for(const block of w.snapshot.blocks)assert.deepEqual(block.sourcePages,[4,5]);
  const middle=plan.windows[1];assert.ok(middle.snapshot.blocks.some(b=>!middle.snapshot.targetIds.includes(b.id)));
  for(const unit of targets)assert.equal(plan.blocks.find(b=>b.id===unit.blockId).text.slice(unit.start,unit.end),unit.text);
  assert.ok(original.blocks.every(b=>b.sourcePages.length===1));
});

test('overlong paragraphs and total review windows are refused in full before diagnostic calls',async()=>{
  const p=planField(),tooLong=note(1);tooLong.blocks[1].text='独立句子。'.repeat(13);
  assert.throws(()=>planWindows(p.request,tooLong),/Too many units/);
  assert.throws(()=>planWindows(p.request,note(35)),/budget/);
  let calls=0;const run=await runField(p,{mode:'live',config,fetcher:async()=>{calls++;return response(note(35));}});
  assert.equal(calls,1);assert.equal(run.status,'planning-failed');assert.equal(run.generation.status,'accepted');assert.equal(run.reviews.length,0);
  assert.equal(inspectField(run).coverage.length,0);assert.equal(summarizeFieldReview(run,createFieldReview(run).review).status,'no-reviewable-output');
});

test('simulation cannot call external provider and replay binds generated text and every diagnostic to actual responses',async()=>{
  let calls=0;const run=await runField(planField(),{fetcher:async()=>{calls++;}}),report=inspectField(run);
  assert.equal(calls,0);assert.equal(report.status,'awaiting-human-review');assert.ok(report.coverage.length>0);assert.equal(report.qualityConclusion,null);
  const changed=structuredClone(run);changed.reviews[0].result.diagnostic.checks[0].text+='x';stamp(changed);assert.throws(()=>inspectField(changed),/raw response/);
  const wrongWindow=structuredClone(run);wrongWindow.reviewPlan.windows[0].snapshot.goal+='x';stamp(wrongWindow);assert.throws(()=>inspectField(wrongWindow),/window plan/);
  const changedNote=structuredClone(run);changedNote.generation.result.blocks[0].text+='x';stamp(changedNote);assert.throws(()=>inspectField(changedNote),/raw response/);
});

test('one failed review window does not erase later coverage or become a no-issue result',async()=>{
  let reviews=0;
  const run=await runField(planField(),{mode:'live',config,fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);if(body.messages[0].content!==conditionPrompt)return response(note(8));
    reviews++;if(reviews===1)return response('{invalid');
    const input=JSON.parse(body.messages[1].content);return response({checks:input.units.filter(u=>u.target).map(u=>({unitId:u.id,verdict:'retain'}))});
  }});
  const report=inspectField(run);assert.equal(run.status,'review-incomplete');assert.equal(report.failedWindows,1);assert.equal(reviews,report.windows);
  assert.ok(report.coverage.some(c=>c.status==='failed'&&c.diagnosis===null));assert.ok(report.coverage.some(c=>c.status==='diagnosed'));
  assert.ok(!JSON.stringify(run).includes(config.apiKey));
  const {review}=createFieldReview(run);review.reviewer='Tester';review.reviewerType='human';review.participatedInDevelopment=false;review.seenModelBefore=false;review.reviewedAt=new Date().toISOString();
  for(const r of review.records){r.verdict='retain';r.reason='测试中声明已检查';}
  assert.ok(summarizeFieldReview(run,review).counts['model-unavailable']>0);
});

test('changed plans and pre-cancelled work never send a request',async()=>{
  const p=planField();p.reviewPrompt+='x';let calls=0;
  await assert.rejects(runField(p,{mode:'live',config,fetcher:async()=>{calls++;}}),/plan changed/);
  const controller=new AbortController();controller.abort();const run=await runField(planField(),{mode:'live',config,signal:controller.signal,fetcher:async()=>{calls++;}});
  assert.equal(calls,0);assert.equal(run.status,'generation-failed');inspectField(run);
});

test('review begins empty; strict identity, coverage, field and source guards reject malformed imports',async()=>{
  const run=await runField(planField()),{packet,review}=createFieldReview(run);
  assert.equal(summarizeFieldReview(run,review).status,'awaiting-human-review');assert.ok(review.records.every(r=>r.verdict===null));
  for(const mutate of [r=>r.packetHash='foreign',r=>r.records.pop(),r=>r.records[1].id=r.records[0].id,r=>r.records[0].reason={},r=>r.records[0].sourcePage=99,r=>{r.records[0].sourcePage=4;r.records[0].sourceQuote='invented';},r=>r.records[0].exposed=true]) {
    const copy=structuredClone(review);mutate(copy);assert.throws(()=>validateFieldReview(packet,copy));
  }
});

test('summary retains pre-exposure judgment and reports unit-level disagreement without filling a quality score',async()=>{
  const run=await runField(planField()),{packet,review}=createFieldReview(run);
  Object.assign(review,{reviewer:'Test fixture',reviewerType:'human',participatedInDevelopment:false,seenModelBefore:false,reviewedAt:new Date().toISOString()});
  for(const r of review.records){r.verdict='retain';r.reason='测试中明确选择保留';}
  const first=review.records[0];Object.assign(first,{verdict:'contradiction',sourcePage:4,sourceQuote:packet.source[0].text.slice(0,30),reason:'模拟审阅者报告矛盾'});
  first.initial=Object.fromEntries(['verdict','reason','sourcePage','sourceQuote'].map(k=>[k,first[k]]));first.exposed=true;first.verdict='retain';first.reason='看过模型后改变判断';
  const report=summarizeFieldReview(run,review);assert.equal(report.counts['possible-miss'],1);assert.equal(report.rows[0].initial.verdict,'contradiction');assert.equal(report.rows[0].current.verdict,'retain');
  assert.equal(report.status,'review-recorded');assert.equal(report.qualityConclusion,null);assert.ok(report.rows.every(r=>!r.selfReportedIndependent)); // Simulation is never independent model evaluation.
  first.initial={verdict:null,reason:'',sourcePage:null,sourceQuote:''};assert.equal(summarizeFieldReview(run,review).rows[0].relation,'unreviewed');
});

test('workbook escapes imported text and renders shared formula output with no prefilled human opinion',async()=>{
  const run=await runField(planField()),pack=createFieldReview(run);pack.packet.title='<script>bad()</script>';
  const dom=new JSDOM(fieldReviewHTML(pack));assert.equal(dom.window.document.querySelectorAll('script').length,1);
  assert.equal(dom.window.document.querySelectorAll('article').length,pack.packet.units.length);assert.ok(dom.window.document.querySelector('[role="math"] svg'));
  assert.equal(dom.window.document.querySelectorAll('[data-model]:not([hidden])').length,0);assert.ok(dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("connect-src 'none'"));dom.window.close();
});

test('field CLI forbids implicit paid runs and mixed review/generation modes',()=>{
  for(const args of [['--live'],['--live','--case','unknown'],['--demo','--inspect','unknown'],['--summarize','unknown']])
    assert.throws(()=>execFileSync(process.execPath,['scripts/evaluate-field.mjs',...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,stdio:'pipe'}),e=>e.status===1);
});

const archived=()=>JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-field/run.json',import.meta.url),'utf8'));
test('real trial retains exact historical prompts/cost; new plans differ only by explicit brand/profile/goal/reference/content migrations',()=>{
  const run=archived(),report=inspectField(run);assert.equal(run.gitRevision,'f81cd94b5308f2aa881e6ed09d67fd28c976a981');assert.equal(run.gitDirty,false);
  assert.equal(fingerprint({ ...run.plan, generationMessages: currentMessagesFromV010(run.plan.generationMessages) }),fingerprint(planField()));
  assert.notEqual(fingerprint(run.plan),fingerprint(planField()), 'Do not rewrite historical evidence to look like current production');
  assert.equal(report.calls,7);assert.equal(report.promptTokens,21383);assert.equal(report.completionTokens,2226);
  assert.equal(run.generation.result.blocks.length,11);assert.equal(report.windows,6);assert.equal(report.coverage.length,39);assert.equal(report.failedWindows,0);
  assert.equal(report.coverage.filter(r=>r.diagnosis.verdict==='retain').length,38);assert.equal(report.coverage.filter(r=>r.diagnosis.verdict==='needs-source').length,1);
  assert.equal(new Set(report.coverage.map(r=>r.id)).size,39);assert.equal(report.qualityConclusion,null);
});

test('real retained weight wording and repeated sensitivity disagreement stay visible; local arithmetic is not a semantic score',()=>{
  const report=inspectField(archived()),byId=id=>report.coverage.find(u=>u.id===id);
  assert.match(byId('b7:s2').text,/各观测值以自身大小为权重/);assert.equal(byId('b7:s2').diagnosis.verdict,'retain');
  assert.equal(byId('b7:s3').diagnosis.verdict,'retain');assert.equal(byId('b11:s5').diagnosis.verdict,'needs-source');
  const xs=[1,3],sum=values=>values.reduce((a,b)=>a+b,0),mean=values=>sum(values)/values.length;
  assert.equal(mean(xs),2);assert.equal(sum(xs.map(x=>x*x))/xs.length,5);assert.equal(sum(xs.map(x=>x*x))/sum(xs),2.5);
  assert.equal(mean([1,5])-mean(xs),2/xs.length);
});

test('AI observations are bound to real raw evidence while every independent human judgment remains empty',()=>{
  const run=archived(),findings=JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18-field/findings.json',import.meta.url),'utf8'));
  assert.equal(findings.runArtifactHash,run.artifactHash);assert.equal(findings.status,'provisional-ai-review');assert.equal(findings.semanticJudgment,'unverified');
  for(const finding of findings.findings){
    for(const e of finding.evidence){const trace=e.stage==='generation'?run.generation.trace:run.reviews.find(r=>r.windowId===e.windowId).result.trace;
      const raw=JSON.parse(trace.at(-1).response.choices[0].message.content),value=e.path.split('.').reduce((o,k)=>o?.[k],raw);assert.equal(typeof value,'string');assert.ok(value.includes(e.quote));}
    for(const e of finding.sourceEvidence)assert.ok(run.plan.request.document.pages.find(p=>p.number===e.page).text.includes(e.quote));
  }
  const {review}=createFieldReview(run),summary=summarizeFieldReview(run,review);
  assert.equal(summary.status,'awaiting-human-review');assert.equal(summary.counts.unreviewed,39);assert.equal(summary.qualityConclusion,null);
  assert.ok(review.records.every(r=>r.verdict===null&&!r.exposed&&r.initial===null));assert.ok(summary.rows.every(r=>!r.selfReportedIndependent));
});
