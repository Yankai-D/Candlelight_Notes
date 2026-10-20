// Small, allowlisted protocol: no provider output, paths or diagnostic payloads
// cross the HTTP boundary. The same classifier drives server and preparation.
import { workflowReportSchema } from './workflow-review.mjs';
const terminal = new Set(['SOURCE_CONTEXT_INVALID', 'INVALID_SOURCE_REFERENCE', 'REFERENCE_REPAIR_FAILED', 'INVALID_EDIT_FORMAT', 'OUTPUT_TRUNCATED', 'WORKFLOW_REVIEW_FAILED']);
export function noteFailureMetadata(error) {
  const parsed = workflowReportSchema.safeParse(error?.workflow);
  const code = terminal.has(error?.code) ? error.code : parsed.success && parsed.data.outcome === 'blocked' ? 'WORKFLOW_REVIEW_FAILED' : undefined;
  return { ...(code ? { code, recovery: { stopRun: true } } : {}), ...(parsed.success ? { workflow: parsed.data } : {}) };
}

export function preparationInterruption(error, consecutive, chapterId) {
  const metadata = noteFailureMetadata(error);
  if (metadata.recovery?.stopRun) return { code: metadata.code, chapterId,
    message: metadata.code === 'SOURCE_CONTEXT_INVALID' ? error.message : '本节未通过生成校验，有限自动修复未能解决，已停止后续章节以避免重复调用。' };
  if (consecutive >= 2) return { code: 'REPEATED_CHAPTER_FAILURE', chapterId,
    message: '连续两节生成失败，已暂停后续调用；已完成内容保留，请检查模型连接与来源后继续。' };
}
