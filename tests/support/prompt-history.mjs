import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { learningGoalPrompt } from '../../shared/learning-goal.mjs';

// Explicit post-v0.1.0 changes, not a general normalizer. Historical experiments
// retain their original messages/hashes. New experiments use production prompts.
// 8a060db: product rename; 3a290ba: unknown/blank profile remains unknown.
// 762737a: goal-v2 separates requested outcomes from the fixed writing voice.
// b71cb99: source-reference-v2 distinguishes original pages from citation IDs.
export function currentMessagesFromV010(messages) {
  const oldName = '你是旁烛笔记的学习笔记编辑器。';
  const profile = '用户画像约束 stable-profile-v1：learner 仅包含用户明确维护的稳定背景与基础知识。资料库状态、已读记录、学习树的分类和概念均不代表用户画像，不据此推断掌握程度或省略必要解释。';
  const unknown = '画像留空或未声明的基础保持未知，不假定学历、专业或知识掌握；依据资料与学习目标解释必要前提，不编造用户背景。';
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[0].content.startsWith(oldName));
  assert.ok(messages[0].content.includes(profile + '\n'));
  const start = messages[0].content.indexOf('学习目标约束 learning-goal-v1：');
  const end = messages[0].content.indexOf('\n统一内容格式 ', start);
  assert.ok(start > 0 && end > start);
  const context = JSON.parse(messages[1].content), action = context.task;
  const oldGoal = messages[0].content.slice(start, end), nextGoal = learningGoalPrompt({ mode: 'adaptive' }, action);
  const hash = value => createHash('sha256').update(value).digest('hex');
  // Both sides are pinned: this is one reviewed migration, not permission to
  // normalize arbitrary future prompt changes or rewrite historical traces.
  assert.equal(hash(oldGoal), {generate:'c1bc3405dbeaf1df2836a710d9e511510be9c5e2ed212bb2bf257090661d4803',explain:'506b5d13d2b82c6472ef45a43a686c7d9eecc86ca6855ff04f618e34e730c52d'}[action]);
  assert.equal(hash(nextGoal), {generate:'38a9f53170106f64805848776beea4ca75688bd53bdf326a1eb66964c58c1db3',explain:'cb5057da03b4d25635f250b65f5a761aacd94e2740e8ffaaa8eb43b19111ecae'}[action]);
  const oldOrganization = '知识画像只决定陌生前提的铺垫深度，学习目标决定内容重点，不改变模板。';
  const nextOrganization = '任务优先于默认编排：learningIntent 要求什么成果，正文就完成什么成果。解答练习时按题号/小问组织过程与结果，允许题号标题与步骤段落；不要为了长文连贯或讲义知识层级，把独立题目改编成概念讲解。保持模板的语气与数学严谨性，不把组织偏好当作禁止作答的规则。样稿里的介绍、算例或总结只示范表达，不替代当前任务。\n知识画像只决定陌生前提的铺垫深度，学习目标决定交付任务，文风保持一致。';
  if (context.writingTemplate) assert.ok(messages[0].content.includes(oldOrganization));
  const referenceRule = '\n来源定位 source-reference-v2：sourceReferences.allowedIds 是本次可用的全部引用定位号，sourcePages 只能从中选择。mapping 显式区分 id 与原文件 originalPage；禁止用文件内页码、章节号或从 1 开始的顺序号代替 id。示例中的 id 仅示意格式，实际依据对应 source 正文选择。';
  assert.equal(context.sourceReferences, undefined, 'Historical traces must remain unchanged');
  const sourceReferences = { version: 'source-reference-v2', allowedIds: [...new Set(context.source.map(page => page.number))],
    mapping: context.source.map(page => ({ id: page.number, title: page.sourceTitle, originalPage: page.sourcePage })),
    rule: 'sourcePages 只填写 allowedIds 内的 id；originalPage 是原文件显示页码，不可用作定位号。不得按本节顺序从 1 重新编号。无来源的补充可用空数组，不为通过校验删除实际来源。' };
  const nextContext = Object.fromEntries(Object.entries(context).flatMap(entry => entry[0] === 'source' ? [entry, ['sourceReferences', sourceReferences]] : [entry]));
  return messages.map((message, index) => index === 1 ? { ...message, content: JSON.stringify(nextContext) } : index ? structuredClone(message) : {
    ...message, content: message.content.replace(oldName, '你是烛光笔记的学习笔记编辑器。').replace(profile + '\n', profile + unknown + '\n').replace(oldGoal, nextGoal).replace(oldOrganization, nextOrganization)
      .replaceAll('"sourcePages":[1]', `"sourcePages":${JSON.stringify(context.source.length ? [context.source[0].number] : [])}`) + referenceRule,
  });
}
