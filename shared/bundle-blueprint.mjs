import { z } from 'zod';
import { teachingPlanSchema, teachingContext } from './teaching-plan.mjs';

const text = z.string().trim().min(1).max(1200);
export const taskRequirementSchema=z.object({id:z.string().regex(/^r[1-9]\d?$/),text,
  evidenceQuote:z.string().trim().min(1).max(4000),scope:z.enum(['global','section']).optional()}).strict();
export const taskContractSchema = z.object({
  kind: z.enum(['lecture', 'solutions', 'narrative', 'translation', 'mixed', 'other']),
  requirements: z.array(taskRequirementSchema).min(1).max(12),
  organization: text, limitations: z.array(text).max(12),
}).strict();
// New model requests declare scope. Existing saved/paused contracts without a
// scope keep the old section-assignment semantics; no guessing from keywords.
export const taskGenerationSchema=taskContractSchema.extend({requirements:z.array(taskRequirementSchema.required({scope:true})).min(1).max(12)});
export const requirementScopePrompt='需求作用域 requirement-scope-v1：每项 requirement 的 scope 为 global 或 section。global 是整份交付的约束，如总章节数、全文组织、精简程度、文风、排除项和交付形式；它们始终有效，由整份规划审查核对，不要求在某一章重复挂标签。section 是必须由具体章节完成的主题、知识任务、题目或成果，至少分配到一章。必要时把混合要求分成各有原话依据的两项；不能为免除内容分工把具体主题或题目归为 global。scope 不表示要求已经满足；仍须对照用户原话与实际规划核查。';
export function requirementCoverage(task,sections) {
  const all=task.requirements.map(r=>r.id),required=task.requirements.filter(r=>r.scope!=='global').map(r=>r.id);
  const assigned=sections.flatMap(section=>section.requirementIds||[]);
  return {required,global:task.requirements.filter(r=>r.scope==='global').map(r=>r.id),
    missing:required.filter(id=>!assigned.includes(id)),unknown:[...new Set(assigned.filter(id=>!all.includes(id)))]};
}
export const materialAnalysisSchema = z.object({ units: z.array(z.object({
  id: z.string().max(100), topics: z.array(text).min(1).max(6),
  prerequisites: z.array(text).max(6), role: text, limitations: z.array(text).max(6),
}).strict()).min(1).max(300) }).strict();
export const sectionPlanSchema = z.object({
  title: z.string().trim().min(1).max(400), purpose: text,
  unitIds: z.array(z.string()).min(1).max(300),
  requirementIds: z.array(z.string()).max(12).optional(),
  dependsOn: z.array(z.number().int().positive()).max(300).optional(),
  handoff: z.string().max(1200).optional(),
  teaching: z.object({ focus: z.array(text).min(1).max(12), recallFrom: z.array(z.number().int().positive()).max(300), omit: z.array(text).max(12) }).strict().optional(),
}).strict();
export const sourceSelectionSchema=z.object({version:z.literal(1),omissions:z.array(z.object({
  unitIds:z.array(z.string()).min(1).max(300),reason:text,
}).strict()).max(300)}).strict();
export const bundleBlueprintSchema = z.object({ sections: z.array(sectionPlanSchema).min(1).max(300),
  teachingPlan: teachingPlanSchema.optional(),
  sourceSelection:sourceSelectionSchema.optional(),
  analysis: z.object({ version: z.literal(1), task: taskContractSchema,
    materials: materialAnalysisSchema, reviewSummary: z.string().max(1600),
    evidenceMode: z.literal('source-index-excerpts'),
    pendingChecks: z.array(z.object({ question: z.string().min(1).max(1600), unitIds: z.array(z.string()).min(1).max(300) }).strict()).max(72).optional(),
  }).strict().optional(),
}).strict();

export function planningIssue(message, issues) {
  return Object.assign(new Error(message), { code: 'STAGE_CONTRACT', issues });
}
export function validateTaskContract(request, raw) {
  const value = taskContractSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const origins = [request.intent, request.feedback || ''];
  const seen = new Set(), issues = [];
  value.requirements.forEach((requirement, index) => {
    if (seen.has(requirement.id)) issues.push({ path: ['requirements', index, 'id'], code: 'DUPLICATE_REQUIREMENT', expected: 'unique requirement ID' });
    if (!origins.some(origin => origin.includes(requirement.evidenceQuote))) issues.push({ path: ['requirements', index, 'evidenceQuote'], code: 'GOAL_EVIDENCE', expected: 'verbatim quote from intent or feedback' });
    seen.add(requirement.id);
  });
  if (issues.length) throw planningIssue('需求分析必须忠于用户原话，不能添加不存在的任务。', issues);
  return value;
}
export function validateMaterialAnalysis(units, raw) {
  const value = materialAnalysisSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const required = new Set(units.map(unit => unit.id)), actual = value.units.map(unit => unit.id);
  if (actual.length !== required.size || new Set(actual).size !== actual.length || actual.some(id => !required.has(id))) {
    throw planningIssue('资料分析未逐项对应当前批次的来源单元。', [{ path: ['units'], code: 'ANALYSIS_COVERAGE',
      expected: [...required], refs: [...required].filter(id => !actual.includes(id)) }]);
  }
  return value;
}

// Carried into generation and review. Prerequisite prose is writing context,
// never evidence for factual claims; originals remain the grounding authority.
export function compositionContract(request) {
  const plan = request.taskPlan;
  if (!request.composition || !plan?.analysis) return undefined;
  const index = request.document.chapters.findIndex(chapter => chapter.id === request.chapterId);
  const section = plan.sections[index];
  if (!section || plan.sections.length !== request.document.chapters.length || section.title !== request.document.chapters[index].title) throw planningIssue('章节与已保存的任务规划不一致。', [{ path: ['taskPlan', 'sections'], code: 'CHAPTER_BINDING' }]);
  const prose = node => [node?.text || '', ...(node?.content || []).map(prose)].filter(Boolean).join(' ');
  const recalls = [...new Set([...(section.dependsOn || []), ...(section.teaching?.recallFrom || [])])];
  const teaching = teachingContext(plan.teachingPlan, request.document.chapters, index + 1);
  const excerptSize = teaching?.evidence.reduce((n, e) => n + e.text.length, 0) || 0;
  const perChapter = Math.min(3000, Math.floor((24000 - excerptSize) / Math.max(1, recalls.length)));
  return { task: plan.analysis.task, section,
    ...(plan.sourceSelection?{proposedSourceOmissions:plan.sourceSelection.omissions}:{}),
    ...(plan.analysis.task.requirements?.some(r=>r.scope) ? {
      globalRequirements:plan.analysis.task.requirements.filter(r=>r.scope==='global'),
      sectionRequirements:plan.analysis.task.requirements.filter(r=>r.scope!=='global'&&section.requirementIds?.includes(r.id)),
    } : {}),
    ...(teaching ? { teaching } : {}),
    pendingChecks: (plan.analysis.pendingChecks || []).filter(check => check.unitIds.some(id => section.unitIds.includes(id))),
    relationships: plan.sections.map(({ title, purpose, dependsOn, handoff, teaching }) => ({ title, purpose, dependsOn, handoff, ...(teaching ? { teaching } : {}) })),
    prerequisiteNotes: recalls.filter(number => !teaching?.prior.some(item => item.section === number) || teaching.prior.some(item => item.section === number && item.status !== 'written')).map(number => {
      const chapter = request.document.chapters[number - 1];
      const text = prose(chapter?.content);
      return { chapterId: chapter?.id, title: chapter?.title, excerpt: text.slice(0, perChapter), excerpted: text.length > perChapter };
    }),
    evidenceBoundary: 'Prerequisite notes support continuity, not source evidence. Verify knowledge against this chapter’s original sources.',
  };
}
