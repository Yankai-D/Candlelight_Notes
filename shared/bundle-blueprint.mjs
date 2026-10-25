import { z } from 'zod';

const text = z.string().trim().min(1).max(1200);
export const taskContractSchema = z.object({
  kind: z.enum(['lecture', 'solutions', 'narrative', 'translation', 'mixed', 'other']),
  requirements: z.array(z.object({ id: z.string().regex(/^r[1-9]\d?$/), text,
    evidenceQuote: z.string().trim().min(1).max(4000) }).strict()).min(1).max(12),
  organization: text, limitations: z.array(text).max(12),
}).strict();
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
}).strict();
export const bundleBlueprintSchema = z.object({ sections: z.array(sectionPlanSchema).min(1).max(300),
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
  const perChapter = Math.min(3000, Math.floor(24000 / Math.max(1, section.dependsOn?.length || 0)));
  return { task: plan.analysis.task, section,
    pendingChecks: (plan.analysis.pendingChecks || []).filter(check => check.unitIds.some(id => section.unitIds.includes(id))),
    relationships: plan.sections.map(({ title, purpose, dependsOn, handoff }) => ({ title, purpose, dependsOn, handoff })),
    prerequisiteNotes: (section.dependsOn || []).map(number => {
      const chapter = request.document.chapters[number - 1];
      const text = prose(chapter?.content);
      return { chapterId: chapter?.id, title: chapter?.title, excerpt: text.slice(0, perChapter), excerpted: text.length > perChapter };
    }),
    evidenceBoundary: 'Prerequisite notes support continuity, not source evidence. Verify knowledge against this chapter’s original sources.',
  };
}
