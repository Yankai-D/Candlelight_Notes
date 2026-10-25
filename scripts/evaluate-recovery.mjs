import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { parseArgs } from 'node:util';
import { recoveryScenarios, evaluateRecoveryScenario } from '../evals/recovery/scenarios.mjs';
import { sourceEvidence } from './lib/source-evidence.mjs';
import { root } from './lib/process.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const directory = resolve(root, values.out || 'artifacts/recovery-eval');
const within = relative(join(root, 'artifacts'), directory);
if (!within || within.startsWith('..') || resolve(root, 'artifacts', within) !== directory) throw new Error('Output must be inside artifacts');
await mkdir(directory, { recursive: true });
const report = { schema: 'recovery-fault-evaluation-v1', mode: 'offline-synthetic', startedAt: new Date().toISOString(),
  liveModelCalls: 0, source: await sourceEvidence(root), cases: [] };
for (const scenario of recoveryScenarios) {
  const result = await evaluateRecoveryScenario(scenario); report.cases.push(result);
  console.log(`${result.status.toUpperCase()} ${result.id}: ${result.observed?.calls ?? '?'} mock calls`);
}
report.passed = report.cases.filter(result => result.status === 'pass').length;
report.failed = report.cases.length - report.passed;
report.status = report.failed ? 'fail' : 'pass';
report.finishedAt = new Date().toISOString();
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${report.passed}/${report.cases.length} scenarios passed; live API calls: 0; ${relative(root, directory)}/report.json`);
if (report.failed) process.exitCode = 1;
