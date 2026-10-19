import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLearningIntent, normalizeLearningIntent } from '../shared/learning-intent.mjs';
import { createDemo } from '../src/demo.ts';
import { restoreBackup } from '../shared/backup.mjs';
import { remainingChapters } from '../shared/preparation.mjs';
import { buildMessages } from '../server/harness.mjs';

const oldDefault = '逐步读懂 Adam 的一阶矩、二阶矩估计和偏差修正，理解超参数与实验。';

test('default goal is simply reading the paper; migrating old prefills never changes notes or queues generation', () => {
  assert.equal(defaultLearningIntent, '看懂这篇文章');
  assert.equal(createDemo().intent, defaultLearningIntent);
  const previous = { ...createDemo(), intent: oldDefault };
  delete previous.intentSource;
  const updated = normalizeLearningIntent(previous);
  assert.equal(updated.intent, defaultLearningIntent);
  assert.equal(updated.intentSource, 'default');
  assert.equal(updated.chapters, previous.chapters);
  assert.equal(updated.versions, previous.versions);
  assert.equal(updated.preparation, previous.preparation);
  assert.equal(updated.revision, previous.revision);
  assert.equal(updated.currentChapter, previous.currentChapter);
  assert.deepEqual(remainingChapters(updated), []);
  assert.equal(previous.intent, oldDefault);
  assert.equal(normalizeLearningIntent(updated), updated);
  assert.equal(normalizeLearningIntent({ ...previous, intent: '' }).intent, defaultLearningIntent);
});

test('custom and explicitly saved goals survive migration and backup even when they match a historical prefill', () => {
  const custom = { ...createDemo(), intent: '只关注文中给出的无偏条件及其证明。' };
  delete custom.intentSource;
  const migrated = normalizeLearningIntent(custom);
  assert.equal(migrated.intent, custom.intent);
  assert.equal(migrated.intentSource, 'user');
  assert.equal(normalizeLearningIntent(migrated), migrated);
  const saved = { ...custom, intent: oldDefault, intentSource: 'user' };
  assert.equal(normalizeLearningIntent(saved), saved);
  const restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: saved }));
  assert.equal(normalizeLearningIntent(restored).intent, oldDefault);
  assert.equal(restored.intentSource, 'user');
});

test('the API receives the simple default and explicitly forbids expanding it into extra learning assignments', () => {
  const document = createDemo();
  const request = { action: 'generate', scope: 'chapter', instruction: '整理', revision: 0, chapterId: document.chapters[0].id, document };
  for (const intent of [defaultLearningIntent, '']) {
    const messages = buildMessages({ ...request, document: { ...document, intent } });
    assert.equal(JSON.parse(messages[1].content).learningIntent, defaultLearningIntent);
    assert.match(messages[0].content, /只要求解释到足以读懂原文/);
    assert.match(messages[0].content, /只有用户明确提出更具体的要求时才增加相应内容/);
  }
});
