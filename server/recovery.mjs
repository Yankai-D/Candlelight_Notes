import { appendFile, mkdir, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AsyncLocalStorage } from 'node:async_hooks';

const scopes = new AsyncLocalStorage();
let diagnostics = Promise.resolve();
const codeOf = error => String(error?.code || error?.name || 'UNKNOWN').replace(/[^A-Z_0-9]/gi, '').slice(0, 64);
// Only classifications/counters go to this bounded local log, never error
// messages, filenames, prompts, model responses, URLs or credentials.
export function recordRecovery(event) {
  const entry = { at: new Date().toISOString(), layer: event.layer, stage: event.stage, code: codeOf(event.error || { code: event.code }),
    attempt: event.attempt, outcome: event.outcome };
  diagnostics = diagnostics.catch(() => {}).then(async () => {
    const directory = process.env.READING_TREE_DIAGNOSTIC_DIR || '.cache';
    await mkdir(directory, { recursive: true });
    const path = join(directory, 'recovery.jsonl');
    if ((await stat(path).catch(() => ({size:0}))).size > 512 * 1024) await rename(path, path + '.previous');
    await appendFile(path, JSON.stringify(entry) + '\n', { mode: 0o600 });
  }).catch(() => {});
}
export function recoveryScope(operation) {
  return scopes.getStore() ? operation() : scopes.run({ transportRemaining: 2 }, operation);
}
export function recoveryDecision(error, layer, signal) {
  if (signal?.aborted || error?.name === 'AbortError') return 'cancel';
  if (layer === 'storage') return ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) ? 'retry' : 'stop';
  if (layer === 'transport') return error?.retryable || error?.name === 'TimeoutError' ? 'retry' : 'stop';
  return 'stop';
}
export async function recoverOperation(operation, { layer, stage, signal, delays = layer === 'storage' ? [80,160,320,640,1280,2560,4000] : [800], sleep = delay, report = recordRecovery } = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      const result = await operation(attempt);
      if (attempt) report({layer,stage,attempt,outcome:'recovered',code:'RECOVERED'});
      return result;
    } catch (error) {
      const decision = recoveryDecision(error, layer, signal), scope = scopes.getStore();
      const retry = decision === 'retry' && attempt < delays.length && (layer !== 'transport' || !scope || scope.transportRemaining > 0);
      report({layer,stage,attempt:attempt+1,outcome:retry?'retry':decision,error});
      if (!retry) throw error;
      if (layer === 'transport' && scope) scope.transportRemaining--;
      const milliseconds = Math.min(10000, Math.max(delays[attempt], error.retryAfterMs || 0));
      await sleep(milliseconds, undefined, { signal });
    }
  }
}
export async function optionalRecord(operation, stage = 'diagnostic') {
  try { return await operation(); }
  catch (error) { recordRecovery({layer:'diagnostic',stage,outcome:'omitted',error}); return undefined; }
}
