import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { executionScope, executionSummary, runStage, reserveExecutionCall } from '../server/execution.mjs';
import { candidateDigest } from '../server/recovery-workbench.mjs';

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
  assert.equal(calls, 5, 'Give the controller a chance to inspect or patch after both full rewrites failed; invalid plans still stop');
  assert.deepEqual(events.filter(e => e.status === 'recovering').map(e => e.strategy), ['repair', 'reframe']);
});

test('failed repair and reframe do not disable inspection and a subsequent local fix', async () => {
  let calls = 0, planners = 0; const events = [];
  const result = await executionScope({ binding: 'late-patch', event: event => events.push(event) }, () => runStage({
    stage: 'parcel', messages, validate,
    complete: async (conversation, action) => {
      await reserveExecutionCall(); calls++;
      if (action !== 'recovery-plan') return JSON.stringify({ ...valid, labels: ['amber','amber','jade'] });
      const context = JSON.parse(conversation[1].content); planners++;
      if (planners === 1) return plan(conversation, 'reframe');
      if (planners === 2) return JSON.stringify({ failureId: context.failureId, strategy: 'inspect', cause: 'Both whole-result corrections retained a duplicate.', instruction: 'Read the actual candidate labels.', target: 'candidate', path: ['labels'], start: 0, length: 1000 });
      assert.match(conversation.at(-1).content, /amber/);
      return JSON.stringify({ failureId: context.failureId, strategy: 'patch', cause: 'The second field repeats amber while the source permits indigo.', instruction: 'Change only label 2 to indigo.',
        candidateDigest: candidateDigest(context.rejectedResult), operations: [{ op: 'set', path: ['labels',1], expected: 'amber', value: 'indigo' }] });
    },
  }));
  assert.deepEqual(result.value, valid);
  assert.deepEqual(events.filter(event => event.status === 'recovering').map(event => event.strategy), ['repair','reframe','patch']);
  assert.equal(calls, 6);
});

test('a method may be reused after new evidence, while a different caption alone cannot reopen it', async () => {
  let generated = 0, planners = 0;
  const result = await runStage({ stage: 'parcel', messages, validate, complete: async (conversation, action) => {
    await reserveExecutionCall();
    if (action !== 'recovery-plan') return JSON.stringify(++generated === 4 ? valid : { ...valid, labels: ['amber','amber','jade'] });
    const context = JSON.parse(conversation[1].content); planners++;
    if (planners <= 2) return plan(conversation, 'reframe');
    if (planners === 3) {
      assert.match(conversation.at(-1).content, /RECOVERY_NO_NEW_ACTION/);
      return JSON.stringify({ failureId: context.failureId, strategy: 'inspect', target: 'context', path: [0, 'content', 'labels'] });
    }
    assert.match(conversation.at(-1).content, /indigo/);
    return JSON.stringify({ failureId: context.failureId, strategy: 'reframe', cause: 'The previous reconstruction retained the repeated middle label.', instruction: 'Bind each output label by its position to the three distinct labels in the user context; do not copy the candidate label array.' });
  } });
  assert.deepEqual(result.value, valid); assert.equal(generated, 4); assert.equal(planners, 4);
});

test('actual call budget covers diagnostic calls and children without changing acceptance rules', async () => {
  let calls = 0;
  await assert.rejects(executionScope({ binding: 'budget', limits: { calls: 3 } }, () => runStage({
    stage: 'parcel', messages, validate,
    complete: async (conversation, action) => { await reserveExecutionCall(); calls++; return action === 'recovery-plan' ? plan(conversation) : '{}'; },
  })), e => e.code === 'EXECUTION_BLOCKED' && e.reason === 'budget');
  assert.equal(calls, 3);
});

test('production recovery completes more than 32 calls and 8 actions in one stage, and resumes with its statistics', async () => {
  const expected = Array.from({ length: 40 }, (_, index) => `source-${index}`);
  const input = [{ role: 'system', content: 'Copy every source value; preserve the title.' },
    { role: 'user', content: JSON.stringify({ source: expected }) }];
  let state, calls = 0;
  const execute = () => executionScope({ binding: 'forty-independent-defects', state, save: saved => { state = saved; } }, () => runStage({
    stage: 'recover-all-fields', messages: input, initialRaw: JSON.stringify({ title: 'Keep this', values: expected.map(() => null) }),
    preferLocalRecovery: true,
    validate: raw => {
      const value = JSON.parse(raw);
      const index = value.values.findIndex((item, i) => item !== expected[i]);
      assert.equal(value.title, 'Keep this');
      if (index !== -1) throw Object.assign(new Error('The indexed value disagrees with the source.'), {
        code: 'STAGE_CONTRACT', issues: [{ path: ['values', index], expected: expected[index] }],
      });
      return value;
    },
    complete: async (conversation, action) => {
      await reserveExecutionCall(); calls++;
      assert.equal(action, 'recovery-plan');
      const context = JSON.parse(conversation[1].content);
      assert.equal(context.budget.calls, null, 'No implicit quota is advertised to the controller');
      const { path, expected: value } = context.failure.issues[0];
      return JSON.stringify({ failureId: context.failureId, strategy: 'patch', cause: 'Correct the next source mismatch.',
        candidateDigest: candidateDigest(context.rejectedResult), operations: [{ op: 'set', path, expected: null, value }] });
    },
  }));
  const result = await execute();
  assert.deepEqual(result.value.values, expected);
  assert.equal(calls, 40); assert.equal(state.calls, 40); assert.equal(state.recoveries, 40);
  const resumed = await execute();
  assert.equal(resumed.reused, true); assert.equal(calls, 40);
  assert.equal(state.calls, 40); assert.equal(state.recoveries, 40);
});

test('a user can cancel after the former call limit and no further requests run', async () => {
  const controller = new AbortController(); let calls = 0, state;
  await assert.rejects(executionScope({ binding: 'cancel-long-task', save: saved => { state = saved; } }, async () => {
    for (let index = 0; index < 50; index++) {
      await runStage({ stage: `part-${index}`, messages, validate, signal: controller.signal,
        complete: async () => {
          await reserveExecutionCall(controller.signal); calls++;
          if (calls === 40) controller.abort();
          return JSON.stringify(valid);
        },
      });
    }
  }), { name: 'AbortError' });
  assert.equal(calls, 40);
  assert.equal(Object.values(state.stages).filter(stage => stage.status === 'accepted').length, 39);
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
