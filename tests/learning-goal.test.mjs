import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.ts';
import { buildMessages, runModel, splitSource } from '../server/harness.mjs';
import { templateSettings } from '../shared/learning-templates.mjs';
import { learningGoalPrompt } from '../shared/learning-goal.mjs';
import { defaultKnowledge } from '../shared/learning.mjs';

function request(action = 'generate', mode = 'adaptive') {
  const document = createDemo(), chapter = document.chapters[0];
  document.intent = '能独立推导注意力的缩放项，解释它的假设和适用边界。';
  return { action, scope: 'chapter', instruction: '处理当前内容', revision: document.revision,
    chapterId: chapter.id, anchorId: chapter.content.content[0].attrs.id, selection: '注意力',
    learning: templateSettings(mode), knowledge: defaultKnowledge, document };
}

test('every action and reading mode carries the current goal with explicit, scoped system constraints', () => {
  for (const mode of ['adaptive', 'translation']) for (const action of ['generate', 'explain', 'rewrite', 'style']) {
    const input = request(action, mode), messages = buildMessages(input);
    assert.equal(JSON.parse(messages[1].content).learningIntent, input.document.intent);
    assert.ok(messages[0].content.includes(learningGoalPrompt(input.learning, action)));
    assert.match(messages[0].content, /必须落实到正文|仍须完整、忠实/);
    assert.match(messages[0].content, /不改变默认文风|固定文风不随目标或知识画像改变/);
    assert.match(messages[0].content, /不能借目标删去原文的实质内容/);
    const updated = { ...input, document: { ...input.document, intent: '判断方法能否用于我的序列任务，明确适用条件。' } };
    const next = buildMessages(updated);
    assert.equal(JSON.parse(next[1].content).learningIntent, updated.document.intent);
    assert.equal(next[0].content, messages[0].content, 'Different goals do not swap out the editorial voice or format contract');
    if (mode === 'translation') assert.equal(JSON.parse(next[1].content).learner, undefined);
  }
});

test('split generation and bounded format repair retain the full goal contract in every provider request', async () => {
  const input = request();
  input.document.pages = [{ number: 1, text: 'Source for the current argument.\n'.repeat(1800) }];
  input.document.chapters[0].sourcePages = [1];
  const segments = splitSource(input.document.pages);
  assert.ok(segments.length > 1);
  const calls = [], attempts = new Map();
  const raw = await runModel({ baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: 'test-only' }, buildMessages(input), undefined, async (_url, options) => {
    const body = JSON.parse(options.body), context = JSON.parse(body.messages[1].content);
    calls.push(body);
    assert.equal(context.learningIntent, input.document.intent);
    assert.ok(body.messages[0].content.includes(learningGoalPrompt(input.learning, input.action)));
    const segment = context.segment.index;
    attempts.set(segment, (attempts.get(segment) || 0) + 1);
    const result = segment === 1 && attempts.get(segment) === 1 ? { blocks: [] } : { blocks: [{ type: 'paragraph', text: `片段 ${segment} 的解释。`, sourcePages: [1] }] };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }));
  }, { action: 'generate' });
  assert.equal(calls.length, segments.length + 1);
  assert.equal(JSON.parse(raw).blocks.length, segments.length);
  assert.match(calls[1].messages.at(-1).content, /修复 JSON/);
});
