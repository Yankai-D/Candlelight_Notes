import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import { builtInTemplates, freshTemplateLibrary, changeTemplateLibrary, templateLibrarySchema, templateSnapshot, writingTemplatePrompt, TEMPLATE_LIBRARY_KEY } from '../shared/writing-templates.mjs';
import { commitTemplateLibrary, readTemplateLibrary } from '../shared/template-library-store.mjs';
import { templateCatalog, templateRoutingRequest, selectedTemplate } from '../shared/template-routing.mjs';
import { freshCourseSample } from '../shared/course-style.mjs';
import { buildMessages, validateResult, runModel } from '../server/harness.mjs';
import { prepareDocument } from '../shared/preparation.mjs';
import { templateSettings } from '../shared/learning-templates.mjs';
import { notebookSettings, ensureNotebooks, commitNotebook } from '../shared/notebooks.mjs';
import { restoreBackup } from '../shared/backup.mjs';
import { createDemo } from '../src/demo.ts';
import { parseMath } from '../shared/math.mjs';

const library = () => freshTemplateLibrary();
const sample = () => structuredClone(builtInTemplates[1].defaultSample);
const definition = i => ({ name: `方法手册 ${i}`, audience: '工程实践教程', organization: '按任务、操作步骤、原理和结果核对组织，知识单元独立查阅。' });
const custom = (value, i) => changeTemplateLibrary(value, { type: 'add', id: `custom-${i}`, definition: definition(i), sample: sample() });
const emptyDocument = () => ensureNotebooks({ ...createDemo(), id: 'routing-fixture', demo: false, chapters: createDemo().chapters.slice(0, 2).map(c => ({ ...c, status: 'empty', content: { type: 'doc', content: [] } })) });
const generated = text => ({ blocks: [{ type: 'paragraph', text, sourcePages: [] }], summary: '' });
const config = { baseUrl: 'https://api.deepseek.com', model: 'mock', apiKey: 'not-a-real-key' };
const completion = value => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }) });

test('two distinct built-ins, five-template cap, immutable defaults, unique names and independent samples', () => {
  let value = library();
  assert.deepEqual(value.templates.map(t => t.layout), ['narrative', 'structured']);
  assert.ok(sample().paragraphs.some(p => p.text.startsWith('## ')));
  const original = structuredClone(value), personal = sample(); personal.paragraphs[0].text += '\n\n额外的表达示范。';
  value = changeTemplateLibrary(value, { type: 'edit', id: 'lecture', sample: personal });
  assert.deepEqual(value.templates[0], original.templates[0]);
  assert.deepEqual(value.templates[1].defaultSample, original.templates[1].defaultSample);
  value = changeTemplateLibrary(value, { type: 'select', id: 'lecture', selected: 'default' });
  assert.deepEqual(value.templates[1].personalSample, personal);
  const reset = changeTemplateLibrary(value, { type: 'reset', id: 'lecture' });
  assert.deepEqual(reset.templates[1].personalSample, sample());
  assert.deepEqual(changeTemplateLibrary(reset, { type: 'undo', id: 'lecture' }).templates[1].personalSample, personal);
  for (let i = 0; i < 3; i++) value = custom(value, i);
  assert.equal(value.templates.length, 5); assert.throws(() => custom(value, 4), /五套/);
  assert.throws(() => changeTemplateLibrary(value, { type: 'delete', id: 'lecture' }), /不能删除/);
  value = changeTemplateLibrary(value, { type: 'delete', id: 'custom-2' });
  assert.equal(custom(value, 4).templates.length, 5);
  assert.throws(() => custom(value, 1));
  const tampered = library(); tampered.templates[1].organization = 'changed'; assert.throws(() => templateLibrarySchema.parse(tampered));
});

test('old personal sample migrates once without affecting the structured template or old preferences; CAS protects concurrent edits', async () => {
  const name = 'templates-' + crypto.randomUUID(), db = await openDB(name, 1, { upgrade(db) { db.createObjectStore('preferences'); db.createObjectStore('documents'); } });
  try {
    const old = { personal: { ...freshCourseSample(), editCount: 2 }, selected: 'personal' };
    old.personal.paragraphs[0].text += '之前保存的表达偏好。';
    await db.put('preferences', old, 'course-style-v1'); await db.put('preferences', { background: '画像保持' }, 'knowledge'); await db.put('documents', { text: '原笔记' }, 'note');
    const first = await readTemplateLibrary(db);
    assert.equal(first.templates[0].editCount, 2); assert.match(first.templates[0].personalSample.paragraphs[0].text, /之前保存/);
    assert.equal(first.templates[1].editCount, 0);
    const next = custom(first, 0); await commitTemplateLibrary(db, next, 0);
    assert.deepEqual(await readTemplateLibrary(db), next);
    await assert.rejects(commitTemplateLibrary(db, custom(first, 1), 0), /其他窗口/);
    assert.deepEqual(await db.get('preferences', 'course-style-v1'), old);
    assert.deepEqual(await db.get('preferences', 'knowledge'), { background: '画像保持' });
    assert.deepEqual(await db.get('documents', 'note'), { text: '原笔记' });
    assert.deepEqual(await db.get('preferences', TEMPLATE_LIBRARY_KEY), next);
  } finally { db.close(); await deleteDB(name); }
});

test('routing reads distributed source and goal, excludes profile, notes and samples; unknown choices repair once', async () => {
  const doc = emptyDocument(); doc.pages = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, text: `page ${i + 1} ` + 'source '.repeat(1000) }));
  doc.intent = '把课件整理成可分块复习的讲义';
  const input = templateRoutingRequest(doc, custom(library(), 0)), messages = buildMessages(input), payload = JSON.parse(messages[1].content);
  assert.equal(payload.document.intent, doc.intent); assert.equal(payload.document.excerpts.at(-1).page, 100);
  assert.ok(payload.document.excerpts.length <= 12); assert.ok(payload.document.excerpts.every(p => p.text.length <= 2000));
  assert.equal(payload.learner, undefined); assert.equal(payload.catalog[0].sample, undefined); assert.equal(payload.document.chapters[0], doc.chapters[0].title);
  let calls = 0;
  const raw = await runModel(config, messages, undefined, async (_, options) => {
    calls++; assert.equal(JSON.parse(options.body).max_tokens, 1024);
    return completion({ templateId: calls === 1 ? 'made-up' : 'lecture', reason: '课件按知识点组织，目标是复习。' });
  });
  assert.equal(calls, 2); assert.equal(selectedTemplate(custom(library(), 0), validateResult(input, raw)).id, 'lecture');
  await assert.rejects(runModel(config, messages, undefined, async () => completion({ templateId: 'bad', reason: 'bad' })), /模板选择无效/);
  const cancelled = new AbortController(); calls = 0;
  await assert.rejects(runModel(config, messages, cancelled.signal, async () => { calls++; cancelled.abort(); return completion({ templateId: 'lecture', reason: '课程' }); }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('route snapshot is saved before chapters, survives partial failure, refresh, backup and template deletion', async () => {
  let current = emptyDocument(), choices = 0, calls = 0, value = custom(library(), 1);
  const chosen = templateSnapshot(value, 'custom-1', '实践教程');
  const shared = { getLatest: () => current, save: async doc => { current = commitNotebook(structuredClone(doc)); }, selectTemplate: async () => { choices++; return chosen; } };
  await prepareDocument({ ...shared, document: current, request: async (_, chapterId, settings) => {
    calls++; assert.deepEqual(current.preparation.settings.writingTemplate, chosen); assert.deepEqual(settings.writingTemplate, chosen);
    if (calls === 2) throw new Error('网络失败'); return generated(chapterId);
  } });
  assert.equal(current.preparation.status, 'partial');
  value = changeTemplateLibrary(value, { type: 'delete', id: 'custom-1' });
  assert.equal(value.templates.length, 2);
  current = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: current }));
  assert.deepEqual(notebookSettings(current).writingTemplate, chosen);
  await prepareDocument({ ...shared, document: current, request: async (_, id, settings) => { assert.deepEqual(settings.writingTemplate, chosen); return generated(id); } });
  assert.equal(choices, 1); assert.equal(current.preparation.status, 'complete');
});

test('failed or cancelled routing never generates chapters; resume retries selection and stale edits survive', async () => {
  let current = emptyDocument(), calls = 0;
  const shared = { getLatest: () => current, save: async doc => { current = doc; }, request: async () => { calls++; return generated('x'); } };
  await prepareDocument({ ...shared, document: current, selectTemplate: async () => { throw new Error('格式失败'); } });
  assert.equal(calls, 0); assert.equal(current.preparation.templateRouting, 'pending'); assert.match(current.preparation.errors.__template, /格式失败/);
  current = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: commitNotebook(current) }));
  assert.equal(current.preparation.templateRouting, 'pending'); assert.match(current.preparation.errors.__template, /格式失败/);
  const controller = new AbortController();
  await prepareDocument({ ...shared, document: current, signal: controller.signal, selectTemplate: async () => { controller.abort(); return templateSnapshot(library(), 'lecture'); } });
  assert.equal(current.preparation.status, 'paused'); assert.equal(calls, 0);
  await prepareDocument({ ...shared, document: current, selectTemplate: async () => { current = { ...current, revision: current.revision + 1, title: '用户编辑保留' }; return templateSnapshot(library(), 'lecture'); } });
  assert.equal(current.title, '用户编辑保留'); assert.equal(calls, 0); assert.match(current.preparation.errors.__template, /发生编辑/);
  await prepareDocument({ ...shared, document: current, selectTemplate: async () => templateSnapshot(library(), 'lecture') });
  assert.equal(current.preparation.status, 'complete'); assert.ok(calls > 0);
});

test('translation and previously started adaptive notes do not classify or change their original template', async () => {
  for (const old of [false, true]) {
    let current = emptyDocument();
    if (old) current.preparation = { status: 'paused', startedAt: 1, settings: templateSettings('adaptive'), completedIds: [], errors: {} };
    await prepareDocument({ document: current, settings: templateSettings(old ? 'adaptive' : 'translation'), getLatest: () => current, save: async d => { current = d; }, selectTemplate: async () => assert.fail('Must retain existing mode'), request: async (_, id, settings) => { assert.equal(settings.writingTemplate, undefined); return generated(id); } });
    assert.equal(current.preparation.status, 'complete');
  }
});

test('generation and local cooperation use one snapshot; structured and narrative constraints differ and translation excludes both', () => {
  const doc = createDemo(), chapter = doc.chapters[1];
  const base = { action: 'generate', scope: 'chapter', instruction: '解释', revision: 0, chapterId: chapter.id, anchorId: chapter.content.content[0].attrs.id, selection: '选区', document: doc };
  const snapshot = templateSnapshot(library(), 'lecture');
  const structured = { ...base, learning: { ...templateSettings('adaptive'), writingTemplate: snapshot } };
  for (const action of ['generate', 'explain', 'rewrite', 'style']) {
    const messages = buildMessages({ ...structured, action }), data = JSON.parse(messages[1].content);
    assert.deepEqual(data.writingTemplate, snapshot); assert.match(messages[0].content, /每个知识单元可独立回查/);
    assert.doesNotMatch(messages[0].content, /不拆成教学栏目/);
  }
  const blocks = [{ type: 'heading', text: '均值的定义', sourcePages: [] }, { type: 'paragraph', text: '知识解释。', sourcePages: [] }];
  assert.equal(validateResult(structured, { blocks }).rendering.blocks[0].type, 'heading');
  assert.throws(() => validateResult(structured, { blocks: [1, 2, 3].map(i => ({ type: 'paragraph', text: `仅一段${i}`, sourcePages: [] })) }), /标题层级/);
  const narrative = { ...structured, learning: { ...structured.learning, writingTemplate: templateSnapshot(library(), 'narrative') } };
  assert.match(buildMessages(narrative)[0].content, /局部计算|关键数学推导/);
  assert.throws(() => validateResult(narrative, { blocks: [{ type: 'heading', text: '必要背景' }, ...blocks] }), /教学栏目/);
  const pure = buildMessages({ ...structured, learning: { ...structured.learning, mode: 'translation' } });
  assert.equal(JSON.parse(pure[1].content).writingTemplate, undefined); assert.doesNotMatch(pure[0].content, /writing-template-v1/);
  const customPrompt = writingTemplatePrompt(templateSnapshot(custom(library(), 0), 'custom-0'));
  assert.match(customPrompt, /组织模式安排知识/); assert.doesNotMatch(customPrompt, /不拆成教学栏目/);
});

test('sample edits preserve formulas, accept structured headings, and reject fabricated IDs and sixth template before calling a model', async () => {
  const value = library(), snapshot = templateSnapshot(value, 'lecture');
  const request = { action: 'template-style', revision: 0, instruction: '标题更清楚', template: snapshot };
  const data = JSON.parse(buildMessages(request)[1].content), paragraph = data.paragraphs.find(p => p.id === 'mean');
  const reply = { rules: ['标题表达具体问题。'], edits: [{ id: 'mean', text: paragraph.text.replace('均值：保留总量的中心', '均值为什么保留总量') }] };
  const result = validateResult(request, reply);
  assert.equal(result.rendering.format, 'reading-tree-note-v1'); assert.ok(result.rendering.blocks.some(n => n.type === 'heading'));
  const math = text => parseMath(text).filter(n => n.type === 'math');
  assert.deepEqual(math(result.sample.paragraphs.find(p => p.id === 'mean').text), math(snapshot.sample.paragraphs.find(p => p.id === 'mean').text));
  assert.throws(() => validateResult(request, { ...reply, edits: [{ id: 'mean', text: '公式已丢失' }] }), /数学/);
  assert.throws(() => validateResult(request, { ...reply, edits: [{ id: 'new-id', text: '伪造单元' }] }), /ID/);
  const wrapped = structuredClone(reply);
  wrapped.edits[0].text = wrapped.edits[0].text.replace(/⟦math:[^⟧]+⟧/g, token => `\\(${token}\\)`);
  assert.deepEqual(validateResult(request, wrapped).sample, result.sample, 'Exact redundant wrappers must not corrupt protected formulas');
  const malformed = structuredClone(reply); malformed.edits[0].text += String.raw`\(unclosed`;
  assert.throws(() => validateResult(request, malformed), /单元 mean 排版失败/);
  let full = value; for (let i = 0; i < 3; i++) full = custom(full, i);
  assert.throws(() => buildMessages({ action: 'create-template', revision: full.revision, definition: definition(4), catalog: templateCatalog(full) }), /五套/);
  const input = { action: 'create-template', revision: 1, definition: definition(9), catalog: templateCatalog(value) };
  const source = JSON.parse(buildMessages(input)[1].content);
  const created = validateResult(input, { rules: ['按步骤组织。'], edits: [{ id: source.paragraphs[0].id, text: '## 问题与任务\n\n' + source.paragraphs[0].text }] });
  assert.equal(created.sample.title, '方法手册 9 · 样稿');
  assert.deepEqual(source.currentRules, [], 'New templates must not inherit the narrative composition rules');
  assert.throws(() => validateResult(input, { rules: ['改变规则但没改正文。'], edits: [source.paragraphs[0]] }), /正文仍与原素材完全相同/);
  assert.throws(() => validateResult(request, { ...reply, rules: ['数学占位符由编译器恢复。'] }), /混入/);
  const reordered = { ...reply, order: snapshot.sample.paragraphs.map(p => p.id).reverse() };
  assert.deepEqual(validateResult(request, reordered).sample.paragraphs.map(p => p.id), reordered.order);
  assert.throws(() => validateResult(request, { ...reply, order: ['mean'] }), /完整列出/);
});
