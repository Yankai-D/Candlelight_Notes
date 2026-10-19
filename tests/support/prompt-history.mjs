import assert from 'node:assert/strict';

// Explicit post-v0.1.0 changes, not a general normalizer. Historical experiments
// retain their original messages/hashes. New experiments use production prompts.
// 8a060db: product rename; 3a290ba: unknown/blank profile remains unknown.
export function currentMessagesFromV010(messages) {
  const oldName = '你是旁烛笔记的学习笔记编辑器。';
  const profile = '用户画像约束 stable-profile-v1：learner 仅包含用户明确维护的稳定背景与基础知识。资料库状态、已读记录、学习树的分类和概念均不代表用户画像，不据此推断掌握程度或省略必要解释。';
  const unknown = '画像留空或未声明的基础保持未知，不假定学历、专业或知识掌握；依据资料与学习目标解释必要前提，不编造用户背景。';
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[0].content.startsWith(oldName));
  assert.ok(messages[0].content.includes(profile + '\n'));
  return messages.map((message, index) => index ? structuredClone(message) : {
    ...message, content: message.content.replace(oldName, '你是烛光笔记的学习笔记编辑器。').replace(profile + '\n', profile + unknown + '\n'),
  });
}
