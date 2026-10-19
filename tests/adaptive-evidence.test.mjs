import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildMessages,runModel} from '../server/harness.mjs';
import {adaptiveEvidencePolicy} from '../shared/adaptive-evidence.mjs';
import {planExperiment,messagesFor,runExperiment} from '../evals/notes/experiment.mjs';
import {smokeOutput} from '../evals/notes/cases.mjs';
import {createReview,summarizeReview} from '../evals/notes/review.mjs';
import {currentMessagesFromV010} from './support/prompt-history.mjs';

const config={baseUrl:'https://api.deepseek.com',model:'fixture-only',apiKey:'test-key'};
const response=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:typeof value==='string'?value:JSON.stringify(value)}}],usage:{prompt_tokens:10,completion_tokens:20}}),{status:200});
const suffix='\n'+adaptiveEvidencePolicy.instruction;

test('current comparison preserves the archived baseline except explicit brand/profile changes, and changes only one experimental suffix',()=>{
  const previous=JSON.parse(readFileSync(new URL('../evals/notes/runs/2026-10-18-product/run.json',import.meta.url),'utf8'));
  const plan=planExperiment({suite:'evidence-boundary'});
  assert.equal(plan.candidateCount,6);
  assert.deepEqual(plan.comparisons,[{baseline:'previous-harness',treatment:'harness'}]);
  for(const c of plan.cases) {
    const baseline=messagesFor(c,'previous-harness',{evidenceTrial:true}),current=messagesFor(c,'harness',{evidenceTrial:true});
    assert.deepEqual(baseline,currentMessagesFromV010(previous.plan.prompts[`${c.id}/harness`].messages));
    assert.equal(current[0].content,baseline[0].content+suffix);
    assert.deepEqual(current.slice(1),baseline.slice(1));
    const changed=structuredClone(c);changed.material.criteria=['PRIVATE_REVIEW_SENTINEL'];
    for(const arm of plan.selectedArms)assert.ok(!JSON.stringify(messagesFor(changed,arm,{evidenceTrial:true})).includes('PRIVATE_REVIEW_SENTINEL'));
  }
  assert.throws(()=>planExperiment({selectedArms:['previous-harness','harness']}),/explicit suite/);
});

test('both comparison arms retain the same bounded repair path and remain unscored',async()=>{
  const plan=planExperiment({suite:'evidence-boundary',materialIds:['resnet-inline']});
  const original=structuredClone(plan.cases[0].request);
  const run=await runExperiment(plan,{mode:'live',config,fetcher:async(url,options)=>{
    const body=JSON.parse(options.body);
    return response(body.messages.length===2?'invalid JSON':smokeOutput(plan.cases[0].request));
  }});
  for(const c of run.candidates) {
    assert.equal(c.status,'accepted');assert.equal(c.usage.calls,2);
    assert.deepEqual(c.trace[1].request.messages.slice(0,2),c.trace[0].request.messages);
    assert.equal(c.trace[1].request.messages[0].content.endsWith(suffix),c.arm==='harness');
  }
  assert.deepEqual(plan.cases[0].request,original);
  assert.equal(summarizeReview(run,createReview(run).review).status,'awaiting-human-review');
  plan.experiment.policy={...plan.experiment.policy,version:'changed'};
  await assert.rejects(runExperiment(plan),/policy changed/);
});

test('withdrawn evidence policy cannot enter ordinary adaptive or translation editing',()=>{
  const original=planExperiment({suite:'evidence-boundary'}).cases.at(-1).request;
  for(const action of ['generate','explain','rewrite','style']) {
    const request={...structuredClone(original),action};
    assert.ok(!buildMessages(request)[0].content.includes(adaptiveEvidencePolicy.instruction));
    request.learning.mode='translation';
    assert.ok(!buildMessages(request)[0].content.includes(adaptiveEvidencePolicy.instruction));
  }
});

test('long adaptive chapters remain on the production contract after the candidate is withdrawn',async()=>{
  const request=structuredClone(planExperiment({suite:'evidence-boundary'}).cases[0].request);
  request.document.pages[0].text=request.document.pages[0].text.repeat(12);
  let calls=0;
  const raw=await runModel(config,buildMessages(request),undefined,async(url,options)=>{
    const body=JSON.parse(options.body);calls++;
    assert.ok(!body.messages[0].content.includes(adaptiveEvidencePolicy.instruction));
    const context=JSON.parse(body.messages[1].content);
    assert.equal(context.segment.index,calls);
    assert.ok(context.source.reduce((n,p)=>n+p.text.length,0)<=18000);
    return response(smokeOutput(request));
  },{action:'generate'});
  assert.ok(calls>1);assert.equal(JSON.parse(raw).blocks.length,calls*2);
});
