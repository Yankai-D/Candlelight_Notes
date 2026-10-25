import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionSchema, createFolder, updateFolder, deleteFolder, reconcileCollection } from '../shared/collection.mjs';
import { bundleForDocument, folderOutline, folderPath } from '../shared/folders.mjs';
import { treeEntries } from '../shared/study-tree.mjs';
import { captureBundleContext, contextForMaterial, createBundleNote, bundleMaterials, bundlePlanRequest, validateBundlePlan, applyBundlePlan } from '../shared/bundle-context.mjs';
import { buildMessages, runModel, validateResult, splitSource } from '../server/harness.mjs';
import { ensureNotebooks, commitNotebook, regenerateNotebook, restoreNotebookVersion } from '../shared/notebooks.mjs';
import { prepareDocument } from '../shared/preparation.mjs';
import { restoreBackup } from '../shared/backup.mjs';

const material = (id, text = 'The mean is the sum of observations divided by the count.') => ({ id, title: id, subtitle: '', filename: `${id}.txt`, kind: 'text', intent: '看懂这篇文章', createdAt: 1, updatedAt: 1, revision: 0, versions: [],
  pages: [{ number: 1, text }], chapters: [{ id: `${id}-chapter`, title: 'Mean', sourcePages: [1], status: 'empty', content: { type: 'doc', content: [] } }], currentChapter: `${id}-chapter`, currentPage: 1 });
const documents = [material('math'), material('unit'), material('english', 'A phrase describes a group of words.'), material('outside', 'OUTSIDE PRIVATE CONTEXT')];
function collection() {
  let value = { version: 1, folders: [], items: {} };
  for (const [id, parentId] of [['final', null], ['maths', 'final'], ['unit1', 'maths'], ['english', 'final']]) value = createFolder(value, id, id, { kind: 'bundle', parentId });
  value.items = Object.fromEntries(['maths', 'unit1', 'english', null].map((folderId, index) => [documents[index].id, { folderId, status: 'imported', inTree: true }]));
  return value;
}

test('nested folders validate ancestry, allow sibling-subject unit names, and dissolve containers without losing contents', () => {
  let c = collection();
  c = createFolder(c, 'unit1', 'english-unit', { parentId: 'english', kind: 'bundle' });
  assert.equal(folderPath(c, 'unit1'), 'final / maths / unit1');
  assert.equal(folderOutline(c).find(f => f.id === 'unit1').depth, 2);
  assert.equal(bundleForDocument(c, 'unit').id, 'unit1');
  assert.throws(() => updateFolder(c, 'final', { parentId: 'unit1' }), /自己/);
  assert.throws(() => updateFolder(c, 'maths', { parentId: 'missing' }), /不存在/);
  assert.throws(() => collectionSchema.parse({ ...c, folders: [...c.folders, c.folders[0]] }), /重复/);
  c = deleteFolder(c, 'maths');
  assert.equal(c.items.math.folderId, 'final');
  assert.equal(c.folders.find(f => f.id === 'unit1').parentId, 'final');
  assert.equal(c.items.unit.folderId, 'unit1');
  assert.equal(c.folders.length, 4);
});

test('material context chooses nearest bundle; independent note scopes include descendants, exclude siblings and notes', () => {
  const c = collection();
  const context = contextForMaterial(documents[0], documents, c);
  assert.deepEqual(context.sources.map(s => s.id), ['math', 'unit']);
  assert.equal(contextForMaterial(documents[3], documents, c), undefined);
  assert.deepEqual(captureBundleContext(documents, c, 'final').sources.map(s => s.id), ['math', 'unit', 'english']);
  const note = createBundleNote(context, 'Revision');
  c.items[note.id] = { folderId: 'maths', status: 'imported', inTree: false };
  assert.equal(bundleMaterials([...documents, note], c, 'final').length, 3);
  assert.equal(note.pages[1].sourceId, 'unit'); assert.equal(note.pages[1].sourcePage, 1); assert.equal(note.pages[1].number, 2);
  const frozen = JSON.stringify(context);
  c.items.unit.folderId = 'english';
  assert.equal(JSON.stringify(context), frozen);
  assert.throws(() => captureBundleContext([], c, 'maths'), /先/);
});

test('only outermost enabled bundle appears in the tree and includes recursive members without duplicate leaves', () => {
  let c = updateFolder(collection(), 'maths', { inTree: true });
  c = updateFolder(c, 'unit1', { inTree: true });
  assert.deepEqual(treeEntries(documents, c).map(e => e.id), ['outside', 'bundle:maths']);
  assert.equal(treeEntries(documents, c)[1].members.length, 2);
  c = updateFolder(c, 'final', { inTree: true });
  assert.deepEqual(treeEntries(documents, c).map(e => e.id), ['outside', 'bundle:final']);
  assert.equal(treeEntries(documents, c)[1].members.length, 3);
});

test('plan validates complete provenance coverage across analysis and repair, and preserves page identity through chunking', async () => {
  const note = createBundleNote(captureBundleContext(documents, collection(), 'maths'), '复习');
  const input = bundlePlanRequest(note);
  const valid = { sections: input.units.map(unit => ({ title: unit.title, purpose: 'Explain the mean and its interpretation.', unitIds: [unit.id] })) };
  assert.throws(() => validateBundlePlan(input, { sections: [valid.sections[0]] }), /遗漏/);
  assert.throws(() => validateBundlePlan(input, { sections: [{ ...valid.sections[0], unitIds: ['fake'] }] }), /来源/);
  assert.throws(() => validateBundlePlan(input, { sections: Array(4).fill(valid.sections[0]) }), /遗漏|重复/);
  let calls = 0, outlines = 0;
  const result = await runModel({ apiKey: 'mock', model: 'mock', baseUrl: 'http://localhost' }, buildMessages(input), undefined, async (_url, options) => {
    calls++;
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content), system = messages[0].content;
    let result;
    if (system.startsWith('bundle-intent-v1')) result = { kind: 'lecture', requirements: [{ id: 'r1', text: input.intent, evidenceQuote: input.intent }], organization: '按概念依赖整理。', limitations: [] };
    else if (system.startsWith('bundle-materials-v1')) result = { units: context.units.map(unit => ({ id: unit.id, topics: ['均值'], prerequisites: [], role: '解释概念', limitations: [] })) };
    else if (system.startsWith('bundle-plan-review-v1')) result = { candidateDigest: context.candidateDigest, verdict: 'accept', checks: ['goal','coverage','order','coherence'].map(dimension => ({ dimension, status: 'pass' })), findings: [], summary: '完整覆盖。' };
    else { outlines++; result = { sections: (outlines === 1 ? [valid.sections[0]] : valid.sections).map(section => ({ ...section, requirementIds: ['r1'], dependsOn: [], handoff: '各节互补。' })) }; }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  });
  assert.equal(calls, 5); assert.equal(outlines, 2);
  assert.deepEqual(validateResult(input, result).sections.map(({ requirementIds, dependsOn, handoff, ...section }) => section), valid.sections);
  const planned = applyBundlePlan(note, valid);
  assert.deepEqual(planned.chapters.flatMap(c => c.sourcePages), [1, 2]);
  assert.ok(splitSource(note.pages, 20).flat().every(page => page.sourceId && page.sourcePage === 1));
});

test('package reference prompts separate primary evidence, bounded excerpts, stable profile and translation', () => {
  const context = captureBundleContext(documents, collection(), 'maths');
  const request = { action: 'generate', scope: 'chapter', instruction: 'Explain the mean', revision: 0, documentId: 'math', chapterId: 'math-chapter', document: documents[0], bundleContext: context, learning: { mode: 'adaptive' }, knowledge: { background: 'beginner', foundations: [] } };
  const messages = buildMessages(request), data = JSON.parse(messages[1].content);
  assert.deepEqual(data.relatedMaterials.sources.map(s => s.id), ['unit']);
  assert.equal(data.relatedMaterials.evidenceMode, 'bounded-excerpts');
  assert.doesNotMatch(JSON.stringify(messages), /OUTSIDE PRIVATE/);
  assert.match(messages[0].content, /不是用户画像/);
  const translation = JSON.parse(buildMessages({ ...request, learning: { mode: 'translation' } })[1].content);
  assert.equal(translation.relatedMaterials, undefined); assert.equal(translation.learner, undefined);
});

test('standalone notes resume only missing chapters, preserve source snapshots, and round-trip after regeneration/history restore', async () => {
  let note = ensureNotebooks(createBundleNote(captureBundleContext(documents, collection(), 'maths'), '复习讲义'));
  const input = bundlePlanRequest(note);
  note = commitNotebook(applyBundlePlan(note, { sections: input.units.map(unit => ({ title: unit.title, purpose: 'Review the mean.', unitIds: [unit.id] })) }));
  let calls = [];
  const run = failed => prepareDocument({ document: note, getLatest: () => note, save: async value => { note = commitNotebook(value); }, request: async (latest, id) => {
    calls.push(id); if (failed && id === note.chapters[1].id) throw new Error('offline');
    return { blocks: [{ type: 'paragraph', text: '均值描述数据的位置。', sourcePages: latest.chapters.find(c => c.id === id).sourcePages }] };
  } });
  await run(true); assert.equal(note.preparation.status, 'partial');
  const first = structuredClone(note.chapters[0]); calls = [];
  await run(false); assert.deepEqual(calls, [note.chapters[1].id]); assert.deepEqual(note.chapters[0], first);
  let restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: note }));
  assert.deepEqual(restored.sourceContext, note.sourceContext); assert.deepEqual(restored.pages, note.pages);
  const oldChapters = note.chapters;
  note = { ...regenerateNotebook(note), composition: { version: 1, planned: false } };
  note = commitNotebook(applyBundlePlan(note, { sections: [{ title: '综合复习', purpose: 'Combine sources.', unitIds: input.units.map(unit => unit.id) }] }));
  restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: note }));
  assert.equal(restored.versions[0].chapters.length, 2); assert.equal(restored.chapters.length, 1);
  restored = restoreNotebookVersion(restored, oldChapters);
  assert.equal(restored.composition.planned, true); assert.equal(restored.preparation.status, 'complete');
  assert.equal(reconcileCollection(collection(), [...documents, restored]).items[restored.id].folderId, null);
});
