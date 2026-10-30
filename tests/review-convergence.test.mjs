import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.ts';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';
import { candidateDigest, applyRevision, validateRevisionTargets } from '../server/note-revision.mjs';
import { buildNoteReview, validateNoteReview } from '../server/note-review.mjs';
import { validateFollowup } from '../server/review-progress.mjs';
import { revisionContext } from '../server/revision-context.mjs';
import { generationUsage } from '../shared/generation-usage.mjs';
import { startWorkflow, workflowRequest } from '../shared/workflow-review.mjs';
import { validateLectureCoverage } from '../shared/lecture-synthesis.mjs';
import { confirmedAudit } from './support/review-audit.mjs';

const p = (text, sourcePages = [8]) => ({ type: 'paragraph', text, sourcePages, sourceQuote: '' });
const original = { blocks: [p('定义及其成立条件。'), p('重复的定义。'), p('独立例题及其答案。'), p('另一处重复定义。')] };
const finding = (id, type, index, indices) => ({ id, dimension: 'clarity', target: { type, index, ...(indices ? { indices } : {}) },
  problem: '同一知识重复讲述。', instruction: '保留独有条件，整合冗余内容。', sourcePages: [], sourceQuote: '' });
const reviewOf = (candidate, findings) => ({ candidateDigest: candidateDigest(candidate), verdict: findings.length ? 'revise' : 'accept',
  checks: ['goal', 'coverage', 'grounding', 'clarity'].map(dimension => ({ dimension, status: findings.some(f => f.dimension === dimension) ? 'issue' : 'pass' })), findings, summary: '检查实际修改与信息保留。' });
function fixture() {
  const document = createDemo(); document.intent = '合并重复讲解，保留公式条件和例题，整理精简笔记';
  document.pages = [{ number: 8, text: 'The method requires independent observations. Keep the assumptions and worked example.' }];
  document.chapters = [{ id: 'c1', title: '知识整理', sourcePages: [8], status: 'empty', content: { type: 'doc', content: [] } }];
  document.currentChapter = 'c1';
  return { action: 'generate', scope: 'chapter', chapterId: 'c1', document, revision: document.revision,
    instruction: document.intent, composition: true, learning: { mode: 'adaptive', template: 'guided-v3' },
    workflow: workflowRequest(startWorkflow(undefined, 1, 'always'), 'c1', 1, 0) };
}
const config = { baseUrl: 'https://api.deepseek.com', model: 'test-only', apiKey: 'test-only' };
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
  usage: { prompt_tokens: 120, completion_tokens: 20, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 40 } }));
function anchored(context, findings) {
  return { ...reviewOf({ blocks: context.blocks }, findings.map(f => ({ ...f, noteEvidenceId: context.blocks[f.target.index].evidenceId }))), candidateDigest: context.binding.candidateDigest };
}

test('non-adjacent merge and deletion are one atomic edit, preserving untouched examples and exact mappings', () => {
  const candidate = structuredClone(original), review = reviewOf(candidate, [finding('f1', 'merge', 0, [0, 1]), finding('f2', 'delete', 3)]);
  const result = applyRevision(candidate, review, { candidateDigest: review.candidateDigest,
    edits: [{ findingId: 'f1', ...p('定义与成立条件一次讲清。') }, { findingId: 'f2', type: 'delete' }] });
  assert.deepEqual(result.candidate.blocks, [p('定义与成立条件一次讲清。'), original.blocks[2]]);
  assert.deepEqual(result.changeMap.map(c => [c.previousIndices, c.currentIndices]), [[[0, 1], [0]], [[3], []]]);
  assert.deepEqual(result.unchangedMap, [{ previousIndex: 2, currentIndex: 1 }]);
  assert.deepEqual(candidate, original);
  const nonAdjacent = reviewOf(candidate, [finding('f1', 'merge', 1, [1, 3])]);
  assert.deepEqual(applyRevision(candidate, nonAdjacent, { candidateDigest: nonAdjacent.candidateDigest,
    edits: [{ findingId: 'f1', ...p('合并两个远处段落。') }] }).candidate.blocks.map(b => b.text), [candidate.blocks[0].text, '合并两个远处段落。', candidate.blocks[2].text]);
});

test('delete/merge reject stale identity, overlap and empty replacement; lost role evidence stays visible to follow-up review', () => {
  const deletion = reviewOf(original, [finding('f1', 'delete', 1)]);
  assert.throws(() => applyRevision(original, deletion, { candidateDigest: 'a'.repeat(64), edits: [{ findingId: 'f1', type: 'delete' }] }));
  assert.throws(() => applyRevision(original, deletion, { candidateDigest: deletion.candidateDigest, edits: [{ findingId: 'f1', ...p('占位句') }] }), { code: 'REVISION_SCOPE' });
  const replace = reviewOf(original, [finding('f1', 'replace', 1)]);
  assert.throws(() => applyRevision(original, replace, { candidateDigest: replace.candidateDigest, changes: [{ findingId: 'f1', blocks: [] }] }), { code: 'REVISION_SCOPE' });
  assert.throws(() => validateRevisionTargets(original, [finding('f1', 'merge', 0, [0, 1]), finding('f2', 'delete', 1)]), { code: 'REVISION_OVERLAP' });
  for (const target of [{ type: 'merge', index: 1, indices: [0, 1] }, { type: 'merge', index: 0, indices: [0, 9] }, { type: 'delete', index: -1 }])
    assert.throws(() => validateRevisionTargets(original, [{ ...finding('f1', 'replace', 0), target }]), { code: 'REVISION_SCOPE' });
  const candidate = { blocks: [p('仅此处有方法。'), { ...p('定义。'), learningUnitId: 'k1', learningRoles: ['concept'] }] };
  candidate.blocks[0].learningUnitId = 'k1'; candidate.blocks[0].learningRoles = ['method'];
  const result = applyRevision(candidate, reviewOf(candidate, [finding('f1', 'delete', 0)]), { candidateDigest: candidateDigest(candidate), edits: [{ findingId: 'f1', type: 'delete' }] });
  assert.deepEqual(validateLectureCoverage({ units: [{ id: 'k1', method: ['步骤'], examples: [], variants: [] }] }, result.candidate.blocks).gaps,[{learningUnitId:'k1',learningRole:'method'}]);
  const all = reviewOf(original, original.blocks.map((_, i) => finding(`f${i + 1}`, 'delete', i)));
  assert.throws(() => applyRevision(original, all, { candidateDigest: all.candidateDigest, edits: all.findings.map(f => ({ findingId: f.id, type: 'delete' })) }), { code: 'REVISION_EMPTY' });
});

test('audited duplicate deletions complete without a writer call or replacement filler, then verify the effect', async () => {
  let calls = 0, reviews = 0; const events = [];
  const raw = await runModel(config, buildMessages(fixture()), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.startsWith('note-self-review-v1')) {
      if (reviews++ === 0) return response(anchored(context, [finding('f1', 'delete', 1), finding('f2', 'delete', 3)]));
      assert.deepEqual(context.blocks.map(b => b.text), [original.blocks[0].text, original.blocks[2].text]);
      assert.ok(context.revisionReview.changeMap.every(c => c.currentIndices.length === 0));
      return response(anchored(context, []));
    }
    assert.ok(!messages[0].content.startsWith('note-review-patch-v1'));
    return response(original);
  }, { action: 'generate', onCompletion: e => events.push(e) });
  assert.equal(calls, 4); assert.equal(JSON.parse(raw).blocks.length, 2);
  assert.ok(events.find(e => e.phase === 'review-progress').issues.every(i => i.status === 'resolved'));
  const usage = generationUsage(events);
  assert.equal(usage.reduce((n, e) => n + e.inputTokens, 0), 480);
  assert.equal(usage.reduce((n, e) => n + e.cacheHitTokens, 0), 320);
  assert.ok(usage.every(e => e.timedCalls === e.completions));
});

test('merge is audited, written once and checked for retained conditions instead of cycling on paraphrased duplicates', async () => {
  let calls = 0, reviews = 0, patches = 0;
  const raw = await runModel(config, buildMessages(fixture()), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.startsWith('note-self-review-v1')) {
      if (reviews++ === 0) return response(anchored(context, [finding('f1', 'merge', 0, [0, 1, 3])]));
      assert.deepEqual(context.revisionReview.changeMap[0].previousIndices, [0, 1, 3]);
      return response(anchored(context, []));
    }
    if (messages[0].content.startsWith('note-review-patch-v1')) { patches++; return response({ candidateDigest: context.binding,
      edits: [{ findingId: 'f1', ...p('定义、独立观测的条件与推导一次讲清。') }] }); }
    return response(original);
  }, { action: 'generate' });
  assert.equal(calls, 5); assert.equal(patches, 1); assert.equal(JSON.parse(raw).blocks.length, 2);
  assert.equal(JSON.parse(raw).blocks[1].text, original.blocks[2].text);
});

test('follow-up explicitly resolves old issues, permits real regressions and missed facts, and rejects free-form style churn', () => {
  const previous = { findings: [finding('f1', 'replace', 0)], changeMap: [{ findingId: 'f1', currentIndices: [0] }] };
  const candidate = structuredClone(original), review = reviewOf(candidate, [{ ...finding('f2', 'replace', 0), problem: '换个说法但问题未解决。', priorFindingId: 'f1' }]);
  review.resolutions = [{ findingId: 'f1', status: 'unresolved', reason: '定义仍然重复。' }];
  assert.equal(validateFollowup(review, previous).findings[0].priorFindingId, 'f1');
  const invalid = structuredClone(review); invalid.resolutions[0].status = 'resolved'; assert.throws(() => validateFollowup(invalid, previous), { code: 'REVIEW_PROGRESS' });
  const regression = reviewOf(candidate, [{ ...finding('f2', 'replace', 2), introducedBy: ['f1'] }]);
  regression.resolutions = [{ findingId: 'f1', status: 'resolved', reason: '原问题已改，但影响了下文。' }];
  assert.doesNotThrow(() => validateFollowup(regression, previous));
  const churn = structuredClone(regression); delete churn.findings[0].introducedBy;
  assert.throws(() => validateFollowup(churn, previous), { code: 'REVIEW_PROGRESS' });
  churn.findings[0].dimension = 'grounding'; churn.findings[0].sourceEvidenceIds = ['actual-evidence'];
  assert.doesNotThrow(() => validateFollowup(churn, previous));
  churn.resolutions.push(churn.resolutions[0]); assert.throws(() => validateFollowup(churn, previous), { code: 'REVIEW_PROGRESS' });
});

test('local revision keeps source text exact, original block identities and a complete-context recovery option', () => {
  const request = fixture(); request.document.pages = Array.from({ length: 40 }, (_, i) => ({ number: i + 8, text: `source ${i}: ` + 'evidence '.repeat(300) }));
  request.document.chapters[0].sourcePages = request.document.pages.map(p => p.number);
  const candidate = { blocks: Array.from({ length: 40 }, (_, i) => p(`正文 ${i}`, [i + 8])) };
  const review = reviewOf(candidate, [finding('f1', 'replace', 20)]), focused = revisionContext(request, candidate, review);
  assert.deepEqual(focused.blocks.map(b => b.index), [19, 20, 21]);
  assert.deepEqual(focused.source, [request.document.pages[20]]);
  const full = revisionContext(request, candidate, review, false);
  assert.equal(full.source.length, 40); assert.equal(full.blocks.length, 40);
  assert.ok(JSON.stringify(focused).length < JSON.stringify(full).length / 10);
  review.findings[0].dimension = 'coverage'; assert.equal(revisionContext(request, candidate, review).source.length, 40);
});

test('usage separates cache reporting from missing legacy fields and excludes non-completion events', () => {
  const usage = generationUsage([{ promptTokens: 10, completionTokens: 2 }, { phase: 'execution', stage: 'review' },
    { stage: 'generate', promptTokens: 100, completionTokens: 20, cacheHitTokens: 80, cacheMissTokens: 20, elapsedMs: 30 }]);
  assert.equal(usage.length, 2); assert.equal(usage[0].stage, 'unclassified-legacy'); assert.equal(usage[0].cacheReportedCalls, 0);
  assert.equal(usage[1].cacheReportedCalls, 1); assert.equal(usage[1].elapsedMs, 30);
});

test('accepted merge and its issue history resume after cancellation without paying for generation, audit or patch again', async () => {
  const request = fixture(), controller = new AbortController(); let checkpoint, calls = 0, reviews = 0;
  const fetcher = async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.startsWith('note-self-review-v1')) {
      if (reviews++ === 0) return response(anchored(context, [finding('f1', 'merge', 0, [0, 1, 3])]));
      assert.equal(context.settledIssues[0].id, 'issue-1');
      return response(anchored(context, []));
    }
    if (messages[0].content.startsWith('note-review-patch-v1')) return response({ candidateDigest: context.binding,
      edits: [{ findingId: 'f1', ...p('合并后的定义和全部条件。') }] });
    return response(original);
  };
  await assert.rejects(runModel(config, buildMessages(request), controller.signal, fetcher, {
    saveCheckpoint: state => { checkpoint = state; }, onCompletion: event => {
      if (event.phase === 'execution' && event.stage === 'note-review-patch' && event.status === 'accepted') controller.abort();
    },
  }), { name: 'AbortError' });
  assert.equal(calls, 4);
  const raw = await runModel(config, buildMessages(request), undefined, fetcher, { checkpoint });
  assert.equal(calls, 5); assert.equal(JSON.parse(raw).blocks.length, 2);
});

test('a compact revision can expand to full context through recovery without replaying accepted generation', async () => {
  const request = fixture(); request.document.pages.push({ number: 9, text: 'Additional context for this one revision.' });
  request.document.chapters[0].sourcePages.push(9);
  const candidate = { blocks: Array.from({ length: 20 }, (_, i) => p(`已生成内容 ${i}。`)) };
  let reviews = 0, writers = 0, generations = 0;
  const result = await runModel(config, buildMessages(request), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content), system = messages[0].content;
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (system.startsWith('note-self-review-v1')) return response(anchored(context, reviews++ === 0 ? [finding('f1', 'replace', 10)] : []));
    assert.ok(!system.startsWith('execution-recovery-plan-v1'), 'Explicit context requests need no diagnostic model call');
    if (system.startsWith('note-review-patch-v1')) {
      writers++;
      if (context.contextScope.focused) { assert.equal(context.blocks.length, 3); return response({ candidateDigest: context.binding, needsContext: true, reason: 'Need the complete definition from an omitted source page.' }); }
      assert.equal(context.blocks.length, 20); assert.equal(context.source.length, 2);
      return response({ candidateDigest: context.binding, edits: [{ findingId: 'f1', ...p('根据完整上下文修正本段。') }] });
    }
    generations++; return response(candidate);
  });
  assert.equal(generations, 1); assert.equal(writers, 2); assert.equal(JSON.parse(result).blocks[10].text, '根据完整上下文修正本段。');
});
