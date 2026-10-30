import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceExchange } from '../server/evidence-exchange.mjs';
import { recoveryInput, recoveryFailure, recoveryHistory } from '../server/recovery-context.mjs';
import { runStage, executionIssue, reserveExecutionCall } from '../server/execution.mjs';
import { inspectRecoveryCandidate } from '../server/recovery-workbench.mjs';
import { buildNoteReview, validateNoteReview } from '../server/note-review.mjs';
import { validateFollowup } from '../server/review-progress.mjs';
import { reviewEvidence } from '../server/review-evidence.mjs';
import { createDemo } from '../src/demo.ts';

const messagesFor = content => [{ role: 'system', content: 'Return the supported answer, retaining all evidence.' }, { role: 'user', content: JSON.stringify(content) }];
const sourceId = 'e249-0-c9569c66fee7', noteId = 'n10-c9569c66fee7';
test('wire aliases round-trip exact evidence references, never prose, quotes or unbound IDs', () => {
  const input = { source: [{ number: 249, excerpts: [{ id: sourceId, text: `Literal ${sourceId} and S1 remain unchanged.` }] }],
    blocks: [{ evidenceId: noteId, text: 'Do not rewrite B1.' }], analysis: { sourceEvidenceIds: [sourceId, 'unbound'] } };
  const messages = messagesFor(input), exchange = evidenceExchange(messages);
  const context = JSON.parse(exchange.messages[1].content);
  assert.equal(context.source[0].excerpts[0].id, 'S1'); assert.equal(context.blocks[0].evidenceId, 'B1');
  assert.deepEqual(context.analysis.sourceEvidenceIds, ['S1', 'unbound']);
  assert.equal(context.source[0].excerpts[0].text, input.source[0].excerpts[0].text);
  assert.deepEqual(JSON.parse(messages[1].content), input);
  assert.deepEqual(JSON.parse(exchange.restore(JSON.stringify({ sourceEvidenceIds: ['S1', 'S999', sourceId], noteEvidenceId: 'B1', text: 'S1', sourceQuote: 'B1' }))),
    { sourceEvidenceIds: [sourceId, 'S999', sourceId], noteEvidenceId: noteId, text: 'S1', sourceQuote: 'B1' });
  assert.equal(exchange.restore('{broken'), '{broken');
  assert.deepEqual(evidenceExchange(messages, false).messages, messages);
});

test('alias tables are request-local and stale/forged evidence still fails the real validator', () => {
  const document = createDemo(); document.pages = [{ number: 8, text: 'The source definition is precise and must be retained.' }];
  document.chapters = [{ id: 'c1', title: 'Definitions', sourcePages: [8] }];
  const request = { document, chapterId: 'c1', learning: { mode: 'adaptive', template: 'guided-v3' } };
  const candidate = { blocks: [{ type: 'paragraph', text: 'A wrong definition.', sourcePages: [8], sourceQuote: '' }] };
  const original = buildNoteReview(request, candidate), exchange = evidenceExchange(original), context = JSON.parse(exchange.messages[1].content);
  const result = { candidateDigest: context.binding.candidateDigest, verdict: 'revise', summary: 'Check the actual definition.', findings: [{ id: 'f1', dimension: 'grounding',
    target: { type: 'replace', index: 0 }, noteEvidenceId: 'B1', sourceEvidenceIds: ['S1'], problem: 'Definition contradicts source.', instruction: 'Restore the supported definition.' }] };
  const restored = exchange.restore(JSON.stringify(result));
  assert.equal(validateNoteReview(request, candidate, restored).findings[0].sourceEvidenceIds[0], reviewEvidence(request).source[0].excerpts[0].id);
  assert.equal(validateNoteReview(request, candidate, restored).checks.find(c => c.dimension === 'grounding').status, 'issue');
  const wireSchema = JSON.parse(original[0].content.slice(original[0].content.lastIndexOf('\n') + 1));
  assert.equal(wireSchema.anyOf.find(option => option.properties.verdict).properties.checks, undefined);
  result.findings[0].sourceEvidenceIds = ['S999'];
  assert.throws(() => validateNoteReview(request, candidate, exchange.restore(JSON.stringify(result))), { code: 'REVIEW_EVIDENCE_INVALID' });
  const changed = structuredClone(request); changed.document.pages[0].text = 'A changed source has a different content-bound reference.';
  const next = evidenceExchange(buildNoteReview(changed, candidate));
  assert.notEqual(JSON.parse(next.restore('{"sourceEvidenceIds":["S1"]}')).sourceEvidenceIds[0], JSON.parse(restored).findings[0].sourceEvidenceIds[0]);
  assert.throws(() => validateNoteReview(changed, candidate, restored), { code: 'REVIEW_EVIDENCE_INVALID' });
  const contradictory = JSON.parse(restored); contradictory.checks = ['goal', 'coverage', 'grounding', 'clarity'].map(dimension => ({ dimension, status: 'pass' }));
  assert.throws(() => validateNoteReview(request, candidate, contradictory), { code: 'REVIEW_CONTRACT' });
  assert.throws(() => validateNoteReview(request, candidate, { ...JSON.parse(restored), findings: [] }), error => {
    assert.deepEqual(error.issues[0].path, ['findings']); return true;
  });
});

test('large-context field repair uses one compact diagnosis, exact paths and original acceptance checks', async () => {
  const source = Array.from({ length: 80 }, (_, index) => ({ number: index + 1, text: `Page ${index}: ` + 'An original example with all its assumptions. '.repeat(200) }));
  const messages = messagesFor({ goal: 'Preserve the whole note.', source, specification: { expectedUnit: 'cm' } });
  const candidate = { unit: 'm', text: 'The accepted content must remain intact. '.repeat(800) };
  let calls = 0, size;
  const result = await runStage({ stage: 'new-unseen-task', messages, initialRaw: JSON.stringify(candidate),
    validate: raw => { const value = JSON.parse(raw); if (value.unit !== 'cm') throw executionIssue('Invalid unit', [{ path: ['unit'], expected: 'cm' }]); return value; },
    complete: async (conversation, stage) => {
      await reserveExecutionCall(); calls++; assert.equal(stage, 'recovery-plan');
      size = JSON.stringify(conversation).length;
      const context = JSON.parse(conversation[1].content);
      assert.equal(context.originalContext, undefined); assert.equal(context.rejectedResult, undefined);
      assert.deepEqual(context.focusedFields[0], { path: ['unit'], exists: true, value: 'm' });
      return JSON.stringify({ failureId: context.failureId, strategy: 'patch', targetDigest: context.candidateDigest,
        operations: [{ op: 'set', path: ['unit'], expected: 'm', value: 'cm' }] });
    } });
  assert.equal(calls, 1); assert.ok(size < JSON.stringify(messages).length / 10);
  assert.deepEqual(result.value, { ...candidate, unit: 'cm' });
  const inspected = inspectRecoveryCandidate(JSON.stringify(candidate), messages, { strategy: 'inspect', target: 'context', path: [0, 'content', 'source', 79, 'text'], start: 0, length: 6000 });
  assert.equal(inspected.excerpt, source[79].text.slice(0, 6000)); // full tail remains locally readable
});

test('long investigations keep a bounded active window and the complete saved journal without a retry quota', async () => {
  const candidate = { answer: 0, references: Array.from({ length: 30 }, (_, index) => `reference ${index}: ` + 'x'.repeat(5000)) };
  const messages = messagesFor({ answer: 37 }); let calls = 0, journal;
  const sizes = [];
  const result = await runStage({ stage: 'long-investigation', messages, initialRaw: JSON.stringify(candidate), save: value => { journal = value; }, preferLocalRecovery: true,
    validate: raw => { const value = JSON.parse(raw); if (value.answer !== 37) throw executionIssue('Wrong answer', [{ path: ['answer'], expected: 37 }]); return value; },
    complete: async (conversation, stage) => {
      await reserveExecutionCall(); calls++; assert.equal(stage, 'recovery-plan');
      sizes.push(JSON.stringify(conversation).length);
      const context = JSON.parse(conversation[1].content);
      assert.ok(conversation.length <= 4);
      if (calls <= 20) return JSON.stringify({ failureId: context.failureId, strategy: 'inspect', target: 'candidate', path: ['references', calls - 1], length: 6000 });
      if (calls === 21) {
        assert.match(conversation.at(-1).content, /reference 19/);
        return JSON.stringify({ failureId: context.failureId, strategy: 'inspect', target: 'candidate', path: ['references', 0], length: 6000 });
      }
      assert.match(conversation.at(-1).content, /reference 0:/);
      return JSON.stringify({ failureId: context.failureId, strategy: 'patch', targetDigest: context.candidateDigest,
        operations: [{ op: 'set', path: ['answer'], expected: 0, value: 37 }] });
    } });
  assert.equal(calls, 22); assert.equal(result.value.answer, 37);
  assert.equal(Object.values(journal.stages)[0].investigation.length, 22);
  assert.ok(Math.max(...sizes) < 65000, String(Math.max(...sizes)));
  assert.deepEqual(result.value.references, candidate.references);
});

test('follow-up contradictions identify the precise field and prior obligation before model investigation', () => {
  const previous = { findings: [{ id: 'f1', problem: 'Remove a duplicated paragraph.', target: { type: 'delete', index: 1 } }], changeMap: [{ findingId: 'f1', previousIndices: [1], currentIndices: [] }] };
  const review = { verdict: 'revise', findings: [], resolutions: [{ findingId: 'f1', status: 'unresolved', reason: 'Still unresolved.' }] };
  assert.throws(() => validateFollowup(review, previous), error => {
    assert.deepEqual(error.issues[0].path, ['resolutions', 0]);
    assert.equal(error.issues[0].expected.prior.id, 'f1'); return true;
  });
  const input = recoveryInput(messagesFor({ prior: previous }), JSON.stringify(review), { issues: [{ path: ['resolutions', 0] }] });
  assert.deepEqual(input.focusedFields[0].value, review.resolutions);
});

test('shared validator expectations are transmitted once while exact constraints and rejected strategies remain available', () => {
  const expected = Array.from({ length: 200 }, (_, index) => `e${index}-0-c9569c66fee7`);
  const failure = { code: 'UNSEEN_CONSTRAINT', message: 'Select actual evidence', issues: Array.from({ length: 12 }, (_, index) => ({ path: ['steps', index, 'sourceEvidenceIds'], expected })) };
  const compact = recoveryFailure(failure);
  assert.equal(Object.keys(compact.expectations).length, 1);
  assert.deepEqual(compact.expectations.expected1, expected);
  assert.ok(compact.issues.every(issue => issue.expected.lookup === 'failure.expectations.expected1'));
  assert.ok(JSON.stringify(compact).length < JSON.stringify(failure).length / 5);
  const history = recoveryHistory([{ strategy: 'reframe', cause: 'Concrete failed hypothesis', instruction: 'A distinct approach', failure }]);
  assert.equal(history[0].instruction, 'A distinct approach'); assert.equal(history[0].failure.issues.length, 12);
  assert.deepEqual(failure.issues[0].expected, expected);
});

test('task requirements remain complete after a large source regardless of context index order or goal length', () => {
  const goal = 'Keep this exact user requirement. '.repeat(220);
  const instruction = 'Preserve the requested deliverable and its scope.';
  const messages = messagesFor({ source: Array.from({ length: 200 }, () => ({ text: 'source '.repeat(1000) })), learningIntent: goal, instruction });
  const input = recoveryInput(messages, '{"blocks":[]}', { issues: [] });
  assert.equal(input.originalContext, undefined);
  assert.equal(input.taskContext[0].fields.learningIntent, goal);
  assert.equal(input.taskContext[0].fields.instruction, instruction);
});

test('references in malformed JSON are restored after exact syntax recovery before acceptance or checkpoint reuse', async () => {
  const messages = messagesFor({ source: [{ number: 249, excerpts: [{ id: sourceId, text: 'An exact source.' }] }] });
  let calls = 0, saved;
  const options = { stage: 'chapter-analysis', messages, initialRaw: '{"sourceEvidenceIds":["S1"]', preferLocalRecovery: true,
    save: value => { saved = value; },
    validate: raw => { const value = JSON.parse(raw); assert.deepEqual(value.sourceEvidenceIds, [sourceId]); return value; },
    complete: async conversation => {
      calls++; const context = JSON.parse(conversation[1].content);
      return JSON.stringify({ failureId: context.failureId, strategy: 'patch', targetDigest: context.candidateDigest,
        operations: [{ op: 'text', before: '["S1"]', after: '["S1"]}' }] });
    } };
  assert.deepEqual((await runStage(options)).value.sourceEvidenceIds, [sourceId]);
  assert.deepEqual(JSON.parse(Object.values(saved.stages)[0].raw).sourceEvidenceIds, [sourceId]);
  assert.equal((await runStage({ ...options, state: saved })).reused, true); assert.equal(calls, 1);
});
