const version = new URL(import.meta.url).search;
const { idealCommandSchema } = await import(new URL(`../../shared/ideal-tree.mjs${version}`, import.meta.url));
const { IdealRunner } = await import(new URL(`./runner.mjs${version}`, import.meta.url));

// This module is intentionally stable across note-harness hot reloads. Active
// jobs must not be duplicated, and credentials live only in execution closures.
const key = Symbol.for('pangzhu.idealTreeRunner');
function currentRunner() {
  const previous = globalThis[key];
  const directory = process.env.READING_TREE_IDEAL_DIR || '.local-ideal-trees';
  if (!previous || (previous.version !== version || previous.directory !== directory) && !previous.runner.active.size && !previous.runner.paperActive?.size) globalThis[key] = { version, directory, runner: new IdealRunner({ directory }) };
  return globalThis[key].runner;
}
const operations = new WeakMap();
export function buildIdealOperation(input) {
  const request = idealCommandSchema.parse(input), envelope = [];
  operations.set(envelope, request); return envelope;
}
export const idealOperationFor = messages => operations.get(messages);
export async function runIdealOperation(request, config, complete) {
  complete.identity = { model: config.model, endpoint: config.baseUrl };
  return JSON.stringify(await currentRunner().command(request, complete, config.model));
}
export const validateIdealOperation = (_request, raw) => JSON.parse(raw);

export function idealTreeActivity() {
  const runner = globalThis[key]?.runner;
  return (runner?.active.size || 0) + (runner?.paperActive.size || 0);
}
export async function pauseIdealTrees() {
  const runner = globalThis[key]?.runner;
  if (!runner) return;
  await runner.control.catch(() => {});
  const entries = [...runner.active.values(), ...runner.paperActive.values()];
  for (const entry of entries) entry.controller.abort();
  await Promise.all(entries.map(entry => entry.promise));
}
