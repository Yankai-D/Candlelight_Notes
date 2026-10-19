import { defaultKnowledge, knowledgeSchema, learnerProfileSchema } from './learning.mjs';

export const learnerSetupKey = 'learner-setup-v1';
const legacyBackground = '本科理科学生，已学习机器学习导论。';
const legacyFoundations = ['高等数学', '概率论', '基础统计学'];

export function profileFromFields(background, foundations) {
  const value = { background: background.trim(), foundations: foundations.split(/[、,，\n]/).map(text => text.trim()).filter(Boolean) };
  const valid = learnerProfileSchema.safeParse(value);
  if (!valid.success) throw new Error('学习背景最多 4000 字；基础最多 100 项，每项不超过 200 字。');
  return valid.data;
}

export async function readLearnerSetup(db) {
  const raw = await db.get('preferences', 'knowledge');
  const marker = await db.get('preferences', learnerSetupKey);
  const parsed = knowledgeSchema.safeParse(raw);
  let knowledge = parsed.success ? parsed.data : structuredClone(defaultKnowledge);
  // The old demo persona was not an explicit statement by a new user.
  // Only remove that exact legacy seed; preserve custom profiles for confirmation.
  if (!marker && knowledge.background === legacyBackground && knowledge.foundations.length === legacyFoundations.length && legacyFoundations.every(item => knowledge.foundations.includes(item))) {
    knowledge = { ...knowledge, background: '', foundations: [] };
    await db.put('preferences', knowledge, 'knowledge');
  }
  const ready = marker?.version === 1;
  /** @type {'profile' | 'connection' | null} */
  const step = ready && marker.step === 'complete' ? null : ready && marker.step === 'connection' ? 'connection' : 'profile';
  return { knowledge, step };
}

export async function commitLearnerSetup(db, value, step) {
  if (!['profile', 'connection', 'complete'].includes(step)) throw new Error('无效的首次设置状态。');
  const knowledge = knowledgeSchema.parse(value);
  knowledge.background = knowledge.background.trim();
  const tx = db.transaction('preferences', 'readwrite');
  await tx.store.put(knowledge, 'knowledge');
  await tx.store.put({ version: 1, step }, learnerSetupKey);
  await tx.done;
  return knowledge;
}

export async function resetLearnerSetup(db) {
  const parsed = knowledgeSchema.safeParse(await db.get('preferences', 'knowledge'));
  return commitLearnerSetup(db, { ...defaultKnowledge, materials: parsed.success ? parsed.data.materials : [] }, 'profile');
}
