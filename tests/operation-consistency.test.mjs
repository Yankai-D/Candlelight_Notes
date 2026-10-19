import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildMessages } from '../server/harness.mjs';
import { materials, smokeOutput } from '../evals/notes/cases.mjs';
import { operationMaterials, operationOracles, operationPolicy } from '../evals/notes/operation-consistency.mjs';
import { planExperiment, messagesFor, runExperiment, hash } from '../evals/notes/experiment.mjs';
import { createReview, summarizeReview, rubric } from '../evals/notes/review.mjs';
import { inspectRun, validateFindings } from '../evals/notes/diagnostics.mjs';

const plan = options => planExperiment({suite:'operation-consistency',...options});
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('operation trial changes exactly one system suffix; source, samples, profile and defaults remain identical',()=>{
  const trial=plan();assert.equal(trial.candidateCount,8);
  assert.equal(trial.experiment.oracleHash,hash(operationOracles));
  assert.deepEqual(trial.comparisons,[{baseline:'harness',treatment:'operation-check'}]);
  for(const c of trial.cases) {
    const baseline=messagesFor(c,'harness'),changed=messagesFor(c,'operation-check');
    assert.deepEqual(baseline,buildMessages(c.request));
    assert.equal(changed[0].content,baseline[0].content+'\n'+operationPolicy.instruction);
    assert.deepEqual(changed.slice(1),baseline.slice(1));
    const context=JSON.parse(changed[1].content);
    assert.deepEqual(context.source,c.material.pages);assert.ok(context.writingTemplate.sample);
    const sentinel=structuredClone(c);sentinel.material.criteria=['ORACLE_SECRET_SENTINEL'];
    assert.ok(!JSON.stringify(messagesFor(sentinel,'operation-check')).includes('ORACLE_SECRET_SENTINEL'));
    assert.ok(!JSON.stringify(changed).includes('operationOracles'));
    assert.ok(!baseline[0].content.includes(operationPolicy.instruction));
  }
  assert.equal(planExperiment().candidateCount,12);assert.equal(materials.length,3);
  assert.throws(()=>planExperiment({selectedArms:['harness','operation-check']}),/explicit suite/);
  assert.throws(()=>plan({selectedArms:['no-sample','operation-check']}),/fixes/);
  assert.throws(()=>plan({selectedProfiles:['foundation']}),/fixes/);
  assert.throws(()=>plan({materialIds:['not-present']}),/Unknown/);
});

test('independent decay and whole-result decay differ; valid shrink-original implementation is a positive control',()=>{
  const {u,h,p,eta,rho,expected,alternative}=operationOracles['independent-shrink'];
  const independent=u.map((v,i)=>(1-eta*rho)*v-eta*p[i]*h[i]);
  const wrong=u.map((v,i)=>(1-eta*rho)*(v-eta*p[i]*h[i]));
  const coupled=u.map((v,i)=>v-eta*p[i]*(h[i]+rho*v));
  const positive=u.map((v,i)=>(v-eta*rho*v)-eta*p[i]*h[i]);
  independent.forEach((v,i)=>{
    close(v,expected[i]);close(wrong[i],alternative[i]);close(positive[i],v);
    close(wrong[i]-v,eta**2*rho*p[i]*h[i]);close(coupled[i]-v,-eta*rho*(p[i]-1)*u[i]);
    assert.notEqual(wrong[i],v);
  });
  const source=operationMaterials.find(c=>c.id==='independent-shrink').pages[0].text;
  assert.ok(source.includes(`(${expected.join(',')})`));assert.ok(source.includes('(2.65,-1.2)'));
});

test('simultaneous state uses a frozen input; reversed output storage order preserves the same map',()=>{
  const {state,matrix,expected,alternative}=operationOracles['simultaneous-state'];
  const result=matrix.map(row=>row.reduce((n,v,i)=>n+v*state[i],0));
  assert.deepEqual(result,expected);
  const sequential=[result[0],matrix[1][0]*result[0]+matrix[1][1]*state[1]];
  assert.deepEqual(sequential,alternative);assert.notDeepEqual(sequential,result);
  const reversed=[];for(const i of [1,0])reversed[i]=matrix[i][0]*state[0]+matrix[i][1]*state[1];
  assert.deepEqual(reversed,result);
});

test('real composition retains its order, including equal special cases; an identity needs no update state',()=>{
  const {x,b,c,expected,alternative}=operationOracles['affine-composition'];
  close(c*(x+b),expected);close(c*x+b,alternative);close(expected-alternative,(c-1)*b);
  for(const [offset,gain] of [[0,4],[3,1]])close(gain*(x+offset),gain*x+offset);
  const oracle=operationOracles['variance-identity'];
  const mean=oracle.values.reduce((n,v,i)=>n+v*oracle.probabilities[i],0);
  const raw=oracle.values.reduce((n,v,i)=>n+v*v*oracle.probabilities[i],0);
  const variance=oracle.values.reduce((n,v,i)=>n+(v-mean)**2*oracle.probabilities[i],0);
  close(mean,oracle.mean);close(raw,oracle.rawSecond);close(variance,oracle.variance);
  close(mean**2,oracle.squaredMean);close(raw-mean**2,variance);assert.notEqual(raw,mean**2);
});

test('experimental arm keeps the production repair policy, the single suffix, and the same provider limits',async()=>{
  const trial=plan({materialIds:['simultaneous-state']}),requests=[];
  const run=await runExperiment(trial,{mode:'live',config:{model:'fake',apiKey:'TEST_ONLY_SECRET',baseUrl:'https://api.deepseek.com'},fetcher:async(url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);
    const content=body.messages.length===2?'invalid JSON':JSON.stringify(smokeOutput(trial.cases[0].request));
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:10}}));
  }});
  assert.equal(requests.length,4);assert.ok(run.candidates.every(c=>c.status==='accepted' && c.usage.calls===2));
  assert.ok(requests.every(r=>r.max_tokens===2048));
  assert.ok(run.candidates.every(c=>c.events.filter(e=>e.repair).length===1));
  const changed=run.candidates.find(c=>c.arm==='operation-check');
  assert.ok(changed.trace.every(t=>t.request.messages[0].content.split(operationPolicy.instruction).length===2));
  assert.ok(!JSON.stringify(run).includes('TEST_ONLY_SECRET'));
});

test('frozen experimental rule and oracle hashes bind the planned trial and no human score is inferred',async()=>{
  const trial=plan({materialIds:['affine-composition']});
  trial.prompts[`${trial.cases[0].id}/operation-check`].hash='changed';let called=0;
  await assert.rejects(runExperiment(trial,{fetcher:async()=>{called++;}}),/Planned prompts changed/);assert.equal(called,0);
  const stale=plan();stale.experiment.oracleHash='changed';
  await assert.rejects(runExperiment(stale),/policy or oracle changed/);
  const run=await runExperiment(plan({materialIds:['affine-composition']}));
  const {review}=createReview(run);assert.deepEqual(review.profilePairs,[]);
  assert.equal(summarizeReview(run,review).status,'simulation-only');
  // A fixture marked live exercises the human scoring branch only.
  const fixture=await runExperiment(plan({materialIds:['affine-composition']}),{mode:'live',config:{model:'fixture',apiKey:'TEST_ONLY',baseUrl:'https://api.deepseek.com'},fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(smokeOutput(plan().cases[0].request))}}]}))});
  const {review:r,packet,mapping}=createReview(fixture);r.reviewer='test fixture';r.reviewedAt=new Date().toISOString();
  for(const record of r.records){record.criticalReview='clear';for(const d of rubric)record.ratings[d.id]={score:mapping[record.id].endsWith('operation-check')?3:2,quote:packet.records.find(p=>p.id===record.id).text.slice(0,20),reason:'仅验证评分程序能够对本轮指定的两组进行相减。'};}
  const result=summarizeReview(fixture,r);assert.equal(result.pairedDeltas.length,1);
  assert.equal(result.pairedDeltas[0].baseline,'harness');assert.equal(result.pairedDeltas[0].treatment,'operation-check');
  assert.equal(result.pairedDeltas[0].dimensions.faithfulness,1);assert.equal(result.qualityConclusion,null);
});

test('CLI requires an explicit material selection for a live operation trial',()=>{
  assert.throws(()=>execFileSync(process.execPath,['scripts/evaluate-notes.mjs','--live','--suite','operation-consistency'],{cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,stdio:'pipe'}),e=>e.status===1 && /require --case/.test(e.stderr));
});

const archive = () => JSON.parse(readFileSync(new URL('../evals/notes/runs/2026-10-18-operation/run.json',import.meta.url),'utf8'));
const observations = () => JSON.parse(readFileSync(new URL('../evals/notes/runs/2026-10-18-operation/findings.json',import.meta.url),'utf8'));

test('archived live pairs preserve the sole prompt change; provisional observations cover all candidates without granting a quality verdict',()=>{
  const run=archive(),f=observations(),report=inspectRun(run);
  assert.equal(report.totals.calls,8);assert.equal(report.totals.promptTokens,36150);assert.equal(report.totals.completionTokens,9684);
  assert.equal(report.byArm['operation-check'].completionTokens-report.byArm.harness.completionTokens,536);
  assert.equal(validateFindings(run,f).semanticJudgment,'unverified');
  const observed=new Set(f.findings.flatMap(f=>f.noteEvidence.map(e=>e.candidateId)));
  assert.deepEqual([...observed].sort(),run.candidates.map(c=>c.id).sort());
  for(const c of run.plan.cases) {
    const base=run.candidates.find(v=>v.caseId===c.id && v.arm==='harness').trace[0].request;
    const treatment=structuredClone(run.candidates.find(v=>v.caseId===c.id && v.arm==='operation-check').trace[0].request);
    assert.equal(treatment.messages[0].content,base.messages[0].content+'\n'+run.plan.experiment.policy.instruction);
    treatment.messages[0].content=base.messages[0].content;
    assert.deepEqual(treatment,base);
  }
  assert.equal(run.candidates.reduce((n,c)=>n+(c.evidence?.quotesRemoved||0),0),1);
  const human=summarizeReview(run,createReview(run).review);
  assert.equal(human.status,'awaiting-human-review');assert.equal(human.qualityConclusion,null);
  assert.ok(human.limitations.some(s=>s.includes('两组使用完全相同的完整样稿')));
  assert.ok(!report.limitations.some(s=>s.includes('harness 的样稿增加')));
});

test('newly observed universal difference claim has valid zero-decay and nonzero-decay counterexamples',()=>{
  const f=observations().findings.find(f=>f.id==='overstated-difference');
  for(const c of f.counterexamples){
    assert.ok(c.eta>0 && c.rho>=0 && c.p.every(v=>v>0) && c.p.some(v=>v!==1));
    const independent=c.u.map((u,i)=>(1-c.eta*c.rho)*u-c.eta*c.p[i]*c.h[i]);
    const coupled=c.u.map((u,i)=>u-c.eta*c.p[i]*(c.h[i]+c.rho*u));
    independent.forEach((v,i)=>{close(v,c.expectedIndependent[i]);close(coupled[i],c.expectedCoupled[i]);close(v,coupled[i]);});
  }
  assert.ok(f.counterexamples.some(c=>c.rho>0 && c.u.some(v=>v!==0)));
});
