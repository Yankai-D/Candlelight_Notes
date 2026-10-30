import { referenceSource, referenceContract } from './source-references.mjs';
import { reviewEvidence } from './review-evidence.mjs';
import { targetIndices } from './note-revision.mjs';

// Keep exact source pages, not generated summaries. The complete source stays
// available to review and to the recovery executor's full-context fallback.
export function revisionContext(request, candidate, review, focused = true) {
  const allSource = referenceSource(request), evidence = reviewEvidence(request);
  const indices = new Set();
  for (const finding of review.findings) {
    const targets = targetIndices(finding.target);
    for (const index of targets.length ? targets : [finding.target.index])
      for (const neighbor of [index - 1, index, index + 1]) if (neighbor >= 0 && neighbor < candidate.blocks.length) indices.add(neighbor);
  }
  const pages = new Set(review.findings.flatMap(f => [
    ...(f.sourcePages || []), ...(f.sourceEvidenceIds || []).map(id => evidence.byId.get(id)?.page).filter(Number.isInteger),
    ...targetIndices(f.target).flatMap(i => candidate.blocks[i]?.sourcePages || []),
  ]));
  const useAll = !focused || review.findings.some(f => f.dimension === 'coverage') || !pages.size;
  const source = useAll ? allSource : allSource.filter(p => pages.has(p.number));
  const blocks = candidate.blocks.flatMap((block, index) => !focused || candidate.blocks.length <= 10 || indices.has(index) ? [{ ...block, index }] : []);
  return { source, sourceReferences: referenceContract(source), blocks,
    contextScope: { focused, sourcePages: source.map(p => p.number), omittedPages: allSource.length - source.length,
      blockIndices: blocks.map(b => b.index), totalBlocks: candidate.blocks.length,
      rule: 'blocks[].index 是原候选块编号，不按当前数组位置重新编号。未提供的资料不是缺失事实；证据不足时返回 needsContext 请求完整上下文。' } };
}
