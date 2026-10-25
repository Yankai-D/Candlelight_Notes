import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.ts';
import { buildMessages, runModel } from '../server/harness.mjs';
import { buildNoteReview, validateNoteReview, normalizeReviewProtocol } from '../server/note-review.mjs';
import { applyReviewAudit } from '../server/note-review-audit.mjs';
import { startWorkflow, workflowRequest } from '../shared/workflow-review.mjs';

function fixture() {
  const document = createDemo();
  document.pages = [{ number: 8, text: 'Linearity of expectation does not require independent random variables.' }];
  document.chapters = [{ id: 'c1', title: '期望', sourcePages: [8], status: 'empty', content: { type: 'doc', content: [] } }];
  document.currentChapter = 'c1';
  const request = { action: 'generate', scope: 'chapter', chapterId: 'c1', revision: document.revision, document,
    instruction: '解释期望', learning: { mode: 'adaptive', template: 'guided-v3' }, workflow: workflowRequest(startWorkflow(undefined, 1, 'always'), 'c1', 1, 0) };
  const candidate = { blocks: [{ type: 'paragraph', text: '期望的线性性不要求随机变量独立。', sourcePages: [8], sourceQuote: '' }] };
  return { request, candidate };
}
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const config = { baseUrl: 'https://api.deepseek.com', model: 'test-only', apiKey: 'test-only' };
function criticism(context) {
  return { candidateDigest: context.binding.candidateDigest, verdict: 'revise',
    checks: ['goal', 'coverage', 'grounding', 'clarity'].map(dimension => ({ dimension, status: dimension === 'grounding' ? 'issue' : 'pass' })),
    findings: [{ id: 'f1', dimension: 'grounding', target: { type: 'replace', index: 0 }, noteEvidenceId: context.blocks[0].evidenceId,
      sourceEvidenceIds: [context.source[0].excerpts[0].id], problem: '声称期望的线性性不需要独立。', instruction: '补上独立条件。' }], summary: '需要复核的批评。' };
}
function decision(context, verdict) {
  return { candidateDigest: context.binding, decisions: [{ findingId: 'f1', verdict,
    reason: '原文明确说明期望的线性性不要求独立，审查建议额外添加条件的推理并不成立。',
    sourceEvidenceIds: [context.source[0].excerpts[0].id] }] };
}

test('an independently dismissed criticism cannot modify a correct note; persistent uncertainty never authorizes editing', async () => {
  for (const verdict of ['dismiss', 'uncertain']) {
    const { request, candidate } = fixture(); let calls = 0, report;
    const run = runModel(config, buildMessages(request), undefined, async (_, options) => {
      calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
      if (messages[0].content.startsWith('execution-recovery-plan')) return response({});
      if (messages[0].content.startsWith('note-self-review-v1')) return response(criticism(context));
      if (messages[0].content.startsWith('note-review-audit-v1')) {
        assert.equal(JSON.parse(options.body).max_tokens, 8192);
        return response(decision(context, verdict));
      }
      assert.equal(calls, 1, 'No patch may run after dismissed or uncertain advice');
      return response(candidate);
    }, { action: 'generate', onWorkflowReport: value => { report = value; } });
    if (verdict === 'dismiss') {
      assert.deepEqual(JSON.parse(await run).blocks, candidate.blocks);
      assert.equal(report.outcome, 'accepted'); assert.equal(report.repairsUsed, 0); assert.equal(report.reviewCalls, 2);
    } else await assert.rejects(run, { code: 'WORKFLOW_REVIEW_FAILED' });
    assert.equal(calls, verdict === 'dismiss' ? 3 : 7, 'Failed rewrites retain one diagnostic opportunity for local repair, never permission to approve uncertain advice');
    if (verdict === 'uncertain') { assert.equal(report.repairsUsed, 0); assert.equal(report.reviewCalls, 4); assert.equal(report.execution.recoveryActions, 2); }
  }
});

test('an uncertain audit can be clarified once without regenerating or changing correct content', async () => {
  const { request, candidate } = fixture(); let calls = 0, audits = 0, report;
  const result = await runModel(config, buildMessages(request), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    if (messages[0].content.startsWith('note-self-review-v1')) return response(criticism(context));
    if (messages[0].content.startsWith('note-review-audit-v1')) {
      audits++;
      if (audits === 2) { assert.equal(messages.length, 4); assert.match(messages[3].content, /不为完成流程而强行通过/); }
      return response(decision(context, audits === 1 ? 'uncertain' : 'dismiss'));
    }
    assert.equal(calls, 1, 'Clarification cannot invoke a content patch');
    return response(candidate);
  }, { action: 'generate', onWorkflowReport: value => { report = value; } });
  assert.deepEqual(JSON.parse(result).blocks, candidate.blocks);
  assert.equal(calls, 4); assert.equal(audits, 2);
  assert.equal(report.repairsUsed, 0); assert.equal(report.execution.recoveryActions, 1); assert.equal(report.outcome, 'accepted');
});

test('exhausting content revisions still allows recovery of an uncertain review without changing prose', async () => {
  const { request, candidate } = fixture(); request.workflow.repairAllowance = 0; let calls = 0, audits = 0, report;
  const result = await runModel(config, buildMessages(request), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    if (messages[0].content.startsWith('note-self-review-v1')) return response(criticism(context));
    if (messages[0].content.startsWith('note-review-audit-v1')) return response(decision(context, ++audits === 1 ? 'uncertain' : 'dismiss'));
    assert.equal(calls, 1);
    return response(candidate);
  }, { action: 'generate', onWorkflowReport: value => { report = value; } });
  assert.deepEqual(JSON.parse(result).blocks, candidate.blocks);
  assert.equal(calls, 4); assert.equal(report.repairsUsed, 0);
});

test('format and audit recovery preserve the separate content correction budget without restarting the task', async () => {
  const { request, candidate } = fixture();
  request.workflow.repairAllowance = 4;
  candidate.blocks[0].text = '期望的线性性需要随机变量独立。';
  let generations = 0, reviews = 0, audits = 0, patches = 0, diagnostics = 0, report;
  const result = await runModel(config, buildMessages(request), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    if (messages[0].content.startsWith('execution-recovery-plan-v1')) {
      diagnostics++;
      return response({failureId:context.failureId,strategy:'repair',cause:'当前审查缺少可执行的 instruction。',instruction:'保留问题与证据，补全该问题的定向修订指令。'});
    }
    if (messages[0].content.startsWith('note-self-review-v1')) {
      reviews++;
      if (patches) return response({ candidateDigest: context.binding.candidateDigest, verdict: 'accept',
        checks: ['goal', 'coverage', 'grounding', 'clarity'].map(dimension => ({ dimension, status: 'pass' })), findings: [], summary: '错误条件已删除。' });
      const review = criticism(context);
      review.findings[0].problem = '正文错误地添加了独立条件。';
      review.findings[0].instruction = '删除独立条件，说明期望的线性性不要求独立。';
      if (reviews === 1) delete review.findings[0].instruction;
      return response(review);
    }
    if (messages[0].content.startsWith('note-review-audit-v1')) return response(decision(context, ++audits === 1 ? 'uncertain' : 'confirm'));
    if (messages[0].content.startsWith('note-review-patch-v1')) {
      patches++;
      return response({ candidateDigest: context.binding, edits: [{ findingId: 'f1', ...candidate.blocks[0], text: '期望的线性性不要求随机变量独立。' }] });
    }
    if (++generations === 1) return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] }));
    return response(candidate);
  }, { action: 'generate', onWorkflowReport: value => { report = value; } });
  assert.equal(JSON.parse(result).blocks[0].text, '期望的线性性不要求随机变量独立。');
  assert.equal(generations, 2); assert.equal(reviews, 3); assert.equal(audits, 2); assert.equal(patches, 1);
  assert.equal(diagnostics,1);
  assert.equal(report.repairsUsed, 1); assert.equal(report.execution.recoveryActions, 3); assert.equal(report.outcome, 'accepted');
});

test('review audit binds every decision to the snapshot, original finding and current evidence', () => {
  const { request, candidate } = fixture(), context = JSON.parse(buildNoteReview(request, candidate)[1].content);
  const review = validateNoteReview(request, candidate, criticism(context));
  const valid = decision({ ...context, binding: context.binding.candidateDigest }, 'dismiss');
  assert.equal(applyReviewAudit(request, candidate, review, valid).review.verdict, 'accept');
  for (const change of [
    value => { value.candidateDigest = '0'.repeat(64); },
    value => { value.decisions[0].findingId = 'f2'; },
    value => { value.decisions.push({ ...value.decisions[0], verdict: 'confirm' }); },
    value => { value.decisions[0].sourceEvidenceIds = []; },
    value => { value.decisions[0].sourceEvidenceIds = ['e8-0-stale']; },
  ]) { const bad = structuredClone(valid); change(bad); assert.throws(() => applyReviewAudit(request, candidate, review, bad)); }
  const supplementary = structuredClone(valid); supplementary.decisions.push({ ...supplementary.decisions[0], reason: '同一结论的补充依据可以无损合并，不能因为重复 ID 而反复调用模型。' });
  const merged = applyReviewAudit(request, candidate, review, supplementary);
  assert.equal(merged.review.verdict, 'accept'); assert.equal(merged.audit.decisions.length, 1);
  assert.equal(merged.audit.normalizations.length, 1);
});

test('local review protocol recovery only resolves a sole exact page excerpt and escalates contradictory pass flags', () => {
  const { request, candidate } = fixture(), context = JSON.parse(buildNoteReview(request, candidate)[1].content), raw = criticism(context);
  raw.findings[0].sourceEvidenceIds = [8]; raw.checks[2].status = 'pass';
  const result = normalizeReviewProtocol(request, raw);
  assert.equal(result.normalizations.length, 2);
  assert.equal(validateNoteReview(request, candidate, result.value).verdict, 'revise');
  assert.equal(raw.checks[2].status, 'pass');
  const ambiguous = structuredClone(request); ambiguous.document.pages[0].text = 'Long source. '.repeat(120);
  assert.equal(normalizeReviewProtocol(ambiguous, raw).value.findings[0].sourceEvidenceIds[0], 8);
  assert.throws(() => validateNoteReview(ambiguous, candidate, normalizeReviewProtocol(ambiguous, raw).value));
  raw.verdict = 'accept';
  assert.throws(() => validateNoteReview(request, candidate, normalizeReviewProtocol(request, raw).value));
});

test('a missing descriptive summary does not discard valid findings or relax required evidence and instructions', () => {
  const { request, candidate } = fixture(), context = JSON.parse(buildNoteReview(request, candidate)[1].content);
  const raw = criticism(context); delete raw.summary;
  const reviewed = validateNoteReview(request, candidate, raw);
  assert.equal(reviewed.summary, ''); assert.equal(reviewed.verdict, 'revise'); assert.equal(reviewed.findings.length, 1);
  delete raw.findings[0].instruction;
  assert.throws(() => validateNoteReview(request, candidate, raw));
});

test('a mixed finding can be narrowed to its real defect and repaired without dropping the defect or altering correct neighboring prose', async () => {
  const { request } = fixture();
  const candidate = { blocks: [
    { type: 'paragraph', text: '期望的线性性不要求独立。', sourcePages: [8], sourceQuote: '' },
    { type: 'paragraph', text: '线性姓适用于可积的随机变量。', sourcePages: [8], sourceQuote: '' },
  ] };
  let reviews = 0, audits = 0, patches = 0, report;
  const result = JSON.parse(await runModel(config, buildMessages(request), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content), system = messages[0].content;
    if (system.startsWith('note-self-review')) {
      if (++reviews === 2) return response({ candidateDigest: context.binding.candidateDigest, verdict: 'accept', checks: ['goal','coverage','grounding','clarity'].map(dimension => ({ dimension,status:'pass' })), findings: [], summary: '笔误已修正，正确条件保留。' });
      const review = criticism(context);
      Object.assign(review.findings[0], { target: { type:'replace',index:1 }, noteEvidenceId: context.blocks[1].evidenceId,
        problem: '第二段有笔误，且上一段应增加独立条件。', instruction: '纠正笔误，并给期望的线性性添加独立条件。' });
      return response(review);
    }
    if (system.startsWith('note-review-audit')) {
      audits++;
      return response({ candidateDigest: context.binding, decisions: [{ findingId:'f1', verdict:'refine',
        reason:'笔误确实需要纠正，但原文明确无需独立，另一项批评不成立；只改原目标中的笔误。',
        sourceEvidenceIds:[context.source[0].excerpts[0].id], refinement:{ problem:'第二段将线性性误写为线性姓。', instruction:'仅将线性姓改为线性性，保留可积条件。' } }] });
    }
    if (system.startsWith('note-review-patch')) {
      patches++;
      assert.equal(context.review.findings[0].target.index,1);
      assert.equal(context.review.findings[0].auditRefinement,undefined,'The writer must not receive withdrawn instructions');
      assert.doesNotMatch(JSON.stringify(context.review),/添加独立条件/);
      assert.doesNotMatch(context.review.findings[0].instruction,/添加独立/);
      return response({candidateDigest:context.binding,edits:[{findingId:'f1',type:'paragraph',text:'线性性适用于可积的随机变量。',sourcePages:[8],sourceQuote:''}]});
    }
    return response(candidate);
  }, { onWorkflowReport: value => { report = value; } }));
  assert.deepEqual(result.blocks[0],candidate.blocks[0]);
  assert.match(result.blocks[1].text,/线性性/);
  assert.equal(audits,1); assert.equal(patches,1); assert.equal(reviews,2);
  assert.equal(report.repairsUsed,1); assert.equal(report.execution.recoveryActions,0);
});

test('refinement is bound to the existing finding and target, and cannot bypass evidence requirements', () => {
  const { request, candidate }=fixture(), context=JSON.parse(buildNoteReview(request,candidate)[1].content);
  const review=validateNoteReview(request,candidate,criticism(context));
  const raw={candidateDigest:review.candidateDigest,decisions:[{findingId:'f1',verdict:'refine',reason:'只保留原意见中有依据的部分，修正错误指令，且不移动原来的编辑位置。',sourceEvidenceIds:[context.source[0].excerpts[0].id],refinement:{problem:'真实局部问题。',instruction:'只修正原目标。'}}]};
  const result=applyReviewAudit(request,candidate,review,raw);
  assert.equal(result.review.verdict,'revise');
  assert.deepEqual(result.review.findings[0].target,review.findings[0].target);
  const changed=structuredClone(raw);changed.decisions[0].refinement.target={type:'replace',index:99};
  assert.throws(()=>applyReviewAudit(request,candidate,review,changed));
  delete changed.decisions[0].refinement;
  assert.throws(()=>applyReviewAudit(request,candidate,review,changed));
  changed.decisions[0].refinement=raw.decisions[0].refinement; changed.decisions[0].sourceEvidenceIds=[];
  assert.throws(()=>applyReviewAudit(request,candidate,review,changed),/原文依据/);
});
