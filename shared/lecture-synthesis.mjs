import { z } from 'zod';
import { explicitTask } from './template-decision.mjs';
import { teachingBlockFields } from './teaching-plan.mjs';

export const lectureOrganization = '按要学会的核心概念与方法重组为紧凑、可独立学习的复习讲义。每个主题只主讲一次，直接定义、说明关键区别、给出可照做的步骤，在真正的难点解释理由；代表例题覆盖实质差异，同型材料合并。先取舍再写作，按知识依赖组织有明确分工的小节，不逐页翻译，不靠重复铺垫扩成教材。';
export const lectureSynthesisPrompt = `复习讲义契约 lecture-synthesis-v3：${lectureOrganization}
交付的是可独立复习、可以照着完成代表题的短讲义。篇幅由目标所需的知识与任务复杂度决定，不与源文本字数、页数、文件数或阅读分批数量成比例。相同知识换成十份重复课件，仍只讲一次；新增实质方法或用户明确扩大目标，才增加相应讲解。完成本章所选能力目标即结束，不逐段扩写，不把原段落改写后按主题堆叠。资料是选材池，阅读全部资料不等于把全部文字写进成品。先确定用户要学会的知识与方法，再选足以支撑它们的内容。来源覆盖记录用于证明材料经过考虑，不代表每页、每个例子都要占正文。默认舍去历史铺垫、课堂过场、重复定义、同型题、旁支证明和与目标无关的操作演示；保留方法的适用条件、决定解法的关键关系、会改变答案的例外。明确要求的证明、全部题解或详细专题不能擅自删去。
按知识依赖合并同一方法的概念、使用与代表例题；课次或文件名称可帮助回查，但不能决定知识分工。区分首次解释、后续应用与深化：同一概念可再次使用，关键是本次增加什么理解；同例可以贯穿多个主题。teaching.focus/recallFrom/omit 兼容旧规划，回顾长度按实际理解需要决定。composition.contract.teaching 的 objective、role、advance、difficultPoint、check 是新规划的教学职责；prior 中实际正文支持衔接，规划和状态都不能证明用户已经掌握。后文不重启无关背景，也不因出现过同一公式就删掉新的推理。没有新增教学作用的章节应合并。
正文以明确结论或操作开始，就地给足理由。基本形态是“是什么/何时用”用一小段说清，公式连同符号和条件直接给出，决定解法的一步解释清楚，再用代表题落实。不是每个概念都配背景、直觉、完整推导和应用意义。只有读者无法据此正确选法或完成步骤时才补解释；画像空缺不授权从全部基础课程重讲。定义、公式、条件、算例是可融合的用途，不是必须各写一节的栏目。
代表例题以覆盖实质差异为准：同型题合并，改变方法、关键条件或常见误解的例子应保留，不机械限制一个主题只能举一个例。题干保留必要数据与所求，一句选法依据，紧凑可核查的过程与结果。用户逐题全解任务仍使用题解契约。没有原题时不强行补自编算例；确有必要才补且标自编。课堂软件代码只保留达到目标必需的命令与结果解释，不逐行讲解整个演示脚本。
关键推理不能省成“显然可得”，但能用一个等式说明的关系不再拆成多段自然语言反复解释。证明只有在用户要求、知识本身是证明任务或决定方法正确性时展开；其余说明成立条件和关键依据即可。变体紧邻主方法说明哪项条件改变、哪一步替换，不重走整套讲解。文风直接准确，分段用于表达实质关系，不用标题装点空泛段落。
可独立学习的密度标准：知识按依赖推进，大章承载方法族，小节回答具体问题；需要时先用简短概览说明几条知识线的关系。定义直接说清，易混点用条件对照或最小反例区分，操作用可照做的步骤，决定成败的推理补上“为什么”。一段只推进一个关系，必要时短段、列表、比较和程序示例比挤成长段更易读；格式必须遵守当前输出协议。证明任务保留构造、正确性和必要的终止或边界论证，不能缩成“显然成立”。这些是按需要选择的表达方式，不是每节必须填满的固定栏目。已解释过的原则在后文简短引用，不重讲整套背景。全题库、额外试卷和自测只在用户目标要求时加入。
写作前选择，写作后减重：删除重复铺垫、定义改写、过渡预告、结尾复述和没有改变操作判断的延伸。lectureEditorial 的重复线索只是待核实的复核依据，篇幅仅记录；不能为了达数字删掉必要条件、答案或推理。以读者能解释关键区别、照步骤完成对应任务为准，不把字数更少当质量更好。允许短，不因短而补成教材。内部选材、omissions、覆盖标签与来源索引不打印为学习地图或审计清单；有助于学习的简短知识关系概览可以保留。`;

// Shared by planning and semantic review. These are editorial criteria, not
// mechanical heading/length assertions or an additional per-chapter API call.
export const lecturePlanningPrompt = '讲义编排审核：先从目标确定最小充分的学习能力集合，排除同型内容，再核对全篇主线、学习能力目标、先备关系，再核对每章首次解释、应用或深化的职责。重复来源可共同支撑一次讲解；同一概念或例题再次出现时，看它是否承担新的推理，不能按名称相同判重复。difficultPoint 指明需要展开的真正难点，check 说明能独立完成什么，不把它变成附加试卷。旧 teaching.focus/recallFrom/omit 仍可参考；每个来源 unit 应经过考虑，归属不等于逐项写入。没有新增教学作用的相邻章节合并，保留实质条件变化和用户指定任务。';
export const lectureReviewPrompt = '讲义编辑审核：以教学职责和实际正文检查必要内容与冗余。读者是否能解释关键区别、执行方法、说明条件变化？检查 difficultPoint 和 check 对应的理由是否真正出现，不把内部标签当教学完成证明。跨章同例的应用/深化必须保留新增推理；prior 的 changed/untracked 不等于原文缺失，也不能假定已讲清。对具体重复铺垫、同型例题堆叠或不服务目标的旁支定位 delete/merge/replace；保留可执行步骤、关键条件和必要证明。lectureEditorial 的相似段落只触发怀疑，必须比较教学作用，不能只凭字数判错。重复材料已合并不算遗漏；不因短而要求变长，不因没有固定栏目判失败。';

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
    conceptIds: z.array(z.string().max(100)).max(24).optional(), exampleIds: z.array(z.string().max(100)).max(24).optional(),
    concept: description, method: z.array(description).max(12), sourceEvidenceIds: refs,
    examples: z.array(z.object({ aim: description, sourceEvidenceIds: refs }).strict()).max(8),
    variants: z.array(z.object({ difference: description, sourceEvidenceIds: refs }).strict()).max(8),
  }).strict()).max(12),
  merges: z.array(z.object({ sourceEvidenceIds: refs, intoUnit: z.string(), reason: description }).strict()).max(24),
  omissions: z.array(z.object({ sourceEvidenceIds: refs, reason: description }).strict()).max(48).optional(),
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
  synthesis.omissions?.forEach((item,index)=>check(item.sourceEvidenceIds,['synthesis','omissions',index,'sourceEvidenceIds']));
  if (issues.length) throw Object.assign(new Error('讲义知识单元或合并依据未对应当前来源。'), { code: 'STAGE_CONTRACT', issues });
  return synthesis;
}

const learningRole = z.enum(['concept', 'method', 'example', 'variant']);
export const lectureBlockFields = { ...teachingBlockFields, learningUnitId: z.string().max(100).optional(),
  learningRole: learningRole.optional(), learningRoles: z.array(learningRole).min(1).max(4).optional() };
export function lectureCoverage(synthesis, blocks) {
  if (!synthesis) return { bindingIssues: [], gaps: [] };
  const units = new Map(synthesis.units.map(unit => [unit.id, unit])), found = new Set(), issues = [];
  blocks.forEach((block, index) => {
    const roles = [...new Set([...(block.learningRoles || []), ...(block.learningRole ? [block.learningRole] : [])])];
    if (!block.learningUnitId && !roles.length) return;
    if (!units.has(block.learningUnitId) || !roles.length) issues.push({ path: ['blocks', index, 'learningUnitId'], code: 'LECTURE_UNIT_BINDING', expected: [...units.keys()] });
    if (block.type !== 'heading' && (block.text || block.items?.join(' '))?.trim()) for (const role of roles) found.add(`${block.learningUnitId}:${role}`);
  });
  const gaps=[];
  for (const unit of synthesis.units) {
    const roles = ['concept', ...(unit.method.length ? ['method'] : []), ...(unit.examples.length ? ['example'] : []), ...(unit.variants.length ? ['variant'] : [])];
    for (const role of roles) if (!found.has(`${unit.id}:${role}`)) gaps.push({ learningUnitId: unit.id, learningRole: role });
  }
  return {bindingIssues:issues,gaps};
}
export function validateLectureCoverage(synthesis, blocks) {
  const report=lectureCoverage(synthesis,blocks);
  // Invalid references are structural errors. Missing annotations are only
  // evidence of missing annotations, not proof that teaching is absent.
  if (report.bindingIssues.length) throw Object.assign(new Error('讲义标注引用了不存在的知识单元或缺少用途。'), { code: 'STAGE_CONTRACT', issues:report.bindingIssues });
  return report;
}

export const lectureCoveragePrompt = '生成讲义时，各正文块用 learningUnitId 引用 chapterAnalysis.synthesis.units 的实际 id，并用 learningRoles 数组标明实际承担的 concept、method、example、variant 用途。一段可融合多个用途，例如定义阈值并解释操作的段落可标 learningRoles:["concept","method"]，不为凑标签拆段或重复。兼容旧 learningRole 单值，但推荐数组。标题不计正文覆盖。先写精简、完整的实际内容，再标注其用途；每个已规划内容有对应正文，已融合讲清的内容不需要另写一遍。标注只辅助结构检查，不能证明内容正确，事实仍须依据 source；标注不写进可见正文。';

export { lectureSample } from './lecture-handout-sample.mjs';
