import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './support/server.mjs';

test('note harness keeps cached dependencies and handlers consistent until a full restart', { timeout: 60000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'candlelight-runtime-'));
  let server;
  async function listTrees() {
    const config = await (await fetch(server.base + '/api/config')).json();
    const response = await fetch(server.base + '/api/edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reading-Tree-Token': config.token },
      body: JSON.stringify({ action: 'ideal-tree', command: 'list' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    assert.deepEqual(body.result.trees, []);
  }
  try {
    // Copy source only; never modify the working application or load its .env.
    for (const name of ['server', 'shared']) await cp(join(root, name), join(directory, name), { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
    await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const entry = join(directory, 'server/index.mjs');
    server = await startTestServer({}, { entry });
    await listTrees();

    // A compatible on-disk update adds an export and a caller together. Reloading
    // only the caller would fail because Node still has the old dependency.
    await appendFile(join(directory, 'shared/folders.mjs'), '\nexport const runtimeRevisionProbe = "next";\n');
    await appendFile(join(directory, 'server/harness.mjs'), '\nimport { runtimeRevisionProbe } from "../shared/folders.mjs";\nif (runtimeRevisionProbe !== "next") throw new Error("Mismatched runtime modules");\n');
    await listTrees();
    await server.stop(); server = undefined;

    // A full restart loads both sides of the new contract successfully.
    server = await startTestServer({}, { entry });
    await listTrees();
  } finally {
    await server?.stop();
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !directory.includes('candlelight-runtime-')) throw new Error('Unexpected runtime test directory');
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
