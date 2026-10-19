import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.ts';
import { buildMessages, validateResult, runModel } from '../server/harness.mjs';
import { applyResult, editableBlocks, markdown, textOf } from '../shared/document.mjs';
import { restoreBackup } from '../shared/backup.mjs';

function fixture(action = 'explain', scope = 'selection') {
  const document = createDemo();
  const chapter = document.chapters[1];
  return { document, request: { action, scope, instruction: '用图书馆的比喻解释', revision: document.revision, chapterId: chapter.id, anchorId: chapter.content.content[0].attrs.id, selection: '注意力机制', document } };
}

test('context contains source evidence, intent, selection and surrounding notes, bounded to the chapter', () => {
  const { request } = fixture();
  request.learning = { mode: 'adaptive', difficulty: 'standard', style: 'clear' };
  const messages = buildMessages(request);
  const context = JSON.parse(messages[1].content);
  assert.deepEqual(context.source.map(p => p.number), [2, 3]);
  assert.equal(context.learningIntent, request.document.intent);
  assert.equal(context.selection, '注意力机制');
  assert.match(context.chapters[0].currentNotes, /Query/);
  assert.match(context.chapters[0].inlineNotes[0].title, /图书馆/);
  assert.match(messages[0].content, /JSON/);
});
test('invalid selection, missing anchor and oversized contexts fail before a model request', () => {
  const { request } = fixture('rewrite');
  assert.throws(() => buildMessages({ ...request, selection: '' }), /选中/);
  assert.throws(() => buildMessages({ ...request, action: 'explain', anchorId: 'missing' }), /插入位置/);
  const big = structuredClone(request);
  big.document.pages[1].text = 'A'.repeat(140000);
  big.document.pages[2].text = 'B'.repeat(140000);
  assert.throws(() => buildMessages(big), /范围过大/);
});
test('model schemas reject invalid JSON, fabricated page citations and unknown edits', () => {
  const { request } = fixture();
  assert.throws(() => validateResult(request, '```json\n{}\n```'), /有效 JSON/);
  assert.throws(() => validateResult(request, { title: '标题', paragraphs: [], sourcePages: [], summary: '' }), /编辑格式/);
  assert.throws(() => validateResult(request, { title: '标题', paragraphs: ['内容'], sourcePages: [99], summary: '' }), /页码/);
  assert.throws(() => validateResult({ ...request, action: 'style' }, { edits: [{ id: 'unknown', text: 'bad' }], summary: '' }), /超出范围/);
});
test('an explanation is a real inline block with source mapping and immutable surrounding prose', () => {
  const { document, request } = fixture();
  const original = structuredClone(document);
  const result = validateResult(request, { title: '匹配与取回', paragraphs: ['先看目录，再读内容。'], sourcePages: [2], summary: '补充讲解' });
  const next = applyResult(document, request, result);
  assert.deepEqual(document, original);
  assert.equal(next.chapters[1].content.content[1].type, 'explanation');
  assert.equal(textOf(next.chapters[1].content.content[1]), '先看目录，再读内容。');
  assert.deepEqual(next.chapters[1].content.content[1].attrs.sourcePages, [2]);
  assert.deepEqual(next.chapters[1].content.content[2], original.chapters[1].content.content[1]);
  assert.deepEqual(next.chapters[0], original.chapters[0]);
  assert.match(markdown(next), /小纸条 · 匹配与取回/);
  assert.match(markdown(next), /> 先看目录，再读内容。/);
});
test('stale revisions cannot overwrite user edits', () => {
  const { document, request } = fixture();
  document.revision++;
  assert.throws(() => applyResult(document, request, { title: 'x', paragraphs: ['x'], sourcePages: [] }), /已发生变化/);
});
test('style edits are bounded and preserve note containers, page references and unchanged paragraphs', () => {
  const { document, request } = fixture('style', 'chapter');
  const blocks = editableBlocks([document.chapters[1]]);
  const paper = document.chapters[1].content.content.find(n => n.type === 'explanation');
  const paperText = blocks.find(b => b.inNote);
  const result = validateResult(request, { edits: [{ id: paperText.id, text: '更直观的解释。' }], summary: '调整解释风格' });
  const next = applyResult(document, request, result);
  const updatedPaper = next.chapters[1].content.content.find(n => n.type === 'explanation');
  assert.deepEqual(updatedPaper.attrs, paper.attrs);
  assert.equal(textOf(updatedPaper), '更直观的解释。');
  assert.deepEqual(next.chapters[1].content.content[0], document.chapters[1].content.content[0]);
  assert.deepEqual(next.chapters[0], document.chapters[0]);
  const other = editableBlocks([document.chapters[0]])[0];
  assert.throws(() => validateResult(request, { edits: [{ id: other.id, text: '不可越界' }], summary: '' }), /超出范围/);
  assert.throws(() => validateResult(request, { edits: [{ id: paperText.id, text: 'a' }, { id: paperText.id, text: 'b' }], summary: '' }), /重复/);
});
test('whole-document style can touch multiple chapters while keeping structure', () => {
  const { document, request } = fixture('style', 'document');
  const blocks = editableBlocks(document.chapters);
  const result = validateResult(request, { edits: [blocks[0], blocks.at(-1)].map(b => ({ id: b.id, text: b.text + '（修订）' })), summary: '风格统一' });
  const next = applyResult(document, request, result);
  assert.match(textOf(next.chapters[0].content), /（修订）/);
  assert.match(textOf(next.chapters.at(-1).content), /（修订）/);
  assert.deepEqual(next.chapters.map(c => c.content.content.length), document.chapters.map(c => c.content.content.length));
});
test('chapter generation normalizes typed blocks, creates stable IDs and leaves other chapters alone', () => {
  const { document, request } = fixture('generate', 'chapter');
  const result = validateResult(request, { blocks: [{ type: 'heading', text: '标题' }, { type: 'paragraph', text: '正文' }, { type: 'bulletList', items: ['重点一', '重点二'] }], summary: '整理完成' });
  const next = applyResult(document, request, result);
  assert.equal(next.chapters[1].status, 'ready');
  assert.ok(next.chapters[1].content.content.every(b => b.attrs.id));
  assert.match(markdown(next), /- 重点二/);
  assert.deepEqual(next.chapters[2], document.chapters[2]);
});
test('generated source anchors survive edits and reject invented pages or unmatched quotes', () => {
  const { document, request } = fixture('generate', 'chapter');
  const quote = document.pages[1].text.slice(0, 100);
  const payload = { blocks: [{ type: 'paragraph', text: '来源可追溯的整理。', sourcePages: [2], sourceQuote: quote }], summary: '' };
  const result = validateResult(request, payload);
  const next = applyResult(document, request, result);
  assert.equal(next.chapters[1].content.content[0].attrs.sourceQuote, quote);
  assert.deepEqual(next.chapters[1].content.content[0].attrs.sourcePages, [2]);
  assert.throws(() => validateResult(request, { ...payload, blocks: [{ ...payload.blocks[0], sourcePages: [99] }] }), /本章以外/);
  const unmatched = validateResult(request, { ...payload, blocks: [{ ...payload.blocks[0], sourceQuote: 'invented quote that is not in the source' }] });
  assert.equal(unmatched.blocks[0].sourceQuote, '');
  assert.deepEqual(unmatched.blocks[0].sourcePages, [2]);
});

test('DeepSeek adapter sends authenticated JSON mode requests and handles provider failures', async () => {
  const config = { baseUrl: 'http://localhost:9999/v1/', apiKey: 'test-only-key', model: 'test-model' };
  let sent;
  const fetcher = async (url, options) => { sent = { url, options }; return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), { status: 200 }); };
  const result = await runModel(config, [{ role: 'user', content: 'json' }], undefined, fetcher);
  assert.equal(result, '{"ok":true}');
  assert.equal(sent.url, 'http://localhost:9999/v1/chat/completions');
  assert.deepEqual(JSON.parse(sent.options.body).response_format, { type: 'json_object' });
  assert.equal(sent.options.headers.Authorization, 'Bearer test-only-key');
  await assert.rejects(runModel(config, [], undefined, async () => new Response('{}', { status: 401 })), /API Key/);
  await assert.rejects(runModel(config, [], undefined, async () => new Response('{"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}')), /截断/);
  await assert.rejects(runModel(config, [], undefined, async () => new Response('{"choices":[{"message":{"content":""}}]}')), /空内容/);
});

test('DeepSeek budgets match the task and reasoning is disabled for structured note editing', async () => {
  const config = { baseUrl: 'https://api.deepseek.com', apiKey: 'test-only', model: 'deepseek-flash' };
  for (const [action, expected] of [['test', 256], ['explain', 8192], ['rewrite', 16384], ['generate', 32768], ['style', 32768]]) {
    let sent;
    await runModel(config, [{ role: 'user', content: 'Return JSON' }], undefined, async (_, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }));
    }, { action });
    assert.equal(sent.max_tokens, expected);
    assert.deepEqual(sent.thinking, { type: 'disabled' });
    assert.deepEqual(sent.response_format, { type: 'json_object' });
  }
});

test('truncated DeepSeek output is discarded and retried once at 64K with the original request', async () => {
  const config = { baseUrl: 'https://api.deepseek.com', apiKey: 'test-only', model: 'deepseek-flash' };
  const { request } = fixture('generate', 'chapter');
  const messages = buildMessages(request), calls = [], diagnostics = [];
  const output = await runModel(config, messages, undefined, async (_, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ finish_reason: calls.length === 1 ? 'length' : 'stop', message: { content: calls.length === 1 ? '{"blocks":[{"type":"paragraph"' : '{"blocks":[{"type":"paragraph","text":"完整的生成正文"}],"summary":"完成"}' } }], usage: { completion_tokens: calls.length === 1 ? 32768 : 80, completion_tokens_details: { reasoning_tokens: 0 } } }));
  }, { action: 'generate', onCompletion: info => diagnostics.push(info) });
  assert.deepEqual(calls.map(call => call.max_tokens), [32768, 65536]);
  assert.deepEqual(calls[0].messages, calls[1].messages, 'Never use truncated JSON as an assistant prefix');
  assert.equal(validateResult(request, output).blocks[0].text, '完整的生成正文');
  assert.deepEqual(diagnostics.map(d => d.finishReason), ['length', 'stop']);
  assert.equal(diagnostics[1].reasoningTokens, 0);

  let attempts = 0;
  await assert.rejects(runModel(config, messages, undefined, async () => {
    attempts++;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"broken":' } }] }));
  }, { action: 'generate' }), error => error.code === 'OUTPUT_TRUNCATED' && /未被修改/.test(error.message));
  assert.equal(attempts, 2, 'Retries must be bounded');

  const controller = new AbortController();
  let cancelledCalls = 0;
  await assert.rejects(runModel(config, messages, controller.signal, async () => {
    cancelledCalls++;
    controller.abort();
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] }));
  }, { action: 'generate' }), { name: 'AbortError' });
  assert.equal(cancelledCalls, 1, 'Cancellation prevents another billable request');
});

test('network permission, DNS and TLS failures are distinguished from API key failures without leaking credentials', async () => {
  const config = { baseUrl: 'https://api.deepseek.com', model: 'test-model', apiKey: 'secret-not-for-errors' };
  for (const [code, pattern] of [['EACCES', /联网权限/], ['ENOTFOUND', /解析/], ['UND_ERR_CONNECT_TIMEOUT', /超时/], ['CERT_HAS_EXPIRED', /证书/]]) {
    await assert.rejects(runModel(config, [], undefined, async () => { throw new TypeError('fetch failed with secret-not-for-errors', { cause: Object.assign(new Error('network denied'), { code }) }); }), error => pattern.test(error.message) && !error.message.includes(config.apiKey));
  }
  const aborted = new DOMException('Cancelled', 'AbortError');
  await assert.rejects(runModel(config, [], undefined, async () => { throw aborted; }), error => error === aborted);
});

test('backup round trip preserves notes and source, creates a new copy and rejects unsafe or inconsistent input', () => {
  const original = createDemo();
  const backup = { format: 'reading-tree-v1', document: original };
  const restored = restoreBackup(JSON.stringify(backup));
  assert.notEqual(restored.id, original.id);
  assert.deepEqual(restored.chapters, original.chapters);
  assert.deepEqual(restored.pages, original.pages);
  assert.equal(restored.currentChapter, original.currentChapter);
  const invalid = structuredClone(backup);
  invalid.document.pages[1].number = 3000;
  assert.throws(() => restoreBackup(JSON.stringify(invalid)), /页码不完整/);
  const injected = structuredClone(backup);
  injected.document.chapters[0].content.content[0].content[0].marks = [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }];
  assert.throws(() => restoreBackup(JSON.stringify(injected)), /有效的烛光笔记/);
});
