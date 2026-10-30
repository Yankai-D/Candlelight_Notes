import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { planExperiment, runExperiment } from '../evals/notes/experiment.mjs';
import { compareNoteRuns, regressionHTML } from '../evals/notes/regression.mjs';
const { values } = parseArgs({ options: { demo: { type: 'boolean' }, baseline: { type: 'string' }, candidate: { type: 'string' },
 'baseline-review': { type: 'string' }, 'candidate-review': { type: 'string' }, prices: { type: 'string' }, policy: { type: 'string' }, arm: { type: 'string', multiple: true }, out: { type: 'string' } } });
if (values.demo && (values.baseline || values.candidate || values['baseline-review'] || values['candidate-review'] || values.prices)) throw new Error('Demo cannot be mixed with real artifacts or prices');
if (!values.demo && (!values.baseline || !values.candidate)) throw new Error('Provide --baseline and --candidate run directories, or --demo. This command never calls a real provider.');
const json = async path => JSON.parse(await readFile(resolve(path), 'utf8'));
let baseline, candidate;
if (values.demo) {
  const plan = planExperiment({ suite: 'product-scenarios' });
  baseline = await runExperiment(plan); candidate = await runExperiment(plan);
} else { baseline = await json(join(values.baseline, 'private-run.json')); candidate = await json(join(values.candidate, 'private-run.json')); }
const report = compareNoteRuns(baseline, candidate, {
 baselineReview: values['baseline-review'] ? await json(values['baseline-review']) : undefined,
 candidateReview: values['candidate-review'] ? await json(values['candidate-review']) : undefined,
 policy: values.policy ? await json(values.policy) : undefined, prices: values.prices ? await json(values.prices) : undefined, arms: values.arm,
});
const out = resolve(values.out || join('artifacts/note-regression', new Date().toISOString().replaceAll(/[:.]/g, '-')));
await mkdir(resolve(out, '..'), { recursive: true }); await mkdir(out); // Never overwrite earlier evidence.
await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(join(out, 'report.html'), regressionHTML(report));
console.log(JSON.stringify({ status: report.status, compared: report.rows.length, flags: report.flags.length, report: join(out, 'report.html'), modelCalls: 0 }));
if (!['simulation-only', 'no-observed-regression'].includes(report.status)) process.exitCode = 1;
