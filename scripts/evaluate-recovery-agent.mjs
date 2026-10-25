import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve, relative, join, dirname } from 'node:path';
import { agentCases, executeAgentCase } from '../evals/recovery/agent-cases.mjs';
import { executionScope } from '../server/execution.mjs';
import { runModel } from '../server/harness.mjs';
import { openSettingsStore } from '../server/settings-store.mjs';
import { sourceEvidence } from './lib/source-evidence.mjs';
import { root } from './lib/process.mjs';

const { values } = parseArgs({ options: { live: { type: 'boolean' }, out: { type: 'string' } } });
const cases = agentCases();
if (!values.live) {
  console.log(JSON.stringify({ mode: 'manifest-only', liveModelCalls: 0, cases: cases.map(({ id, description }) => ({ id, description })),
    instructions: 'Use --live explicitly to send these original fixtures to the configured API. No private library is read. This manifest is not a test pass.' }, null, 2));
} else {
  const directory = resolve(root, values.out || `artifacts/recovery-agent-${Date.now()}`), within = relative(join(root, 'artifacts'), directory);
  if (!within || within.startsWith('..') || resolve(root, 'artifacts', within) !== directory) throw new Error('Output must be inside artifacts');
  await mkdir(dirname(directory), { recursive: true }); await mkdir(directory); // Never reset a previous run's allowance.
  process.env.READING_TREE_DIAGNOSTIC_DIR = join(directory, 'diagnostics');
  const settings = await openSettingsStore();
  if (!settings.current.apiKey) throw new Error('Configure the local .env API key first; never put it in command-line arguments.');
  const report = { schema: 'recovery-agent-evaluation-v1', mode: 'live-with-injected-initial-failure', source: await sourceEvidence(root),
    startedAt: new Date().toISOString(), model: settings.current.model, limits: { calls: 12, milliseconds: 300000, completionTokens: 24000 },
    calls: 0, completionTokens: 0, cases: [] };
  const signal = AbortSignal.timeout(report.limits.milliseconds);
  let active;
  const save = () => writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  const fetcher = async (url, options) => {
    signal.throwIfAborted();
    if (report.calls >= report.limits.calls || report.completionTokens >= report.limits.completionTokens) throw Object.assign(new Error('Evaluation budget exhausted'), { code: 'EVAL_BUDGET' });
    const body = JSON.parse(options.body);
    body.max_tokens = Math.min(body.max_tokens, 4096, report.limits.completionTokens - report.completionTokens);
    const number = ++report.calls; await save();
    const response = await fetch(url, { ...options, body: JSON.stringify(body), signal });
    const raw = await response.clone().text();
    // Reserve the full output ceiling if usage is missing rather than undercount.
    let usage; try { usage = JSON.parse(raw).usage; } catch { /* Save provider error as evidence. */ }
    report.completionTokens += usage?.completion_tokens ?? body.max_tokens;
    await writeFile(join(directory, `call-${number}.json`), JSON.stringify({ case: active.id, messages: body.messages,
      maxTokens: body.max_tokens, status: response.status, response: raw }, null, 2), { flag: 'wx' });
    await save(); return response;
  };
  for (const scenario of cases) {
    active = { id: scenario.id, description: scenario.description, status: 'running', events: [], initialCalls: report.calls,
      injectedFailedRepairs: 1 }; report.cases.push(active);
    try {
      const tested = await executionScope({ binding: { evaluation: scenario.id }, limits: { calls: Math.min(8, report.limits.calls - report.calls) },
        save: journal => writeFile(join(directory, `${scenario.id}.checkpoint.json`), JSON.stringify(journal, null, 2)),
        event: event => active.events.push(event),
      }, () => executeAgentCase(scenario, { signal, complete: (messages, action) => runModel(settings.current, messages, signal, fetcher, { action }) }));
      active.status = 'pass'; await writeFile(join(directory, `${scenario.id}.result.json`), JSON.stringify(tested.result, null, 2));
    } catch (error) { active.status = 'fail'; active.error = { code: error.code || error.name, message: error.message }; }
    active.calls = report.calls - active.initialCalls; await save();
    console.log(`${active.status.toUpperCase()} ${scenario.id}: ${active.calls} real HTTP attempts`);
  }
  report.finishedAt = new Date().toISOString(); report.sourceAfter = await sourceEvidence(root);
  report.status = report.cases.every(c => c.status === 'pass') && report.source.fingerprint === report.sourceAfter.fingerprint ? 'pass' : 'fail';
  await save(); if (report.status !== 'pass') process.exitCode = 1;
}
