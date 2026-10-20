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
    assert.equal(calls, verdict === 'dismiss' ? 3 : 7);
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
  let generations = 0, reviews = 0, audits = 0, patches = 0, report;
  const result = await runModel(config, buildMessages(request), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
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
