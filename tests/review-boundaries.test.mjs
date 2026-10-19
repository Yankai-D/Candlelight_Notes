import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { startTestServer } from './support/server.mjs';
import { createBundleNote } from '../shared/bundle-context.mjs';
import { ensureNotebooks, restoreNotebookVersion, commitNotebook } from '../shared/notebooks.mjs';
import { restoreBackup } from '../shared/backup.mjs';

function fixture() {
  return ensureNotebooks(createBundleNote({ version: 1, folderId: 'bundle', folderName: '复习', capturedAt: 1,
    sources: ['one', 'two'].map(id => ({ id, title: `来源 ${id}`, path: '复习',
      pages: [{ number: 1, text: '均值用于描述位置。' }], chapters: [{ title: '均值', sourcePages: [1] }] })) }, '边界复核'));
}
const backup = document => JSON.stringify({ format: 'reading-tree-v1', document });

test('HTTP export retains standalone provenance and accepts the generated plan subtitle limit', async t => {
  const server = await startTestServer({}, { entry: 'tests/support/print-server.mjs' });
  try {
    const { token } = await (await fetch(server.base + '/api/config')).json();
    const headers = { 'content-type': 'application/json', 'x-reading-tree-token': token };
    await t.test('source identity survives HTTP schema parsing', async () => {
      const response = await fetch(server.base + '/api/export/pdf', { method: 'POST', headers, body: JSON.stringify({ document: fixture() }) });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, / 来源<\/span>/);
      assert.doesNotMatch(html, / p\.1<\/span>/);
    });
    await t.test('valid 1200-character section purposes remain exportable', async () => {
      const document = fixture(); document.chapters[0].subtitle = '讲'.repeat(1200);
      const response = await fetch(server.base + '/api/export/pdf', { method: 'POST', headers, body: JSON.stringify({ document }) });
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes(document.chapters[0].subtitle));
    });
    await t.test('UTF-8 characters split across network chunks are preserved', async () => {
      const document = fixture(); document.title = '边界测试';
      const bytes = Buffer.from(JSON.stringify({ document }));
      const split = bytes.indexOf(Buffer.from('界')) + 1;
      const result = new Promise((resolve, reject) => {
        const req = request(server.base + '/api/export/pdf', { method: 'POST', headers }, res => {
          const chunks = []; res.on('data', c => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, html: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject); req.write(bytes.subarray(0, split));
        void setTimeout(80).then(() => req.end(bytes.subarray(split)));
      });
      const { status, html } = await result;
      assert.equal(status, 200); assert.ok(html.includes('<title>边界测试</title>'));
      assert.ok(!html.includes('\uFFFD'));
    });
  } finally { await server.stop(); }
});

test('backup rejects missing, duplicated, or relabelled source pages without altering the original', () => {
  const original = fixture(), saved = structuredClone(original);
  const malformed = [
    note => { note.sourceContext.sources[1].pages.push({ number: 2, text: '未映射的页' }); },
    note => { note.pages[1] = { ...note.pages[0], number: 2 }; },
    note => { note.pages[0].sourceTitle = '错误来源'; },
  ];
  for (const mutate of malformed) {
    const note = structuredClone(original); mutate(note);
    assert.throws(() => restoreBackup(backup(note)), /来源映射/);
  }
  assert.deepEqual(original, saved);
  assert.deepEqual(restoreBackup(backup(original)).pages, original.pages);
});

test('restoring a shorter independent note resets invalid reading position and stale completion metadata', () => {
  let document = fixture();
  const old = document.chapters.map(c => ({ ...c, status: 'empty' }));
  const later = { ...old[0], id: 'later', sourcePages: [2] };
  document = commitNotebook({ ...document, chapters: [...old, later], currentChapter: later.id, currentPage: 2,
    readingAnchor: { chapterId: later.id, blockId: 'gone', fraction: .8 },
    preparation: { status: 'complete', startedAt: 1, completedAt: 2, completedIds: [old[0].id, later.id], errors: {}, settings: { mode: 'adaptive' } } });
  const restored = restoreNotebookVersion(document, old, 3);
  assert.equal(restored.currentChapter, old[0].id); assert.equal(restored.currentPage, 1);
  assert.equal(restored.readingAnchor, undefined); assert.equal(restored.preparation.completedAt, undefined);
  assert.equal(restored.notebooks.adaptive.currentChapter, old[0].id);
});
