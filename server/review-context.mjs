import { referenceSource, referenceContract } from './source-references.mjs';
import { reviewEvidence } from './review-evidence.mjs';
import { targetIndices, revisionContextRequestSchema, candidateDigest } from './note-revision.mjs';

export { revisionContextRequestSchema as reviewContextRequestSchema };
export const reviewContextPrompt = `审查上下文 review-context-v1：contextScope.focused 为 true 时，只验收本次修改、相关原文与受影响内容。blocks[].index 是完整正文中的原编号，不能按缩减数组位置定位。outline 和 coverageIndex 只是导航，不是正文或事实证据；没有展示的段落不能认定缺失。需要其他正文或原文才能判断时，返回 {candidateDigest:当前正文摘要,needsContext:true,reason:"缺少的具体内容及用途"}，程序会展开完整上下文继续本次审查。不要猜测省略部分，也不要因上下文缩减而撤销真实问题。首次完整审查的四维要求保持不变。`;

export function reviewContext(request, candidate, { previous, findings, full = false } = {}) {
  const allSource = referenceSource(request), evidence = reviewEvidence(request), indices = new Set(), pages = new Set();
  const include = index => { for (const i of [index - 1, index, index + 1]) if (i >= 0 && i < candidate.blocks.length) indices.add(i); };
  const affected = findings || previous?.findings || [];
  if (previous) {
    for (const change of previous.changeMap) {
      change.currentIndices.forEach(include);
      if (!change.currentIndices.length) {
        const start = Math.min(...change.previousIndices), map = previous.unchangedMap || [];
        const before = map.filter(item => item.previousIndex < start).at(-1), after = map.find(item => item.previousIndex > start);
        if (before) include(before.currentIndex);
        if (after) include(after.currentIndex);
        if (!before && !after) include(Math.min(start, candidate.blocks.length - 1));
      }
    }
  } else for (const finding of affected) {
    const targets = targetIndices(finding.target);
    (targets.length ? targets : [Math.max(0, finding.target.index)]).forEach(include);
  }
  const units = new Set([...indices].map(index => candidate.blocks[index].learningUnitId).filter(Boolean));
  candidate.blocks.forEach((block, index) => { if (units.has(block.learningUnitId)) indices.add(index); });
  // Keep headings that give the selected prose its topic and scope.
  for (const index of [...indices]) for (let i = index; i >= 0; i--) if (candidate.blocks[i].type === 'heading') { indices.add(i); break; }
  for (const index of indices) for (const page of candidate.blocks[index].sourcePages || []) pages.add(page);
  for (const finding of affected) {
    for (const page of finding.sourcePages || []) pages.add(page);
    for (const id of finding.sourceEvidenceIds || []) if (evidence.byId.has(id)) pages.add(evidence.byId.get(id).page);
  }
  const complete = full || (!previous && !findings) || !indices.size;
  const source = complete || !pages.size || affected.some(f => f.dimension === 'coverage') ? allSource : allSource.filter(page => pages.has(page.number));
  const blocks = candidate.blocks.flatMap((block, index) => complete || candidate.blocks.length <= 10 || indices.has(index) ? [{ ...block, index }] : []);
  return { source, sourceReferences: referenceContract(source), blocks,
    outline: candidate.blocks.flatMap((block, index) => block.type === 'heading' ? [{ index, text: block.text }] : []),
    coverageIndex: candidate.blocks.flatMap((block, index) => block.learningUnitId ? [{ index, unit: block.learningUnitId, roles: block.learningRoles || [block.learningRole].filter(Boolean) }] : []),
    contextScope: { focused: blocks.length < candidate.blocks.length || source.length < allSource.length,
      blockIndices: blocks.map(block => block.index), totalBlocks: candidate.blocks.length, sourcePages: source.map(page => page.number), totalSourcePages: allSource.length } };
}

export function scopedReviewRequest(request, context) {
  return { ...request, document: { ...request.document, pages: context.source } };
}

export function checkReviewContextRequest(raw, candidate, context) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value?.needsContext) return null;
  const parsed = revisionContextRequestSchema.parse(value);
  if (parsed.candidateDigest !== candidateDigest(candidate) || !context.contextScope.focused) throw Object.assign(new Error('上下文申请与当前正文不符，或完整正文和来源已经提供。'), {
    code: 'REVIEW_CONTEXT', issues: [{ path: ['needsContext'], expected: { candidateDigest: candidateDigest(candidate), focused: context.contextScope.focused } }],
  });
  return parsed;
}

export function validateReviewScope(review, context) {
  if (!context.contextScope.focused) return review;
  const allowed = new Set(context.contextScope.blockIndices);
  const invalid = review.findings.flatMap((finding, index) => {
    const targets = targetIndices(finding.target);
    const needed = targets.length ? targets : [Math.max(0, finding.target.index)];
    return needed.some(i => !allowed.has(i)) ? [{ path: ['findings', index, 'target'], expected: [...allowed] }] : [];
  });
  if (invalid.length) throw Object.assign(new Error('审查定位到尚未提供的正文。先请求完整上下文，不能猜测省略段落。'), { code: 'REVIEW_CONTEXT', issues: invalid });
  return review;
}
