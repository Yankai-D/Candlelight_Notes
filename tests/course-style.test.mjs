import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import { freshCourseSample, courseStylePreferences, changeCourseStyle, defaultCourseSample, courseStyleContext, resolveCourseStyle, COURSE_STYLE_KEY } from '../shared/course-style.mjs';
import { commitCourseStylePreferences } from '../shared/course-style-store.mjs';
import { buildCourseStyleMessages, validateCourseStyleResult } from '../server/course-style-harness.mjs';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';
import { buildCourseMessages, runCourseLecture } from '../server/course-harness.mjs';
import { reference, referenceRequest, referencePlan } from '../examples/course/descriptive-statistics/reference.mjs';
import { parseMath } from '../shared/math.mjs';

const request = () => ({ action: 'course-style', revision: 0, instruction: '减少重复预告，让计算更自然地回到判断。', sample: freshCourseSample() });
function reply(input, id = 'mean') {
  const data = JSON.parse(buildCourseStyleMessages(input)[1].content);
  return { rules: ['用完整因果关系连接段落，减少重复预告。'], edits: [{ id, text: data.paragraphs.find(p => p.id === id).text + '\n\n计算得到的中心需要与离散程度一起解释。' }] };
}
const edited = (preferences, prompt = '更多解释关键转折') => changeCourseStyle(preferences, { type: 'edit', expectedRevision: preferences.revision,
  paragraphs: preferences.personal.paragraphs.map((p, i) => i ? p : { ...p, text: p.text + '需要理解的是两个概括之间的关系。' }),
  rules: ['解释关键转折，并在推导后回到问题。'], instruction: prompt }, 1234);

test('two samples start identical, personal edits never mutate the canonical baseline or reading profile', () => {
  const original = structuredClone(defaultCourseSample);
  const first = courseStylePreferences();
  assert.deepEqual(first.personal.paragraphs, defaultCourseSample.paragraphs);
  const second = edited(first);
  assert.equal(second.selected, 'personal');
  assert.equal(second.personal.editCount, 1);
  assert.equal(second.personal.updatedAt, 1234);
  assert.notEqual(second.personal.paragraphs[0].text, first.personal.paragraphs[0].text);
  assert.deepEqual(defaultCourseSample, original);
  assert.deepEqual(defaultCourseSample.paragraphs, reference.blocks.map(({ id, text }) => ({ id, text })));
});

test('switching retains personal edits; restore default is local, undoable and version checked', () => {
  const custom = edited(courseStylePreferences());
  const switched = changeCourseStyle(custom, { type: 'select', selected: 'default' });
  assert.deepEqual(switched.personal, custom.personal);
  assert.deepEqual(resolveCourseStyle(courseStyleContext(switched)).paragraphs, defaultCourseSample.paragraphs);
  const restored = changeCourseStyle(switched, { type: 'reset' });
  assert.equal(restored.selected, 'default');
  assert.deepEqual(restored.personal, freshCourseSample());
  const undone = changeCourseStyle(restored, { type: 'undo' });
  assert.deepEqual(undone.personal, custom.personal);
  assert.equal(undone.revision, restored.revision + 1);
  assert.throws(() => changeCourseStyle(undone, { type: 'edit', expectedRevision: 0 }), /发生变化/);
});

test('personal preference persists independently and concurrent tabs cannot overwrite a newer selection', async () => {
  const name = 'course-style-cas-' + crypto.randomUUID();
  const db = await openDB(name, 1, { upgrade(db) { db.createObjectStore('preferences'); db.createObjectStore('documents'); } });
  try {
    await db.put('documents', { content: 'User note stays unchanged' }, 'note');
    await db.put('preferences', { background: 'Stable profile' }, 'knowledge');
    const first = courseStylePreferences(), custom = edited(first);
    await commitCourseStylePreferences(db, custom, 0);
    const reopened = courseStylePreferences(await db.get('preferences', COURSE_STYLE_KEY));
    assert.deepEqual(reopened, custom);
    const next = changeCourseStyle(reopened, { type: 'select', selected: 'default' });
    await commitCourseStylePreferences(db, next, 1);
    await assert.rejects(commitCourseStylePreferences(db, edited(reopened), 1), /其他窗口更新/);
    assert.deepEqual(await db.get('preferences', COURSE_STYLE_KEY), next);
    assert.deepEqual(await db.get('documents', 'note'), { content: 'User note stays unchanged' });
    assert.deepEqual(await db.get('preferences', 'knowledge'), { background: 'Stable profile' });
  } finally { db.close(); await deleteDB(name); }
});

test('style editing uses the current personal sample and rules, with no imported material or learner history', () => {
  const custom = edited(courseStylePreferences());
  const input = { ...request(), revision: custom.revision, sample: custom.personal };
  const messages = buildMessages(input), data = JSON.parse(messages[1].content);
  assert.match(messages[0].content, /course-style-edit-v1/);
  assert.deepEqual(data.currentRules, custom.personal.rules);
  assert.ok(data.paragraphs[0].text.endsWith('需要理解的是两个概括之间的关系。'));
  assert.equal(data.learner, undefined); assert.equal(data.sources, undefined);
  assert.throws(() => buildMessages({ ...input, document: { title: 'Private paper' } }));
});

test('math stays intact through style editing, and every edited sample uses the common note compiler', () => {
  const input = request(), output = validateResult(input, reply(input));
  const before = input.sample.paragraphs.find(p => p.id === 'mean').text;
  const after = output.paragraphs.find(p => p.id === 'mean').text;
  const math = text => parseMath(text).filter(n => n.type === 'math');
  assert.deepEqual(math(after), math(before));
  assert.equal(output.rendering.format, 'reading-tree-note-v1');
  assert.equal(output.revision, input.revision);
  assert.ok(!after.includes('⟦math:'));
  assert.equal(input.sample.paragraphs.find(p => p.id === 'mean').text, before);
});

test('lost, duplicate, foreign math, unexpected ids and invented rendering are rejected', () => {
  const input = request();
  const reject = mutate => { const output = reply(input); mutate(output); assert.throws(() => validateCourseStyleResult(input, output), { code: 'COURSE_STYLE_FORMAT' }); };
  reject(r => { r.edits[0].text = '只剩一个短句，全部公式丢失。'; });
  reject(r => { r.edits[0].text += '⟦math:mean:1⟧'; });
  reject(r => { r.edits[0].text += '⟦math:other:1⟧'; });
  reject(r => { r.edits[0].id = 'unknown'; });
  reject(r => { r.edits.push(r.edits[0]); });
  reject(r => { r.edits[0].text += String.raw`\(\badcommand{x}\)`; });
  reject(r => { r.edits[0].text += '\n\n## 必要背景'; });
  reject(r => { r.rendering = { blocks: [] }; });
});

test('style adapter repairs a malformed response once using the same personal sample and provider budgets', async () => {
  const input = request(), calls = [], original = structuredClone(input);
  const config = { baseUrl: 'https://api.deepseek.com', model: 'mock', apiKey: 'synthetic-test-key' };
  const raw = await runModel(config, buildMessages(input), undefined, async (_, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: calls.length === 1 ? '{}' : JSON.stringify(reply(input)) } }] }) };
  }, { action: 'course-style' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].max_tokens, 16384);
  assert.equal(calls[1].messages[1].content, calls[0].messages[1].content);
  assert.equal(calls[0].thinking.type, 'disabled');
  assert.ok(validateResult(input, raw).paragraphs.length);
  assert.deepEqual(input, original);
});

test('cancelled or twice invalid style requests never return a candidate for saving', async () => {
  const input = request(), config = { baseUrl: 'https://example.test', model: 'mock', apiKey: 'test' };
  let calls = 0;
  const invalid = async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }; };
  await assert.rejects(runModel(config, buildMessages(input), undefined, invalid), { code: 'COURSE_STYLE_FORMAT' });
  assert.equal(calls, 2);
  const controller = new AbortController();
  await assert.rejects(runModel(config, buildMessages(input), controller.signal, async () => {
    controller.abort(); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply(input)) } }] }) };
  }), { name: 'AbortError' });
});

test('course planning and writing consume the selected personal sample, while default selection excludes it', async () => {
  const custom = edited(courseStylePreferences());
  const request = { ...referenceRequest, writingStyle: courseStyleContext(custom) };
  const planMessages = buildCourseMessages(request), writeMessages = buildCourseMessages(request, { plan: referencePlan, sectionId: 'summary' });
  assert.deepEqual(JSON.parse(planMessages[1].content).writingStyle, resolveCourseStyle(request.writingStyle));
  assert.deepEqual(JSON.parse(writeMessages[1].content).writingStyle, resolveCourseStyle(request.writingStyle));
  assert.equal(JSON.parse(writeMessages[1].content).writingStyle.lastRequest, undefined);
  const differentProfile = buildCourseMessages({ ...request, learner: { background: '博士生', foundations: ['统计学'] } });
  assert.equal(planMessages[0].content, differentProfile[0].content);
  assert.deepEqual(JSON.parse(planMessages[1].content).writingStyle, JSON.parse(differentProfile[1].content).writingStyle);
  const defaults = buildCourseMessages({ ...request, writingStyle: courseStyleContext(changeCourseStyle(custom, { type: 'select', selected: 'default' })) });
  assert.deepEqual(JSON.parse(defaults[1].content).writingStyle.paragraphs, defaultCourseSample.paragraphs);
  assert.match(defaults[0].content, /不是当前资料的事实依据/);
  const snapshots = [];
  const result = await runCourseLecture(request, { complete: async (messages, { stage }) => {
    snapshots.push(JSON.parse(messages[1].content).writingStyle);
    return stage === 'plan' ? referencePlan : reference;
  } });
  assert.ok(snapshots.every(snapshot => JSON.stringify(snapshot) === JSON.stringify(result.writingStyle)));
});
