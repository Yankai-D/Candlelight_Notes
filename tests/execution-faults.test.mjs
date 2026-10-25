import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryScenarios, evaluateRecoveryScenario } from '../evals/recovery/scenarios.mjs';

for (const scenario of recoveryScenarios) test(`recovery fault: ${scenario.id}`, async () => {
  const result = await evaluateRecoveryScenario(scenario);
  assert.equal(result.status, 'pass', JSON.stringify(result, null, 2));
});
