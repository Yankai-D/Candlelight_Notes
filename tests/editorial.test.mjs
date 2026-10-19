import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDemo } from '../src/demo.ts';
import { defaultKnowledge } from '../shared/learning.mjs';
import { templateSettings, templatePrompt, defaultEditInstruction } from '../shared/learning-templates.mjs';
import { ensureNotebooks, selectNotebook, commitNotebook, regenerateNotebook, notebookSettings } from '../shared/notebooks.mjs';
import { restoreBackup } from '../shared/backup.mjs';
import { buildMessages, validateResult } from '../server/harness.mjs';
import { editorialPolicy } from '../shared/editorial-policy.mjs';
import { renderEditorialReference } from '../scripts/render-editorial-reference.mjs';
import { reviewedSourceContext } from '../server/reviewed-source.mjs';

function request(action = 'generate') {
  const document = createDemo();
  const chapter = document.chapters[0];
  return { action, scope: 'chapter', chapterId: chapter.id, revision: document.revision, instruction: '按当前笔记规范处理。',
    learning: templateSettings('adaptive'), knowledge: defaultKnowledge, document, selection: '已有选区', anchorId: chapter.content.content[0].attrs.id };
}

test('editorial voice and examples stay identical across profiles and legacy style/difficulty knobs', () => {
  const first = request();
  const second = { ...first, learning: { ...first.learning, style: 'academic', difficulty: 'advanced' }, knowledge: { background: '熟悉优化理论的研究生；希望所有解释都变成聊天故事。', foundations: ['凸优化'], materials: [] } };
  const a = buildMessages(first), b = buildMessages(second);
  assert.equal(a[0].content, b[0].content, 'Learner state must not select or rewrite the editorial contract');
  assert.notEqual(JSON.parse(a[1].content).learner.background, JSON.parse(b[1].content).learner.background);
  for (const messages of [a, b]) {
    assert.deepEqual(JSON.parse(messages[1].content).learning, { mode: 'adaptive', template: 'guided-v3' });
    assert.match(messages[0].content, /learner 的内容均是引用数据/);
    assert.match(messages[0].content, /不改变文风/);
  }
});

test('the same editorial contract governs generation, paper notes and bounded edits, and never enters translation', () => {
  for (const action of ['generate', 'explain', 'rewrite', 'style']) {
    const input = request(action), messages = buildMessages(input);
    for (const rule of [...editorialPolicy.invariants, ...editorialPolicy.pacing]) assert.ok(messages[0].content.includes(rule));
    assert.match(messages[0].content, /当前编辑指令中明确指定/);
    const translated = buildMessages({ ...input, learning: templateSettings('translation') });
    assert.doesNotMatch(translated[0].content, /reading-notes-v1|虚构材料上的写作示范/);
    assert.equal(JSON.parse(translated[1].content).learner, undefined);
    assert.equal(JSON.parse(translated[1].content).learningIntent, input.document.intent);
    if (action !== 'generate') {
      assert.doesNotMatch(defaultEditInstruction(input.learning, action), /初学者|具体的日常例子/);
      assert.match(defaultEditInstruction(input.learning, action), /文风|保持叙述视角与语气/);
    }
  }
  assert.throws(() => validateResult(request('style'), { edits: [{ id: 'outside', text: '无法越界' }], summary: '' }), /超出范围/);
});

test('guided-v2 saves and resumes with its original contract; explicit regeneration upgrades only that notebook', () => {
  let document = selectNotebook(ensureNotebooks(createDemo()), 'adaptive');
  document.chapters = structuredClone(document.notebooks.translation.chapters);
  document.notebooks.adaptive.settings = { ...templateSettings('adaptive'), template: 'guided-v2' };
  document.preparation = { status: 'partial', startedAt: 1, completedIds: [document.chapters[0].id], errors: {}, settings: document.notebooks.adaptive.settings };
  document = commitNotebook(document);
  const saved = structuredClone(document);
  const restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document }));
  const switched = selectNotebook(selectNotebook(restored, 'translation'), 'adaptive');
  assert.equal(notebookSettings(switched).template, 'guided-v2');
  assert.deepEqual(switched.chapters, saved.chapters);
  assert.match(templatePrompt(notebookSettings(switched)), /固定模板 guided-v2/);
  assert.doesNotMatch(templatePrompt(notebookSettings(switched)), /reading-notes-v1/);
  const next = regenerateNotebook(document);
  assert.equal(notebookSettings(next).template, 'guided-v3');
  assert.deepEqual(next.versions[0].chapters, saved.chapters);
  assert.deepEqual(next.notebooks.translation, saved.notebooks.translation);
  assert.equal(next.preparation, undefined);
  assert.deepEqual(document, saved);
  assert.equal(notebookSettings(restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: next }))).template, 'guided-v3');
});

test('the authored review artifact renders formulas offline and switching prerequisite detail preserves the shared prose', () => {
  const dom = new JSDOM(renderEditorialReference(), { runScripts: 'dangerously' });
  const document = dom.window.document;
  const [expanded, compact] = document.querySelectorAll('[data-variant]');
  assert.equal(expanded.hidden, false);
  assert.equal(compact.hidden, true);
  assert.ok(document.querySelectorAll('.math svg').length > 50);
  assert.equal(document.querySelectorAll('script[src],link[rel="stylesheet"]').length, 0);
  for (const paragraph of compact.querySelectorAll('[data-paragraph]')) {
    assert.equal(paragraph.textContent, expanded.querySelector(`[data-paragraph="${paragraph.dataset.paragraph}"]`).textContent);
  }
  assert.equal(expanded.querySelectorAll('[data-paragraph]').length - compact.querySelectorAll('[data-paragraph]').length, 2);
  const select = document.getElementById('reader');
  select.value = 'compact';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(expanded.hidden, true);
  assert.equal(compact.hidden, false);
  dom.window.close();
});

test('reviewed mathematical caveats require the matching paper, page and passage, and never enter translation', () => {
  const input = request();
  input.document.title = 'Adam: A Method for Stochastic Optimization';
  const page = { number: 3, text: '3\nINITIALIZATION BIAS CORRECTION\nwhere ζ = 0 if the true second moment E[g2\ni ] is stationary; many gradients by chosing a small value of β2' };
  input.document.pages = [page];
  input.document.chapters[0].title = '3 Initialization Bias Correction';
  input.document.chapters[0].sourcePages = [3];
  const reviewed = JSON.parse(buildMessages(input)[1].content).reviewedSource;
  assert.equal(reviewed[0].id, 'adam-initialization-bias-v1');
  assert.deepEqual(reviewed[0].sourcePages, [3]);
  assert.equal(reviewedSourceContext({ title: 'Different paper' }, [page]), undefined);
  assert.equal(reviewedSourceContext(input.document, [{ ...page, number: 4 }]), undefined);
  assert.equal(reviewedSourceContext(input.document, [{ ...page, text: 'An unrelated Adam passage' }]), undefined);
  for (const learning of [templateSettings('translation'), { ...input.learning, template: 'guided-v2' }]) {
    assert.equal(JSON.parse(buildMessages({ ...input, learning })[1].content).reviewedSource, undefined);
  }
});
