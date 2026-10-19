import { editorialPolicy } from './editorial-policy.mjs';
import { noteFormatPrompt } from './note-format.mjs';
import { courseStylePrompt } from './course-style.mjs';
import { writingTemplatePrompt } from './writing-templates.mjs';

// A document genre, not another voice or difficulty setting. Paper composition
// is deliberately NOT inherited: a course can reorganize multiple sources.
export const coursePolicy = {
  id: 'course-lecture-v1',
  voice: editorialPolicy.id,
  label: '课程复习讲义',
  composition: [
    '一次生成一份讲义。learningIntent 是本次成品必须回应的目标，决定范围内的重点、用途和解释深度；不顺带生成试卷、答案册或其他版本。没有目标时使用“看懂这篇文章”，不自行替用户设定考试、职业或难度目标。',
    '按知识依赖和要解决的问题组织长文，可以跨文件、跨章节重组。合并教材与课件对同一概念的重复介绍，保留各自独有的条件、反例、图示信息和重要细节；不按文件顺序拼接摘要。覆盖清单是内部约束，不是正文目录的固定文案。',
    '每个主题只安排一个主要解释位置。后文需要时用简短关系衔接，避免再次完整定义。相邻小节沿同一问题推进，正文中的背景、直觉、公式和例子自然融合；不设“必要背景／直觉讲解／关键原理／本节总结”等固定教学栏目。',
    '公式进入正文前先让变量、单位和所求量有含义。条件放在结论附近；关键计算完成后说明它如何改变当前判断。熟悉的代数紧凑处理，概念转换、适用条件和常见误读充分展开。不会因画像较强而省去核心条件。',
    '只将提供的资料视为证据。课件中未被正确抽取的图像公式、缺失定义或相互冲突的口径需要先核对，不根据记忆悄悄补成原文。来源不充分时明确留下局部缺口，不能声称已经覆盖。允许有依据的教学补充，但不得归为作者原话。',
    '沿用统一符号与单位。不同来源的符号若含义相同，可以在说明对应关系后统一；若条件、定义或结论不同，明确保留差异，不用流畅措辞掩盖冲突。不要把经验规律写成定理，不把描述性关联写成因果或统计推断。',
    '可添加少量合成算例，在首次出现处自然说明“合成算例”等来源属性，尽量用同一组数据连接相邻概念。必须交代计算口径、单位、舍入与条件；不复刻教材练习或将教学数据伪装成真实观察。数值需独立验算。',
    '每个实质段落携带 sourceId、page 和该页可核对的短引文。页码以输入文件的 PDF 页序为准，不能把不同文件的同号页合并。补充段落保留 origin=supplement 并关联当前主题；其数值和推导不冒充原文证据。来源元数据不混入正文的行文。',
    '封面、目录导航、许可和署名页不作为知识证据。署名、来源链接、许可及改编说明由程序保留在成品附记，不要求模型猜测许可信息。规划、验收表、覆盖标签和读者画像只用于内部，不进入讲义正文。',
  ],
  hardChecks: [
    '每个约定主题恰有一个主要解释位置，先修关系无环且顺序成立。',
    '每个主题的依据进入对应小节；来源必须同时匹配文件、PDF 页序及原文短引文。',
    '待核对的图像公式或残缺来源不能进入生成；不能用抽取残片伪装完整资料。',
    '正文只属于当前小节，不能改变覆盖规划或一次生成多份成品。',
    '公式通过统一内容编译与 MathJax 校验；不接受模型提交的渲染节点。',
    '失败只修复当前步骤一次；取消或失败不返回可提交成品，不改写旧笔记。',
  ],
  reviewCriteria: [
    '目标落实：读完能完成学习目标中的具体判断，而不只是识别术语。',
    '关系连贯：每段推进一个问题；能说明为何从当前概念进入下一个概念。',
    '张弛有度：关键细节有展开，计算之后回到问题；熟悉步骤不反复铺垫。',
    '跨文件融合：重复定义合并，独有信息和限定条件未丢失，例子与符号一致。',
    '事实与数学：逐项核对定义、单位、适用条件、图示和结论；算例独立验算。',
    '画像稳定：改变背景后，只有必要铺垫变化，文风、核心结论和严谨性不变。',
    '来源诚实：引用确实支持紧邻论述；补充推导、合成数据及未解决缺口可辨。',
  ],
};

export function courseEditorialPrompt(writingTemplate) {
  if (writingTemplate) return `讲义模板 ${coursePolicy.id}；采用独立的 ${writingTemplate.name} 组织规范。\n${writingTemplatePrompt(writingTemplate, { course: true })}\n` +
    coursePolicy.composition.filter((_, index) => index !== 2).join('\n') + '\n每个主题有一个主要解释位置；知识单元可独立回查，标题层级、段落职责按选定模板组织。跨文件、跨章节重组时保留来源和覆盖边界。\n' + noteFormatPrompt;
  return `讲义模板 ${coursePolicy.id}；文风契约 ${coursePolicy.voice}。\n` +
    [...editorialPolicy.invariants, ...editorialPolicy.adaptation, ...editorialPolicy.pacing, ...coursePolicy.composition]
      .map((rule, i) => `${i + 1}. ${rule}`).join('\n') + `\n${courseStylePrompt}\n${noteFormatPrompt}`;
}
