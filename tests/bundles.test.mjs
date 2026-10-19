import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionSchema, createFolder, updateFolder, updateCollectionItem, deleteFolder, reconcileCollection } from '../shared/collection.mjs';
import { bundleTreeId } from '../shared/folders.mjs';
import { organizationInput, organizationRequestSchema, treeEntries, treeDomains, treeBranches, treeEntryStatus, treeFingerprint } from '../shared/study-tree.mjs';
import { decodeClassification } from '../server/organization-protocol.mjs';

const documents = ['textbook', 'slides', 'other'].map(id => ({ id, title: id, subtitle: 'Public course materials', kind: 'pdf',
  pages: [{ number: 1, text: 'Statistics: mean, median and standard deviation.' }],
  chapters: [{ id: `${id}-chapter`, title: 'Introduction', sourcePages: [1], status: 'ready', content: { type: 'doc', content: [{ type: 'text', text: 'User note' }] } }],
  revision: 4, versions: [{ label: 'Before editing' }], currentPage: 1,
}));
const base = () => ({ version: 1, folders: [{ id: 'course', name: '统计课程' }], items: {
  textbook: { folderId: 'course', inTree: true, status: 'studying' },
  slides: { folderId: 'course', inTree: false, status: 'imported' },
  other: { folderId: null, inTree: true, status: 'imported' },
} });

test('folder types are optional for legacy data; creating and editing bundles defaults to excluded', () => {
  assert.deepEqual(collectionSchema.parse(base()), base());
  const original = base();
  const bundle = updateFolder(original, 'course', { kind: 'bundle' });
  assert.deepEqual(bundle.folders[0], { id: 'course', name: '统计课程', kind: 'bundle', inTree: false });
  assert.deepEqual(original, base());
  const created = createFolder(original, '联合复习', 'review', { kind: 'bundle' });
  assert.equal(created.folders[1].inTree, false);
  const enabled = updateFolder(bundle, 'course', { inTree: true });
  const renamed = updateFolder(enabled, 'course', { name: '期末复习' });
  assert.equal(renamed.folders[0].kind, 'bundle');
  assert.equal(renamed.folders[0].inTree, true);
  assert.deepEqual(reconcileCollection(renamed, documents), renamed);
  assert.throws(() => updateFolder(created, 'course', { name: '联合复习' }), /同名/);
  assert.throws(() => createFolder(original, '另一名称', 'course'), /编号/);
});

test('bundle inclusion exposes one node and never member leaves, including stale saved trees', () => {
  const snapshot = structuredClone(documents);
  const previous = base();
  const input = organizationInput(documents, previous);
  previous.tree = { ...decodeClassification(input, { groups: [{ label: '课程', documents: ['D1'] }, { label: '其他', documents: ['D2'] }] }),
    version: 'study-tree-v1', generatedAt: 1, fingerprint: treeFingerprint(documents, previous), model: 'test' };
  const bundle = updateFolder(previous, 'course', { kind: 'bundle' });
  assert.deepEqual(treeEntries(documents, bundle).map(d => d.id), ['other']);
  assert.deepEqual(organizationInput(documents, bundle).documents.map(d => d.id), ['other']);
  assert.deepEqual(treeBranches(documents, bundle).flatMap(b => b.documentIds), ['other']);
  const enabled = updateFolder(bundle, 'course', { inTree: true });
  const expected = ['other', bundleTreeId('course')].sort();
  assert.deepEqual(treeDomains(documents, enabled).flatMap(d => d.documentIds).sort(), expected);
  assert.deepEqual(treeBranches(documents, enabled).flatMap(d => d.documentIds).sort(), expected);
  const next = organizationInput(documents, enabled);
  organizationRequestSchema.parse(next);
  assert.deepEqual(next.documents.map(d => d.id).sort(), expected);
  assert.match(next.documents.find(d => d.id === bundleTreeId('course')).description, /textbook\nslides/);
  assert.equal(next.documents.some(d => d.id === 'slides' || d.id === 'textbook'), false);
  assert.deepEqual(decodeClassification(next, { groups: [{ label: '统计课程', documents: ['D1', 'D2'] }] }).branches[0].documentIds.sort(), expected);
  assert.notEqual(treeFingerprint(documents, bundle), treeFingerprint(documents, enabled));
  assert.deepEqual(documents, snapshot, 'Changing folders never changes source files, notes or versions');
  assert.deepEqual(enabled.items, previous.items, 'Independent tree preferences remain available for conversion back');
});

test('moving files and converting back restore independent settings without leaking bundle members', () => {
  let collection = updateFolder(base(), 'course', { kind: 'bundle', inTree: true });
  assert.throws(() => updateCollectionItem(collection, 'slides', { inTree: true }), /联合资料包/);
  collection = updateCollectionItem(collection, 'other', { folderId: 'course' });
  assert.deepEqual(treeEntries(documents, collection).map(d => d.id), [bundleTreeId('course')]);
  collection = updateCollectionItem(collection, 'textbook', { folderId: null });
  assert.ok(treeEntries(documents, collection).some(d => d.id === 'textbook'));
  const restored = updateFolder(collection, 'course', { kind: 'folder' });
  assert.deepEqual(treeEntries(documents, restored).map(d => d.id), ['textbook', 'other']);
  assert.deepEqual(treeEntries(documents, deleteFolder(collection, 'course')).map(d => d.id), ['textbook', 'other']);
  const empty = updateFolder(base(), 'course', { kind: 'bundle', inTree: true });
  assert.equal(treeEntries([], empty).length, 0);
});

test('package status follows member progress, and long folder identifiers remain valid for classification', () => {
  let collection = updateFolder(base(), 'course', { kind: 'bundle', inTree: true });
  const entry = treeEntries(documents, collection).find(d => d.kind === 'bundle');
  assert.equal(treeEntryStatus(entry, collection), 'studying');
  collection = updateCollectionItem(updateCollectionItem(collection, 'textbook', { status: 'completed' }), 'slides', { status: 'completed' });
  assert.equal(treeEntryStatus(entry, collection), 'completed');
  const id = 'x'.repeat(100);
  collection.folders[0].id = id;
  collection.items.textbook.folderId = id; collection.items.slides.folderId = id;
  organizationRequestSchema.parse(organizationInput(documents, collection));
});

test('catalog-created bundles retain their kind and exclusion through collection reconciliation', () => {
  const source = { ...documents[0], library: { placement: { folder: { id: 'new-course', name: '新课程', kind: 'bundle' }, inTree: true } } };
  const collection = reconcileCollection(null, [source]);
  assert.equal(collection.folders.find(f => f.id === 'new-course').kind, 'bundle');
  assert.equal(treeEntries([source], collection).length, 0);
  assert.deepEqual(reconcileCollection(collection, [source]), collection);
});
