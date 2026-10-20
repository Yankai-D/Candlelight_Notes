import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultKnowledge, defaultSettings, addReadMaterial, materialFromDocument, restoreKnowledge, learnerProfile } from '../shared/learning.mjs';
import { prepareDocument, remainingChapters } from '../shared/preparation.mjs';
import { buildMessages, runModel, splitSource, chapterSource } from '../server/harness.mjs';
import { createSourceFollower, easeOutCubic } from '../shared/source-follow.mjs';
import { restoreBackup } from '../shared/backup.mjs';
import { createDemo } from '../src/demo.ts';
import { templateSettings } from '../shared/learning-templates.mjs';

function fixture() {
  const document = createDemo();
  document.demo = false;
  document.chapters = document.chapters.slice(0, 3).map(c => ({ ...c, status: 'empty', content: { type: 'doc', content: [] } }));
  return document;
}
const output = text => ({ blocks: [{ type: 'paragraph', text }], summary: '' });
const settings = { mode: 'adaptive', difficulty: 'advanced', style: 'derivation' };
const makeRequest = document => ({ action: 'generate', scope: 'chapter', instruction: '完整翻译', revision: document.revision, chapterId: document.chapters[0].id, document });
const modelConfig = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-only' };
const response = content => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }));

test('translation keeps the learning goal but excludes learner profiles; adaptive defaults include background and exclude the current paper', () => {
  const document = fixture();
  const knowledge = addReadMaterial(defaultKnowledge, materialFromDocument(document));
  const request = { ...makeRequest(document), documentId: document.id, knowledge };
  const pure = JSON.parse(buildMessages({ ...request, learning: templateSettings('translation') })[1].content);
  assert.equal(pure.learner, undefined);
  assert.equal(pure.learningIntent, document.intent);
  assert.deepEqual(pure.learning, { mode: 'translation' });
  const adaptive = JSON.parse(buildMessages({ ...request, learning: settings })[1].content);
  assert.equal(adaptive.learner.background, knowledge.background);
  assert.deepEqual(adaptive.learner.foundations, knowledge.foundations);
  assert.deepEqual(adaptive.learner, learnerProfile(knowledge));
  assert.equal(adaptive.learning.difficulty, 'advanced');
  assert.equal(adaptive.learning.style, 'derivation');
  const defaultContext = JSON.parse(buildMessages(request)[1].content);
  assert.deepEqual(defaultContext.learning, { mode: 'adaptive', template: 'guided-v3' });
  assert.equal(defaultContext.learner.background, knowledge.background);
});

test('initialization saves successful chapters, continues past failure, resumes only missing chapters, and cannot rerun completed work', async () => {
  let latest = fixture();
  const original = structuredClone(latest), calls = [], saved = [];
  const failed = latest.chapters[1].id;
  const shared = { getLatest: () => latest, save: async value => { latest = structuredClone(value); saved.push(latest); }, knowledge: defaultKnowledge };
  await prepareDocument({ ...shared, document: latest, settings, request: async (_document, id) => { calls.push(id); if (id === failed) throw new Error('模拟失败'); return output(id); } });
  assert.equal(latest.preparation.status, 'partial');
  assert.deepEqual(calls, original.chapters.map(c => c.id));
  assert.equal(latest.preparation.completedIds.length, 2);
  assert.equal(remainingChapters(latest).length, 1);
  assert.equal(latest.preparation.errors[failed], '模拟失败');
  assert.ok(saved.some(d => d.chapters[0].status === 'ready' && d.chapters[2].status === 'empty'));
  const first = structuredClone(latest.chapters[0]);
  await prepareDocument({ ...shared, document: latest, settings: defaultSettings, request: async (_document, id, chosen, background) => {
    calls.push(id); assert.equal(id, failed); assert.deepEqual(chosen, settings); assert.deepEqual(background, learnerProfile(defaultKnowledge)); return output('补齐');
  } });
  assert.equal(latest.preparation.status, 'complete');
  assert.deepEqual(latest.chapters[0], first);
  assert.deepEqual(latest.preparation.errors, {});
  await prepareDocument({ ...shared, document: latest, request: async () => assert.fail('Completed documents must never call the model again') });
  assert.equal(calls.length, 4);
  const restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: latest }));
  assert.equal(restored.preparation.status, 'complete');
  assert.equal(remainingChapters(restored).length, 0);
  const inconsistent = structuredClone(latest);
  inconsistent.preparation.completedIds[0] = 'unknown';
  assert.throws(() => restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: inconsistent })), /初始化进度/);
});

test('cancellation stops subsequent calls and a concurrent edit is not overwritten by initialization', async () => {
  let latest = fixture(), calls = 0;
  const controller = new AbortController();
  const common = { document: latest, getLatest: () => latest, save: async value => { latest = value; }, knowledge: defaultKnowledge };
  await prepareDocument({ ...common, signal: controller.signal, request: async () => { calls++; controller.abort(); return output('do not apply'); } });
  assert.equal(calls, 1);
  assert.equal(latest.preparation.status, 'paused');
  assert.equal(latest.chapters[0].status, 'empty');
  await prepareDocument({ ...common, document: latest, request: async () => { latest = { ...latest, revision: latest.revision + 1 }; return output('stale'); } });
  assert.equal(latest.preparation.status, 'partial');
  assert.equal(latest.chapters[0].status, 'empty');
  assert.match(Object.values(latest.preparation.errors)[0], /笔记发生编辑/);
});

test('existing handwritten notes are preserved and pure translation does not persist a profile snapshot', async () => {
  let latest = fixture();
  latest.chapters[0].status = 'ready';
  const original = structuredClone(latest.chapters[0]);
  await prepareDocument({ document: latest, settings: templateSettings('translation'), knowledge: defaultKnowledge,
    getLatest: () => latest, save: async d => { latest = d; }, request: async (_d, id, _s, knowledge) => { assert.notEqual(id, original.id); assert.equal(knowledge, undefined); return output(id); } });
  assert.deepEqual(latest.chapters[0], original);
  assert.equal(latest.preparation.knowledge, undefined);
  assert.equal(latest.preparation.status, 'complete');
});

test('read materials grow once, stay editable, and survive a validated knowledge backup', () => {
  const document = fixture(), material = materialFromDocument(document, 123);
  const knowledge = addReadMaterial(defaultKnowledge, material);
  assert.equal(knowledge.materials.length, 1);
  assert.equal(addReadMaterial(knowledge, material), knowledge);
  assert.equal(defaultKnowledge.materials.length, 0);
  assert.deepEqual(restoreKnowledge(JSON.stringify({ format: 'reading-tree-knowledge-v1', knowledge })), knowledge);
  assert.throws(() => restoreKnowledge(JSON.stringify({ format: 'invalid', knowledge })));
});

test('invalid model structure receives one bounded repair and unsafe page references are still rejected', async () => {
  const request = makeRequest(fixture()), calls = [];
  const result = await runModel(modelConfig, buildMessages(request), undefined, async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return response(calls.length === 1 ? { blocks: [{ type: 'equation', formula: 'a+b' }] } : output('a+b'));
  }, { action: 'generate' });
  assert.equal(JSON.parse(result).blocks[0].text, 'a+b');
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].messages.at(-1).content).execution, 'stage-recovery-v1');
  let attempts = 0;
  await assert.rejects(runModel(modelConfig, buildMessages(request), undefined, async () => { attempts++; return response({ blocks: [] }); }, { action: 'generate' }), { code: 'WORKFLOW_REVIEW_FAILED' });
  assert.equal(attempts, 5);
  let unsafeCalls = 0;
  await assert.rejects(runModel(modelConfig, buildMessages(request), undefined, async () => { unsafeCalls++; return response({ blocks: [{ type: 'paragraph', text: 'x', sourcePages: [999] }] }); }, { action: 'generate' }), { code: 'WORKFLOW_REVIEW_FAILED' });
  assert.equal(unsafeCalls, 6, 'Metadata recovery remains bounded and never accepts invalid references');
});

test('long sources split without lost or duplicated characters, and every segment must validate before any chapter result is returned', async () => {
  const pages = [{ number: 1, text: 'a\nb\nc\n'.repeat(6500) }, { number: 2, text: 'd'.repeat(15000) }];
  const segments = splitSource(pages);
  assert.ok(segments.length > 1);
  assert.equal(segments.flat().map(p => p.text).join(''), pages.map(p => p.text).join(''));
  assert.ok(segments.every(s => s.reduce((n, p) => n + p.text.length, 0) <= 18000));
  const document = fixture(); document.pages = pages; document.chapters[0].sourcePages = [1, 2];
  let calls = 0;
  const result = JSON.parse(await runModel(modelConfig, buildMessages(makeRequest(document)), undefined, async (_url, options) => {
    const context = JSON.parse(JSON.parse(options.body).messages[1].content);
    calls++; assert.equal(context.segment.index, calls); return response(output(`片段${calls}`));
  }, { action: 'generate' }));
  assert.equal(result.blocks.length, segments.length);
  assert.deepEqual(result.blocks.map(b => b.text), segments.map((_, i) => `片段${i + 1}`));
});

test('generation isolates adjacent PDF sections even when the heading wraps over two lines', () => {
  const source = [{ number: 1, text: 'Paper title\nABSTRACT\nAbstract body.\n1\nINTRODUCTION\nIntro first page.' }, { number: 2, text: 'Intro second page.\n2\nALGORITHM\nAlgorithm body.' }];
  const abstract = chapterSource(source.slice(0, 1), 'Abstract', '1 Introduction');
  assert.match(abstract[0].text, /Abstract body/);
  assert.doesNotMatch(abstract[0].text, /INTRODUCTION|Paper title/);
  const intro = chapterSource(source, '1 Introduction', '2 Algorithm');
  assert.deepEqual(intro.map(p => p.number), [1, 2]);
  assert.match(intro[0].text, /Intro first page/);
  assert.match(intro[1].text, /Intro second page/);
  assert.doesNotMatch(intro[1].text, /ALGORITHM/);
  assert.deepEqual(chapterSource(source, 'Unmatched layout', '2 Algorithm'), source);
});

test('source follower delays, decelerates, retargets from its visible position, and cancels scheduled movement', () => {
  let time = 0, id = 0;
  const frames = new Map(), timers = new Map();
  const root = { scrollTop: 0, scrollHeight: 4000, clientHeight: 400 };
  const env = { raf: fn => { frames.set(++id, fn); return id; }, cancelRaf: id => frames.delete(id), now: () => time,
    setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: id => timers.delete(id) };
  const follower = createSourceFollower(root, env);
  const flushTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  const frame = t => { time = t; for (const [id, fn] of [...frames]) { frames.delete(id); fn(t); } };
  follower.to(() => 1000);
  assert.equal(root.scrollTop, 0);
  flushTimers(); frame(100); const fast = root.scrollTop;
  frame(200); const slower = root.scrollTop - fast;
  assert.ok(fast > slower && slower > 0);
  const visible = root.scrollTop;
  follower.to(() => 1500); flushTimers(); frame(200);
  assert.equal(root.scrollTop, visible);
  frame(300); assert.ok(root.scrollTop > visible);
  follower.cancel(); assert.equal(frames.size + timers.size, 0);
  const reduced = createSourceFollower(root, { ...env, reducedMotion: true });
  reduced.to(() => 8000, true); assert.equal(root.scrollTop, 3600);
  assert.equal(easeOutCubic(0), 0); assert.equal(easeOutCubic(1), 1);
});
