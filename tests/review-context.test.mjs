import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewContext, validateReviewScope, checkReviewContextRequest } from '../server/review-context.mjs';
import { candidateDigest } from '../server/note-revision.mjs';
import { reviewNoteSegment, buildNoteReview } from '../server/note-review.mjs';
import { buildReviewAudit } from '../server/note-review-audit.mjs';

const fixture = () => {
  const pages = Array.from({ length: 40 }, (_, index) => ({ number: index + 1, text: `Source ${index + 1}: ` + 'The definition requires independent observations. '.repeat(80) }));
  const candidate = { blocks: pages.map(page => ({ type: 'paragraph', text: `Paragraph ${page.number}. Preserve its content.`, sourcePages: [page.number], sourceQuote: '' })) };
  const request = { learning: { mode: 'adaptive', template: 'guided-v3' }, chapterId: 'c1', revision: 0, instruction: 'Fix the one wrong definition.',
    document: { title: 'Review', intent: 'Keep the assumptions.', pages, chapters: [{ id: 'c1', title: 'Definitions', sourcePages: pages.map(p => p.number) }] } };
  const finding = { id: 'f1', dimension: 'clarity', target: { type: 'replace', index: 20 }, noteQuote: candidate.blocks[20].text,
    sourcePages: [21], sourceQuote: '', problem: 'This definition is unclear.', instruction: 'Clarify it without changing the other content.' };
  const previous = { findings: [finding], changeMap: [{ findingId: 'f1', previousIndices: [20], currentIndices: [20] }],
    unchangedMap: candidate.blocks.flatMap((_, index) => index === 20 ? [] : [{ previousIndex: index, currentIndex: index }]) };
  return { request, candidate, finding, previous };
};

test('incremental review and advice auditing retain exact indices and sources with much smaller input', () => {
  const { request, candidate, finding, previous } = fixture();
  const full = buildNoteReview(request, candidate), partial = buildNoteReview(request, candidate, [], previous);
  const context = JSON.parse(partial[1].content);
  assert.deepEqual(context.blocks.map(b => b.index), [19, 20, 21]);
  assert.deepEqual(context.source.map(page => page.number), [20, 21, 22]);
  assert.match(context.blocks[1].evidenceId, /^n20-/);
  assert.ok(JSON.stringify(partial).length < JSON.stringify(full).length / 3);
  const review = { candidateDigest: candidateDigest(candidate), findings: [finding] };
  const audit = JSON.parse(buildReviewAudit(request, candidate, review)[1].content);
  assert.deepEqual(audit.blocks.map(b => b.index), [19, 20, 21]);
  assert.equal(audit.binding, candidateDigest(candidate));
  assert.throws(() => validateReviewScope({ findings: [{ ...finding, target: { type: 'replace', index: 2 } }] }, reviewContext(request, candidate, { previous })), { code: 'REVIEW_CONTEXT' });
});

test('deletion checks its surviving neighbours, shared learning units stay visible, and coverage keeps all source', () => {
  const { request, candidate, finding, previous } = fixture();
  candidate.blocks[20].learningUnitId = 'k1'; candidate.blocks[3].learningUnitId = 'k1';
  const related = reviewContext(request, candidate, { previous }); assert.ok(related.contextScope.blockIndices.includes(3));
  const coverage = reviewContext(request, candidate, { findings: [{ ...finding, dimension: 'coverage' }] });
  assert.equal(coverage.source.length, request.document.pages.length);
  const deleted = { blocks: candidate.blocks.filter((_, index) => index !== 20) };
  const deletion = { ...previous, changeMap: [{ findingId: 'f1', previousIndices: [20], currentIndices: [] }],
    unchangedMap: previous.unchangedMap.map(item => ({ ...item, currentIndex: item.previousIndex > 20 ? item.previousIndex - 1 : item.previousIndex })) };
  const context = reviewContext(request, deleted, { previous: deletion });
  assert.ok(context.contextScope.blockIndices.includes(19)); assert.ok(context.contextScope.blockIndices.includes(20));
});

test('review and audit request full context within one task, then retain all unaffected prose', async () => {
  const { request, candidate, finding } = fixture(); let reviews = 0, audits = 0, writes = 0;
  const events = [];
  const result = await reviewNoteSegment({ request, candidate, validate: value => value, consumeRepair: () => {}, event: event => events.push(event),
    complete: async (messages, action) => {
      const context = JSON.parse(messages[1].content);
      assert.notEqual(action, 'recovery-plan', 'Explicit context expansion needs no extra diagnosis');
      if (action === 'note-review') {
        reviews++;
        if (reviews === 1) return JSON.stringify({ candidateDigest: context.binding.candidateDigest, verdict: 'revise', findings: [finding], summary: 'One supported defect.' });
        if (context.contextScope.focused) return JSON.stringify({ candidateDigest: context.binding.candidateDigest, needsContext: true, reason: 'Check the distant definition before accepting.' });
        assert.equal(context.blocks.length, 40);
        return JSON.stringify({ candidateDigest: context.binding.candidateDigest, verdict: 'accept', findings: [], summary: 'The change is correct and all other content is retained.' });
      }
      if (action === 'note-review-audit') {
        audits++;
        if (context.contextScope.focused) return JSON.stringify({ candidateDigest: context.binding, needsContext: true, reason: 'The meaning depends on a distant paragraph.' });
        return JSON.stringify({ candidateDigest: context.binding, decisions: [{ findingId: 'f1', verdict: 'confirm', sourceEvidenceIds: [], reason: 'The full context supports this specific clarification without any other changes.' }] });
      }
      assert.equal(action, 'note-review-patch'); writes++;
      return JSON.stringify({ candidateDigest: context.binding, edits: [{ findingId: 'f1', type: 'paragraph', text: 'The definition and its assumptions are now clear.', sourcePages: [21], sourceQuote: '' }] });
    } });
  assert.equal(reviews, 3); assert.equal(audits, 2); assert.equal(writes, 1);
  assert.equal(events.filter(e => /context-expanded$/.test(e.phase)).length, 2);
  assert.deepEqual(result.blocks.filter((_, i) => i !== 20), candidate.blocks.filter((_, i) => i !== 20));
});

test('full-context requests are candidate-bound and cannot repeat after expansion', () => {
  const { request, candidate, previous } = fixture();
  assert.throws(() => checkReviewContextRequest({ candidateDigest: 'a'.repeat(64), needsContext: true, reason: 'More detail' }, candidate, reviewContext(request, candidate, { previous })), { code: 'REVIEW_CONTEXT' });
  assert.throws(() => checkReviewContextRequest({ candidateDigest: candidateDigest(candidate), needsContext: true, reason: 'More detail' }, candidate, reviewContext(request, candidate, { previous, full: true })), { code: 'REVIEW_CONTEXT' });
});
