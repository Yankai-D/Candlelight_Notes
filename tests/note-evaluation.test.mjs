import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { materials, smokeOutput } from '../evals/notes/cases.mjs';
import { planExperiment, messagesFor, runExperiment, meteredFetcher, defaultBudget } from '../evals/notes/experiment.mjs';
import { createReview, summarizeReview, reviewHTML, rubric } from '../evals/notes/review.mjs';

const shortPlan = options => planExperiment({materialIds:['diagonal-penalty'],...options});
const response = (content, usage, finish='stop') => new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content}}],...(usage?{usage}:{})}),{status:200});
const config={baseUrl:'https://api.deepseek.com',model:'fake-live-adapter',apiKey:'SECRET_TEST_KEY'};

test('product pilot compares real material extracts and the same inline interaction without leaking grading criteria',()=>{
  const plan=planExperiment({suite:'product-scenarios'});
  assert.equal(plan.candidateCount,6);
  assert.deepEqual(plan.cases.map(c=>c.request.action),['generate','generate','explain']);
  for(const item of plan.cases) {
    const direct=JSON.parse(messagesFor(item,'direct')[1].content),harness=JSON.parse(messagesFor(item,'harness')[1].content);
    assert.deepEqual(direct.source,harness.source);assert.deepEqual(direct.learner,harness.learner);
    assert.equal(direct.learningIntent,harness.learningIntent);
    assert.deepEqual(direct.source,item.request.document.pages);
    if(item.request.action==='explain') for(const key of ['instruction','selection','anchorId','chapters']) assert.deepEqual(direct[key],harness[key]);
    const sentinel=structuredClone(item);sentinel.material.criteria=['PRIVATE_PRODUCT_GRADER'];
    for(const arm of plan.selectedArms)assert.ok(!JSON.stringify(messagesFor(sentinel,arm)).includes('PRIVATE_PRODUCT_GRADER'));
  }
  assert.match(plan.cases[0].request.document.pages[0].text,/This hypothesis, however, is still an open question/);
  const lecture=plan.cases[1].request.document.pages.map(p=>p.text).join('\n');
  assert.match(lecture,/51 \/ 137/);assert.match(lecture,/18 \/ 70/);
  assert.throws(()=>planExperiment({suite:'product-scenarios',repeats:2}));
});

test('product review shows existing context separately, includes new inline text and shared math, and starts unscored',async()=>{
  let external=0;
  const run=await runExperiment(planExperiment({suite:'product-scenarios'}),{fetcher:async()=>{external++;throw new Error('must stay offline');}});
  assert.equal(external,0);assert.ok(run.candidates.every(c=>c.status==='accepted'));
  const {packet,review}=createReview(run),inline=packet.records.filter(r=>r.materialId==='resnet-inline');
  assert.equal(inline.length,2);assert.ok(inline.every(r=>r.text.includes('模拟小纸条')&&r.blocks.length));
  assert.ok(inline.every(r=>!r.text.includes('改变的是学习问题的表达方式')));
  assert.equal(review.profilePairs.length,0);
  assert.ok(review.records.every(r=>r.criticalReview===null&&Object.values(r.ratings).every(v=>v.score===null)));
  const dom=new JSDOM(reviewHTML(packet,review)),doc=dom.window.document;
  assert.equal(doc.querySelectorAll('section').length,3);
  const section=[...doc.querySelectorAll('section')].at(-1);
  assert.match(section.querySelector('aside').textContent,/是不是把 F 设成 0 就一定更好/);
  assert.ok(section.querySelector('aside [role="math"] svg'));
  assert.equal(section.querySelectorAll('article .note h4').length,2);
  assert.equal(section.querySelectorAll('article [role="math"] svg').length,2);
  assert.ok(![...doc.querySelectorAll('h2')].some(el=>el.textContent==='跨画像一致性'));
  assert.equal(summarizeReview(run,review).qualityConclusion,null);dom.window.close();
});

test('inline product candidate uses explain schema and bounded production repair, preserving the existing note',async()=>{
  const plan=planExperiment({suite:'product-scenarios',materialIds:['resnet-inline']});
  const before=structuredClone(plan.cases[0].request);let calls=0;
  const run=await runExperiment(plan,{mode:'live',config,fetcher:async(url,options)=>{
    calls++;const body=JSON.parse(options.body);
    return response(body.messages.length>2?JSON.stringify(smokeOutput(plan.cases[0].request)):'invalid JSON',{prompt_tokens:12,completion_tokens:10});
  }});
  assert.equal(calls,3);assert.equal(run.candidates.find(c=>c.arm==='direct').status,'failed');
  assert.ok(run.candidates.find(c=>c.arm==='harness').result.paragraphs.length);
  assert.deepEqual(plan.cases[0].request,before);
  const result=summarizeReview(run,createReview(run).review);
  assert.equal(result.status,'awaiting-human-review');assert.equal(result.failedCount,1);
});

test('paired cases share exact evidence and stable goals; evaluator facts and samples never leak into the direct baseline',()=>{
  const plan=planExperiment({selectedArms:['direct','harness','no-sample']});
  assert.equal(plan.candidateCount,18);
  for(const item of plan.cases) {
    const direct=JSON.parse(messagesFor(item,'direct')[1].content),harness=JSON.parse(messagesFor(item,'harness')[1].content),ablated=JSON.parse(messagesFor(item,'no-sample')[1].content);
    assert.deepEqual(direct.source,harness.source);assert.deepEqual(direct.learner,harness.learner);
    assert.equal(direct.learningIntent,harness.learningIntent);
    assert.ok(harness.writingTemplate.sample);assert.equal(ablated.writingTemplate.sample,undefined);
    assert.doesNotMatch(JSON.stringify(direct),/reviewCriteria|firstStepCheck|sampleChoice/);
    const sentinel=structuredClone(item);sentinel.material.criteria=['PRIVATE_GRADER_SENTINEL'];
    for(const arm of plan.selectedArms)assert.ok(!JSON.stringify(messagesFor(sentinel,arm)).includes('PRIVATE_GRADER_SENTINEL'));
    assert.equal(item.request.document.chapters.length,1);
  }
  assert.equal(materials.find(m=>m.id==='openintro-mean').split,'development');
  assert.ok(materials.every(m=>m.split!=='holdout'));
  assert.throws(()=>shortPlan({selectedArms:['harness','harness']}));
  assert.throws(()=>shortPlan({budget:{maxCalls:0}}));
});

test('frozen prompt hashes prevent running a changed plan, before any provider call',async()=>{
  const plan=shortPlan();plan.cases[0].request.document.intent='Changed goal';let calls=0;
  await assert.rejects(runExperiment(plan,{mode:'live',config,fetcher:async()=>{calls++;}}),/Planned prompts changed/);
  assert.equal(calls,0);
});

test('authored numeric oracles independently check coordinate updates and standard error',()=>{
  const w=[2,4],g=[1,1],d=[1,.25],alpha=.1,lambda=.2;
  const coupled=w.map((value,i)=>value-alpha*d[i]*(g[i]+lambda*value));
  const separate=w.map((value,i)=>(1-alpha*lambda)*value-alpha*d[i]*g[i]);
  assert.ok(Math.abs(coupled[0]-1.86)<1e-12);assert.ok(Math.abs(coupled[1]-3.955)<1e-12);
  assert.ok(Math.abs(separate[1]-3.895)<1e-12);
  const penaltySource=materials.find(m=>m.id==='diagonal-penalty').pages[0].text;
  for(const result of [coupled,separate])assert.ok(penaltySource.includes(`(${result.map(value=>Number(value.toFixed(3))).join(',')})`));
  const values=[1,3,5,7],mean=values.reduce((a,b)=>a+b)/values.length;
  const sum=values.reduce((n,value)=>n+(value-mean)**2,0),sd=Math.sqrt(sum/(values.length-1));
  assert.equal(mean,4);assert.equal(sum,20);assert.equal((sd/Math.sqrt(values.length)).toFixed(3),'1.291');
  const standardErrorSource=materials.find(m=>m.id==='standard-error').pages[0].text;
  assert.ok(standardErrorSource.includes(`s^2=${sum}/${values.length-1}`));
  assert.ok(standardErrorSource.includes((sd/Math.sqrt(values.length)).toFixed(3)));
});

test('provider budgets count retries, clamp actual requests and reserve unknown usage without leaking credentials',async()=>{
  const trace=[],requests=[],budget={...defaultBudget,maxCalls:3,maxCompletionTokens:10,totalCompletionTokens:15};
  const bounded=meteredFetcher(async(url,options)=>{requests.push(JSON.parse(options.body));return response('{}');},budget,trace);
  const options={headers:{Authorization:'Bearer SECRET_TEST_KEY'},body:JSON.stringify({model:'fake',messages:[{role:'user',content:'hello'}],max_tokens:32768})};
  await bounded('https://example.org',options);await bounded('https://example.org',options);
  assert.deepEqual(requests.map(r=>r.max_tokens),[10,5]);
  await assert.rejects(bounded('https://example.org',options),/TOKEN_BUDGET/);assert.equal(requests.length,2);
  assert.ok(!JSON.stringify(trace).includes('SECRET_TEST_KEY'));assert.equal(trace[1].chargedCompletionTokens,15);
  const transportTrace=[],transport=meteredFetcher(async()=>{throw new Error('disconnect');},{...budget,maxCalls:1},transportTrace);
  await assert.rejects(transport('https://example.org',options));
  await assert.rejects(transport('https://example.org',options),/CALL_BUDGET/);assert.equal(transportTrace.length,1);
  const over=meteredFetcher(async()=>{throw new Error('must not call');},{...budget,maxPromptCharacters:1},[]);
  await assert.rejects(over('https://example.org',options),/CONTEXT_BUDGET/);
});

test('offline experiment exercises the frozen production writing stage, keeps every candidate, and never calls a real provider',async()=>{
  let external=0;
  const run=await runExperiment(planExperiment(),{fetcher:async()=>{external++;throw new Error('external call');}});
  assert.equal(external,0);assert.equal(run.candidates.length,12);assert.ok(run.candidates.every(c=>c.status==='accepted'));
  assert.ok(run.candidates.every(c=>c.usage.promptTokens===null&&c.usage.completionTokens===null));
  const {packet,review,mapping}=createReview(run);
  assert.equal(packet.records.length,12);assert.equal(review.profilePairs.length,6);
  assert.ok(!JSON.stringify(packet).includes('"arm":'));assert.ok(!JSON.stringify(packet).includes('simulation-only'));
  for(const pair of review.profilePairs) assert.equal(new Set(pair.recordIds.map(id=>run.candidates.find(c=>c.id===mapping[id]).arm)).size,1);
  assert.equal(summarizeReview(run,review).status,'simulation-only');assert.equal(summarizeReview(run,review).qualityConclusion,null);
  const damaged=structuredClone(run);damaged.candidates[0].result.blocks[0].text+='changed';assert.throws(()=>createReview(damaged),/hash/);
  const relabeled=structuredClone(run);relabeled.mode='live';assert.throws(()=>createReview(relabeled),/hash/);
  const otherModel=structuredClone(run);otherModel.model='different-model';assert.throws(()=>createReview(otherModel),/hash/);
});

test('harness repairs within the same ceiling, direct failure remains in the denominator, and truncation cannot bypass limits',async()=>{
  const plan=shortPlan({selectedProfiles:['foundation']});
  let calls=0;
  const run=await runExperiment(plan,{mode:'live',config,fetcher:async(url,options)=>{
    calls++;const body=JSON.parse(options.body),hasRepair=body.messages.length>2;
    return response(hasRepair?JSON.stringify(smokeOutput(plan.cases[0].request)):'invalid JSON',{prompt_tokens:12,completion_tokens:10});
  }});
  assert.equal(calls,3);assert.equal(run.candidates.find(c=>c.arm==='direct').status,'failed');
  const successful=run.candidates.find(c=>c.arm==='harness');assert.equal(successful.status,'accepted');assert.equal(successful.events.filter(e=>e.repair).length,1);
  assert.equal(successful.usage.completionTokens,20);assert.equal(successful.trace[0].request.max_tokens,2048);
  assert.ok(!JSON.stringify(run).includes(config.apiKey));
  const pending=summarizeReview(run,createReview(run).review);assert.equal(pending.failedCount,1);assert.equal(pending.status,'awaiting-human-review');
  let truncatedCalls=0;
  const truncated=await runExperiment(shortPlan({selectedProfiles:['foundation'],budget:{maxCalls:1}}),{mode:'live',config,fetcher:async()=>{truncatedCalls++;return response('{',undefined,'length');}});
  assert.equal(truncatedCalls,2);assert.ok(truncated.candidates.every(c=>c.error.code==='EVAL_CALL_BUDGET'));
});

function completeReview(run) {
  const {packet,review}=createReview(run);review.reviewer='fixture reviewer';review.reviewedAt='2026-10-17T00:00:00.000Z';
  for(const record of review.records) {
    record.criticalReview='clear';const text=packet.records.find(r=>r.id===record.id).text;
    for(const dimension of rubric)record.ratings[dimension.id]={score:3,quote:text.slice(0,20),reason:'这是针对该段内容和来源条件的人工核对记录。'};
  }
  for(const pair of review.profilePairs) {
    Object.assign(pair,{stableVoice:true,preservedFacts:true,appropriateDepth:true,reason:'比较两种画像中的正文，检查必要铺垫与事实条件是否保持一致。'});
    for(const id of pair.recordIds)pair.quotes[id]=packet.records.find(r=>r.id===id).text.slice(0,20);
  }
  return review;
}

test('human review requires exact evidence, complete paired checks and matching artifact; critical errors cannot be averaged away',async()=>{
  // A fake provider is marked live only to exercise review validation. Never
  // export this test as a real model experiment or human-reviewed result.
  const plan=shortPlan(),run=await runExperiment(plan,{mode:'live',config,fetcher:async()=>response(JSON.stringify(smokeOutput(plan.cases[0].request)))});
  const review=completeReview(run),good=summarizeReview(run,review);
  assert.equal(good.status,'human-reviewed');assert.equal(good.pairedDeltas.length,2);
  const missing=structuredClone(review);missing.records[0].ratings.faithfulness.quote='THIS TEXT DOES NOT EXIST';
  assert.equal(summarizeReview(run,missing).status,'awaiting-human-review');
  const missingPair=structuredClone(review);missingPair.profilePairs=[];assert.equal(summarizeReview(run,missingPair).status,'awaiting-human-review');
  const wrong=structuredClone(review);wrong.artifactHash='other';assert.throws(()=>summarizeReview(run,wrong),/different run/);
  const duplicate=structuredClone(review);duplicate.records.push(duplicate.records[0]);assert.throws(()=>summarizeReview(run,duplicate),/duplicate/);
  review.records[0].criticalReview='issues';review.records[0].criticalErrors=[{quote:review.records[0].ratings.faithfulness.quote,reason:'该段结论缺少关键成立条件，需要实质修改。'}];
  const critical=summarizeReview(run,review);assert.equal(Object.values(critical.byArm).reduce((n,a)=>n+a.criticalErrors,0),1);
  assert.equal(Object.values(critical.byArm).reduce((n,a)=>n+a.needsRevision,0),1);assert.equal(critical.qualityConclusion,null);
});

test('review artifact escapes untrusted text, uses the shared math renderer, and exports entered scores',async()=>{
  const run=await runExperiment(shortPlan());const {packet,review}=createReview(run);
  packet.cases[0].material.title='<script>window.PWNED=true</script>';
  const html=reviewHTML(packet,review),dom=new JSDOM(html,{runScripts:'dangerously'});
  assert.equal(dom.window.PWNED,undefined);assert.ok(dom.window.document.querySelector('[role="math"] svg'));
  assert.equal(dom.window.document.querySelectorAll('script').length,1);
  let blob;dom.window.URL.createObjectURL=value=>{blob=value;return 'blob:test';};dom.window.URL.revokeObjectURL=()=>{};
  dom.window.HTMLAnchorElement.prototype.click=function(){};
  const doc=dom.window.document;doc.getElementById('reviewer').value='Local reviewer';
  doc.querySelector('[data-path="records.0.ratings.faithfulness.score"]').value='3';
  doc.querySelector('[data-path="records.0.ratings.faithfulness.quote"]').value='这是离线模拟正文';
  doc.querySelector('[data-path="records.0.criticalReview"]').value='issues';
  doc.querySelector('[data-critical-quote="0"]').value='这是离线模拟正文';doc.querySelector('[data-critical-reason="0"]').value='模拟内容没有讲解当前资料';
  const disclosures=[...doc.querySelectorAll('details')];
  disclosures[0].open=true;
  const disclosureState=disclosures.map(detail=>detail.open),notes=[...doc.querySelectorAll('.note')].map(note=>note.innerHTML);
  let printCalls=0;dom.window.print=()=>{printCalls++;};doc.getElementById('print').click();assert.equal(printCalls,1);
  dom.window.dispatchEvent(new dom.window.Event('beforeprint'));
  dom.window.dispatchEvent(new dom.window.Event('beforeprint'));
  assert.ok(doc.body.classList.contains('review-print'));
  assert.ok([...doc.querySelectorAll('section > details')].every(detail=>detail.open));
  assert.ok([...doc.querySelectorAll('article > details')].every(detail=>!detail.open));
  dom.window.dispatchEvent(new dom.window.Event('afterprint'));
  assert.ok(!doc.body.classList.contains('review-print'));
  assert.deepEqual(disclosures.map(detail=>detail.open),disclosureState);
  assert.deepEqual([...doc.querySelectorAll('.note')].map(note=>note.innerHTML),notes);
  assert.equal(doc.querySelector('[data-path="records.0.ratings.faithfulness.score"]').value,'3');
  doc.getElementById('download').click();
  const exported=await new Promise(resolve=>{const reader=new dom.window.FileReader();reader.onload=()=>resolve(JSON.parse(reader.result));reader.readAsText(blob);});
  assert.equal(exported.records[0].ratings.faithfulness.score,3);assert.equal(exported.records[0].criticalErrors.length,1);
  assert.equal(exported.reviewer,'Local reviewer');dom.window.close();
});
