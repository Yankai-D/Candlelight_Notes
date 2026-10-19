import { editorialPrompt } from './editorial-policy.mjs';

export const defaultNotebookId = 'adaptive';
export const noteTemplates = {
  translation: { id: 'translation', label: '纯翻译', version: 'translation-v1', mode: 'translation', sections: [] },
  adaptive: { id: 'adaptive', label: '适应学习', version: 'guided-v3', mode: 'adaptive', sections: [] },
};
const integratedAdaptiveTemplate = { ...noteTemplates.adaptive, version: 'guided-v2' };
// Retain the old protocol only for unfinished notebooks created with it.
// Existing completed notes are stored as rich text and never rewritten here.
const groupedAdaptiveTemplate = {
  id: 'adaptive', label: '适应学习', version: 'guided-v1', mode: 'adaptive', sections: [
    { id: 'translation', label: '原文译文' }, { id: 'background', label: '必要背景' },
    { id: 'intuition', label: '直觉讲解' }, { id: 'principles', label: '关键原理' },
  ],
};
export function templateSettings(id) {
  const template = noteTemplates[id];
  if (!template) throw new Error('未知笔记模板。');
  return { mode: template.mode, difficulty: 'standard', style: 'clear', template: template.version };
}
export function templateFor(settings) {
  if (settings.mode === 'translation') return noteTemplates.translation;
  if (settings.template === 'guided-v3') return noteTemplates.adaptive;
  if (settings.template === 'guided-v2') return integratedAdaptiveTemplate;
  return settings.template === 'guided-v1' ? groupedAdaptiveTemplate : null;
}
export function isContinuousTemplate(settings) {
  return settings.mode === 'adaptive' && ['guided-v2', 'guided-v3'].includes(settings.template);
}
export function defaultEditInstruction(settings, action) {
  if (settings.mode === 'adaptive' && settings.writingTemplate) return action === 'explain'
    ? '沿用当前笔记已选定的模板，补足此处理解所需的概念、推理与例子，保持条件准确，不展开成整份新笔记。'
    : action === 'style' ? '沿用当前笔记模板的组织方式理顺表达，保留事实、公式、条件与个人补充。'
    : '沿用当前笔记模板，把选中内容写得更清楚，保留事实、公式和限定条件。';
  if (settings.mode === 'adaptive' && settings.template === 'guided-v3') {
    return action === 'explain' ? '沿用当前笔记的文风，补足理解当前内容所需的概念和推理；必要时加入具体例子，并说明例子的适用边界。'
      : action === 'style' ? '按统一笔记规范理顺表达和段落衔接，保持叙述视角与语气，保留事实、公式、条件和个人补充。'
      : '沿用当前笔记的文风，把选中内容写得更清楚，保留事实、公式和限定条件。';
  }
  return action === 'explain' ? '请用一个具体的日常例子，通俗解释当前概念，并说明比喻的边界。'
    : action === 'style' ? '让表达更清楚、更适合初学者，保留事实、公式与个人补充。' : '让这段话更清楚、更容易理解。';
}
export function templatePrompt(settings) {
  const template = templateFor(settings);
  if (!template || template.mode === 'translation') return '';
  if (template.version === 'guided-v3') return editorialPrompt();
  if (template.version === 'guided-v2') return `固定模板 ${template.version}：沿原文脉络写成一篇连贯的中文讲解长文。根据 learner 判断解释深度，已具备的知识只做简短连接，不能因为读过资料就假定完全掌握。
generate 必须完整保留本章的实质内容、论证顺序、公式、数据、假设与限定条件。译述、背景、直觉和原理是同一条叙述线：概念第一次出现时，就在这里解释它依赖的陌生前提，用恰当例子承接它的含义，再顺着本段论证说明为什么成立，之后自然回到原文。每个位置只补理解所需的内容，不对每个概念机械重复相同讲解步骤。
不要先给出整章译文，再另写背景、直觉或原理；不要为这些写作功能设置独立章节、标题、段落标签或小纸条，不输出 section 字段。段落之间应有指代、因果或问题递进关系，避免孤立的知识清单和复述。只保留有助于定位原文的实质性小标题，不凭空添加教学栏目。
长文可以按论证自然分段，公式可以独立成段；保留充分的推理过程，不把“连贯”理解为压缩总结，也不挤成一个超长段落。仅原文确实列举时才使用列表。
教学补充要在行文中自然说明是帮助理解的解释，不能冒充论文作者的主张、实验或结论；类比要交代边界。参考文献、致谢等按原文译述即可。
若有 segment，继续当前片段的论证，不为每段另起导读或总括，不重复其他片段；保持可直接顺序连接的正文。explain/rewrite/style 只执行用户提出的局部编辑，并延续连贯、克制、严谨的叙述。`;
  return `固定模板 ${template.version}，不要混用自由风格。根据 learner 判断解释深度，已具备的知识只做简短连接，不能因为读过资料就假定完全掌握。generate 的每个 blocks 元素必须带 section，且只能是以下四种：
translation（原文译文）：按原文顺序完整翻译，忠实保留公式、限定条件和论证，不夹入教学补充。
background（必要背景）：只补 learner 尚不熟悉且本章确实依赖的前置概念，先定义再说明用途；无需补充时省略。
intuition（直觉讲解）：围绕本章核心问题，用一个具体例子建立直觉，同时说明类比的边界；不写口号或重复译文。
principles（关键原理）：按假设→关键步骤→结论→适用边界解释必要原理，保留严谨公式；深度依据知识画像，不跳过陌生的关键步骤。
应用会统一分组、顺序和四个栏目标题。不要自己输出“原文译文/必要背景/直觉讲解/关键原理”这些栏目标题；其他原文章节小标题可以保留。不适用的教学栏目省略，参考文献、致谢等只需 translation。explain/rewrite/style 只执行当前局部编辑，不输出整套栏目，维持清晰、克制、严谨的叙述。`;
}
export function layoutTemplateBlocks(blocks) {
  if (!blocks.some(block => block.section)) return blocks;
  return groupedAdaptiveTemplate.sections.flatMap(section => {
    const content = blocks.filter(block => block.section === section.id);
    if (!content.length) return [];
    return [{ type: 'heading', text: section.label, sourcePages: [...new Set(content.flatMap(b => b.sourcePages || []))], sourceQuote: '' },
      ...content.filter(block => !(block.type === 'heading' && block.text.trim() === section.label))];
  });
}
