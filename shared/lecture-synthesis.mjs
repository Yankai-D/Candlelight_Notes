import { z } from 'zod';
import { explicitTask } from './template-decision.mjs';

export const lectureOrganization = '按知识点和方法重组资料：先给必要概念与适用条件，再给可操作的流程或模板，紧接对应的资料例题，最后比较课内变体及使用差异。每个主题只主讲一次，重复定义和同型例题合并；不同条件、边界与方法选择不能省略。目标是精简、初学者可以独立使用的学习资料，不逐页翻译，也不扩写所有段落。';
export const lectureSynthesisPrompt = `精简讲义契约 lecture-synthesis-v1：${lectureOrganization}
“完整”指覆盖学习目标需要的知识与方法，不指复述所有原文。每个知识单元可独立回查，使用知识性标题和必要层级。把文件和页码留作来源定位，不作为章节组织轴。默认不单设资料范围、学习地图或流水账导读章节；需要先修知识时在使用处给最短充分说明。
每个知识单元回答：是什么、何时用、怎么做。方法给输入、条件、步骤、输出与判断口径；公式先交代符号，保留关键推导，不展开重复代数。例题优先选资料内有代表性的题目，保留解题所需原题条件，给精简思路、可复现过程和答案；同型题不反复展开，除非用户明确要求逐题全解。变体只整理资料中实际出现的条件变化、公式/流程调整和易混区别，不能为了填满栏目编造变体。
只含概念的单元不强造流程，没有资料例题不伪称原题。补充教学算例必须标注为自编，不能替代已有原题。判断能否压缩的标准是初学者是否仍能识别适用条件并独立完成代表性问题；不能只剩公式清单，也不能把“唯一学习材料”误解成无限补充课外背景。用户明确要求的范围、逐题作答或完整证明优先。`;

export function isLectureSynthesis(request) {
  if (request.learning?.mode !== 'adaptive') return false;
  const task = explicitTask(request.learning?.regenerationFeedback || '') || explicitTask(request.document?.intent || '')
    || request.learning?.writingTemplate?.routing?.task;
  if (['solve', 'hints', 'answers', 'create-exercises', 'translate'].includes(task)) return false;
  const kind = request.taskPlan?.analysis?.task?.kind;
  if (kind === 'solutions' || request.learning?.writingTemplate?.layout === 'exercise') return false;
  return kind === 'lecture' || request.learning?.writingTemplate?.layout === 'structured';
}

const description = z.string().trim().min(1).max(1600);
const refs = z.array(z.string().max(100)).min(1).max(24);
export const lectureSynthesisSchema = z.object({
  units: z.array(z.object({ id: z.string().regex(/^k[1-9]\d?$/), topic: description,
    concept: description, method: z.array(description).max(12), sourceEvidenceIds: refs,
    examples: z.array(z.object({ aim: description, sourceEvidenceIds: refs }).strict()).max(8),
    variants: z.array(z.object({ difference: description, sourceEvidenceIds: refs }).strict()).max(8),
  }).strict()).min(1).max(12),
  merges: z.array(z.object({ sourceEvidenceIds: refs, intoUnit: z.string(), reason: description }).strict()).max(24),
}).strict();

export function validateLectureSynthesis(value, evidence) {
  const synthesis = lectureSynthesisSchema.parse(value), ids = synthesis.units.map(unit => unit.id), issues = [];
  if (new Set(ids).size !== ids.length) issues.push({ path: ['synthesis', 'units'], code: 'DUPLICATE_LEARNING_UNIT', expected: 'unique k IDs' });
  const check = (references, path) => {
    if (new Set(references).size !== references.length || references.some(id => !evidence.has(id))) issues.push({ path, code: 'SYNTHESIS_EVIDENCE', expected: [...evidence.keys()] });
  };
  synthesis.units.forEach((unit, index) => {
    check(unit.sourceEvidenceIds, ['synthesis','units',index,'sourceEvidenceIds']);
    for (const field of ['examples','variants']) unit[field].forEach((item, itemIndex) => check(item.sourceEvidenceIds, ['synthesis','units',index,field,itemIndex,'sourceEvidenceIds']));
  });
  synthesis.merges.forEach((merge, index) => {
    check(merge.sourceEvidenceIds, ['synthesis','merges',index,'sourceEvidenceIds']);
    if (!ids.includes(merge.intoUnit)) issues.push({ path: ['synthesis','merges',index,'intoUnit'], code: 'SYNTHESIS_MERGE_TARGET', expected: ids });
  });
  if (issues.length) throw Object.assign(new Error('讲义知识单元或合并依据未对应当前来源。'), { code: 'STAGE_CONTRACT', issues });
  return synthesis;
}

const learningRole = z.enum(['concept', 'method', 'example', 'variant']);
export const lectureBlockFields = { learningUnitId: z.string().max(100).optional(),
  learningRole: learningRole.optional(), learningRoles: z.array(learningRole).min(1).max(4).optional() };
export function validateLectureCoverage(synthesis, blocks) {
  if (!synthesis) return;
  const units = new Map(synthesis.units.map(unit => [unit.id, unit])), found = new Set(), issues = [];
  blocks.forEach((block, index) => {
    const roles = [...new Set([...(block.learningRoles || []), ...(block.learningRole ? [block.learningRole] : [])])];
    if (!block.learningUnitId && !roles.length) return;
    if (!units.has(block.learningUnitId) || !roles.length) issues.push({ path: ['blocks', index, 'learningUnitId'], code: 'LECTURE_UNIT_BINDING', expected: [...units.keys()] });
    if (block.type !== 'heading' && (block.text || block.items?.join(' '))?.trim()) for (const role of roles) found.add(`${block.learningUnitId}:${role}`);
  });
  for (const unit of synthesis.units) {
    const roles = ['concept', ...(unit.method.length ? ['method'] : []), ...(unit.examples.length ? ['example'] : []), ...(unit.variants.length ? ['variant'] : [])];
    for (const role of roles) if (!found.has(`${unit.id}:${role}`)) issues.push({ path: ['blocks'], code: 'LECTURE_UNIT_COVERAGE',
      expected: { learningUnitId: unit.id, learningRole: role }, message: '这是覆盖标注缺口，不是正文缺失的事实判断。先核对该单元的现有正文；一段可以同时解释概念与方法，用 learningRoles 数组表达多个真实用途，不要求分段重复。只有标题不计覆盖。确实缺内容才依据原资料局部补写，不能只添标签假装覆盖。' });
  }
  if (issues.length) throw Object.assign(new Error('讲义覆盖标注尚未对齐，需要核对实际正文。'), { code: 'STAGE_CONTRACT', issues });
}

export const lectureCoveragePrompt = '生成讲义时，各正文块用 learningUnitId 引用 chapterAnalysis.synthesis.units 的实际 id，并用 learningRoles 数组标明实际承担的 concept、method、example、variant 用途。一段可融合多个用途，例如定义阈值并解释操作的段落可标 learningRoles:["concept","method"]，不为凑标签拆段或重复。兼容旧 learningRole 单值，但推荐数组。标题不计正文覆盖。先写精简、完整的实际内容，再标注其用途；每个已规划内容有对应正文，已融合讲清的内容不需要另写一遍。标注只辅助结构检查，不能证明内容正确，事实仍须依据 source；标注不写进可见正文。';

export const lectureSample = {
  title: '样本均值与方差：会判断，也会计算',
  rules: ['按概念和方法组织，重复定义与同型算例只讲一次。', '方法给条件、步骤与结果解释；例题紧接方法，变体说明究竟改了哪里。', '用最短充分解释支持初学者独立做题，保留必要条件，不写资料导读或反复铺垫。'],
  paragraphs: [
    { id: 'question', text: '## 1. 先明确要描述什么\n\n均值描述数据的中心，标准差描述数据围绕中心的波动。两组数据的均值相同，离散程度仍可能不同；因此判断“典型水平”和“稳定程度”时，应分别看中心与离散指标。' },
    { id: 'mean', text: String.raw`## 2. 计算方法

给定 \(n>1\) 个观测 \(x_1,\ldots,x_n\)：①相加后除以 \(n\)，得 \(\bar{x}=\sum_i x_i/n\)；②逐项计算与均值的差并平方，再求和；③求样本方差 \(s^2=\sum_i(x_i-\bar{x})^2/(n-1)\)；④开平方得标准差 \(s\)。均值和标准差保留原数据单位，方差的单位是原单位的平方。先算均值再算偏差，不能用原始值的平方和直接替代偏差平方和。` },
    { id: 'variance', text: String.raw`## 3. 自编教学算例

题目：三次等待时间为 \(2,4,6\) 分钟，求样本均值、方差和标准差。

思路：先找中心，再量偏离中心的大小。\(\bar{x}=(2+4+6)/3=4\) 分钟；平方偏差和为 \((-2)^2+0^2+2^2=8\)；故 \(s^2=8/(3-1)=4\) 分钟平方，\(s=2\) 分钟。这里用的是样本方差口径。` },
    { id: 'choice', text: String.raw`## 4. 口径变了，哪一步要变

若题目把这三个数视为整个有限总体，平均平方偏差的分母改为 \(n\)，得到 \(8/3\)，不能与上面的样本方差混用。若题目改问“典型等待时间”，还需查看分布是否偏斜；少数极端值可能拉动均值，此时应结合中位数判断，不能只机械套公式。` },
  ],
};
