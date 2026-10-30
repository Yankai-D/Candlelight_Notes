import { confirmedAudit } from './support/review-audit.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.ts';
import { buildMessages, runModel, validateResult, continuationContext } from '../server/harness.mjs';
import { candidateDigest, parseRevision, applyRevision, revisionContract } from '../server/note-revision.mjs';
import { buildNoteReview } from '../server/note-review.mjs';
import { startWorkflow, workflowRequest, acceptWorkflowReport } from '../shared/workflow-review.mjs';
import {runStage,reserveExecutionCall} from '../server/execution.mjs';

const paragraph = (text, sourcePages = [8]) => ({ type: 'paragraph', text, sourcePages, sourceQuote: '' });
const original = { blocks: [paragraph('这里的阈值写错了，需要修正。'), paragraph('这个公式还缺少适用条件。'), paragraph('已经正确的背景段落，保持原样。')] };
function fixture() {
  const document = createDemo(); document.intent = '整理一份完整的复习讲义';
  document.pages = [{ number: 8, text: 'A probability threshold lies between zero and one. The product formula requires independent events.' }];
  document.chapters = [{ id: 'c1', title: '概率条件', sourcePages: [8], status: 'empty', content: { type: 'doc', content: [] } }];
  document.currentChapter = 'c1';
  return { action: 'generate', scope: 'chapter', composition: true, chapterId: 'c1', revision: document.revision, document, instruction: document.intent,
    learning: { mode: 'adaptive', template: 'guided-v3' }, workflow: workflowRequest(startWorkflow(undefined, 1, 'always'), 'c1', 1, 0) };
}
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const config = { baseUrl: 'https://api.deepseek.com', model: 'test-only', apiKey: 'test-only' };
function review(context, index, problem = '阈值有误。') {
  const issue = Number.isInteger(index);
  return { candidateDigest: context.binding.candidateDigest, verdict: issue ? 'revise' : 'accept',
    ...(context.revisionReview ? { resolutions: context.revisionReview.findings.map(f => ({ findingId: f.id,
      status: issue && context.revisionReview.changeMap.find(c => c.findingId === f.id)?.currentIndices.includes(index) ? 'unresolved' : 'resolved', reason: 'Fixture checks the prior target after the actual edit.' })) } : {}),
    checks: ['goal', 'coverage', 'grounding', 'clarity'].map(dimension => ({ dimension, status: issue && dimension === 'grounding' ? 'issue' : 'pass' })),
    findings: issue ? [{ id: 'f1', dimension: 'grounding', target: { type: 'replace', index }, noteEvidenceId: context.blocks[index].evidenceId,
      ...(context.revisionReview?.changeMap.some(c => c.currentIndices.includes(index)) ? { priorFindingId: context.revisionReview.changeMap.find(c => c.currentIndices.includes(index)).findingId } : {}),
      sourceEvidenceIds: [context.source[0].excerpts[0].id], problem, instruction: `只修正本段的${problem}` }] : [], summary: issue ? problem : '已解决。' };
}

test('flat revisions preserve ordered blocks per finding and reject ambiguous mixed protocols', () => {
  const edits = [{ findingId: 'f1', ...paragraph('first') }, { findingId: 'f1', ...paragraph('second') }, { findingId: 'f2', ...paragraph('third') }];
  const parsed = parseRevision({ candidateDigest: 'a'.repeat(64), edits });
  assert.deepEqual(parsed.changes.map(c => c.blocks.map(b => b.text)), [['first', 'second'], ['third']]);
  assert.throws(() => parseRevision({ ...parsed, edits }));
  assert.throws(() => parseRevision({ candidateDigest: 'a'.repeat(64), edits: [{ ...edits[0], execute: 'unexpected' }] }));
});

test('legacy shared limits migrate out of state and requests without losing history or identity', () => {
  assert.equal(startWorkflow(undefined, 1).repairLimit, undefined);
  assert.equal(startWorkflow(undefined, 8).repairLimit, undefined);
  assert.equal(startWorkflow(undefined, 300).repairLimit, undefined);
  const old = { ...startWorkflow(undefined, 8), repairLimit: 3, repairsUsed: 3 };
  const resumed = startWorkflow(old, 8);
  assert.equal(resumed.id, old.id); assert.equal(resumed.attempt, old.attempt + 1);
  assert.equal(resumed.repairLimit, undefined); assert.equal(resumed.repairsUsed, 0);
  assert.equal(workflowRequest(old,'c1',8,0).repairAllowance,undefined);
});

test('composition review receives chapter responsibilities rather than treating shared source as repeated whole-course coverage', () => {
  const input = fixture();
  input.document.chapters[0].subtitle = '只解释定义，计算交给下一章。';
  input.document.chapters.push({ ...structuredClone(input.document.chapters[0]), id: 'c2', title: '计算应用', subtitle: '应用上一章定义进行计算。' });
  input.workflow.totalChapters = 2;
  const candidate = validateResult(input, original), messages = buildNoteReview(input, candidate), context = JSON.parse(messages[1].content);
  assert.equal(context.composition.purpose, input.document.chapters[0].subtitle);
  assert.deepEqual(context.composition.outline.map(chapter => chapter.purpose), input.document.chapters.map(chapter => chapter.subtitle));
  assert.match(messages[0].content, /不能把后续章节承担的内容判作本章遗漏/);
  assert.equal(JSON.parse(buildNoteReview({ ...input, composition: false }, candidate)[1].content).composition, undefined);
});

test('a copied neighboring paragraph is removed from the patch only, with exact edit and unchanged-block mapping', () => {
  const candidate = structuredClone(original), review = { candidateDigest: candidateDigest(candidate), findings: [{ id: 'f1', target: { type: 'replace', index: 0 } }] };
  const raw = { candidateDigest: review.candidateDigest, changes: [{ findingId: 'f1', blocks: [paragraph('更正后的阈值。'), candidate.blocks[1]] }] };
  const result = applyRevision(candidate, review, raw);
  assert.deepEqual(result.candidate.blocks, [paragraph('更正后的阈值。'), ...candidate.blocks.slice(1)]);
  assert.deepEqual(result.normalizations, [{ findingId: 'f1', kind: 'copied-neighbor', retainedOriginalIndex: 1 }]);
  assert.deepEqual(result.changeMap[0].currentIndices, [0]);
  assert.deepEqual(result.unchangedMap, [{ previousIndex: 1, currentIndex: 1 }, { previousIndex: 2, currentIndex: 2 }]);
  assert.deepEqual(candidate, original);
  for (const change of [
    block => { block.text += '这里增加了条件。'; },
    block => { block.sourcePages = [9]; },
    block => { block.sourceQuote = 'A different exact quote'; },
    block => { block.learningRoles = ['concept', 'method']; },
  ]) {
    const distinct = structuredClone(raw); change(distinct.changes[0].blocks[1]);
    assert.equal(applyRevision(candidate, review, distinct).normalizations.length, 0, 'No fuzzy deletion of conditions, citations or prose');
  }
});

test('two bounded content corrections carry previous findings and exact mappings through independent rechecks', async () => {
  const request = fixture(), phases = [], events = []; let reviewCount = 0, patches = 0, report;
  const raw = await runModel(config, buildMessages(request), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.startsWith('note-self-review-v1')) {
      phases.push('review');
      if (reviewCount > 0) {
        assert.equal(context.revisionReview.round, reviewCount);
        assert.equal(context.revisionReview.findings.length, 1);
        assert.equal(context.revisionReview.changeMap.length, 1);
        assert.match(context.revisionReview.previousCandidateDigest, /^[a-f0-9]{64}$/);
      }
      return response(review(context, [0, 1, undefined][reviewCount++], reviewCount === 2 ? '公式遗漏独立条件。' : '阈值有误。'));
    }
    if (messages[0].content.startsWith('note-review-patch-v1')) {
      phases.push('patch');
      const edits = ++patches === 1
        ? [{ findingId: 'f1', ...paragraph('更正阈值为 0.05。') }, { findingId: 'f1', ...context.blocks[1], index: undefined }]
        : [{ findingId: 'f1', ...paragraph('乘积公式成立的前提是事件相互独立。') }];
      return response({ candidateDigest: context.binding, edits });
    }
    phases.push('generate'); return response(original);
  }, { action: 'generate', onCompletion: event => events.push(event), onWorkflowReport: value => { report = value; } });
  assert.deepEqual(phases, ['generate', 'review', 'patch', 'review', 'patch', 'review']);
  const result = JSON.parse(raw);
  assert.equal(result.blocks.length, 3); assert.equal(result.blocks[2].text, original.blocks[2].text);
  assert.equal(result.blocks[1].text, '乘积公式成立的前提是事件相互独立。');
  assert.equal(report.outcome, 'accepted'); assert.equal(report.repairsUsed, 2); assert.equal(report.reviewCalls, 5);
  assert.ok(events.some(event => event.phase === 'review-patch-normalized'));
});

test('independent findings on one paragraph are audited separately, written once and both rechecked', async () => {
  let reviews = 0, writes = 0, audits = 0;
  const raw = await runModel(config, buildMessages(fixture()), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages);
    if (audit) { audits++; assert.deepEqual(audit.decisions.map(d=>d.findingId), ['f1','f2']); return response(audit); }
    if (messages[0].content.startsWith('note-self-review-v1')) {
      if (reviews++ === 0) {
        const result = review(context, 0);
        result.findings.push({ ...result.findings[0], id:'f2', problem:'还缺少独立条件。',instruction:'说明乘积公式需要独立事件。' });
        return response(result);
      }
      assert.deepEqual(context.revisionReview.changeMap.map(c=>[c.findingId,c.currentIndices]),[['f1',[0]],['f2',[0]]]);
      assert.equal(context.revisionReview.findings.length,2);
      return response(review(context));
    }
    if (messages[0].content.startsWith('note-review-patch-v1')) {
      writes++;
      assert.equal(context.review.findings.length,1);
      assert.deepEqual(context.review.findings[0].relatedFindings.map(f=>f.id),['f1','f2']);
      return response({candidateDigest:context.binding,edits:[{findingId:'f1',...paragraph('阈值为 0.05；乘积公式需要独立事件。')}]});
    }
    return response(original);
  }, {action:'generate'});
  assert.equal(audits,1);assert.equal(writes,1);assert.equal(reviews,2);
  assert.equal(JSON.parse(raw).blocks.length,3);
  assert.deepEqual(JSON.parse(raw).blocks.slice(1),original.blocks.slice(1));
});

test('confirmed same-target aliases preserve all prose and mappings, while dismissed targets get exact diagnostics',()=>{
  const findings=[{id:'f1',target:{type:'replace',index:0}},{id:'f2',target:{type:'replace',index:0}}];
  const review={candidateDigest:candidateDigest(original),findings};
  const edits=[{findingId:'f1',...paragraph('更正阈值。')},{findingId:'f2',...paragraph('补充独立条件。')}];
  const result=applyRevision(original,review,{candidateDigest:review.candidateDigest,edits});
  assert.deepEqual(result.candidate.blocks.slice(0,2).map(b=>b.text),['更正阈值。','补充独立条件。']);
  assert.deepEqual(result.candidate.blocks.slice(2),original.blocks.slice(1));
  assert.deepEqual(result.changeMap.map(c=>[c.findingId,c.currentIndices]),[['f1',[0,1]],['f2',[0,1]]]);
  assert.deepEqual(result.patch.changes.map(c=>c.findingId),['f1']);
  assert.deepEqual(result.normalizations,[{kind:'same-target-alias',findingId:'f2',canonicalId:'f1'}]);
  assert.throws(()=>applyRevision(original,review,{candidateDigest:review.candidateDigest,edits:[...edits,{findingId:'dismissed',...paragraph('不该修改。')}]}),e=>{
    assert.equal(e.code,'REVISION_TARGETS');assert.deepEqual(e.issues[0].path,['edits',2,'findingId']);
    assert.deepEqual(e.issues[0].expected,revisionContract(review));return true;
  });
});

test('one diagnostic action removes a withdrawn edit while original validation preserves every confirmed target',async()=>{
  const review={candidateDigest:candidateDigest(original),findings:[{id:'f1',target:{type:'replace',index:0}}]};
  const edits=[{findingId:'f1',...paragraph('只更正已确认的阈值。')},{findingId:'withdrawn',...paragraph('不能恢复撤销的批评。')}];
  const raw=JSON.stringify({candidateDigest:review.candidateDigest,edits});let calls=0;
  const result=await runStage({stage:'revision',messages:[{role:'system',content:'Repair only the current revision targets.'}],initialRaw:raw,
    preferLocalRecovery:true,validate:value=>applyRevision(original,review,value),complete:async(messages,action)=>{
      await reserveExecutionCall();calls++;assert.equal(action,'recovery-plan');const context=JSON.parse(messages[1].content);
      const issue=context.failure.issues[0];assert.equal(issue.code,'UNAUTHORIZED_REVISION_TARGET');
      return JSON.stringify({failureId:context.failureId,strategy:'patch',targetDigest:context.toolState.targetDigest,
        operations:[{op:'remove',path:issue.path.slice(0,-1),expected:edits[1]}]});}});
  assert.equal(calls,1);assert.deepEqual(result.value.candidate.blocks.slice(1),original.blocks.slice(1));
  assert.throws(()=>applyRevision(original,review,{candidateDigest:review.candidateDigest,edits:[]}),e=>
    e.code==='REVISION_TARGETS'&&e.issues.some(i=>i.code==='MISSING_REVISION_TARGET'));
});

test('an unchanged revision is diagnosed without accepting unchanged content or invoking another reviewer', async () => {
  let calls = 0;
  await assert.rejects(runModel(config, buildMessages(fixture()), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.startsWith('note-self-review-v1')) return response(review(context, 0));
    if (messages[0].content.startsWith('note-review-patch-v1'))
      return response({ candidateDigest: context.binding, edits: [{ findingId: 'f1', ...context.blocks[0] }] });
    return response(original);
  }, { action: 'generate' }), error => error.code === 'WORKFLOW_REVIEW_FAILED' && error.executionStage === 'note-review-patch');
  assert.equal(calls, 9);
});

test('ongoing corrections pass the former chapter, notebook and call limits, including exhausted legacy requests', async () => {
  for (const allowance of [0, 3]) {
    const input = fixture(); input.workflow.repairAllowance = allowance;
    let calls = 0, reviews = 0, patches = 0, report;
    const raw = await runModel(config, buildMessages(input), undefined, async (_, options) => {
      calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
      if (messages[0].content.startsWith('note-self-review-v1')) { reviews++; return response(review(context, patches < 13 ? 0 : undefined, `剩余待修正项目 ${13-patches}。`)); }
      if (messages[0].content.startsWith('note-review-patch-v1'))
        return response({ candidateDigest: context.binding, edits: [{ findingId: 'f1', ...paragraph(`修订内容 ${++patches}。`) }] });
      return response(original);
    }, { action: 'generate', onWorkflowReport:value=>{report=value;} });
    assert.equal(patches,13); assert.equal(calls,41); assert.equal(reviews,14);
    assert.equal(report.repairsUsed,13); assert.equal(report.outcome,'accepted');
    assert.equal(JSON.parse(raw).blocks[0].text,'修订内容 13。');
    const prior={...startWorkflow(undefined,2),repairLimit:12,repairsUsed:12};
    const request=workflowRequest(prior,'c1',2,0);
    const updated=acceptWorkflowReport(prior,request,{...report,id:prior.id,attempt:prior.attempt,chapterId:'c1'},'accepted');
    assert.equal(updated.repairsUsed,25);assert.equal(updated.repairLimit,undefined);
  }
});

test('later segments receive accepted writing context without expanding source evidence or cutting formulas', async () => {
  const input = fixture();
  input.document.pages = [{ number: 8, text: 'Source A. '.repeat(2800) }, { number: 9, text: 'Source B. '.repeat(2400) }];
  input.document.chapters[0].sourcePages = [8, 9];
  const generations = [], reviews = [];
  await runModel(config, buildMessages(input), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.startsWith('note-self-review-v1')) { reviews.push(context); return response(review(context)); }
    generations.push(context);
    return response({ blocks: [paragraph(`本片段的解释 ${generations.length}：\\(x^2\\)。`, context.sourceReferences.allowedIds)] });
  }, { action: 'generate' });
  assert.equal(generations.length, 2);
  assert.equal(generations[0].continuation, undefined);
  assert.equal(generations[1].continuation.completedSegments, 1);
  assert.match(generations[1].continuation.recentProse[0].text, /解释 1/);
  assert.deepEqual(reviews[1].continuation, generations[1].continuation);
  assert.ok(generations[1].continuation.recentProse.every(block => !Object.hasOwn(block, 'sourcePages')));
  const huge = continuationContext([{ blocks: [paragraph('x'.repeat(13000)), paragraph('\\(x^2\\)')] }]);
  assert.deepEqual(huge.recentProse.map(b => b.text), ['\\(x^2\\)']);
});

test('bounded adaptive bundle chapters reconcile all related files together while translation keeps smaller chunks', async () => {
  for (const mode of ['adaptive', 'translation']) {
    const input = fixture(); input.learning.mode = mode;
    input.document.pages = [{ number: 8, text: 'Source A. '.repeat(1600) }, { number: 9, text: 'Source B. '.repeat(1600) }];
    input.document.chapters[0].sourcePages = [8, 9];
    const sources = [];
    await runModel(config, buildMessages(input), undefined, async (_, options) => {
      const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
      if (messages[0].content.startsWith('note-self-review-v1')) return response(review(context));
      sources.push(context.sourceReferences.allowedIds);
      return response({ blocks: [paragraph('由两份资料支持的完整解释。', context.sourceReferences.allowedIds)] });
    }, { action: 'generate' });
    assert.deepEqual(sources, mode === 'adaptive' ? [[8, 9]] : [[8, 9], [9]]);
  }
});
