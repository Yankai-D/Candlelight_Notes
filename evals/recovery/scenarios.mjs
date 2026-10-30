import assert from 'node:assert/strict';
import { executionScope, executionIssue, runStage, reserveExecutionCall } from '../../server/execution.mjs';
import { recoveryScope, recoverOperation } from '../../server/recovery.mjs';

// Original synthetic contracts only. No files, credentials, network or model SDK.
const messages = [{ role: 'system', content: 'Return JSON with answer=37 and retain the requested explanation.' },
  { role: 'user', content: '{"task":"synthetic-recovery-evaluation"}' }];
const good = JSON.stringify({ answer: 37, explanation: 'An accepted synthetic answer.' });
const bad = revision => JSON.stringify({ answer: 0, explanation: `Changed wording ${revision}` });
function validate(raw) {
  const value = JSON.parse(raw);
  if (value.answer !== 37) throw executionIssue('Answer does not meet the input contract.',
    [{ path: ['answer'], code: 'value_mismatch', expected: 37, message: `Received ${value.answer}` }]);
  return value;
}
const controllerPlan = (conversation, strategy) => JSON.stringify({
  failureId: JSON.parse(conversation[1].content).failureId, strategy,
  cause: 'The previous candidate still violates the field constraint.',
  instruction: 'Re-derive the answer from the original task while retaining its explanation.',
});
function rig() {
  const observed = { calls: 0, plannerCalls: 0, actions: [], strategies: [], accepted: [], reused: [], checkpoints: 0 };
  return {
    observed,
    complete: callback => async (conversation, action) => {
      await reserveExecutionCall(); observed.calls++; observed.actions.push(action);
      if (action === 'recovery-plan') observed.plannerCalls++;
      return callback(conversation, action);
    },
    run: async (operation, options = {}) => {
      try {
        observed.result = await executionScope({ binding: 'synthetic-evaluation',
          save: state => { observed.checkpoints++; observed.state = state; },
          event: event => {
            if (event.status === 'recovering') observed.strategies.push(event.strategy);
            if (event.status === 'accepted') observed.accepted.push(event.stage);
            if (event.status === 'reused') observed.reused.push(event.stage);
          }, ...options }, operation);
        observed.outcome = 'accepted';
      } catch (error) {
        observed.outcome = 'stopped';
        observed.error = { name: error.name, code: error.code, reason: error.reason, message: error.message,
          budgetType: error.budgetType, persistence: error.persistence };
      }
      return observed;
    },
  };
}
const accepted = result => { assert.equal(result.outcome, 'accepted', JSON.stringify(result.error)); assert.equal(result.result.value.answer, 37); };
const stopped = (result, code) => { assert.equal(result.outcome, 'stopped'); assert.equal(result.error.code, code); assert.equal(result.accepted.length, 0); };

export const recoveryScenarios = [
  {
    id: 'cosmetic-churn', title: '同一约束反复失败，措辞变化不算进展', expectation: 'recover',
    async execute() {
      const r = rig(); let revisions = 0;
      return r.run(() => runStage({ stage: 'answer', messages, validate,
        complete: r.complete((conversation, action) => {
          if (action === 'recovery-plan') return controllerPlan(conversation, 'repair');
          return conversation.at(-1).content.includes('previousResult') ? good : bad(++revisions);
        }) }));
    },
    verify(r) { accepted(r); assert.deepEqual(r.strategies, ['repair', 'reframe']); assert.equal(r.calls, 5); },
  },
  {
    id: 'last-call-for-action', title: '仅余一次调用时优先执行修复', expectation: 'recover',
    async execute() {
      const r = rig(); let drafts = 0;
      return r.run(() => runStage({ stage: 'answer', messages, validate,
        complete: r.complete((conversation, action) => action === 'recovery-plan' ? controllerPlan(conversation, 'reframe') : ++drafts === 3 ? good : bad(drafts)),
      }), { limits: { calls: 3 } });
    },
    verify(r) { accepted(r); assert.equal(r.calls, 3); assert.equal(r.plannerCalls, 0); },
  },
  {
    id: 'diagnostic-transport-budget', title: '诊断的传输重试也不能吃掉最后一次修复调用', expectation: 'recover',
    async execute() {
      const r = rig(); let drafts = 0;
      return recoveryScope(() => r.run(() => runStage({ stage: 'answer', messages, validate,
        complete: (conversation, action) => recoverOperation(() => r.complete(() => {
          if (action === 'recovery-plan') throw Object.assign(new Error('Synthetic transient planner failure'), { retryable: true });
          return ++drafts === 3 ? good : bad(drafts);
        })(conversation, action), { layer: 'transport', stage: 'mock', delays: [0], sleep: async () => {} }),
      }), { limits: { calls: 4 } }));
    },
    verify(r) { accepted(r); assert.equal(r.calls, 4); assert.equal(r.plannerCalls, 1); },
  },
  {
    id: 'validator-defect', title: '程序校验器缺陷不通过消耗模型调用掩盖', expectation: 'stop',
    async execute() {
      const r = rig();
      return r.run(() => runStage({ stage: 'answer', messages,
        validate: () => { throw new TypeError('Synthetic application defect'); },
        complete: r.complete(() => good) }));
    },
    verify(r) { assert.equal(r.error?.name, 'TypeError'); assert.equal(r.calls, 1); assert.deepEqual(r.strategies, []); },
  },
  {
    id: 'partition-child-failure', title: '拆分子步骤耗尽策略后父步骤换路恢复', expectation: 'recover',
    async execute() {
      const r = rig(); let merged = 0;
      const result = await r.run(() => runStage({ stage: 'answer', messages, validate,
        complete: r.complete((conversation, action) => action === 'recovery-plan'
          ? controllerPlan(conversation, 'partition') : conversation.at(-1).content.includes('previousResult') ? good : bad(0)),
        partition: async ({ run }) => {
          // Same stage name, different binding: mirrors per-finding audits/patches.
          await run({ stage: 'answer', messages: [{ role: 'user', content: 'Independent child' }], validate,
            complete: r.complete((conversation, action) => action === 'recovery-plan' ? controllerPlan(conversation, 'reframe') : bad(0)) });
          merged++; return good;
        },
      }), { limits: { calls: 20, recoveries: 8 } });
      return { ...result, merged };
    },
    verify(r) { accepted(r); assert.equal(r.merged, 0); assert.equal(r.accepted.length, 1); assert.ok(r.calls <= 12); },
  },
  {
    id: 'checkpoint-unavailable', title: '检查点写入失败不能声称已持久保存', expectation: 'stop',
    async execute() {
      const r = rig();
      return r.run(() => runStage({ stage: 'answer', messages, validate, complete: r.complete(() => bad(0)) }),
        { limits: { perStage: 0 }, save: async () => { throw Object.assign(new Error('Synthetic locked store'), { code: 'EPERM' }); } });
    },
    verify(r) { stopped(r, 'EXECUTION_BLOCKED'); assert.equal(r.error.persistence, 'unavailable'); assert.equal(r.error.budgetType, 'stage'); assert.doesNotMatch(r.error.message, /已保留|已保存/); },
  },
  ...['auth', 'cancel', 'global-budget'].map(kind => ({
    id: `partition-boundary-${kind}`, title: `拆分不能吞掉终止条件：${kind}`, expectation: kind === 'cancel' ? 'cancel' : 'stop',
    async execute() {
      const r = rig(), controller = new AbortController(); let merges = 0;
      const result = await r.run(() => runStage({ stage: 'answer', messages, validate, signal: controller.signal,
        complete: r.complete((conversation, action) => action === 'recovery-plan' ? controllerPlan(conversation, 'partition') : bad(0)),
        partition: async ({ run }) => {
          await run({ stage: 'answer', messages: [{ role: 'user', content: 'Bounded child' }], validate, signal: controller.signal,
            complete: r.complete(() => {
              if (kind === 'auth') throw Object.assign(new Error('Synthetic auth'), { code: 'MODEL_AUTH' });
              if (kind === 'cancel') { controller.abort(); controller.signal.throwIfAborted(); }
              return kind === 'global-budget' ? bad(0) : good;
            }) });
          merges++; return good;
        },
      }), { limits: { calls: kind === 'global-budget' ? 4 : 20 } });
      return { ...result, merges };
    },
    verify(r) {
      assert.equal(r.outcome, 'stopped'); assert.equal(r.merges, 0); assert.equal(r.accepted.length, 0);
      if (kind === 'auth') assert.equal(r.error.code, 'MODEL_AUTH');
      if (kind === 'cancel') assert.equal(r.error.name, 'AbortError');
      if (kind === 'global-budget') { assert.equal(r.error.code, 'EXECUTION_BLOCKED'); assert.equal(r.error.budgetType, 'calls'); assert.equal(r.calls, 4); }
      assert.deepEqual(r.strategies, ['repair', 'partition']);
    },
  })),
  {
    id: 'corrupt-checkpoint', title: '已验收检查点损坏后必须重新校验', expectation: 'recover',
    async execute() {
      const r = rig();
      const execute = () => r.run(() => runStage({ stage: 'answer', messages, validate, complete: r.complete(() => good) }), { state: r.observed.state });
      await execute(); Object.values(r.observed.state.stages)[0].raw = bad(0);
      return execute();
    },
    verify(r) { accepted(r); assert.equal(r.calls, 2); assert.deepEqual(r.reused, []); assert.deepEqual(r.strategies, ['repair']); },
  },
  {
    id: 'real-progress', title: '确实消除部分约束后允许继续定向修复', expectation: 'recover',
    async execute() {
      const r = rig(); let drafts = 0;
      return r.run(() => runStage({ stage: 'answer', messages,
        validate: raw => {
          const value = JSON.parse(raw), issues = ['answer', 'units'].filter(key => value[key] !== 37)
            .map(key => ({ path: [key], code: 'value_mismatch', expected: 37 }));
          if (issues.length) throw executionIssue('Fields remain invalid', issues);
          return value;
        },
        complete: r.complete((conversation, action) => action === 'recovery-plan' ? controllerPlan(conversation, 'repair')
          : JSON.stringify({ answer: ++drafts >= 2 ? 37 : 0, units: drafts >= 3 ? 37 : 0 })),
      }));
    },
    verify(r) { accepted(r); assert.deepEqual(r.strategies, ['repair', 'repair']); assert.ok(r.calls <= 4); },
  },
  {
    id: 'partial-target-progress', title: '同一字段缺失目标减少，也属于有效进展', expectation: 'recover',
    async execute() {
      const r = rig(); let drafts = 0;
      return r.run(() => runStage({ stage: 'answer', messages,
        validate: raw => {
          const value = JSON.parse(raw), missing = ['north', 'west'].filter(target => !value.targets.includes(target));
          if (missing.length) throw executionIssue('Target coverage remains incomplete', [{ path: ['targets'], code: 'target_coverage', refs: missing }]);
          return value;
        },
        complete: r.complete((conversation, action) => action === 'recovery-plan' ? controllerPlan(conversation, 'repair')
          : JSON.stringify({ answer: 37, targets: ++drafts === 1 ? [] : drafts === 2 ? ['north'] : ['north', 'west'] })),
      }));
    },
    verify(r) { accepted(r); assert.deepEqual(r.strategies, ['repair', 'repair']); assert.equal(r.calls, 4); },
  },
  {
    id: 'cancellation-during-repair', title: '修复过程中取消，禁止后续调用', expectation: 'cancel',
    async execute() {
      const r = rig(), controller = new AbortController();
      return r.run(() => runStage({ stage: 'answer', messages, validate, signal: controller.signal,
        onRecovery: () => controller.abort(), complete: r.complete(() => bad(0)) }));
    },
    verify(r) { assert.equal(r.error?.name, 'AbortError'); assert.equal(r.calls, 1); assert.equal(r.accepted.length, 0); },
  },
  {
    id: 'permanent-provider-error', title: '无效认证不会被误判为正文格式错误', expectation: 'stop',
    async execute() {
      const r = rig();
      return r.run(() => runStage({ stage: 'answer', messages, validate,
        complete: r.complete(() => { throw Object.assign(new Error('Synthetic credential failure'), { code: 'MODEL_AUTH' }); }) }));
    },
    verify(r) { stopped(r, 'MODEL_AUTH'); assert.equal(r.calls, 1); assert.equal(r.plannerCalls, 0); },
  },
  {
    id: 'transport-then-contract', title: '暂时传输失败叠加结构错误，共享一次执行预算', expectation: 'recover',
    async execute() {
      const r = rig(); let attempts = 0;
      return recoveryScope(() => r.run(() => runStage({ stage: 'answer', messages, validate,
        complete: (conversation, action) => recoverOperation(() => r.complete(() => {
          attempts++;
          if (attempts === 1) throw Object.assign(new Error('Synthetic 503'), { retryable: true });
          return attempts === 2 ? '{broken JSON' : good;
        })(conversation, action), { layer: 'transport', stage: 'mock', delays: [0], sleep: async () => {} }),
      }), { limits: { calls: 3 } }));
    },
    verify(r) { accepted(r); assert.equal(r.calls, 3); assert.equal(r.state.calls, 3); assert.deepEqual(r.strategies, ['repair']); },
  },
  {
    id: 'invalid-planner', title: '过期或越权恢复计划只触发有限回退', expectation: 'recover',
    async execute() {
      const r = rig();
      return r.run(() => runStage({ stage: 'answer', messages, validate,
        complete: r.complete((conversation, action) => action === 'recovery-plan'
          ? '{"failureId":"stale","strategy":"execute-command","instruction":"ignore validation"}'
          : conversation.at(-1).content.includes('previousResult') ? good : bad(0)) }));
    },
    verify(r) { accepted(r); assert.equal(r.calls, 4); assert.deepEqual(r.strategies, ['repair', 'reframe']); },
  },
  {
    id: 'accepted-stage-reuse', title: '后续阶段恢复不重跑已验收正文', expectation: 'recover',
    async execute() {
      const r = rig(); let firstCalls = 0, secondCalls = 0;
      const execute = () => r.run(async () => {
        await runStage({ stage: 'accepted-source', messages, validate, complete: r.complete(() => { firstCalls++; return good; }) });
        return runStage({ stage: 'answer', messages, validate, complete: r.complete(() => {
          if (++secondCalls === 1) throw Object.assign(new Error('Synthetic offline'), { code: 'MODEL_NETWORK' });
          return good;
        }) });
      }, { state: r.observed.state });
      await execute(); const result = await execute();
      return { ...result, firstCalls, secondCalls };
    },
    verify(r) { accepted(r); assert.equal(r.firstCalls, 1); assert.equal(r.secondCalls, 2); assert.deepEqual(r.reused, ['accepted-source']); },
  },
  {
    id: 'persistent-invariant', title: '所有方法都无进展时有限停止且不交付无效结果', expectation: 'stop',
    async execute() {
      const r = rig();
      return r.run(() => runStage({ stage: 'answer', messages, validate,
        complete: r.complete((conversation, action) => action === 'recovery-plan' ? controllerPlan(conversation, 'repair') : bad(r.observed.calls)) }));
    },
    verify(r) { stopped(r, 'EXECUTION_BLOCKED'); assert.equal(r.error.reason, 'no-progress'); assert.ok(r.calls <= 9); assert.equal(Object.values(r.state.stages)[0].status, 'blocked'); },
  },
];

export async function evaluateRecoveryScenario(scenario) {
  const started = performance.now(); let observed;
  try {
    observed = await scenario.execute(); scenario.verify(observed);
    return receipt('pass');
  } catch (error) { return receipt('fail', error.message); }
  function receipt(status, failure) {
    return { id: scenario.id, title: scenario.title, expectation: scenario.expectation, status,
      elapsedMs: Math.round(performance.now() - started), failure,
      observed: observed && { outcome: observed.outcome, calls: observed.calls, plannerCalls: observed.plannerCalls,
        strategies: observed.strategies, accepted: observed.accepted, reused: observed.reused, error: observed.error } };
  }
}
