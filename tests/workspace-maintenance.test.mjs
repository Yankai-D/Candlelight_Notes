import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileLibrary } from '../server/file-library.mjs';
import { createDemo } from '../src/demo.ts';
import { ensureNotebooks } from '../shared/notebooks.mjs';
import { freshTemplateLibrary } from '../shared/writing-templates.mjs';
import { createGenerationRecord, readGenerationRecords } from '../server/generation-records.mjs';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'candlelight-maintenance-')); t.after(() => rm(root, { recursive: true, force: true }));
  const options = { profile: join(root, 'profile'), defaultDirectory: join(root, 'library') };
  const store = new FileLibrary(options); await store.command({ action: 'status' });
  const doc = ensureNotebooks({ ...createDemo(), id: 'saved-note', title: 'Saved note', library: undefined, kind: 'text', filename: 'source.txt' });
  await store.command({ action: 'import', document: doc, source: { name: 'source.txt', data: Buffer.from('ORIGINAL').toString('base64') } });
  const entry = store.index.entries[0];
  return { root, options, store, doc, entry, command: command => store.command(command) };
}
test('retirement keeps shared files in place and restores classification without model calls', async t => {
  const f = await fixture(t), bytes = await readFile(f.entry.notePath);
  await f.command({ action: 'preference-set', key: 'collection', value: { version: 1, folders: [{ id: 'course', name: 'Course' }], items: { [f.doc.id]: { folderId: 'course', status: 'learning', inTree: true } } } });
  const receipt = await f.command({ action: 'retire', id: f.doc.id, mode: 'record' });
  assert.deepEqual(await f.command({ action: 'list' }), []); assert.deepEqual(await readFile(f.entry.notePath), bytes);
  const reopened = new FileLibrary(f.options); assert.deepEqual(await reopened.command({ action: 'list' }), []);
  await reopened.command({ action: 'retired-restore', id: receipt.id });
  assert.equal((await reopened.command({ action: 'list' }))[0].id, f.doc.id);
  assert.equal((await reopened.command({ action: 'preference-get', key: 'collection' })).items[f.doc.id].folderId, 'course');
  assert.equal((await reopened.command({ action: 'retired-list' })).length, 0);
});
test('recycle bin requires explicit purge and protects edits made by another installation', async t => {
  const f = await fixture(t);
  const receipt = await f.command({ action: 'retire', id: f.doc.id, mode: 'trash' });
  await assert.rejects(f.command({ action: 'retired-purge', id: receipt.id }), /确认/);
  const before = await readFile(f.entry.notePath);
  await writeFile(f.entry.notePath, before.toString().replace('Saved note', 'Changed elsewhere'));
  await assert.rejects(f.command({ action: 'retired-purge', id: receipt.id, confirm: true }), /已被修改/);
  assert.equal(await readFile(f.entry.sourcePath, 'utf8'), 'ORIGINAL');
  await f.command({ action: 'retired-restore', id: receipt.id }); await f.command({ action: 'list' });
  const confirmed = await f.command({ action: 'retire', id: f.doc.id, mode: 'trash' });
  await f.command({ action: 'retired-purge', id: confirmed.id, confirm: true });
  await assert.rejects(readFile(f.entry.notePath), { code: 'ENOENT' }); await assert.rejects(readFile(f.entry.sourcePath), { code: 'ENOENT' });
});
test('complete backup restores exact notes, sources, profile, templates, folders, trees and traces without credentials; undo preserves both spaces', async t => {
  const f = await fixture(t), snapshot = await readFile(f.entry.notePath);
  await f.command({ action: 'learner-save', value: { background: 'User-authored profile', foundations: ['Calculus'], materials: [] }, step: 'complete' });
  await f.command({ action: 'templates-save', value: { ...freshTemplateLibrary(), revision: 1 }, revision: 0 });
  await f.command({ action: 'preference-set', key: 'collection', value: { version: 1, folders: [{ id: 'course', name: 'Course' }], items: {} } });
  await f.command({ action: 'preference-set', key: 'api-key', value: 'DO_NOT_BACKUP' });
  await writeFile(join(f.options.profile, '.env'), 'DEEPSEEK_API_KEY=DO_NOT_BACKUP');
  const treeId = randomUUID(); await mkdir(join(f.store.index.systemDirectory, 'ideal-trees/assets'), { recursive: true });
  await writeFile(join(f.store.index.systemDirectory, 'ideal-trees', treeId + '.json'), JSON.stringify({ id: treeId, status: 'paused', input: { goal: 'Learn' } }));
  await writeFile(join(f.store.index.systemDirectory, 'ideal-trees/assets', 'S' + 'a'.repeat(22) + '.txt'), 'TREE SOURCE');
  const backup = await f.command({ action: 'workspace-backup', directory: join(f.root, 'backups') }); assert.equal(backup.warnings.length, 0);
  const manifest = await readFile(join(backup.directory, 'candlelight-workspace.json'), 'utf8'); assert.ok(!manifest.includes('DO_NOT_BACKUP')); assert.ok(!manifest.includes(f.options.profile));
  const target = new FileLibrary({ profile: join(f.root, 'new-profile'), defaultDirectory: join(f.root, 'new-library') });
  await target.command({ action: 'import', document: { ...f.doc, id: 'old-space', title: 'Keep old workspace' } });
  await writeFile(join(target.profile, '.env'), 'DEEPSEEK_API_KEY=TARGET_ONLY');
  const preview = await target.command({ action: 'workspace-preview', directory: backup.directory }); assert.equal(preview.documents, 1); assert.equal(preview.trees, 1);
  const restored = await target.command({ action: 'workspace-restore', previewId: preview.id, directory: join(f.root, 'restored'), confirm: true });
  assert.notEqual(restored.directory, f.options.defaultDirectory);
  assert.deepEqual(await readFile(target.index.entries[0].notePath), snapshot); assert.equal((await target.command({ action: 'file', id: f.doc.id })).data.toString(), 'ORIGINAL');
  assert.equal((await target.command({ action: 'learner-read' })).knowledge.background, 'User-authored profile');
  assert.ok((await target.command({ action: 'templates-read' })).templates.length >= 2);
  assert.equal((await target.command({ action: 'preference-get', key: 'collection' })).folders[0].name, 'Course');
  assert.equal(await readFile(join(target.profile, '.env'), 'utf8'), 'DEEPSEEK_API_KEY=TARGET_ONLY');
  assert.equal(JSON.parse(await readFile(join(target.index.systemDirectory, 'ideal-trees', treeId + '.json'))).input.goal, 'Learn');
  assert.equal((await new FileLibrary({ profile: target.profile, defaultDirectory: join(f.root, 'new-library') }).command({ action: 'list' })).length, 1, 'Restart must not reimport the previous workspace');
  await target.command({ action: 'workspace-undo', confirm: true }); assert.equal((await target.command({ action: 'list' }))[0].id, 'old-space');
  await target.command({ action: 'workspace-undo', confirm: true }); assert.equal((await target.command({ action: 'list' }))[0].id, f.doc.id);
  assert.deepEqual(await readFile(f.entry.notePath), snapshot);
});
test('damaged or changed backups, traversal and redirected files are rejected before replacing current state', async t => {
  const f = await fixture(t), backup = await f.command({ action: 'workspace-backup', directory: join(f.root, 'backups') });
  const manifestPath = join(backup.directory, 'candlelight-workspace.json'), original = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(original);
  const before = JSON.stringify(f.store.index), preview = await f.command({ action: 'workspace-preview', directory: backup.directory });
  manifest.createdAt++; await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(f.command({ action: 'workspace-restore', previewId: preview.id, directory: join(f.root, 'restored'), confirm: true }), /变化/);
  manifest.files[0].path = '../outside'; await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(f.command({ action: 'workspace-preview', directory: backup.directory }));
  await writeFile(manifestPath, original);
  const file = join(backup.directory, JSON.parse(original).files[0].path); await writeFile(file, '{}');
  await assert.rejects(f.command({ action: 'workspace-preview', directory: backup.directory }), /校验失败/);
  assert.equal(JSON.stringify(f.store.index), before);
});
test('a pending state transaction finishes after restart without touching the key', async t => {
  const f = await fixture(t); await writeFile(join(f.options.profile, '.env'), 'KEEP');
  await writeFile(join(f.options.profile, 'workspace-pending.json'), JSON.stringify({ version: 1, index: { ...f.store.index, isolatedWorkspace: true }, preferences: { 'font-size': 20 } }));
  const resumed = new FileLibrary(f.options); await resumed.command({ action: 'status' });
  assert.equal(resumed.index.isolatedWorkspace, true); assert.equal(await resumed.command({ action: 'preference-get', key: 'font-size' }), 20);
  await assert.rejects(readFile(join(f.options.profile, 'workspace-pending.json')), { code: 'ENOENT' }); assert.equal(await readFile(join(f.options.profile, '.env'), 'utf8'), 'KEEP');
});
test('saved backup folders are excluded from live note discovery', async t => {
  const f = await fixture(t); await f.command({ action: 'workspace-backup', directory: f.options.defaultDirectory });
  const other = new FileLibrary({ ...f.options, profile: join(f.root, 'other-profile') }); assert.equal((await other.command({ action: 'list' })).length, 1);
});

test('failed backups and nested restored spaces do not become duplicate live notes', async t => {
  const f = await fixture(t), system = join(f.store.index.systemDirectory, 'ideal-trees');
  await mkdir(system, { recursive: true }); await writeFile(join(system, 'unexpected.log'), 'injected failure');
  await assert.rejects(f.command({ action: 'workspace-backup', directory: f.options.defaultDirectory }), /未识别文件/);
  const failed = (await readdir(f.options.defaultDirectory)).find(name => name.startsWith('烛光笔记备份-'));
  assert.ok(await readFile(join(f.options.defaultDirectory, failed, '.candlelight-incomplete')));
  await unlink(join(system, 'unexpected.log'));
  const other = new FileLibrary({ ...f.options, profile: join(f.root, 'other-profile') }); assert.equal((await other.command({ action: 'list' })).length, 1);
  const backup = await f.command({ action: 'workspace-backup', directory: f.options.defaultDirectory });
  const preview = await f.command({ action: 'workspace-preview', directory: backup.directory });
  await f.command({ action: 'workspace-restore', previewId: preview.id, directory: f.options.defaultDirectory, confirm: true });
  await f.command({ action: 'workspace-undo', confirm: true });
  const restarted = new FileLibrary(f.options); assert.equal((await restarted.command({ action: 'list' })).length, 1); assert.deepEqual(restarted.discoveryIssues, []);
});

test('failed original-file restoration rolls back only its newly created copy', async t => {
  const f = await fixture(t), before = await readFile(f.entry.notePath); await unlink(f.entry.sourcePath);
  const persist = f.store.persist.bind(f.store); f.store.persist = async () => { throw new Error('disk-full fixture'); };
  await assert.rejects(f.command({ action: 'source-restore', id: f.doc.id, source: { data: Buffer.from('RESTORE').toString('base64') } }), /disk-full/);
  await assert.rejects(readFile(f.entry.sourcePath), { code: 'ENOENT' }); assert.deepEqual(await readFile(f.entry.notePath), before);
  f.store.persist = persist;
});

test('missing originals can be restored without touching notes; conflict copies keep both versions', async t => {
  const f = await fixture(t), note = await readFile(f.entry.notePath);
  await unlink(f.entry.sourcePath);
  await f.command({ action: 'source-restore', id: f.doc.id, source: { data: Buffer.from('RESTORED ORIGINAL').toString('base64') } });
  assert.deepEqual(await readFile(f.entry.notePath), note); assert.equal(await readFile(f.entry.sourcePath, 'utf8'), 'RESTORED ORIGINAL');
  await assert.rejects(f.command({ action: 'source-restore', id: f.doc.id, source: { data: 'bm8=' } }), /已存在/);
  await writeFile(f.entry.notePath, note.toString().replace('Saved note', 'External edit'));
  const disk = await f.command({ action: 'conflict-read', id: f.doc.id }); assert.equal(disk.document.title, 'External edit');
  await assert.rejects(f.command({ action: 'save', document: f.doc }), /其他应用修改/, 'Previewing conflict must not silently refresh the write snapshot');
  const copy = await f.command({ action: 'conflict-copy', document: { ...f.doc, title: 'Unsaved local edit' } });
  assert.notEqual(copy.id, f.doc.id); assert.equal(JSON.parse(await readFile(f.entry.notePath)).title, 'External edit');
  const entry = f.store.index.entries.find(item => item.id === copy.id); assert.match(JSON.parse(await readFile(entry.notePath)).title, /Unsaved local edit/); assert.equal(await readFile(entry.sourcePath, 'utf8'), 'RESTORED ORIGINAL');
});

test('generation evidence retains the frozen request and real repair calls while excluding credentials and headers', async t => {
  const f = await fixture(t), chapter = f.doc.chapters[1];
  const request = { action: 'explain', scope: 'selection', instruction: 'Explain the selected concept', revision: f.doc.revision, documentId: f.doc.id, notebookId: 'adaptive', chapterId: chapter.id, anchorId: chapter.content.content[0].attrs.id, document: f.doc,
    learning: { mode: 'adaptive', difficulty: 'standard', style: 'clear' }, knowledge: { background: 'Frozen background', foundations: ['Calculus'] } };
  let calls = 0;
  const record = await createGenerationRecord(f.store.index.systemDirectory, { ...request, apiKey: 'MUST_NOT_PERSIST' }, 'fixture-model', async () => {
    calls++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: calls === 1 ? '{}' : JSON.stringify({ title: 'Concept', paragraphs: ['An explanation.'], sourcePages: [2], summary: 'Explained' }) } }], usage: { prompt_tokens: 40, completion_tokens: 20 } }), { status: 200 });
  });
  const raw = await runModel({ baseUrl: 'http://127.0.0.1:1', apiKey: 'SECRET_HEADER_ONLY', model: 'fixture-model' }, buildMessages(request), undefined, record.fetch, { action: 'explain', onCompletion: record.event });
  await record.finish('accepted', validateResult(request, raw)); assert.equal(calls, 2);
  const list = await f.command({ action: 'records-list', id: f.doc.id }); assert.equal(list[0].calls, 2); assert.equal(list[0].repairs, 1); assert.equal(list[0].inputTokens, 80);
  const evidence = await f.command({ action: 'record-read', id: f.doc.id, recordId: record.id });
  assert.equal(evidence.request.knowledge.background, 'Frozen background'); assert.equal(evidence.calls[1].messages.length, 4);
  assert.doesNotMatch(JSON.stringify(evidence), /MUST_NOT_PERSIST|SECRET_HEADER_ONLY|Authorization/);
  const backup = await f.command({ action: 'workspace-backup', directory: join(f.root, 'backups') }); assert.ok(JSON.parse(await readFile(join(backup.directory, 'candlelight-workspace.json'))).files.some(file => file.path.includes(record.id)));
  const receipt = await f.command({ action: 'retire', id: f.doc.id, mode: 'trash' });
  await f.command({ action: 'retired-purge', id: receipt.id, confirm: true });
  assert.deepEqual(await f.command({ action: 'records-list', id: f.doc.id }), []);
});

test('interrupted and failed generation remains distinguishable from a successful result; history has a bounded retention', async t => {
  const f = await fixture(t), request = { action: 'generate', scope: 'chapter', instruction: 'Translate', revision: 0, documentId: f.doc.id, chapterId: f.doc.chapters[0].id, document: f.doc, learning: { mode: 'translation' } };
  const interrupted = await createGenerationRecord(f.store.index.systemDirectory, request, 'fixture', async () => { throw new Error('network failure'); });
  await assert.rejects(interrupted.fetch('http://127.0.0.1:1', { body: JSON.stringify({ messages: [], max_tokens: 100 }) }));
  await interrupted.finish('failed', undefined, { code: 'MODEL_NETWORK' });
  assert.equal((await readGenerationRecords(f.store.index.systemDirectory, f.doc.id))[0].status, 'failed');
  for (let i = 0; i < 22; i++) { const record = await createGenerationRecord(f.store.index.systemDirectory, request, 'fixture'); await record.finish('cancelled', undefined, { name: 'AbortError' }); }
  assert.equal((await readGenerationRecords(f.store.index.systemDirectory, f.doc.id)).length, 20);
});
