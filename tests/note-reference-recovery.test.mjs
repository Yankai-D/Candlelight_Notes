import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';
import { applyReferenceRepair, repairQuotedReferences, referenceRepairMessages } from '../server/source-references.mjs';
import { noteFailureMetadata } from '../shared/note-recovery.mjs';
import { prepareDocument } from '../shared/preparation.mjs';
import { restoreBackup } from '../shared/backup.mjs';
import { createDemo } from '../src/demo.ts';
import { startTestServer } from './support/server.mjs';

const config = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-only' };
const quoteA = 'A derivative measures the instantaneous rate of change.';
const quoteB = 'A probability distribution assigns weights to possible outcomes.';
const reply = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const block = (sourcePages = [1], sourceQuote = '') => ({ type: 'paragraph', text: '保留这个已经写好的因果解释，不重写正文。', sourcePages, sourceQuote });
function fixture() {
  const document = createDemo();
  document.pages = Array.from({ length: 30 }, (_, index) => ({ number: index + 1, text: `Source evidence for document ${index + 1}.`, sourceId: `file-${index}`, sourceTitle: `File ${index}`, sourcePage: 1 }));
  document.pages[7].text = quoteA; document.pages[24].text = quoteB;
  document.chapters = [{ id: 'section', title: '联合讲义', sourcePages: [8, 25], status: 'empty', content: { type: 'doc', content: [] } }];
  document.currentChapter = 'section'; document.currentPage = 8;
  return { action: 'generate', scope: 'chapter', instruction: '整理资料包', revision: 0, chapterId: 'section', composition: true,
    learning: { mode: 'translation' }, document };
}

test('bundle prompts distinguish original pages from allowed IDs, including output examples and segments', () => {
  const input = fixture(), messages = buildMessages(input), context = JSON.parse(messages[1].content);
  assert.deepEqual(context.sourceReferences.allowedIds, [8, 25]);
  assert.deepEqual(context.sourceReferences.mapping.map(page => [page.id, page.originalPage]), [[8, 1], [25, 1]]);
  assert.doesNotMatch(messages[0].content, /"sourcePages":\[1\]/);
  assert.match(messages[0].content, /"sourcePages":\[8\]/);
  const segment = { ...input, segment: { index: 1, total: 2 }, document: { ...input.document, pages: [input.document.pages[7]] } };
  assert.deepEqual(JSON.parse(buildMessages(segment)[1].content).sourceReferences.allowedIds, [8]);
  assert.throws(() => validateResult(segment, { blocks: [block([25])] }), { code: 'INVALID_SOURCE_REFERENCE' });
});

test('missing or ambiguous source indexes stop before a model call', () => {
  const input = fixture();
  for (const pages of [input.document.pages.filter(p => p.number !== 25), [...input.document.pages, input.document.pages[7]]]) {
    assert.throws(() => buildMessages({ ...input, document: { ...input.document, pages } }), { code: 'SOURCE_CONTEXT_INVALID' });
  }
});

test('unique verbatim evidence corrects original-page IDs locally without another API call or prose changes', async () => {
  const input = fixture(), original = { blocks: [block([1], quoteA), block([1], quoteB)] };
  let calls = 0;
  const output = JSON.parse(await runModel(config, buildMessages(input), undefined, async () => { calls++; return reply(original); }, { action: 'generate' }));
  assert.equal(calls, 1);
  assert.deepEqual(output.blocks.map(b => b.sourcePages), [[8], [25]]);
  assert.deepEqual(output.blocks.map(b => b.text), original.blocks.map(b => b.text));
  assert.deepEqual(original.blocks.map(b => b.sourcePages), [[1], [1]], 'The candidate is immutable');
});

test('uncertain evidence uses one constrained citation patch, retaining all prose and valid citations', async () => {
  const input = fixture(), original = { blocks: [block([1]), block([25], quoteB)] }, calls = [];
  const output = JSON.parse(await runModel(config, buildMessages(input), undefined, async (_, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return reply(calls.length === 1 ? original : { edits: [{ index: 0, sourcePages: [8], sourceQuote: quoteA }] });
  }, { action: 'generate' }));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].max_tokens, 8192);
  assert.match(calls[1].messages[0].content, /source-reference-repair-v1/);
  const context = JSON.parse(calls[1].messages[1].content);
  assert.equal(context.issues[0].diagnosis, 'original-page-used-as-id');
  assert.deepEqual(context.blocks.map(b => b.index), [0]);
  assert.deepEqual(output.blocks.map(b => b.text), original.blocks.map(b => b.text));
  assert.deepEqual(output.blocks.map(b => b.sourcePages), [[8], [25]]);
  assert.equal(output.blocks[1].sourceQuote, quoteB);
});

test('ambiguous quotes, short text and multi-page references are not guessed or collapsed', () => {
  const input = fixture(); input.document.pages[24].text = quoteA;
  for (const candidate of [{ blocks: [block([1], quoteA)] }, { blocks: [block([1], 'A derivative')] }, { blocks: [block([1, 25], quoteA)] }]) {
    const result = repairQuotedReferences(input, candidate);
    assert.equal(result.repaired, 0); assert.deepEqual(result.candidate, candidate);
  }
});

test('patches cannot erase citations, invent evidence, modify valid blocks or rewrite prose', () => {
  const input = fixture(), candidate = { blocks: [block([1]), block([25], quoteB)] };
  const valid = { index: 0, sourcePages: [8], sourceQuote: quoteA };
  for (const edits of [[], [{ ...valid, sourcePages: [] }], [{ ...valid, sourcePages: [25] }], [{ ...valid, sourceQuote: 'This is an invented quotation.' }], [{ ...valid, index: 1 }], [valid, valid], [{ ...valid, text: 'Changed text' }]]) {
    assert.throws(() => applyReferenceRepair(input, candidate, JSON.stringify({ edits })));
  }
});

test('multi-source citation recovery verifies each source independently without requiring a shared quote', () => {
  const input = fixture(), candidate = { blocks: [block([1, 25]), block([25], quoteB)] };
  const context = JSON.parse(referenceRepairMessages(input, candidate)[1].content);
  const ids = context.source.map(page => page.excerpts[0].id);
  const edits = [{ index: 0, sourceEvidenceIds: ids }];
  const result = applyReferenceRepair(input, candidate, JSON.stringify({ edits }));
  assert.deepEqual(result.blocks[0].sourcePages, [8, 25]);
  assert.equal(result.blocks[0].sourceQuote, quoteA);
  assert.equal(result.blocks[0].text, candidate.blocks[0].text);
  assert.deepEqual(result.blocks[1], candidate.blocks[1]);
  assert.deepEqual(candidate.blocks[0].sourcePages, [1, 25]);
  for (const edit of [
    { ...edits[0], sourceEvidenceIds: [ids[0], ids[0]] },
    { ...edits[0], sourceEvidenceIds: ['e999-0-fabricated'] },
    { ...edits[0], sourcePages: [8] }, { ...edits[0], index: 1 },
  ]) assert.throws(() => applyReferenceRepair(input, candidate, JSON.stringify({ edits: [edit] })));
  const changed = structuredClone(input); changed.document.pages[7].text += ' Changed source.';
  assert.throws(() => applyReferenceRepair(changed, candidate, JSON.stringify({ edits })));
});

test('persistent citation failure changes strategy and remains bounded; cancellation never issues a repair', async () => {
  const input = fixture(); let calls = 0;
  await assert.rejects(runModel(config, buildMessages(input), undefined, async () => { calls++; return reply({ blocks: [block()] }); }, { action: 'generate' }), { code: 'WORKFLOW_REVIEW_FAILED' });
  assert.equal(calls, 6);
  const controller = new AbortController(); calls = 0;
  await assert.rejects(runModel(config, buildMessages(input), controller.signal, async () => { calls++; controller.abort(); return reply({ blocks: [block()] }); }, { action: 'generate' }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('valid citation resolution across segments does not consume the content revision budget', async () => {
  const input = fixture(); input.document.pages[7].text = (quoteA + '\n').repeat(1100);
  input.document.chapters[0].sourcePages = [8];
  let generates = 0, patches = 0;
  const result = await runModel(config, buildMessages(input), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages;
    if (messages[0].content.includes('source-reference-repair-v1')) { patches++; return reply({ edits: [{ index: 0, sourcePages: [8], sourceQuote: quoteA }] }); }
    generates++; return reply({ blocks: [block([1])] });
  }, { action: 'generate' });
  assert.equal(generates, 4); assert.equal(patches, 2, 'Identical immutable reference stages are reused');
  assert.equal(JSON.parse(result).blocks.length, generates);
});

test('thirty-chapter generation stops on an exhausted semantic recovery, commits earlier work and resumes only unfinished chapters', async () => {
  const input = fixture(); let latest = input.document;
  latest.chapters = Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(latest.chapters[0]), id: `chapter-${index}` }));
  latest.currentChapter = 'chapter-0';
  const calls = [], saved = [];
  const common = { getLatest: () => latest, save: async value => { latest = structuredClone(value); saved.push(latest); }, settings: { mode: 'translation' } };
  await prepareDocument({ ...common, document: latest, request: async (_, id) => {
    calls.push(id);
    if (id === 'chapter-1') throw Object.assign(new Error('引用自动校正失败'), { code: 'REFERENCE_REPAIR_FAILED' });
    return { blocks: [block([8], quoteA)] };
  } });
  assert.deepEqual(calls, ['chapter-0', 'chapter-1']);
  assert.deepEqual(latest.preparation.completedIds, ['chapter-0']);
  assert.equal(latest.preparation.interruption.code, 'REFERENCE_REPAIR_FAILED');
  assert.ok(saved.some(document => document.chapters[0].status === 'ready' && !document.preparation.interruption));
  const first = structuredClone(latest.chapters[0]);
  const restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: latest }));
  assert.deepEqual(restored.preparation.interruption, latest.preparation.interruption);
  const invalid = structuredClone(latest); invalid.preparation.interruption.chapterId = 'unknown';
  assert.throws(() => restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: invalid })), /中断记录/);
  await prepareDocument({ ...common, document: latest, request: async (_, id) => { assert.notEqual(id, 'chapter-0'); return { blocks: [block([8], quoteA)] }; } });
  assert.deepEqual(latest.chapters[0], first); assert.equal(latest.preparation.status, 'complete');
  assert.equal(latest.preparation.interruption, undefined); assert.deepEqual(latest.preparation.errors, {});
});

test('unknown consecutive failures are bounded without falsely reporting completed chapters', async () => {
  const input = fixture(); let latest = input.document, calls = 0;
  latest.chapters = Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(latest.chapters[0]), id: `chapter-${index}` }));
  await prepareDocument({ document: latest, settings: { mode: 'translation' }, getLatest: () => latest, save: async value => { latest = value; }, request: async () => { calls++; throw new Error('Unexpected provider failure'); } });
  assert.equal(calls, 2); assert.deepEqual(latest.preparation.completedIds, []);
  assert.equal(latest.preparation.interruption.code, 'REPEATED_CHAPTER_FAILURE');
});

test('HTTP carries only allowlisted stop classification, enabling the client to stop a multi-chapter run', { timeout: 60000 }, async () => {
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume the request */ }
    calls++; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ blocks: [block()] }) } }] }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  let server;
  try {
    server = await startTestServer({ DEEPSEEK_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, DEEPSEEK_API_KEY: 'test-only' });
    const connection = await (await fetch(server.base + '/api/config')).json();
    const response = await fetch(server.base + '/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reading-Tree-Token': connection.token }, body: JSON.stringify(fixture()) });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, 'WORKFLOW_REVIEW_FAILED'); assert.equal(body.recovery.stopRun, true);
    assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'recovery']);
    assert.equal(calls, 6);
    assert.deepEqual(noteFailureMetadata({ code: 'UNKNOWN', recovery: { stopRun: true }, secret: 'hidden' }), {});
  } finally { if (server) await server.stop(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});
