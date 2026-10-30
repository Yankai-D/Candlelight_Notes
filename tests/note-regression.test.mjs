import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { planExperiment, runExperiment, artifactHash, hash } from '../evals/notes/experiment.mjs';
import { smokeOutput } from '../evals/notes/cases.mjs';
import { createReview, rubric } from '../evals/notes/review.mjs';
import { compareNoteRuns, regressionHTML } from '../evals/notes/regression.mjs';

// Injected provider and synthetic ratings exercise validation only. These are
// not live model results or human quality evidence, and are never published.
const config = { baseUrl: 'https://fixture.invalid', model: 'fixture', apiKey: 'fixture-key' };
const prices = { currency: 'USD', asOf: '2026-10-29', model: config.model, baseUrl: config.baseUrl, inputPerMillion: 2, outputPerMillion: 4 };
async function fixture({ usage = { prompt_tokens: 100, completion_tokens: 40 }, fail = false } = {}) {
  const plan = planExperiment({ materialIds: ['diagonal-penalty'], selectedProfiles: ['foundation'], budget: { maxCalls: 1 } });
  const run = await runExperiment(plan, { mode: 'live', config, fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: fail ? '{}' : JSON.stringify(smokeOutput(plan.cases[0].request)) } }], ...(usage ? { usage } : {}) })) });
  for (const c of run.candidates) c.elapsedMs = 100;
  run.artifactHash = artifactHash(run); return run;
}
function ratings(run) {
  const { packet, review } = createReview(run);
  review.reviewer = 'synthetic validator fixture'; review.reviewedAt = '2026-10-29T00:00:00.000Z';
  for (const record of review.records) {
    record.criticalReview = 'clear';
    for (const dimension of rubric) record.ratings[dimension.id] = { score: 3, quote: packet.records.find(r => r.id === record.id).text.slice(0, 20), reason: 'Synthetic evidence for validator testing only.' };
  }
  return review;
}
const reviewed = (a,b,extra={}) => ({ baselineReview: ratings(a), candidateReview: ratings(b), ...extra });
const reseal = run => { run.planHash = hash(run.plan); run.artifactHash = artifactHash(run); return run; };

test('paired regression freezes task and rubric, separates content from usage, and records stages', async () => {
  const a = await fixture(), b = await fixture();
  const report = compareNoteRuns(a,b,reviewed(a,b,{prices}));
  assert.equal(report.status, 'no-observed-regression'); assert.equal(report.quality.conclusion,null);
  assert.equal(report.candidate.cases,1); assert.equal(report.candidate.inputTokens,100);
  assert.equal(report.candidate.p95Ms,100); assert.equal(report.candidate.estimatedCost,0.00036);
  assert.equal(report.rows[0].candidate.stages[0].stage,'generate');
  assert.equal(report.rubricHash,hash(rubric)); assert.equal(report.contractHash,compareNoteRuns(a,a).contractHash);
});

test('higher resource use and critical content regressions cannot be hidden by an average', async () => {
  const a = await fixture(), b = await fixture({usage:{prompt_tokens:200,completion_tokens:80}}), options=reviewed(a,b,{prices});
  const mapping=createReview(b).mapping, r=options.candidateReview.records.find(r=>mapping[r.id].endsWith('/harness'));
  r.criticalReview='issues';r.criticalErrors=[{quote:r.ratings.faithfulness.quote,reason:'Synthetic critical finding to verify rejection.'}];r.ratings.faithfulness.score=2;
  const report=compareNoteRuns(a,b,options), kinds=report.flags.map(f=>f.kind);
  for(const kind of ['inputTokens','outputTokens','estimatedCost','critical-content-error','quality-below-standard','quality-drop']) assert.ok(kinds.includes(kind),kind);
  assert.equal(report.status,'needs-attention');
});

test('failed cheap output stays in the denominator and is never reported as savings', async () => {
  const a=await fixture(), b=await fixture({fail:true,usage:{prompt_tokens:1,completion_tokens:1}});
  const report=compareNoteRuns(a,b);
  assert.equal(report.candidate.accepted,0);assert.equal(report.candidate.cases,1);
  assert.equal(report.status,'needs-attention');assert.deepEqual(report.rows[0].ratios,{});
});

test('missing or incomplete billing metadata remains unknown, with model-specific prices', async () => {
  const a=await fixture(), b=await fixture({usage:null});
  const report=compareNoteRuns(a,b,reviewed(a,b,{prices}));
  assert.equal(report.status,'incomplete-usage');assert.equal(report.candidate.inputTokens,null);assert.equal(report.candidate.estimatedCost,null);
  const cache=compareNoteRuns(a,a,reviewed(a,a,{prices:{...prices,cacheHitInputPerMillion:0.2}}));
  assert.equal(cache.status,'incomplete-usage');assert.equal(cache.candidate.estimatedCost,null);
  const c=await fixture({usage:{prompt_tokens:100,completion_tokens:40,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20}});
  assert.ok(Math.abs(compareNoteRuns(c,c,reviewed(c,c,{prices:{...prices,cacheHitInputPerMillion:0.2}})).candidate.estimatedCost-0.000216)<1e-12);
  assert.throws(()=>compareNoteRuns(a,a,{prices:{...prices,model:'other'}}),/different provider/);
});

test('unreviewed results and simulations cannot pass the content gate', async () => {
  const a=await fixture();assert.equal(compareNoteRuns(a,a).status,'awaiting-human-review');
  const options=reviewed(a,a);delete options.baselineReview.rubricHash;
  assert.equal(compareNoteRuns(a,a,options).status,'awaiting-human-review');
  options.baselineReview.rubricHash='wrong';assert.throws(()=>compareNoteRuns(a,a,options),/rubric/i);
  const sim=await runExperiment(planExperiment({suite:'product-scenarios'}));
  assert.equal(compareNoteRuns(sim,sim).status,'simulation-only');
});

test('different goals, learner settings, budgets or sources are not a paired benchmark', async () => {
  const a=await fixture();
  for(const mutate of [b=>b.plan.cases[0].request.document.intent+='changed',b=>b.plan.cases[0].request.learning.difficulty='changed',b=>b.plan.cases[0].request.document.pages[0].text+='changed',b=>b.plan.budget.maxCalls++,b=>b.model='other']) {
    const b=structuredClone(a);mutate(b);reseal(b);assert.throws(()=>compareNoteRuns(a,b),/requires|changed/);
  }
  const incomplete=structuredClone(a);incomplete.candidates.pop();reseal(incomplete);assert.throws(()=>compareNoteRuns(a,incomplete),/Incomplete/);
  const tampered=structuredClone(a);tampered.candidates[0].elapsedMs=5;assert.throws(()=>compareNoteRuns(a,tampered),/hash/);
  const template=structuredClone(a);template.plan.cases[0].request.learning.writingTemplate.sample+='new template';reseal(template);
  assert.doesNotThrow(()=>compareNoteRuns(a,template));
});

test('HTML report escapes artifact-controlled fields', async () => {
  const a=await fixture(), report=compareNoteRuns(a,a);report.rows[0].id='<img src=x onerror=alert(1)>';
  const dom=new JSDOM(regressionHTML(report));assert.equal(dom.window.document.querySelector('img'),null);
  assert.match(dom.window.document.body.textContent,/<img src=x/);dom.window.close();
});
