import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import { randomUUID } from 'node:crypto';
import { defaultKnowledge } from '../shared/learning.mjs';
import { learnerSetupKey, profileFromFields, readLearnerSetup, commitLearnerSetup, resetLearnerSetup } from '../shared/learner-setup.mjs';

async function database(run) {
  const name = randomUUID();
  const db = await openDB(name, 1, { upgrade(db) { db.createObjectStore('preferences'); db.createObjectStore('documents'); } });
  try { await run(db); } finally { db.close(); await deleteDB(name); }
}
test('first entry offers an empty profile and accepts an explicit skip without inventing a persona', async () => database(async db => {
  assert.deepEqual(defaultKnowledge, { background: '', foundations: [], materials: [] });
  assert.equal((await readLearnerSetup(db)).step, 'profile');
  await commitLearnerSetup(db, defaultKnowledge, 'complete');
  assert.equal((await readLearnerSetup(db)).step, null);
  assert.deepEqual((await readLearnerSetup(db)).knowledge, defaultKnowledge);
  assert.deepEqual(profileFromFields('  ', ''), { background: '', foundations: [] });
  assert.deepEqual(profileFromFields(' 从零开始 ', ''), { background: '从零开始', foundations: [] });
  assert.deepEqual(profileFromFields('学习者', ' 概率、统计\n编程，代数 '), { background: '学习者', foundations: ['概率','统计','编程','代数'] });
  assert.throws(() => profileFromFields('学习者', 'x'.repeat(201)), /200/);
}));
test('legacy demo profile is removed, while custom and explicitly confirmed profiles are preserved', async () => database(async db => {
  const legacy = { background: '本科理科学生，已学习机器学习导论。', foundations: ['高等数学','概率论','基础统计学'], materials: [] };
  await db.put('preferences', legacy, 'knowledge');
  const empty = await readLearnerSetup(db);
  assert.equal(empty.step, 'profile'); assert.equal(empty.knowledge.background, '');
  assert.equal((await db.get('preferences', 'knowledge')).background, '');
  const custom = { ...legacy, background: '在职学习者，熟悉线性代数。' };
  await db.put('preferences', custom, 'knowledge');
  assert.deepEqual(await readLearnerSetup(db), { knowledge: custom, step: 'profile' });
  await commitLearnerSetup(db, legacy, 'complete');
  assert.deepEqual(await readLearnerSetup(db), { knowledge: legacy, step: null });
}));
test('saved profile resumes at optional connection and only explicit completion opens the workspace', async () => database(async db => {
  const profile = { background: '自学编程', foundations: ['基本数学'], materials: [] };
  await commitLearnerSetup(db, profile, 'connection');
  assert.deepEqual(await readLearnerSetup(db), { knowledge: profile, step: 'connection' });
  await assert.rejects(commitLearnerSetup(db, { ...profile, background: 'x'.repeat(4001) }, 'complete'));
  assert.equal((await readLearnerSetup(db)).step, 'connection');
  await commitLearnerSetup(db, profile, 'complete');
  assert.equal((await readLearnerSetup(db)).step, null);
}));
test('profile reset preserves documents, collection and reading records without copying the cleared persona', async () => database(async db => {
  const material = { id:'read-1',title:'原有资料',category:'method',concepts:[],note:'阅读经历',readAt:1 };
  await commitLearnerSetup(db, { background:'旧背景', foundations:['旧基础'], materials:[material] }, 'complete');
  await db.put('documents', { text:'原有笔记' }, 'keep'); await db.put('preferences', { folders:['keep'] }, 'collection');
  const cleared = await resetLearnerSetup(db);
  assert.deepEqual(cleared, { background:'',foundations:[],materials:[material] });
  assert.equal((await readLearnerSetup(db)).step, 'profile');
  assert.deepEqual(await db.get('documents','keep'), { text:'原有笔记' });
  assert.deepEqual(await db.get('preferences','collection'), { folders:['keep'] });
}));
