import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {IdealRunner} from '../server/ideal-tree/runner.mjs';
import {evaluateIdealArtifact} from './evaluate-ideal-tree.mjs';
import {input,fixtureTools,fixtureCompletion} from '../examples/harness/fixture.mjs';
import {root} from './lib/process.mjs';
const directory=await mkdtemp(join(tmpdir(),'pangzhu-demo-')),output=join(root,'artifacts/harness-demo');
await mkdir(output,{recursive:true});
try {
  const runner=new IdealRunner({directory,tools:fixtureTools(),retryDelay:0}),transcript=[],complete=fixtureCompletion(transcript);
  const {job}=await runner.command({command:'create',input,requestId:randomUUID()},complete,'fixture-model (no API)');
  await runner.active.get(job.id)?.promise;const interrupted=await runner.store.read(job.id);
  assert.equal(interrupted.status,'failed');assert.ok(interrupted.branches.B1);assert.equal(interrupted.branches.B2,undefined);
  await runner.command({command:'resume',id:job.id},complete,'fixture-model (no API)');
  await runner.active.get(job.id)?.promise;const completed=await runner.store.read(job.id);
  assert.equal(completed.status,'complete');assert.deepEqual(completed.branches.B1,interrupted.branches.B1);
  assert.equal(transcript.filter(t=>t.stage==='branch'&&t.input.branch.id==='B1').length,1);
  assert.equal(completed.reviewRound,1);assert.equal(completed.repairDone.length,1);
  assert.ok(completed.events.some(e=>e.type==='repair'&&e.stage==='research'));
  const formatCorrection=transcript.find(t=>t.stage==='research'&&t.messages.length>2);
  assert.ok(formatCorrection);assert.equal(formatCorrection.messages.at(-1).role,'user');
  assert.match(formatCorrection.messages.at(-2).content,/Sunknown/);
  const report=evaluateIdealArtifact(completed);assert.ok(report.checks.every(c=>c.status==='pass'));
  const snapshot=JSON.stringify(completed.branches),callCount=transcript.length;
  await runner.command({command:'resume',id:job.id},complete,'fixture-model (no API)');
  assert.equal(transcript.length,callCount);assert.equal(JSON.stringify((await runner.store.read(job.id)).branches),snapshot);
  const provenance={kind:'authored-simulation',realModelCalls:0,externalRequests:0,notice:'模拟响应驱动真实 runner；不证明模型教学质量。'};
  await writeFile(join(output,'job.json'),JSON.stringify({...completed,demo:provenance},null,2)+'\n');
  await writeFile(join(output,'trace.json'),JSON.stringify({provenance,transcript,events:completed.events},null,2)+'\n');
  await writeFile(join(output,'report.json'),JSON.stringify({...report,provenance,behaviorChecks:{checkpointSurvives:true,completedBranchNotRepeated:true,invalidSourceRejected:true,oneScopedRepair:true,completedResumeIsNoop:true}},null,2)+'\n');
  console.log('PASS: 中断保留 B1 → 从 B2 续接 → 拒绝不存在的来源 → 一次格式修正 → 仅修订 B2 → 完成后继续不重复调用。');
  console.log('输出：artifacts/harness-demo/{job,trace,report}.json；真实模型调用 0 次。');
}finally{
  if(dirname(resolve(directory))!==resolve(tmpdir())||!directory.includes('pangzhu-demo-'))throw new Error('Unexpected demo directory');
  await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
