import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.ts';
import { mergeLibrary, orderLibraryDocuments } from '../shared/library.mjs';
import { restoreBackup } from '../shared/backup.mjs';

function paper() {
  return { ...createDemo(), id: 'paper-test', demo: false, title: 'A real source', library: { id: 'test', label: 'Test paper', group: 'Training', year: '2020', authors: 'Author', order: 0 } };
}

test('new collection replaces the untouched demo in the visible shelf and preserves all user notes', () => {
  const demo = createDemo();
  const edited = { ...paper(), revision: 5, currentPage: 4, intent: 'My own learning goal' };
  const { documents, added } = mergeLibrary([demo, edited], [paper()]);
  assert.deepEqual(documents, [edited]);
  assert.equal(added.length, 0);
  assert.equal(demo.id, 'attention-demo', 'Hidden demo data is not deleted or modified');
  const modifiedDemo = { ...demo, revision: 1 };
  assert.ok(mergeLibrary([modifiedDemo], [paper()]).documents.includes(modifiedDemo));
});

test('catalog imports are idempotent and explicitly removed papers do not come back', () => {
  const first = mergeLibrary([], [paper()]);
  assert.equal(first.added.length, 1);
  assert.equal(mergeLibrary(first.documents, [paper()]).added.length, 0);
  assert.equal(mergeLibrary([], [paper()], ['paper-test']).documents.length, 0);
});

test('booklist order is stable after reading, editing and reloading, and does not mutate stored documents', () => {
  const first = { ...createDemo(), id: 'import-first', createdAt: 100, updatedAt: 100 };
  const second = { ...createDemo(), id: 'import-second', createdAt: 200, updatedAt: 200 };
  const catalog = paper();
  const documents = [first, second, catalog];
  const ordered = orderLibraryDocuments(documents).map(d => d.id);
  assert.deepEqual(ordered, [catalog.id, second.id, first.id]);
  first.updatedAt = 10000;
  first.revision++;
  assert.deepEqual(orderLibraryDocuments(documents).map(d => d.id), ordered);
  assert.deepEqual(mergeLibrary(documents, [catalog]).documents.map(d => d.id), ordered);
  assert.deepEqual(documents.map(d => d.id), [first.id, second.id, catalog.id]);
});

test('backup preserves the local source reference and learning metadata without a filesystem path', () => {
  const original = paper();
  original.library.placement = { folder: { id: 'course', name: '描述性统计' }, inTree: false };
  const restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: original }));
  assert.deepEqual(restored.library, original.library);
  assert.notEqual(restored.id, original.id);
  assert.throws(() => restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: { ...original, library: { ...original.library, id: '../../secret' } } })), /有效/);
});
