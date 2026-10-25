import { confirmedAudit } from './support/review-audit.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.ts';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';
import { buildNoteReview, validateNoteReview } from '../server/note-review.mjs';
import { reviewEvidence, applyReviewEvidenceRepair } from '../server/review-evidence.mjs';
import { startWorkflow, workflowRequest } from '../shared/workflow-review.mjs';
import { preparationErrors } from '../shared/note-recovery.mjs';
import { prepareDocument } from '../shared/preparation.mjs';

const sourceText = 'Type I: reject a true null hypothesis. Type II: retain a false null hypothesis. PDF symbols: θ \uE020 0. 学习🕯️';
function fixture() {
  const document = createDemo();
  document.intent = '理解错误率控制';
  document.pages = [{ number: 31, sourcePage: 1, sourceTitle: 'Unit A', text: sourceText },
    { number: 213, sourcePage: 1, sourceTitle: 'Unit B', text: 'An independent reference with another original page 1.' }];
  document.chapters = [{ id: 'c1', title: '错误率', sourcePages: [31, 213], status: 'empty', content: { type: 'doc', content: [] } }];
  document.currentChapter = 'c1';
  const workflow = workflowRequest(startWorkflow(undefined, 1, 'always'), 'c1', 1, 0);
  const request = { action: 'generate', scope: 'chapter', composition: true, instruction: document.intent, revision: document.revision,
    chapterId: 'c1', document, learning: { mode: 'adaptive', template: 'guided-v3' }, workflow };
  const raw = { blocks: [{ type: 'paragraph', text: '第一类错误是没有拒绝错误的零假设。', sourcePages: [31], sourceQuote: sourceText },
    { type: 'paragraph', text: '这一段保留，讨论控制错误率的目的。', sourcePages: [213], sourceQuote: '' }] };
  return { request, raw, candidate: validateResult(request, raw) };
}
function findingReview(context, revise = true) {
  return { candidateDigest: context.binding.candidateDigest, verdict: revise ? 'revise' : 'accept',
    checks: ['goal', 'coverage', 'grounding', 'clarity'].map(dimension => ({ dimension, status: revise && dimension === 'grounding' ? 'issue' : 'pass' })),
    findings: revise ? [{ id: 'f1', dimension: 'grounding', target: { type: 'replace', index: 0 }, noteEvidenceId: context.blocks[0].evidenceId,
      sourceEvidenceIds: [context.source[0].excerpts[0].id], problem: '第一类与第二类错误混淆。', instruction: '只更正错误定义，保留其他内容。' }] : [],
    summary: revise ? '定义方向需要更正。' : '定义与原文一致。' };
}
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const config = { baseUrl: 'https://api.deepseek.com', model: 'test-only', apiKey: 'test-only' };

test('review evidence preserves complete PDF text, glyphs and distinct cross-file source IDs', () => {
  const { request } = fixture();
  request.document.pages[0].text = `${'x'.repeat(799)}🕯️ ${sourceText.repeat(60)}`;
  const evidence = reviewEvidence(request);
  for (const [index, page] of evidence.source.entries()) {
    assert.equal(page.excerpts.map(span => span.text).join(''), request.document.pages[index].text);
    assert.ok(page.excerpts.every(span => span.text.length <= 800 && !/[\uD800-\uDBFF]$/.test(span.text)));
    assert.ok(page.excerpts.every(span => evidence.byId.get(span.id).page === page.number));
  }
  assert.deepEqual(reviewEvidence(request).source, evidence.source);
  assert.notEqual(evidence.source[0].excerpts[0].id, evidence.source[1].excerpts[0].id);
});

test('review resolves selected evidence itself and rejects foreign, stale, duplicate or contradictory evidence', () => {
  const { request, candidate } = fixture(), context = JSON.parse(buildNoteReview(request, candidate)[1].content);
  const original = findingReview(context), resolved = validateNoteReview(request, candidate, original);
  assert.equal(resolved.findings[0].sourceQuote, sourceText);
  assert.deepEqual(resolved.findings[0].sourcePages, [31]);
  assert.deepEqual(validateNoteReview(request, candidate, resolved), resolved);
  assert.equal(resolved.findings[0].noteQuote, candidate.blocks[0].text);
  for (const mutation of [
    r => { r.findings[0].target.index = 1; },
    r => { r.findings[0].noteEvidenceId = 'n0-stale'; },
    r => { r.findings[0].noteQuote = 'a rewritten formula'; },
  ]) {
    const invalid = structuredClone(original); mutation(invalid);
    assert.throws(() => validateNoteReview(request, candidate, invalid), /正文片段/);
  }
  for (const mutate of [
    r => { r.findings[0].sourceEvidenceIds = ['invented-id']; },
    r => { r.findings[0].sourceEvidenceIds.push(r.findings[0].sourceEvidenceIds[0]); },
    r => { r.findings[0].sourcePages = [1]; },
    r => { r.findings[0].sourceQuote = 'The model rewrote PDF symbols.'; },
  ]) {
    const invalid = structuredClone(original); mutate(invalid);
    assert.throws(() => validateNoteReview(request, candidate, invalid), { code: 'REVIEW_EVIDENCE_INVALID', findingId: 'f1' });
  }
  const changed = structuredClone(request); changed.document.pages[0].text += ' updated';
  assert.throws(() => validateNoteReview(changed, candidate, original), { code: 'REVIEW_EVIDENCE_INVALID' });
  const segment = structuredClone(request); segment.document.pages = [segment.document.pages[1]];
  assert.throws(() => validateNoteReview(segment, candidate, original), { code: 'REVIEW_EVIDENCE_INVALID' });
});

test('evidence-only repair cannot change the verdict, finding, note target or candidate binding', () => {
  const { request, candidate } = fixture(), context = JSON.parse(buildNoteReview(request, candidate)[1].content), review = findingReview(context);
  const failure = { findingId: 'f1' }, valid = { candidateDigest: review.candidateDigest, edits: [{ findingId: 'f1', sourceEvidenceIds: review.findings[0].sourceEvidenceIds }] };
  const repaired = applyReviewEvidenceRepair(review, valid, failure);
  assert.equal(repaired.verdict, review.verdict);
  assert.deepEqual(repaired.findings[0].target, review.findings[0].target);
  assert.equal(repaired.findings[0].problem, review.findings[0].problem);
  for (const patch of [
    { ...valid, verdict: 'accept' }, { ...valid, candidateDigest: 'a'.repeat(64) }, { ...valid, edits: [] },
    { ...valid, edits: [{ ...valid.edits[0], findingId: 'f2' }] },
    { ...valid, edits: [{ ...valid.edits[0], instruction: 'Delete the problem' }] },
    { ...valid, edits: [valid.edits[0], valid.edits[0]] },
  ]) assert.throws(() => applyReviewEvidenceRepair(review, patch, failure));
});

test('an altered PDF quote is repaired as evidence, then the real content error is patched and rechecked within budget', async () => {
  const { request, raw } = fixture(), phases = [], events = []; let reviews = 0, report;
  const corrected = { ...raw.blocks[0], text: '第一类错误是拒绝真实的零假设；第二类错误是没有拒绝错误的零假设。' };
  const result = JSON.parse(await runModel(config, buildMessages(request), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content), system = messages[0].content;
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (system.startsWith('execution-recovery-plan-v1')) {
      phases.push('diagnose');
      assert.equal(context.failure.code,'REVIEW_EVIDENCE_INVALID');
      return response({failureId:context.failureId,strategy:'patch',targetDigest:context.toolState.targetDigest,
        operations:[{op:'set',path:['findings',0,'sourceQuote'],expected:sourceText.replace('\uE020','='),value:sourceText}]});
    }
    if (system.startsWith('note-self-review-v1')) {
      phases.push('review'); const review = findingReview(context, ++reviews <= 1);
      if (reviews === 1) {
        delete review.findings[0].sourceEvidenceIds;
        review.findings[0].sourcePages = [31];
        review.findings[0].sourceQuote = sourceText.replace('\uE020', '=');
      }
      return response(review);
    }
    if (system.startsWith('note-review-patch-v1')) {
      phases.push('patch');
      assert.equal(context.review.findings[0].sourceQuote, sourceText);
      return response({ candidateDigest: context.binding, changes: [{ findingId: 'f1', blocks: [corrected] }] });
    }
    phases.push('generate'); return response(raw);
  }, { action: 'generate', onWorkflowReport: value => { report = value; }, onCompletion: event => events.push(event) }));
  assert.deepEqual(phases, ['generate', 'review', 'diagnose', 'patch', 'review']);
  assert.equal(report.repairsUsed, 1); assert.equal(report.execution.recoveryActions, 1); assert.equal(report.outcome, 'accepted'); assert.equal(report.reviewCalls, 3);
  assert.equal(result.blocks[0].text, corrected.text);
  assert.deepEqual(result.blocks[1], validateResult(request, raw).blocks[1]);
  assert.ok(events.some(event => event.stage === 'note-review' && event.status === 'recovering'));
});

test('unresolvable evidence records the exact validator reason and stops without losing the finding or looping', async () => {
  const { request, raw } = fixture(), events = []; let calls = 0;
  await assert.rejects(runModel(config, buildMessages(request), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.startsWith('note-review-evidence-repair-v1'))
      return response({ candidateDigest: context.binding, edits: [{ findingId: 'f1', sourceEvidenceIds: ['unknown'] }] });
    if (messages[0].content.startsWith('note-self-review-v1')) {
      const review = findingReview(context); review.findings[0].sourceEvidenceIds = ['unknown']; return response(review);
    }
    return response(raw);
  }, { action: 'generate', onCompletion: event => events.push(event) }), error => error.code === 'WORKFLOW_REVIEW_FAILED' && error.workflow.repairsUsed === 0);
  assert.equal(calls, 7);
  assert.ok(events.some(event => event.status === 'validation-failed' && event.code === 'REVIEW_EVIDENCE_INVALID'));
});

test('generation and patch format recover without consuming the content correction budget or restarting prose', async () => {
  const { request, raw } = fixture(), events = []; let generates = 0, patches = 0, reviews = 0, calls = 0, report;
  const malformed = content => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  const corrected = { ...raw.blocks[0], text: '第一类错误是拒绝真实的零假设。' };
  const result = JSON.parse(await runModel(config, buildMessages(request), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content), system = messages[0].content;
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (system.startsWith('execution-recovery-plan-v1')) return response({failureId:context.failureId,strategy:'repair',
      cause:'修订返回含一个完整 JSON 后的多余内容。',instruction:'按原修订目标返回一个合法 JSON 对象，保留正确的修订内容。'});
    if (system.startsWith('note-self-review-v1')) return response(findingReview(context, reviews++ === 0));
    if (system.startsWith('note-review-patch-v1')) {
      const patch = { candidateDigest: context.binding, changes: [{ findingId: 'f1', blocks: [corrected] }] };
      if (++patches === 1) return malformed(JSON.stringify(patch) + ',{"findingId":"f2"}');
      assert.equal(JSON.parse(messages.at(-1).content).execution, 'stage-recovery-v1');
      assert.match(messages.at(-1).content, /Unexpected non-whitespace character/);
      return response(patch);
    }
    return ++generates === 1 ? malformed('{"blocks":[}') : response(raw);
  }, { action: 'generate', onCompletion: event => events.push(event), onWorkflowReport: value => { report = value; } }));
  assert.equal(calls, 8); assert.equal(generates, 2); assert.equal(patches, 2); assert.equal(reviews, 2);
  assert.equal(report.repairsUsed, 1); assert.equal(report.execution.recoveryActions, 2); assert.equal(report.outcome, 'accepted');
  assert.equal(result.blocks[0].text, corrected.text);
  assert.equal(result.blocks[1].text, raw.blocks[1].text);
  assert.ok(events.some(event => event.stage === 'note-review-patch' && event.status === 'validation-failed'));
});

test('a persistently fabricated patch cannot bypass reference checks through recovery', async () => {
  const { request, raw } = fixture(); let calls = 0;
  await assert.rejects(runModel(config, buildMessages(request), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.startsWith('note-self-review-v1')) return response(findingReview(context));
    if (messages[0].content.startsWith('note-review-patch-v1'))
      return response({ candidateDigest: context.binding, changes: [{ findingId: 'f1', blocks: [{ ...raw.blocks[0], sourcePages: [999] }] }] });
    return response(raw);
  }, { action: 'generate' }), error => error.code === 'WORKFLOW_REVIEW_FAILED' && error.workflow.repairsUsed === 1);
  assert.equal(calls, 9);
});

test('preparation distinguishes this attempt from inherited errors, including legacy records and ordinary failures', async () => {
  const { request } = fixture();
  const errors = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`c${i + 1}`, i ? '旧页码错误' : '本轮审查错误']));
  const state = startWorkflow(undefined, 8);
  const legacy = { errors, workflow: state, interruption: { chapterId: 'c1' } };
  assert.deepEqual(preparationErrors(legacy).current, [['c1', errors.c1]]);
  assert.equal(preparationErrors(legacy).previous.length, 7);
  assert.equal(preparationErrors({ errors, workflow: startWorkflow(state, 8) }).current.length, 0);
  let latest = { ...request.document, preparation: { startedAt: 1, settings: request.learning, completedIds: [], status: 'partial', errors: { c1: 'old' } } };
  const controller = new AbortController();
  await prepareDocument({ document: latest, settings: request.learning, getLatest: () => latest, save: async doc => { latest = doc; },
    request: async () => { throw new Error('Connection failed'); } });
  assert.deepEqual(latest.preparation.currentErrorIds, ['c1']);
  assert.deepEqual(preparationErrors(latest.preparation).current, [['c1', 'Connection failed']]);
  controller.abort();
  await prepareDocument({ document: latest, signal: controller.signal, getLatest: () => latest, save: async doc => { latest = doc; },
    request: async () => { assert.fail('No request after cancellation'); } });
  assert.equal(preparationErrors(latest.preparation).current.length, 0);
  assert.equal(preparationErrors(latest.preparation).previous.length, 1);
  await prepareDocument({ document: latest, getLatest: () => latest, save: async doc => { latest = doc; }, request: async () => fixture().candidate });
  assert.equal(latest.preparation.status, 'complete');
  assert.deepEqual(preparationErrors(latest.preparation), { current: [], previous: [] });
});
