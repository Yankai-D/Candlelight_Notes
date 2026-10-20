import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { executionScope, executionSummary, runStage, reserveExecutionCall } from '../server/execution.mjs';

const messages = [{ role: 'system', content: 'Return a parcel with capacity 17 and exactly three distinct labels.' },
  { role: 'user', content: JSON.stringify({ labels: ['amber', 'indigo', 'jade'] }) }];
const valid = { capacity: 17, labels: ['amber', 'indigo', 'jade'] };
const schema = z.object({ capacity: z.literal(17), labels: z.array(z.string()).length(3) }).strict();
const validate = raw => {
  const value = schema.parse(JSON.parse(raw));
  if (new Set(value.labels).size !== 3) throw Object.assign(new Error('Each label must be unique for this parcel.'), { code: 'UNSEEN_PARCEL_RULE' });
  return value;
};
const plan = (conversation, strategy = 'reframe') => JSON.stringify({
  failureId: JSON.parse(conversation[1].content).failureId, strategy,
  cause: 'The attempted correction preserved a duplicate label.',
  instruction: 'Reconstruct the three labels from the original input and check distinctness before returning.',
});

test('an unseen validator failure changes strategy and completes within one invocation', async () => {
  const actions = [], events = []; let parcelCalls = 0, journal;
  const result = await executionScope({ binding: 'parcel', save: state => { journal = state; }, event: e => events.push(e) }, () => runStage({
    stage: 'parcel', messages, validate,
    complete: async (conversation, action) => {
      await reserveExecutionCall(); actions.push(action);
      if (action === 'recovery-plan') {
        const context = JSON.parse(conversation[1].content);
        assert.equal(context.failure.code, 'UNSEEN_PARCEL_RULE');
        assert.equal(context.history[0].strategy, 'repair');
        return plan(conversation);
      }
      if (++parcelCalls === 3) {
        assert.equal(conversation.length, 3, 'Reframing uses a fresh conversation');
        return JSON.stringify(valid);
      }
      return JSON.stringify({ ...valid, labels: ['amber', 'amber', 'jade'] });
    },
  }));
  assert.deepEqual(result.value, valid);
  assert.deepEqual(actions, ['parcel', 'parcel', 'recovery-plan', 'parcel']);
  assert.deepEqual(events.filter(e => e.status === 'recovering').map(e => e.strategy), ['repair', 'reframe']);
  assert.equal(journal.calls, 4); assert.equal(journal.recoveries, 2);
});

test('checkpoint resumes a later stage without regenerating accepted work; changed input invalidates it', async () => {
  let state, firstCalls = 0, secondCalls = 0;
  const execute = (binding, fail = false) => executionScope({ binding, state, save: s => { state = s; } }, async () => {
    const first = await runStage({ stage: 'first', messages, validate, complete: async () => {
      await reserveExecutionCall(); firstCalls++; return JSON.stringify(valid);
    } });
    const second = await runStage({ stage: 'second', messages: [...messages, { role: 'user', content: JSON.stringify(first.value) }],
      validate, complete: async () => { await reserveExecutionCall(); secondCalls++; if (fail) throw Object.assign(new Error('Offline'), { code: 'MODEL_AUTH' }); return JSON.stringify(valid); } });
    return { first, second, summary: executionSummary() };
  });
  await assert.rejects(execute('same', true), { code: 'MODEL_AUTH' });
  const resumed = await execute('same');
  assert.equal(firstCalls, 1); assert.equal(secondCalls, 2); assert.equal(resumed.first.reused, true);
  assert.equal(resumed.summary.calls, 1);
  await execute('changed source');
  assert.equal(firstCalls, 2); assert.equal(secondCalls, 3);
});

test('recovery planner can only use supplied partition capability; merged result is revalidated', async () => {
  let partitions = 0, calls = 0;
  const result = await executionScope({ binding: 'partition' }, () => runStage({
    stage: 'parcel', messages, validate,
    complete: async (conversation, action) => {
      await reserveExecutionCall(); calls++;
      return action === 'recovery-plan' ? plan(conversation, 'partition') : '{"capacity":0}';
    },
    partition: async ({ run }) => {
      partitions++;
      const labels = [];
      for (const label of valid.labels) {
        const child = await run({ stage: 'label', messages: [{ role: 'user', content: label }],
          complete: async () => { await reserveExecutionCall(); calls++; return JSON.stringify(label); },
          validate: raw => z.literal(label).parse(JSON.parse(raw)) });
        labels.push(child.value);
      }
      return JSON.stringify({ capacity: 17, labels });
    },
  }));
  assert.deepEqual(result.value, valid); assert.equal(partitions, 1); assert.equal(calls, 6);
});

test('invalid controller output has bounded fallback; unchanged failures cannot loop indefinitely', async () => {
  const events = []; let calls = 0;
  await assert.rejects(executionScope({ binding: 'bad planner', event: e => events.push(e) }, () => runStage({
    stage: 'parcel', messages, validate,
    complete: async () => { await reserveExecutionCall(); calls++; return '{}'; },
  })), e => e.code === 'EXECUTION_BLOCKED' && e.reason === 'no-progress');
  assert.equal(calls, 5);
  assert.deepEqual(events.filter(e => e.status === 'recovering').map(e => e.strategy), ['repair', 'reframe']);
});

test('actual call budget covers diagnostic calls and children without changing acceptance rules', async () => {
  let calls = 0;
  await assert.rejects(executionScope({ binding: 'budget', limits: { calls: 3 } }, () => runStage({
    stage: 'parcel', messages, validate,
    complete: async (conversation, action) => { await reserveExecutionCall(); calls++; return action === 'recovery-plan' ? plan(conversation) : '{}'; },
  })), e => e.code === 'EXECUTION_BLOCKED' && e.reason === 'budget');
  assert.equal(calls, 3);
});

test('cancellation and provider failures never become content-repair prompts', async () => {
  for (const code of ['MODEL_AUTH', 'MODEL_NETWORK']) {
    let calls = 0;
    await assert.rejects(runStage({ stage: 'parcel', messages, validate,
      complete: async () => { calls++; throw Object.assign(new Error(code), { code }); } }), { code });
    assert.equal(calls, 1);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runStage({ stage: 'parcel', messages, validate, signal: controller.signal,
    complete: async () => assert.fail('Cannot call after cancellation') }), { name: 'AbortError' });
});

test('failed diagnostic persistence cannot discard valid output; cached data is always revalidated', async () => {
  let state, calls = 0;
  const first = await executionScope({ binding: 'save', save: s => { state = s; throw new Error('EPERM'); }, event: () => { throw new Error('observer'); } }, () => runStage({
    stage: 'parcel', messages, validate, complete: async () => JSON.stringify(valid),
  }));
  assert.deepEqual(first.value, valid);
  Object.values(state.stages)[0].raw = JSON.stringify({ ...valid, capacity: 1 });
  const second = await executionScope({ binding: 'save', state }, () => runStage({
    stage: 'parcel', messages, validate, complete: async () => { calls++; return JSON.stringify(valid); },
  }));
  assert.equal(calls, 1); assert.deepEqual(second.value, valid); assert.equal(second.reused, false);
});
