import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {courseCase,courseOracle} from '../evals/lectures/course-case.mjs';
import {hash,runtimeIdentity,runCourseArm,pilotBudget,usageReport,contextInventory,planCourseExperiment} from '../evals/lectures/experiment.mjs';
import {courseSimulator} from '../evals/lectures/simulation.mjs';
import {createCourseReview,reviewHTML,validateCourseRatings} from '../evals/lectures/review.mjs';
import {validateLectureCoverage} from '../shared/lecture-synthesis.mjs';

const identity=await runtimeIdentity(resolve('.'));
const plan=()=>({schema:'course-eval-v1',id:'course-eval-test',testCase:structuredClone(courseCase),caseHash:hash(courseCase),arms:[{arm:'candidate',...identity}],budget:{...pilotBudget,timeoutMs:30000},limitations:[]});
const config={apiKey:'never-write-this-key',model:'simulation-only',baseUrl:'https://example.invalid'};

test('course evaluation runs actual planning and three sequential chapters, preserving prose and excluding the assessment oracle',async()=>{
  const saves=[];
  const result=await runCourseArm(plan(),'candidate',{mode:'simulation',config,fetcher:courseSimulator(courseCase),onSave:async r=>saves.push({calls:r.trace.length,chapters:r.chapters.length})});
  assert.equal(result.status,'complete',JSON.stringify(result.failure));
  assert.equal(result.chapters.length,3);assert.equal(result.trace.length,13);assert.equal(result.usage.promptTokens,null);
  assert.equal(result.runtimeUnchanged,true);assert.equal(result.qualityConclusion,null);
  assert.ok(saves.some(s=>s.chapters===1)&&saves.some(s=>s.chapters===2));
  const wire=JSON.stringify(result.trace.map(t=>t.request));
  assert.ok(!wire.includes('never-write-this-key'));assert.ok(!wire.includes(courseOracle.transfer[0].question));assert.ok(!wire.includes(courseOracle.transfer[0].answer));
  assert.ok(result.trace.every(t=>t.stage&&t.context.length));
  const second=result.trace.filter(t=>t.stage==='chapter-analysis')[1];
  assert.ok(second.request.messages[1].content.includes('条件概率'));
  const {packet,review}=createCourseReview(plan(),[result,{...result,arm:'baseline'}],courseOracle,{reverse:false});
  assert.throws(()=>validateCourseRatings(packet,review),/reviewer/);
  assert.ok(!JSON.stringify(packet).includes(identity.root));assert.ok(!JSON.stringify(packet).includes('runtime'));
  assert.match(reviewHTML(packet),/离线模拟/);
});

test('failed later chapter retains completed chapter, and provider-bound budget stops retries without reporting completion',async()=>{
  const failed=await runCourseArm(plan(),'candidate',{mode:'simulation',config,fetcher:courseSimulator(courseCase,{failCall:8})});
  assert.equal(failed.status,'failed');assert.equal(failed.chapters.length,1);assert.ok(failed.markdown.includes(courseCase.sources[0].pages[0]));
  assert.equal(failed.failure.chapter,2);assert.equal(failed.trace[7].httpStatus,401);
  const limited=plan();limited.budget.maxCalls=5;
  const stopped=await runCourseArm(limited,'candidate',{mode:'simulation',config,fetcher:courseSimulator(courseCase)});
  assert.equal(stopped.status,'failed');assert.equal(stopped.trace.length,5);assert.equal(stopped.failure.code,'EVAL_CALL_BUDGET');
  assert.equal(stopped.qualityConclusion,null);
});

test('missing teaching labels invoke content review once, preserve accepted prose and never require a metadata-repair model call',async()=>{
  const provider=courseSimulator(courseCase);let changed=false,reviewed=0;let originalText;
  const result=await runCourseArm(plan(),'candidate',{mode:'simulation',config,fetcher:async(url,options)=>{
    const messages=JSON.parse(options.body).messages,ctx=JSON.parse(messages[1].content);
    if(messages[0].content.startsWith('note-self-review')){
      reviewed++;assert.ok(ctx.lectureCoverage.gaps.length);assert.ok(ctx.reviewTriggers.includes('LECTURE_COVERAGE'));
      assert.match(messages[0].content,/不要求补标签/);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({candidateDigest:ctx.binding.candidateDigest,verdict:'accept',findings:[],summary:'正文已说明概念；缺的是用途标签，无需重写。'})}}]}));
    }
    const response=await provider(url,options);
    if(!changed&&ctx.composition?.contract){
      const outer=await response.json(),body=JSON.parse(outer.choices[0].message.content);originalText=body.blocks.map(b=>b.text);
      for(const block of body.blocks)block.learningRoles=['example'];
      outer.choices[0].message.content=JSON.stringify(body);changed=true;return new Response(JSON.stringify(outer));
    }
    return response;
  }});
  assert.equal(result.status,'complete',JSON.stringify(result.failure));assert.equal(result.trace.length,14);assert.equal(reviewed,1);
  assert.deepEqual(result.chapters[0].result.blocks.map(b=>b.text),originalText);
  assert.ok(!result.trace.some(t=>t.stage==='recovery-plan'));assert.ok(result.chapters[0].workflow.reviewTriggers.includes('LECTURE_COVERAGE'));
});

test('modified sources and runtime are rejected before network access; identical versions cannot pretend to be a comparison',async()=>{
  let calls=0;const fetcher=()=>{calls++;throw new Error('must not call');};
  const changed=plan();changed.testCase.sources[0].pages[0]+='changed';
  await assert.rejects(runCourseArm(changed,'candidate',{config,fetcher}),/Frozen case/);
  const changedRuntime=plan();changedRuntime.arms[0].fingerprint='changed';
  await assert.rejects(runCourseArm(changedRuntime,'candidate',{config,fetcher}),/Frozen runtime/);
  await assert.rejects(planCourseExperiment(courseCase,{baseline:'.',candidate:'.'}),/different runtime/);
  assert.equal(calls,0);
});

test('three actual provider failures become reviewable coverage observations without rewriting their prose',async()=>{
  const observed=JSON.parse(await readFile(new URL('./fixtures/course-coverage-observed-v1.json',import.meta.url),'utf8'));
  assert.equal(observed.cases.length,3);
  for(const item of observed.cases){
    const before=JSON.stringify(item.blocks),report=validateLectureCoverage(item.synthesis,item.blocks);
    assert.deepEqual(report.gaps,item.observedGaps);assert.equal(JSON.stringify(item.blocks),before);
    assert.equal(report.bindingIssues.length,0);
  }
});

test('usage counts failed attempts and unknown cache honestly; inventory identifies exact context parts without counting nested text twice',()=>{
  const trace=[{stage:'generate',status:'received',elapsedMs:20,request:{messages:[{role:'user',content:'abc'}]},response:{usage:{prompt_tokens:100,completion_tokens:50}}},
    {stage:'recovery-plan',status:'transport-error',elapsedMs:5,request:{messages:[{role:'user',content:'xyz'}]}}];
  const result=usageReport(trace);assert.equal(result.calls,2);assert.equal(result.promptTokens,null);assert.equal(result.cacheHitTokens,null);assert.equal(result.elapsedMs,25);assert.equal(result.currencyCost,null);
  assert.equal(result.stages[0].promptTokens,100);assert.equal(result.stages[1].promptTokens,null);
  const inventory=contextInventory([{role:'user',content:JSON.stringify({source:[{text:'one'}],composition:{prior:[{text:'two'}]}})}]);
  assert.equal(inventory.length,2);assert.equal(inventory[0].characters,JSON.stringify([{text:'one'}]).length);
});

test('review requires bound real quotations, source references and reviewer identity; assistant and simulation cannot become human quality evidence',()=>{
  const quote='原例由 90 与 495 得到 2/13。';
  const result={arm:'candidate',status:'complete',mode:'live',document:{chapters:[{id:'c1',title:'正文',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:quote}]}]}}]}};
  const {packet,review}=createCourseReview(plan(),[result,{...result,arm:'baseline'}],courseOracle,{reverse:false});
  Object.assign(review,{reviewer:'test reviewer',reviewerKind:'assistant',preference:'tie',reason:'fixture assertions only'});
  for(const c of review.candidates){for(const r of c.checks)Object.assign(r,{verdict:'partial',noteQuotes:[quote],sourceRefs:['counts:2'],reason:'A real quote is present; semantic judgment is still a reviewer responsibility.'});for(const t of c.transfer)Object.assign(t,{supported:'partial',reason:'fixture'});}
  assert.equal(validateCourseRatings(packet,review).status,'assistant-reviewed-awaiting-human');
  review.candidates[0].checks[0].noteQuotes=['invented quote'];assert.throws(()=>validateCourseRatings(packet,review),/absent/);
  review.candidates[0].checks[0].noteQuotes=[quote];review.candidates[0].checks[0].sourceRefs=['not-a-source'];assert.throws(()=>validateCourseRatings(packet,review),/source/);
  review.candidates[0].checks[0].sourceRefs=['counts:2'];review.packetHash='wrong';assert.throws(()=>validateCourseRatings(packet,review),/match/);
});
