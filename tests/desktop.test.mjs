import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appOrigin, isAppURL, externalURL, rendererOptions } from '../desktop/policy.mjs';
import { desktopBuildConfig } from '../packaging/desktop/config.mjs';
import { IdealRunner } from '../server/ideal-tree/runner.mjs';
import { idealTreeActivity, pauseIdealTrees } from '../server/ideal-tree/adapter.mjs';

test('desktop navigation confines application content and does not expose Node to documents', () => {
  assert.equal(isAppURL(appOrigin + '/assets/app.js'), true);
  for (const url of ['file:///C:/secret', 'https://example.org', 'pangzhu://elsewhere', 'pangzhu://user@app/', 'javascript:alert(1)']) assert.equal(isAppURL(url), false);
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'ms-settings:privacy', 'https://user:password@example.org']) assert.equal(externalURL(url), null);
  assert.equal(externalURL('https://arxiv.org/abs/1234.56789'), 'https://arxiv.org/abs/1234.56789');
  const options = rendererOptions('preload.cjs');
  assert.equal(options.nodeIntegration, false); assert.equal(options.sandbox, true); assert.equal(options.contextIsolation, true); assert.equal(options.webSecurity, true);
});

test('desktop installer creates user shortcuts and preserves data on uninstall', () => {
  const config = desktopBuildConfig('stage', 'output');
  assert.equal(config.nsis.perMachine, false); assert.equal(config.nsis.allowElevation, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.createDesktopShortcut, true); assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.electronFuses.runAsNode, false); assert.equal(config.electronFuses.enableNodeOptionsEnvironmentVariable, false);
});

test('desktop shutdown cancels an active tree and awaits its persisted paused state', async () => {
  const key = Symbol.for('pangzhu.idealTreeRunner'), previous = globalThis[key], records = new Map();
  const store = { directory: 'test-only', save: async job => records.set(job.id, structuredClone(job)), read: async id => structuredClone(records.get(id)), list: async () => [...records.values()] };
  const runner = new IdealRunner({ store, tools: {}, retryDelay: 0 });
  let entered; const inRequest = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  try {
    globalThis[key] = { version: '', runner };
    const result = await runner.command({ action: 'ideal-tree', command: 'create', requestId: randomUUID(),
      input: { goal: '理解描述性统计并能说明统计量的适用条件', profile: { background: '本科生', foundations: ['基础概率论'] }, library: [] } },
    async (_messages, task) => {
      calls++; entered();
      await new Promise((_resolve, reject) => task.signal.addEventListener('abort', () => reject(task.signal.reason), { once: true }));
    }, 'test-model');
    await inRequest; assert.equal(idealTreeActivity(), 1);
    await pauseIdealTrees();
    assert.equal(idealTreeActivity(), 0); assert.equal(calls, 1);
    const saved = await store.read(result.job.id);
    assert.equal(saved.status, 'paused'); assert.ok(saved.events.some(event => event.type === 'stopped'));
  } finally { if (previous) globalThis[key] = previous; else delete globalThis[key]; }
});
