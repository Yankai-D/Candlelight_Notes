import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceKnowledgeCache, prepareSourceKnowledge, validateSourceKnowledge } from '../server/source-knowledge.mjs';
import { sourceEvidenceIndex } from '../server/source-evidence-index.mjs';
import { analyzeChapter } from '../server/chapter-analysis.mjs';
import { runModel, buildMessages } from '../server/harness.mjs';
import { FileLibrary } from '../server/file-library.mjs';
import { createDemo } from '../src/demo.ts';
import { freshTemplateLibrary, templateSnapshot } from '../shared/writing-templates.mjs';

const identity = { baseUrl: 'https://api.deepseek.com', model: 'offline', apiKey: 'PRIVATE_KEY_CANARY' };
const pages = [{ number: 50, sourceId: 'material-a', sourcePage: 1, text: 'The mean is the sum divided by the count. '.repeat(50) },
  { number: 51, sourceId: 'material-a', sourcePage: 2, text: 'For unequal weights use a weighted sum divided by total weight. '.repeat(40) }];
const indexed = source => ({ items: source.map(page => ({ kind: 'concept', title: `Source ${page.number}`, summary: 'A source concept with its assumptions.', sourceEvidenceIds: [page.excerpts[0].id] })) });
async function directory(t) { const root = await mkdtemp(join(await realpath(tmpdir()), 'candlelight-knowledge-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const request = goal => ({ action: 'generate', scope: 'chapter', chapterId: 'c1', revision: 0, composition: true, instruction: goal,
  learning: { mode: 'adaptive', template: 'guided-v3', writingTemplate: templateSnapshot(freshTemplateLibrary(), 'lecture') },
  knowledge: { background: 'PRIVATE_PROFILE_CANARY', foundations: [], materials: [] },
  document: { title: 'Sources', intent: goal, pages, chapters: [{ id: 'c1', title: 'Means', sourcePages: [50, 51], content: { type: 'doc', content: [] } }] } });
const analysis = source => { const refs = source.flatMap(page => page.excerpts.map(excerpt => excerpt.id)); return {
  approach: 'Organize the actual current goal.', connection: 'Keep the assumptions with the method.', steps: [{ focus: 'Mean', instruction: 'State its meaning and assumptions.', sourceEvidenceIds: refs.slice(0, 2) }], risks: [],
  synthesis: { units: [{ id: 'k1', topic: 'Mean', concept: 'Definition and assumptions', method: [], sourceEvidenceIds: refs.slice(0, 2), examples: [], variants: [] }], merges: [] },
}; };

test('source analysis persists across notebooks and global page renumbering without storing goals, profiles or keys', async t => {
  const root = await directory(t); let calls = 0; const events = [];
  const complete = async (messages, stage) => {
    calls++; assert.equal(stage, 'knowledge-index'); const context = JSON.parse(messages[1].content);
    assert.deepEqual(Object.keys(context), ['source']); assert.ok(!JSON.stringify(messages).includes('PRIVATE'));
    return JSON.stringify(indexed(context.source));
  };
  const first = await prepareSourceKnowledge({ allPages: pages, pages, cache: sourceKnowledgeCache(root, identity), complete, event: e => events.push(e) });
  const renumbered = pages.map(page => ({ ...page, number: page.number + 100 }));
  const second = await prepareSourceKnowledge({ allPages: renumbered, pages: renumbered, cache: sourceKnowledgeCache(root, identity), complete, event: e => events.push(e) });
  assert.equal(calls, 1); assert.equal(first.created, 1); assert.equal(second.reused, 1);
  assert.ok(second.items.flatMap(item => item.sourceEvidenceIds).every(id => sourceEvidenceIndex(renumbered).byId.has(id)));
  const files = await readdir(join(root, 'source-knowledge')); assert.equal(files.length, 1);
  const stored = await readFile(join(root, 'source-knowledge', files[0]), 'utf8');
  assert.ok(!stored.includes('PRIVATE_KEY_CANARY')); assert.ok(!stored.includes('PRIVATE_PROFILE_CANARY'));
  assert.equal(events.at(-1).indexedPages, 2);
});

test('changed content, provider, model and damaged cache regenerate; stale or missing references are never accepted', async t => {
  const root = await directory(t); let calls = 0;
  const complete = async messages => { calls++; return JSON.stringify(indexed(JSON.parse(messages[1].content).source)); };
  const prepare = (source = pages, config = identity) => prepareSourceKnowledge({ allPages: source, pages: source, cache: sourceKnowledgeCache(root, config), complete });
  await prepare(); await prepare(); assert.equal(calls, 1);
  await prepare([{ ...pages[0], text: 'Changed source statement.' }, pages[1]]); assert.equal(calls, 2);
  await prepare(pages, { ...identity, model: 'different-model' }); assert.equal(calls, 3);
  await prepare(pages, { ...identity, baseUrl: 'https://example.invalid/v1' }); assert.equal(calls, 4);
  for (const file of await readdir(join(root, 'source-knowledge'))) await writeFile(join(root, 'source-knowledge', file), '{broken');
  await prepare(); assert.equal(calls, 5);
  assert.throws(() => validateSourceKnowledge({ items: [{ kind: 'concept', title: 'Wrong reference', summary: 'A statement.', sourceEvidenceIds: ['S999'] }] }, pages), { code: 'STAGE_CONTRACT' });
  const incomplete = indexed(sourceEvidenceIndex(pages.map((page, i) => ({ ...page, number: i + 1 }))).source); incomplete.items.pop();
  assert.throws(() => validateSourceKnowledge(incomplete, pages), error => error.issues.some(issue => issue.code === 'INDEX_COVERAGE'));
});

test('concurrent users of the same source share extraction; cancelling a waiter leaves the producer intact', async t => {
  const root = await directory(t), cache = sourceKnowledgeCache(root, identity), controller = new AbortController();
  let release, started, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const produce = async () => { calls++; started(); await new Promise(resolve => { release = resolve; }); return indexed(sourceEvidenceIndex(pages.map((p, i) => ({ ...p, number: i + 1 }))).source); };
  const first = cache.obtain(pages, produce); await ready;
  const second = cache.obtain(pages, produce, controller.signal); controller.abort();
  await assert.rejects(second, { name: 'AbortError' }); release();
  assert.equal((await first).reused, false); assert.equal(calls, 1);
  assert.equal((await sourceKnowledgeCache(root, identity).obtain(pages, produce)).reused, true);
});

test('two different note goals reuse source work but independently select and write from verbatim original evidence', async t => {
  const root = await directory(t); let extracts = 0, plans = 0, writers = 0; const goals = [], events = [];
  const fetcher = async (_url, options) => {
    const messages = JSON.parse(options.body).messages, system = messages[0].content, context = JSON.parse(messages[1].content);
    if (system.startsWith('source-knowledge-v1')) { extracts++; assert.ok(!JSON.stringify(context).includes('PRIVATE')); return response(indexed(context.source)); }
    if (system.startsWith('lecture-outline')) return response(context.analyses[0]);
    if (system.startsWith('chapter-analysis-v1')) {
      plans++; goals.push(context.goal); assert.equal(context.evidenceMode, 'index-and-previews');
      assert.equal(context.learner.background, 'PRIVATE_PROFILE_CANARY');
      assert.ok(context.source.every(page => page.excerpts.every(excerpt => excerpt.partial && excerpt.text === undefined)));
      return response(analysis(context.source));
    }
    assert.ok(!system.startsWith('execution-recovery-plan-v1')); writers++;
    assert.deepEqual(context.source.map(p=>p.number),pages.map(p=>p.number));
    assert.ok(context.source.every(p=>pages.find(original=>original.number===p.number).text.includes(p.text)));
    return response({ blocks: [{ type: 'paragraph', text: `A concise account for ${context.learningIntent}.`, sourcePages: [50, 51], learningUnitId: 'k1', learningRole: 'concept' }] });
  };
  for (const goal of ['Explain the definition.', 'Explain the assumptions.']) {
    await runModel(identity, buildMessages(request(goal)), undefined, fetcher, { action: 'generate', knowledgeDirectory: root, onCompletion: event => events.push(event) });
  }
  assert.equal(extracts, 1); assert.equal(plans, 2); assert.equal(writers, 2); assert.notEqual(goals[0], goals[1]);
  assert.equal(events.filter(e => e.phase === 'source-knowledge-cache').at(-1).reused, 1);
});

test('indexed planning expands original sources when needed; partial pages never bind to a full-page cached reference', async t => {
  const root = await directory(t), complete = async messages => JSON.stringify(indexed(JSON.parse(messages[1].content).source));
  const knowledge = await prepareSourceKnowledge({ allPages: pages, pages, cache: sourceKnowledgeCache(root, identity), complete });
  let calls = 0;
  const result = await analyzeChapter(request('Check the exact conditions.'), async messages => {
    calls++; const context = JSON.parse(messages[1].content);
    if (context.evidenceMode === 'index-and-previews') return '{"needsSource":true,"reason":"Check the complete condition before choosing the method."}';
    assert.equal(context.source[0].excerpts.map(e => e.text).join(''), pages[0].text);
    return JSON.stringify(analysis(context.source));
  }, undefined, knowledge);
  assert.equal(calls, 2); assert.ok(result.synthesis.units.length);
  const partial = [{ ...pages[0], text: pages[0].text.slice(500) }];
  const index = await prepareSourceKnowledge({ allPages: pages, pages: partial, cache: sourceKnowledgeCache(root, identity), complete: () => { throw new Error('Do not create an index for a truncated page'); } });
  assert.equal(index.items.length, 0);
});

test('a stalled optional index falls back to original-source analysis instead of failing note generation', async t => {
  const root = await directory(t); let fullAnalyses = 0;
  const raw = await runModel(identity, buildMessages(request('Explain the definition.')), undefined, async (_url, options) => {
    const messages = JSON.parse(options.body).messages, system = messages[0].content, context = JSON.parse(messages[1].content);
    if (system.startsWith('source-knowledge-v1') || system.startsWith('execution-recovery-plan-v1')) return response({});
    if (system.startsWith('chapter-analysis-v1')) { fullAnalyses++; assert.ok(context.source[0].excerpts[0].text); return response(analysis(context.source)); }
    if (system.startsWith('lecture-outline')) return response(context.analyses[0]);
    return response({ blocks: [{ type: 'paragraph', text: 'A source-supported definition.', sourcePages: [50], learningUnitId: 'k1', learningRole: 'concept' }] });
  }, { action: 'generate', knowledgeDirectory: root });
  assert.equal(fullAnalyses, 1); assert.equal(JSON.parse(raw).blocks.length, 1);
});

test('knowledge cache follows verified workspace move and backup/restore without carrying credentials', async t => {
  const root = await directory(t), store = new FileLibrary({ profile: join(root, 'profile'), defaultDirectory: join(root, 'library') });
  await store.command({ action: 'import', document: { ...createDemo(), id: 'cache-note', kind: 'text', library: undefined, filename: 'source.txt' }, source: { name: 'source.txt', data: Buffer.from('SOURCE').toString('base64') } });
  let calls = 0; const produce = async () => { calls++; return indexed(sourceEvidenceIndex(pages.map((page, i) => ({ ...page, number: i + 1 }))).source); };
  await sourceKnowledgeCache(store.index.systemDirectory, identity).obtain(pages, produce);
  const preview = await store.command({ action: 'workspace-move-preview', directory: join(root, 'moved') });
  await store.command({ action: 'workspace-move', previewId: preview.id, confirm: true });
  assert.equal((await sourceKnowledgeCache(store.index.systemDirectory, identity).obtain(pages, produce)).reused, true);
  const backup = await store.command({ action: 'workspace-backup', directory: join(root, 'backups') });
  const manifest = await readFile(join(backup.directory, 'candlelight-workspace.json'), 'utf8'); assert.ok(manifest.includes('source-knowledge/')); assert.ok(!manifest.includes('PRIVATE_KEY_CANARY'));
  const target = new FileLibrary({ profile: join(root, 'new-profile'), defaultDirectory: join(root, 'new-library') });
  const restore = await target.command({ action: 'workspace-preview', directory: backup.directory });
  await target.command({ action: 'workspace-restore', previewId: restore.id, directory: join(root, 'restored'), confirm: true });
  assert.equal((await sourceKnowledgeCache(target.index.systemDirectory, identity).obtain(pages, produce)).reused, true); assert.equal(calls, 1);
});
