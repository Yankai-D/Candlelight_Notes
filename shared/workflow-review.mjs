import { z } from 'zod';

export const workflowDiagnoses = ['ORIGINAL_PAGE_AS_ID', 'OUTSIDE_EVIDENCE', 'EDIT_FORMAT', 'GOAL_MISMATCH', 'COVERAGE_GAP', 'UNSUPPORTED_CLAIM', 'UNCLEAR_REASONING', 'REVIEW_PROTOCOL', 'REVIEW_UNRESOLVED'];
export const workflowTriggers = ['SOURCE_REPAIR', 'FORMAT_REPAIR', 'SHORT_RESPONSE', 'MISSING_SOLUTION', 'NO_SOURCE_ANCHORS', 'SOURCE_QUOTE_MISMATCH'];
const diagnoses = z.array(z.enum(workflowDiagnoses)).max(workflowDiagnoses.length);
export const workflowRequestSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), attempt: z.number().int().positive(), chapterId: z.string().min(1).max(100),
  totalChapters: z.number().int().min(1).max(300), completedChapters: z.number().int().min(0).max(300),
  reviewPolicy: z.enum(['always', 'on-anomaly']), repairAllowance: z.number().int().min(0).max(12), priorDiagnoses: diagnoses,
}).strict();
export const workflowReportSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), attempt: z.number().int().positive(), chapterId: z.string().min(1).max(100),
  outcome: z.enum(['accepted', 'blocked', 'cancelled']), totalSegments: z.number().int().min(1).max(1000),
  reviewedSegments: z.number().int().min(0).max(1000), reviewCalls: z.number().int().min(0).max(3000),
  reusedReviewStages: z.number().int().min(0).max(3000).default(0),
  repairsUsed: z.number().int().min(0).max(12), diagnoses,
  requiredReviewSegments: z.number().int().min(0).max(1000).default(0), reviewTriggers: z.array(z.enum(workflowTriggers)).max(workflowTriggers.length).default([]),
  execution: z.object({ calls: z.number().int().min(0).max(1000), recoveryActions: z.number().int().min(0).max(1000),
    completedStages: z.number().int().min(0).max(10000) }).strict().optional(),
}).strict();
export const workflowStateSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), attempt: z.number().int().positive(), reviewPolicy: z.enum(['always', 'on-anomaly']),
  repairLimit: z.number().int().min(1).max(12), repairsUsed: z.number().int().min(0).max(12),
  history: z.array(workflowReportSchema).max(900),
}).strict();

export function startWorkflow(previous, chapterCount, reviewPolicy = 'on-anomaly') {
  const prior = previous ? workflowStateSchema.parse(previous) : undefined;
  return workflowStateSchema.parse({ version: 1, id: prior?.id || crypto.randomUUID(), attempt: (prior?.attempt || 0) + 1,
    reviewPolicy: prior?.reviewPolicy || reviewPolicy, repairLimit: Math.min(12, Math.max(3, chapterCount)), repairsUsed: 0, history: prior?.history || [] });
}
export function workflowRequest(state, chapterId, totalChapters, completedChapters) {
  return workflowRequestSchema.parse({ version: 1, id: state.id, attempt: state.attempt, chapterId, totalChapters, completedChapters,
    reviewPolicy: state.reviewPolicy, repairAllowance: Math.max(0, state.repairLimit - state.repairsUsed),
    priorDiagnoses: [...new Set(state.history.flatMap(report => report.diagnoses))] });
}
export function workflowFailure(message = '本次任务的审查记录不完整，已停止提交并保留原笔记。') {
  return Object.assign(new Error(message), { code: 'WORKFLOW_REVIEW_FAILED' });
}
export function acceptWorkflowReport(state, request, raw, outcome) {
  const parsed = workflowReportSchema.safeParse(raw);
  if (!parsed.success) throw workflowFailure();
  const report = parsed.data;
  if (report.id !== state.id || report.attempt !== state.attempt || report.chapterId !== request.chapterId || report.outcome !== outcome
      || state.history.some(prior => prior.id === report.id && prior.attempt === report.attempt && prior.chapterId === report.chapterId)
      || report.repairsUsed > request.repairAllowance || state.repairsUsed + report.repairsUsed > state.repairLimit || report.reviewedSegments > report.totalSegments
      || report.reviewCalls + report.reusedReviewStages < report.reviewedSegments || report.requiredReviewSegments > report.totalSegments || outcome === 'accepted' && (report.reviewedSegments < report.requiredReviewSegments || report.reviewTriggers.length > 0 && !report.reviewedSegments)
      || outcome === 'accepted' && request.reviewPolicy === 'always' && report.reviewedSegments !== report.totalSegments) throw workflowFailure();
  return workflowStateSchema.parse({ ...state, repairsUsed: state.repairsUsed + report.repairsUsed, history: [...state.history, report].slice(-900) });
}
