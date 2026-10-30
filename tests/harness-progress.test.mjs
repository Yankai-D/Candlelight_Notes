import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStage, executionIssue, reserveExecutionCall } from '../server/execution.mjs';
import { recoveryFrontier, progressTracker } from '../server/recovery-progress.mjs';

const messages = [{ role: 'system', content: 'Use the supported answer.' }, { role: 'user', content: '{"answer":37}' }];
const validate = raw => { const value = JSON.parse(raw); if (value.answer !== 37) throw executionIssue('Wrong answer', [{ path: ['answer'], expected: 37 }]); return value; };

test('paraphrased repair instructions and changes outside the failing field cannot cause endless rewrites', async () => {
  for (const noise of [false, true]) {
    let plans = 0, writes = 0, checkpoint;
    await assert.rejects(runStage({ stage: 'same-defect', messages, initialRaw: '{"answer":0}', preferLocalRecovery: true, validate,
      save: value => { checkpoint = value; }, complete: async (conversation, action) => {
        await reserveExecutionCall(); assert.ok(plans + writes < 16, 'The test abort guard is not a production quota');
        if (action === 'recovery-plan') {
          const context = JSON.parse(conversation[1].content);
          return JSON.stringify({ failureId: context.failureId, strategy: 'repair', cause: 'Another caption', instruction: `Reconsider the same result ${++plans}` });
        }
        writes++; return JSON.stringify({ answer: 0, ...(noise ? { unrelated: `Change ${writes}` } : {}) });
      } }), error => error.code === 'EXECUTION_BLOCKED' && error.reason === 'no-progress');
    assert.equal(writes, 2, 'One failed repair and a different fallback approach; no repeated unchanged approach');
    assert.ok(Object.values(checkpoint.stages)[0].progress.rejectedCandidates);
    let resumedWrites = 0;
    await assert.rejects(runStage({ stage: 'same-defect', messages, state: checkpoint, preferLocalRecovery: true, validate,
      complete: async (conversation, action) => {
        if (action !== 'recovery-plan') { resumedWrites++; return '{"answer":0}'; }
        const context = JSON.parse(conversation[1].content);
        return JSON.stringify({ failureId: context.failureId, strategy: 'repair', cause: 'New session caption', instruction: 'Try the same thing after restart' });
      } }), { reason: 'no-progress' });
    assert.equal(resumedWrites, 0);
  }
});

test('the controller changes to a local patch in the same request after an unchanged whole-result attempt', async () => {
  let plans = 0, writes = 0;
  const result = await runStage({ stage: 'switch-approach', messages, initialRaw: '{"answer":0}', preferLocalRecovery: true, validate,
    complete: async (conversation, action) => {
      if (action !== 'recovery-plan') { writes++; return '{"answer":0}'; }
      const context = JSON.parse(conversation[1].content); plans++;
      if (plans <= 2) return JSON.stringify({ failureId: context.failureId, strategy: 'repair', cause: 'Same failure', instruction: `Reworded instruction ${plans}` });
      assert.match(conversation.at(-1).content, /RECOVERY_NO_NEW_ACTION/);
      return JSON.stringify({ failureId: context.failureId, strategy: 'patch', targetDigest: context.candidateDigest,
        operations: [{ op: 'set', path: ['answer'], expected: 0, value: 37 }] });
    } });
  assert.equal(result.value.answer, 37); assert.equal(writes, 1); assert.equal(plans, 3);
});

test('progress is content-bound, meaningful reads reopen methods, and empty searches do not', () => {
  const entry = {}, failure = { code: 'NEW', issues: [{ path: ['answer'], expected: 37 }] };
  const tracker = progressTracker(entry, '{"answer":0,"aside":"a"}', failure); tracker.attempted('repair');
  assert.equal(tracker.blocked('repair'), true);
  assert.equal(recoveryFrontier('{"aside":"b","answer":0}', failure), tracker.frontier);
  assert.equal(tracker.observe({ target: 'context', query: 'unseen', matches: [] }), false);
  assert.equal(tracker.blocked('repair'), true);
  assert.equal(tracker.observe({ target: 'context', value: { answer: 37 } }), true);
  assert.equal(tracker.blocked('repair'), false); tracker.attempted('repair');
  assert.equal(tracker.observe({ target: 'context', value: { answer: 37 }, start: 500 }), false);
  assert.equal(tracker.blocked('repair'), true);
  assert.equal(progressTracker(entry, '{"answer":20}', failure).blocked('repair'), false);
  for (let i = 1; i <= 30; i++) progressTracker(entry, JSON.stringify({ answer: i }), failure);
  assert.equal(progressTracker(entry, '{"answer":31}', failure).seenCandidate('{"aside":"a","answer":0}'), true);
});
