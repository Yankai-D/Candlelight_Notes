import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestServer } from './support/server.mjs';
import { createDemo } from '../src/demo.ts';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('file storage API requires the local token and returns bytes without changing model settings', async t => {
  const server = await startTestServer({ READING_TREE_FILE_STORAGE: '1' }); t.after(() => server.stop());
  const config = await (await fetch(server.base + '/api/config')).json(); assert.equal(config.fileStorage, true);
  const command = (value, headers = {}) => fetch(server.base + '/api/storage', { method: 'POST', headers: { 'content-type': 'application/json', 'x-reading-tree-token': config.token, ...headers }, body: JSON.stringify(value) });
  assert.equal((await command({ action: 'status' }, { 'x-reading-tree-token': '' })).status, 403);
  assert.equal((await command({ action: 'status' }, { origin: 'https://example.invalid' })).status, 403);
  assert.equal((await command({ action: 'status' })).status, 200);
  const document = { ...createDemo(), id: 'api-storage-test', demo: false, library: undefined, kind: 'text', filename: 'test.txt' };
  const result = await command({ action: 'import', document, remember: true, source: { name: 'test.txt', data: Buffer.from('source bytes').toString('base64') } });
  assert.equal(result.status, 200, await result.text());
  const source = await command({ action: 'file', id: document.id }); assert.equal(await source.text(), 'source bytes'); assert.equal(source.headers.get('cache-control'), 'no-store');
  assert.equal((await command({ action: 'preference-set', key: '__proto__', value: { polluted: true } })).status, 400);
  assert.equal((await command({ action: 'remove', id: '../.env' })).status, 400);
  assert.equal((await command({ action: 'directory', directory: join(server.directory, 'profile/inside') })).status, 400);
  const after = await (await fetch(server.base + '/api/config')).json(); assert.equal(after.configured, false); assert.equal(after.model, config.model);
  assert.ok((await readFile(join(server.directory, 'profile/library-index.json'), 'utf8')).length < 2000);
});

test('workspace recovery rejects stale windows and never transfers the saved model key', async t => {
  const server = await startTestServer({ READING_TREE_FILE_STORAGE: '1' }, { envText: 'DEEPSEEK_API_KEY=LOCAL_ONLY\n' }); t.after(() => server.stop());
  const config = await (await fetch(server.base + '/api/config')).json();
  const ideal = (body, epoch = config.workspaceToken) => fetch(server.base + '/api/edit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-reading-tree-token': config.token }, body: JSON.stringify({ action: 'ideal-tree', ...body, workspaceToken: epoch }) });
  const first = await ideal({ command: 'list' }); assert.equal(first.status, 200, await first.clone().text()); assert.deepEqual((await first.json()).result.trees, []);
  assert.equal((await ideal({ command: 'list', unexpected: true })).status, 400, 'Domain schemas must still reject unknown fields');
  const command = value => fetch(server.base + '/api/storage', { method: 'POST', headers: { 'content-type': 'application/json', 'x-reading-tree-token': config.token }, body: JSON.stringify({ ...value, workspaceToken: config.workspaceToken }) });
  await command({ action: 'import', document: { ...createDemo(), id: 'workspace', library: undefined } });
  const backup = await (await command({ action: 'workspace-backup', directory: join(server.directory, 'backups') })).json();
  const preview = await (await command({ action: 'workspace-preview', directory: backup.directory })).json();
  const result = await command({ action: 'workspace-restore', previewId: preview.id, directory: join(server.directory, 'restored'), confirm: true }); assert.equal(result.status, 200, await result.text());
  assert.equal((await command({ action: 'preference-set', key: 'font-size', value: 25 })).status, 409);
  const staleGeneration = await fetch(server.base + '/api/edit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-reading-tree-token': config.token }, body: JSON.stringify({ action: 'generate', workspaceToken: config.workspaceToken }) });
  assert.equal(staleGeneration.status, 409); assert.match(await staleGeneration.text(), /未调用模型/);
  assert.equal((await ideal({ command: 'list' })).status, 409);
  const next = await (await fetch(server.base + '/api/config')).json(); assert.notEqual(next.workspaceToken, config.workspaceToken); assert.equal(next.configured, true);
  const restored = await ideal({ command: 'list' }, next.workspaceToken); assert.equal(restored.status, 200, await restored.clone().text()); assert.deepEqual((await restored.json()).result.trees, []);
  assert.equal(await readFile(join(server.directory, '.env'), 'utf8'), 'DEEPSEEK_API_KEY=LOCAL_ONLY\n');
});

test('HTTP generation creates frozen evidence, counts actual repair calls and never confuses acceptance with writing', async t => {
  let calls = 0;
  const upstream = createServer(async (req, res) => { for await (const _chunk of req) {} calls++; res.setHeader('content-type','application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(calls === 1 ? {} : { title: 'Fixture explanation', paragraphs: ['Fixture explanation.'], sourcePages: [2], summary: 'Fixture' }) } }], usage: { prompt_tokens: 30, completion_tokens: 15 } })); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); t.after(() => new Promise(resolve => upstream.close(resolve)));
  const server = await startTestServer({ READING_TREE_FILE_STORAGE: '1', DEEPSEEK_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, DEEPSEEK_MODEL: 'local-fixture' }); t.after(() => server.stop());
  const config = await (await fetch(server.base + '/api/config')).json(), headers = { 'content-type': 'application/json', 'x-reading-tree-token': config.token };
  const post = async (path, body) => { const response = await fetch(server.base + path, { method: 'POST', headers, body: JSON.stringify(path === '/api/config' ? body : { ...body, workspaceToken: config.workspaceToken }) }); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; };
  const document = { ...createDemo(), id: 'trace-http-fixture', library: undefined }, chapter = document.chapters[1];
  await post('/api/storage', { action: 'import', document }); await post('/api/config', { apiKey: 'LOCAL_FAKE_KEY_NOT_FOR_RECORDS' });
  const index = JSON.parse(await readFile(join(server.directory, 'profile/library-index.json'))), before = await readFile(index.entries[0].notePath);
  const reply = await post('/api/edit', { action: 'explain', scope: 'selection', instruction: 'Explain', revision: 0, documentId: document.id, notebookId: 'adaptive', chapterId: chapter.id, anchorId: chapter.content.content[0].attrs.id, document });
  assert.ok(reply.recordId); assert.equal(calls, 2);
  const summaries = await post('/api/storage', { action: 'records-list', id: document.id }); assert.equal(summaries[0].status, 'accepted'); assert.equal(summaries[0].calls, 2); assert.equal(summaries[0].repairs, 1);
  const record = await post('/api/storage', { action: 'record-read', id: document.id, recordId: reply.recordId }); assert.doesNotMatch(JSON.stringify(record), /LOCAL_FAKE_KEY_NOT_FOR_RECORDS|Authorization/);
  assert.deepEqual(await readFile(index.entries[0].notePath), before);
});
