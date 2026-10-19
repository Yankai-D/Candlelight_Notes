import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.ts';
import { commitNotebook, ensureNotebooks, selectNotebook, regenerateNotebook, restoreNotebookVersion, notebookSettings } from '../shared/notebooks.mjs';
import { templateSettings } from '../shared/learning-templates.mjs';
import { defaultKnowledge } from '../shared/learning.mjs';
import { prepareDocument } from '../shared/preparation.mjs';
import { restoreBackup } from '../shared/backup.mjs';
import { applyResult, textOf } from '../shared/document.mjs';
import { buildMessages, validateResult, runModel } from '../server/harness.mjs';

const output = (text, section) => ({ blocks: [{ type: 'paragraph', text, ...(section ? { section } : {}) }], summary: '' });
function fixture() {
  const source = createDemo();
  return ensureNotebooks({ ...source, demo: false, chapters: source.chapters.slice(0, 2).map(c => ({ ...c, content: { type: 'doc', content: [] }, status: 'empty' })) });
}

test('first visit creates only adaptive notes; each edition retains content, paper notes, reading position and history across switches and backup', async () => {
  let latest = fixture();
  assert.deepEqual(Object.keys(latest.notebooks), ['adaptive']);
  assert.equal(notebookSettings(latest).mode, 'adaptive');
  assert.equal(notebookSettings(latest).template, 'guided-v3');
  const calls = [];
  const prepare = () => prepareDocument({ document: latest, settings: notebookSettings(latest), knowledge: defaultKnowledge,
    getLatest: () => latest, save: async value => { latest = commitNotebook(value); },
    request: async (doc, chapterId, settings, background) => {
      calls.push([doc.activeNotebookId, chapterId]);
      assert.equal(Boolean(background), settings.mode === 'adaptive');
      return output(`${settings.mode} ${chapterId}`);
    } });
  await prepare();
  const chapterId = latest.chapters[0].id;
  latest = commitNotebook(applyResult(latest, { action: 'explain', chapterId, anchorId: latest.chapters[0].content.content[0].attrs.id, revision: latest.revision }, { title: '我的补充', paragraphs: ['适应版的个人理解'], sourcePages: [] }));
  latest = commitNotebook({ ...latest, currentChapter: latest.chapters[1].id, currentPage: 2, readingAnchor: { chapterId, blockId: 'reading-block', fraction: 0.3 },
    versions: [{ id: 'before-note', label: '原笔记', time: 1, chapters: structuredClone(latest.chapters) }] });
  const adaptive = structuredClone(latest.notebooks.adaptive);
  latest = selectNotebook(latest, 'translation');
  assert.equal(latest.chapters.every(c => c.status === 'empty'), true);
  assert.equal(latest.versions.length, 0);
  await prepare();
  const translation = structuredClone(latest.notebooks.translation);
  assert.equal(calls.length, 4);
  latest = selectNotebook(latest, 'adaptive');
  assert.deepEqual(latest.notebooks.adaptive, adaptive);
  assert.equal(latest.currentChapter, adaptive.currentChapter);
  assert.deepEqual(latest.readingAnchor, adaptive.readingAnchor);
  assert.match(textOf(latest.chapters[0].content), /适应版的个人理解/);
  await prepare();
  assert.equal(calls.length, 4, 'Returning to saved notes must not call a model');
  latest = selectNotebook(latest, 'adaptive');
  assert.deepEqual(latest.chapters, adaptive.chapters);
  assert.deepEqual(latest.versions, adaptive.versions);
  const restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: latest }));
  assert.equal(restored.activeNotebookId, 'adaptive');
  assert.deepEqual(restored.notebooks.translation, JSON.parse(JSON.stringify(translation)));
  assert.deepEqual(restored.chapters, adaptive.chapters);
  assert.deepEqual(selectNotebook(restored, 'translation').chapters, translation.chapters);
  const broken = structuredClone(latest);
  broken.notebooks.translation.preparation.completedIds.push('missing');
  assert.throws(() => restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: broken })), /初始化进度/);
});

test('untouched old shelves adopt the new default once, while saved notes and explicit mode choices remain intact', () => {
  const empty = fixture();
  let old = selectNotebook(empty, 'translation');
  delete old.notebooks.adaptive;
  delete old.notebookDefaultsVersion;
  const migrated = ensureNotebooks(old);
  assert.equal(migrated.activeNotebookId, 'adaptive');
  assert.equal(migrated.notebookDefaultsVersion, 1);
  assert.deepEqual(migrated.notebooks.translation, old.notebooks.translation);
  const chosen = selectNotebook(migrated, 'translation');
  assert.equal(ensureNotebooks(chosen).activeNotebookId, 'translation');
  const restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: chosen }));
  assert.equal(ensureNotebooks(restored).activeNotebookId, 'translation');
  const written = ensureNotebooks(createDemo());
  delete written.notebookDefaultsVersion;
  const before = structuredClone(written);
  assert.equal(ensureNotebooks(written).activeNotebookId, 'translation');
  assert.deepEqual(ensureNotebooks(written).notebooks, before.notebooks);
  const started = structuredClone(old);
  started.preparation = { status: 'paused', startedAt: 1, completedIds: [], errors: {}, settings: templateSettings('translation') };
  assert.equal(ensureNotebooks(started).activeNotebookId, 'translation');
});

test('explicit regeneration snapshots only the current notebook and restored complete history stays complete', () => {
  let doc = ensureNotebooks(createDemo());
  const translation = structuredClone(doc.notebooks.translation);
  doc = selectNotebook(doc, 'adaptive');
  doc = restoreNotebookVersion(doc, translation.chapters);
  const previous = structuredClone(doc.chapters);
  doc = regenerateNotebook(doc);
  assert.ok(doc.chapters.every(c => c.status === 'empty'));
  assert.equal(doc.preparation, undefined);
  assert.deepEqual(doc.versions[0].chapters, previous);
  assert.deepEqual(doc.notebooks.translation, translation);
  doc = restoreNotebookVersion(doc, doc.versions[0].chapters);
  assert.deepEqual(doc.chapters, previous);
  assert.equal(doc.preparation.status, 'complete');
  assert.deepEqual(doc.notebooks.translation, translation);
});

test('legacy adaptive notebook is archived with its edits and progress, while new translation remains independent', () => {
  const legacy = createDemo();
  legacy.preparation = { status: 'complete', startedAt: 1, completedIds: legacy.chapters.map(c => c.id), errors: {}, settings: { mode: 'adaptive', difficulty: 'advanced', style: 'derivation' } };
  let doc = ensureNotebooks(legacy);
  assert.equal(doc.activeNotebookId, 'adaptive-legacy');
  assert.deepEqual(doc.chapters, legacy.chapters);
  doc = selectNotebook(doc, 'translation');
  assert.ok(doc.chapters.every(c => c.status === 'empty'));
  doc = selectNotebook(doc, 'adaptive-legacy');
  assert.deepEqual(doc.chapters, legacy.chapters);
  assert.deepEqual(doc.preparation, legacy.preparation);
  assert.equal(notebookSettings(doc).template, 'legacy');
  assert.throws(() => regenerateNotebook(doc), /旧版/);
});

test('a late completion cannot write into a different notebook with the same paper id and revision', async () => {
  let latest = fixture();
  let calls = 0;
  await prepareDocument({ document: latest, settings: notebookSettings(latest), getLatest: () => latest,
    save: async value => { latest = commitNotebook(value); }, request: async () => {
      calls++;
      latest = selectNotebook(latest, 'translation');
      return output('wrong notebook');
    } });
  assert.equal(calls, 1);
  assert.equal(latest.activeNotebookId, 'translation');
  assert.equal(latest.preparation, undefined);
  assert.ok(latest.chapters.every(c => !textOf(c.content)));
  assert.ok(latest.notebooks.adaptive.chapters.every(c => !textOf(c.content)));
});

test('adaptive notes integrate teaching into source-ordered prose and preserve paragraph order across segments', async () => {
  const doc = fixture();
  doc.pages = [{ number: 1, text: 'Source sentence.\n'.repeat(2200) }];
  const chapterId = doc.chapters[0].id;
  const request = { action: 'generate', scope: 'chapter', revision: 0, chapterId, instruction: '整理', learning: templateSettings('adaptive'), knowledge: defaultKnowledge, document: doc };
  const messages = buildMessages(request);
  assert.match(messages[0].content, /固定模板 guided-v3/);
  assert.match(messages[0].content, /概念第一次出现时/);
  assert.doesNotMatch(messages[0].content, /"section":/);
  assert.equal(validateResult(request, output('连贯正文中的译述与解释。')).blocks[0].text, '连贯正文中的译述与解释。');
  assert.throws(() => validateResult(request, output('a separate block', 'intuition')), /连贯正文/);
  assert.throws(() => validateResult(request, { blocks: [{ type: 'heading', text: '必要背景' }, { type: 'paragraph', text: '另起一节' }] }), /连贯正文/);
  const originalHeading = { type: 'heading', text: '3. 偏差修正' };
  assert.equal(validateResult(request, { blocks: [originalHeading, { type: 'paragraph', text: '原文的实质性小节继续保留。' }] }).blocks[0].text, originalHeading.text);
  const translation = validateResult({ ...request, learning: templateSettings('translation') }, output('pure text', 'translation'));
  assert.equal(translation.blocks[0].section, undefined);
  let calls = 0;
  const raw = await runModel({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-only' }, messages, undefined, async () => {
    calls++;
    const blocks = [`原文论证与随文解释-${calls}`, `承接前文的直觉与推导-${calls}`].map(text => ({ type: 'paragraph', text, sourcePages: [1] }));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ blocks }) } }] }));
  }, { action: 'generate' });
  const edited = applyResult(doc, request, validateResult(request, raw));
  assert.ok(calls > 1);
  const nodes = edited.chapters[0].content.content;
  assert.equal(nodes.filter(n => n.type === 'heading').length, 0);
  assert.deepEqual(nodes.map(textOf), Array.from({ length: calls }, (_, i) => [`原文论证与随文解释-${i+1}`, `承接前文的直觉与推导-${i+1}`]).flat());
  assert.ok(nodes.every(node => node.attrs.sourcePages[0] === 1));
});

test('existing sectioned notebooks stay saved and resume consistently; explicit regeneration adopts the integrated template', () => {
  let doc = selectNotebook(ensureNotebooks(createDemo()), 'adaptive');
  const request = { action: 'generate', scope: 'chapter', revision: 0, chapterId: doc.chapters[0].id, instruction: '整理', learning: { ...templateSettings('adaptive'), template: 'guided-v1' }, knowledge: defaultKnowledge, document: doc };
  const oldResult = { blocks: [{ type: 'paragraph', section: 'translation', text: '已有译文。' }, { type: 'paragraph', section: 'intuition', text: '已有独立讲解。' }] };
  doc = applyResult(doc, request, validateResult(request, oldResult));
  doc.notebooks.adaptive.settings = request.learning;
  doc.preparation = { status: 'partial', startedAt: 1, settings: request.learning, completedIds: [request.chapterId], errors: {} };
  doc = commitNotebook(doc);
  const saved = structuredClone(doc);
  const restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: doc }));
  assert.deepEqual(ensureNotebooks(restored).chapters, saved.chapters);
  assert.equal(notebookSettings(restored).template, 'guided-v1');
  assert.deepEqual(selectNotebook(selectNotebook(doc, 'translation'), 'adaptive').chapters, saved.chapters);
  const regenerated = regenerateNotebook(doc);
  assert.equal(notebookSettings(regenerated).template, 'guided-v3');
  assert.equal(regenerated.preparation, undefined);
  assert.deepEqual(regenerated.versions[0].chapters, saved.chapters);
  assert.deepEqual(regenerated.notebooks.translation, saved.notebooks.translation);
  assert.deepEqual(doc, saved, 'Upgrading the template must not mutate the saved notebook');
});

test('invalid JSON math escapes receive the precise parser error and a correctly escaped example before retry', async () => {
  const doc = fixture();
  const request = { action: 'generate', scope: 'chapter', revision: 0, chapterId: doc.chapters[0].id, instruction: '整理', learning: templateSettings('adaptive'), knowledge: defaultKnowledge, document: doc };
  let calls = 0;
  const malformed = String.raw`{"blocks":[{"type":"paragraph","text":"\(\eta_t\)"}]}`;
  const valid = output(String.raw`学习率为 \(\eta_t\)。`);
  const raw = await runModel({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-only' }, buildMessages(request), undefined, async (_url, options) => {
    const messages = JSON.parse(options.body).messages;
    if (++calls === 2) {
      assert.match(messages.at(-1).content, /Bad escaped character/);
      assert.ok(messages.at(-1).content.includes(JSON.stringify({ text: String.raw`\(m_t = \beta_1 m_{t-1} + (1-\beta_1)g_t\)` })));
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: calls === 1 ? malformed : JSON.stringify(valid) } }] }));
  }, { action: 'generate' });
  assert.equal(calls, 2);
  assert.equal(JSON.parse(raw).blocks[0].text, valid.blocks[0].text);
});
