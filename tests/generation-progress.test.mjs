import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generationProgressStore } from '../server/generation-progress.mjs';
import { generationSession, observedGeneration } from '../shared/generation-progress.mjs';

test('progress retains only counters, includes retries and missing usage, and expires without evicting active work', () => {
  let now = 1; const store = generationProgressStore({ now: () => now, retentionMs: 10, retained: 1 });
  const id = randomUUID(), job = store.start(id, 'space', 'generate');
  job.request({ stage: 'chapter-analysis' }); job.request({ stage: 'chapter-analysis' });
  job.event({ stage: 'chapter-analysis', finishReason: 'stop', promptTokens: 100, completionTokens: 20, cacheHitTokens: 40, cacheMissTokens: 60, privateText: 'SECRET' });
  job.event({ phase: 'execution', stage: 'generate', status: 'recovering', cause: 'PRIVATE_SOURCE' });
  job.event({ phase: 'source-knowledge-cache', reused: 2 });
  const active = store.get(id, 'space');
  assert.equal(active.requests, 2); assert.equal(active.reportedCalls, 1); assert.equal(active.inputTokens, 100);
  assert.equal(active.repairs, 1); assert.equal(active.indexReused, 2); assert.equal(active.cacheHitTokens, 40);
  assert.doesNotMatch(JSON.stringify(active), /SECRET|PRIVATE|space/);
  assert.equal(store.get(id, 'other'), null); assert.throws(() => store.start(id, 'space', 'generate'));
  now = 20; assert.ok(store.get(id, 'space')); job.finish('cancelled');
  now = 31; assert.equal(store.get(id, 'space'), null);
});

test('task totals replace snapshots and accumulate planning and chapter requests once', () => {
  const values = [], session = generationSession(value => values.push(value), () => 100);
  session.observe({ id: 'a', updatedAt: 1, requests: 2, reportedCalls: 1, inputTokens: 30, outputTokens: 10 });
  session.observe({ id: 'a', updatedAt: 2, requests: 3, reportedCalls: 2, inputTokens: 50, outputTokens: 20 });
  session.observe({ id: 'a', updatedAt: 1, requests: 2, inputTokens: 30 });
  session.observe({ id: 'b', updatedAt: 3, requests: 1, reportedCalls: 1, inputTokens: 5, outputTokens: 3 });
  assert.equal(values.at(-1).requests, 4); assert.equal(values.at(-1).inputTokens, 55);
  session.observe(null); assert.equal(values.at(-1).unavailable, true);
  session.finish('paused'); const count = values.length; session.observe({ id: 'b', updatedAt: 4, requests: 99 }); assert.equal(values.length, count);
});

test('progress failures never retry edits or fail successful work; final snapshots survive missing polls', async () => {
  const events = []; let edits = 0, polls = 0;
  const snapshot = { id: randomUUID(), updatedAt: 3, requests: 1 };
  const result = await observedGeneration(async path => {
    if (path === '/api/edit') { edits++; await new Promise(resolve => setTimeout(resolve, 30)); return { result: 'ok', progress: snapshot }; }
    polls++; throw new Error('offline status endpoint');
  }, {}, undefined, value => events.push(value), { interval: 2 });
  assert.equal(result.result, 'ok'); assert.equal(edits, 1); assert.ok(polls > 0); assert.deepEqual(events.at(-1), snapshot);
  const before = polls; await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(polls, before);
});

test('cancellation stops status polling without starting another generation', async () => {
  const control = new AbortController(); let edits = 0, reads = 0;
  const pending = observedGeneration(async (path, _input, signal) => {
    if (path !== '/api/edit') { reads++; return null; }
    edits++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, {}, control.signal, () => {}, { interval: 2 });
  await new Promise(resolve => setTimeout(resolve, 15)); control.abort();
  await assert.rejects(pending, { name: 'AbortError' }); const count = reads;
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(reads, count); assert.equal(edits, 1);
});
