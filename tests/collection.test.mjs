import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCollection, createFolder, updateCollectionItem, deleteFolder } from '../shared/collection.mjs';
import { organizationInput, treeFingerprint, treeBranches, treeDomains, validateTree } from '../shared/study-tree.mjs';
import { organizationMessages, organizeTree } from '../server/organization-harness.mjs';
import { classificationInput, decodeClassification } from '../server/organization-protocol.mjs';
import { defaultKnowledge, learnerProfile, addReadMaterial, materialFromDocument } from '../shared/learning.mjs';
import { buildMessages } from '../server/harness.mjs';
import { createDemo } from '../src/demo.ts';

const paper = (id, title = id) => ({ ...createDemo(), id, title, filename: title + '.pdf', demo: false, revision: 0 });
const docs = [paper('adam', 'Adam'), paper('batch', 'Batch Normalization'), paper('wk10', 'wk10')];
const tree = () => ({ branches: [{ label: '优化与训练', description: '训练方法', documentIds: docs.map(d => d.id) }],
  documents: docs.map(d => ({ documentId: d.id, description: d.title, concepts: [{ label: '核心方法', description: '已有章节', chapterIds: [d.chapters[1].id] }] })) });

test('one-time migration groups existing papers except wk10; later imports and user choices are preserved', () => {
  const profile = addReadMaterial(defaultKnowledge, materialFromDocument(docs[0]));
  const original = structuredClone({ docs, profile });
  let collection = reconcileCollection(null, docs, profile);
  assert.deepEqual(collection.folders, [{ id: 'machine-learning', name: '机器学习' }]);
  assert.equal(collection.items.adam.status, 'completed');
  assert.equal(collection.items.batch.status, 'imported');
  assert.equal(collection.items.adam.folderId, 'machine-learning');
  assert.equal(collection.items.wk10.folderId, null);
  collection = createFolder(collection, ' 课程 ', 'course');
  collection = updateCollectionItem(collection, 'batch', { folderId: 'course', status: 'studying' });
  collection = updateCollectionItem(collection, 'adam', { folderId: null });
  const next = reconcileCollection(collection, [...docs, paper('new')], profile);
  assert.deepEqual(next.items.batch, { folderId: 'course', status: 'studying', inTree: true });
  assert.equal(next.items.adam.folderId, null);
  assert.equal(next.items.new.folderId, null);
  assert.deepEqual({ docs, profile }, original);
  for (const name of ['WK10', 'Week 10 lecture', 'wk_10', 'wk10-notes']) assert.equal(reconcileCollection(null, [paper('week', name)]).items.week.folderId, null);
  const deleted = deleteFolder(next, 'course');
  assert.deepEqual(deleted.items.batch, { folderId: null, status: 'studying', inTree: true });
  assert.equal(Object.keys(deleted.items).length, 4);
  assert.throws(() => createFolder(next, '机器学习', 'duplicate'), /同名/);
  assert.throws(() => updateCollectionItem(next, 'batch', { folderId: 'missing' }), /不存在/);
});

test('catalog course imports start grouped and excluded, without reapplying placement to user choices', () => {
  const course = ['textbook', 'numerical', 'categorical'].map(id => ({ ...paper(id), library: {
    id, placement: { folder: { id: 'statistics', name: '描述性统计' }, inTree: false },
  } }));
  const before = reconcileCollection(null, docs);
  const snapshot = structuredClone(before);
  const all = [...docs, ...course];
  const imported = reconcileCollection(before, all);
  assert.deepEqual(before, snapshot);
  for (const doc of docs) assert.deepEqual(imported.items[doc.id], before.items[doc.id]);
  assert.equal(imported.folders.filter(f => f.name === '描述性统计').length, 1);
  for (const doc of course) assert.deepEqual(imported.items[doc.id], { folderId: 'statistics', status: 'imported', inTree: false });
  assert.deepEqual(organizationInput(all, imported), organizationInput(docs, before));
  const changed = updateCollectionItem(imported, 'textbook', { folderId: 'machine-learning', status: 'studying', inTree: true });
  assert.deepEqual(reconcileCollection(changed, all), changed);
  const deleted = deleteFolder(changed, 'statistics');
  assert.deepEqual(reconcileCollection(deleted, all), deleted, 'Deleted folders are not recreated on reload');
  const sameName = createFolder(before, '描述性统计', 'user-folder');
  const merged = reconcileCollection(sameName, all);
  assert.equal(merged.items.textbook.folderId, 'user-folder');
  assert.equal(merged.folders.length, sameName.folders.length);
  assert.equal(reconcileCollection(null, all).items.textbook.folderId, 'statistics');
});

test('tree input contains descriptions and source references only; profile and note changes cannot invalidate its index', () => {
  const changed = structuredClone(docs);
  changed[0].intent = 'Private learning goal';
  changed[0].chapters[0].content = { type: 'doc', content: [{ type: 'text', text: 'Private note' }] };
  changed[0].knowledge = { background: 'Private profile' };
  assert.deepEqual(organizationInput(changed), organizationInput(docs));
  assert.equal(treeFingerprint(changed), treeFingerprint([...docs].reverse()));
  changed[0].chapters[0].title += ' changed';
  assert.notEqual(treeFingerprint(changed), treeFingerprint(docs));
  assert.throws(() => organizationMessages({ ...organizationInput(docs), instruction: 'arbitrary prompt' }));
  const messages = organizationMessages(organizationInput(docs));
  assert.match(messages[0].content, /引用数据/);
  assert.equal(JSON.parse(messages[1].content).documents.length, 3);
});

test('tree validates exact document coverage and real chapter links, and keeps newly added files visible', () => {
  const input = organizationInput(docs), valid = tree();
  assert.deepEqual(validateTree(input, JSON.stringify(valid)), valid);
  const missing = structuredClone(valid); missing.branches[0].documentIds.pop();
  assert.throws(() => validateTree(input, missing), /遗漏/);
  const repeated = structuredClone(valid); repeated.branches[0].documentIds[1] = 'adam';
  assert.throws(() => validateTree(input, repeated), /重复/);
  const badLink = structuredClone(valid); badLink.documents[0].concepts[0].chapterIds = ['missing'];
  assert.throws(() => validateTree(input, badLink), /章节/);
  const collection = { ...reconcileCollection(null, docs), tree: valid };
  assert.deepEqual(treeBranches([...docs.slice(1), paper('new')], collection).flatMap(b => b.documentIds).sort(), ['batch', 'new', 'wk10']);
});

test('organization repairs one invalid response, refuses repeated invalid links, and respects cancellation', async () => {
  const config = { baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: 'test' };
  const input = organizationInput(docs), requests = [];
  const output = { groups: [{ label: '训练与优化', description: '方法', documents: ['D1', 'D2', 'D3'] }] };
  const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
  const result = await organizeTree(config, input, undefined, async (_url, options) => {
    requests.push(JSON.parse(options.body)); return response(requests.length === 1 ? { groups: [{ label: '方法', documents: ['D1', 'D2'] }] } : output);
  });
  assert.deepEqual(result, decodeClassification(input, output)); assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /校验失败/);
  assert.deepEqual(JSON.parse(requests[1].messages.at(-1).content).failure.issues, [{ code: 'missing_documents', path: 'groups', refs: ['D3'] }]);
  let calls = 0;
  await assert.rejects(organizeTree(config, input, undefined, async () => { calls++; return response({ branches: [] }); }), { code: 'EXECUTION_BLOCKED' });
  assert.equal(calls, 5);
  const controller = new AbortController();
  await assert.rejects(organizeTree(config, input, controller.signal, async () => { controller.abort(); return response(output); }), { name: 'AbortError' });
});

test('folder context and inclusion constrain classification, fingerprints, and valid short-reference output', () => {
  let collection = reconcileCollection(null, docs);
  const original = structuredClone(docs);
  const input = organizationInput(docs, collection);
  const compiled = classificationInput(input);
  assert.deepEqual(compiled.folders, [{ ref: 'F1', name: '机器学习' }]);
  assert.equal(compiled.documents[0].folder, 'F1');
  assert.equal(compiled.documents[2].folder, null);
  assert.equal(compiled.documents[0].id, undefined);
  assert.equal(compiled.documents[0].chapters, undefined, 'No chapter IDs are generated by the model');
  const raw = { groups: [{ label: '训练与优化方法', documents: ['D1', 'D2'] }, { label: '课程资料', documents: ['D3'] }] };
  const result = decodeClassification(input, '```json\n' + JSON.stringify(raw) + '\n```');
  assert.deepEqual(result.branches[0].documentIds, ['adam', 'batch']);
  assert.equal(result.branches[0].folderId, 'machine-learning');
  assert.deepEqual(result.documents[0].concepts, []);
  assert.throws(() => decodeClassification(input, { groups: [{ label: '全部', documents: ['D1', 'D2', 'D3'] }] }), error => error.issues[0].code === 'mixed_folders');
  assert.throws(() => decodeClassification(input, { groups: [{ label: '方法', documents: ['D1', 'D1', 'D2', 'D99'] }] }), error => error.issues.some(issue => issue.code === 'unknown_document') && error.issues.some(issue => issue.code === 'duplicate_document'));
  const fingerprint = treeFingerprint(docs, collection);
  collection = updateCollectionItem(collection, 'batch', { inTree: false });
  assert.deepEqual(organizationInput(docs, collection).documents.map(d => d.id), ['adam', 'wk10']);
  assert.notEqual(treeFingerprint(docs, collection), fingerprint);
  assert.equal(Object.keys(collection.items).length, 3);
  assert.deepEqual(docs, original);
  assert.notEqual(treeFingerprint(docs, { ...collection, folders: [{ id: 'machine-learning', name: '优化专题' }] }), treeFingerprint(docs, collection));
  assert.deepEqual(treeBranches(docs, { ...collection, tree: result }).flatMap(branch => branch.documentIds).sort(), ['adam', 'wk10']);
});

test('classification diagnostics retain exact validation paths without source, prompts or secrets', async () => {
  const input = organizationInput(docs), diagnostics = [];
  const config = { baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: 'DO_NOT_LOG_THIS' };
  const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
  await assert.rejects(organizeTree(config, input, undefined, async () => response({ groups: [{ label: '方法', documents: ['D1'] }] }), { onDiagnostic: record => diagnostics.push(record) }), { code: 'EXECUTION_BLOCKED' });
  assert.equal(diagnostics[0].status, 'failed');
  assert.deepEqual(diagnostics[0].attempts[1].issues[0].refs, ['D2', 'D3']);
  assert.equal(diagnostics[0].attempts.length, 5);
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /DO_NOT_LOG_THIS|Attention|paragraph|messages|prompt|responseBody/);
});

test('tree presentation follows folder moves and exclusion immediately, and restores saved topics on re-inclusion', () => {
  let collection = { ...reconcileCollection(null, docs), tree: { ...tree(), version: 'study-tree-v1', generatedAt: 1, fingerprint: 'old-tree', model: 'test' } };
  const savedTree = structuredClone(collection.tree);
  collection = createFolder(collection, '优化专题', 'optimization');
  collection = updateCollectionItem(collection, 'adam', { folderId: 'optimization', inTree: false });
  assert.deepEqual(treeDomains(docs, collection).flatMap(domain => domain.documentIds).sort(), ['batch', 'wk10']);
  const reloaded = reconcileCollection(JSON.parse(JSON.stringify(collection)), docs);
  assert.equal(reloaded.items.adam.inTree, false);
  collection = updateCollectionItem(reloaded, 'adam', { inTree: true });
  const moved = treeDomains(docs, collection).find(domain => domain.id === 'optimization');
  assert.deepEqual(moved.documentIds, ['adam']);
  assert.equal(moved.topics[0].label, '优化与训练');
  assert.deepEqual(collection.tree, savedTree, 'Visibility and folder changes do not destroy the stored classification');
  for (const document of docs) collection = updateCollectionItem(collection, document.id, { inTree: false });
  assert.deepEqual(treeDomains(docs, collection), []);
  assert.deepEqual(organizationInput(docs, collection), { folders: [], documents: [] });
});

test('adaptive generation uses only stable profile even when legacy records or tree data are supplied', () => {
  const doc = docs[0];
  const request = { action: 'generate', scope: 'chapter', instruction: '整理', revision: 0, chapterId: doc.chapters[0].id, document: doc, knowledge: defaultKnowledge };
  const enriched = { ...addReadMaterial(defaultKnowledge, materialFromDocument(docs[1])), tree: tree(), status: 'completed' };
  const original = buildMessages(request);
  assert.deepEqual(buildMessages({ ...request, knowledge: enriched }), original);
  assert.deepEqual(JSON.parse(original[1].content).learner, learnerProfile(defaultKnowledge));
});
