import { createHash } from 'node:crypto';
import { z } from 'zod';
import { lectureBlockFields } from '../shared/lecture-synthesis.mjs';

export const candidateDigest = candidate => createHash('sha256').update(JSON.stringify(candidate.blocks)).digest('hex');
const legacy = z.object({ candidateDigest: z.string().length(64), changes: z.array(z.object({
  findingId: z.string(), blocks: z.array(z.unknown()).max(30),
}).strict()).min(1).max(8) }).strict();
const writtenEdit = z.object({
  findingId: z.string(), type: z.enum(['paragraph', 'heading', 'bulletList']),
  text: z.string().optional(), items: z.array(z.string()).optional(),
  sourcePages: z.array(z.number().int().positive()).default([]), sourceQuote: z.string().max(2000).default(''),
  section: z.enum(['translation', 'background', 'intuition', 'principles']).optional(),
  ...lectureBlockFields,
}).strict();
const flat = z.object({ candidateDigest: z.string().length(64), edits: z.array(z.union([
  writtenEdit, z.object({ findingId: z.string(), type: z.literal('delete') }).strict(),
])).min(1).max(240) }).strict();
export const revisionContextRequestSchema = z.object({ candidateDigest: z.string().length(64),
  needsContext: z.literal(true), reason: z.string().min(1).max(1200) }).strict();
export const revisionOutputSchema = z.union([flat, revisionContextRequestSchema]);

export const revisionTargetSchema = z.object({ type: z.enum(['replace', 'insertAfter', 'delete', 'merge']),
  index: z.number().int().min(-1), indices: z.array(z.number().int().nonnegative()).min(2).max(30).optional(),
}).strict();
export const targetIndices = target => target.type === 'insertAfter' ? [] : target.type === 'merge' ? target.indices || [] : [target.index];
const targetKey = target => JSON.stringify([target.type, target.index, target.indices]);

// Validate the whole transaction before applying any mutation. The candidate
// digest binds all consumed blocks, including non-adjacent merge members.
export function validateRevisionTargets(candidate, findings) {
  const occupied = new Map();
  for (const finding of findings) {
    const target = revisionTargetSchema.parse(finding.target), indices = targetIndices(target);
    if (target.index >= candidate.blocks.length || target.index < (target.type === 'insertAfter' ? -1 : 0)
      || target.type !== 'merge' && target.indices
      || target.type === 'merge' && (!indices.includes(target.index) || target.index !== Math.min(...indices)
        || new Set(indices).size !== indices.length || indices.some(i => i >= candidate.blocks.length)))
      throw Object.assign(new Error('修订目标越界或合并范围不明确；merge.index 必须是 indices 中最小的实际块编号。'), { code: 'REVISION_SCOPE' });
    for (const index of indices) {
      if (occupied.has(index) && occupied.get(index) !== targetKey(target))
        throw Object.assign(new Error('修订目标相互重叠；同一段不能同时删除、替换或参与不同合并，请将相关问题归入同一个合并目标。'), { code: 'REVISION_OVERLAP' });
      occupied.set(index, targetKey(target));
    }
  }
}

// A flat list avoids repeatedly nesting/closing changes[].blocks[] for several
// findings. Existing saved/provider responses retain their original protocol.
export function parseRevision(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Object.hasOwn(value || {}, 'edits')) return legacy.parse(value);
  const parsed = flat.parse(value), changes = [];
  for (const { findingId, ...block } of parsed.edits) {
    const existing = changes.find(change => change.findingId === findingId);
    if (existing && (block.type === 'delete' || !existing.blocks.length)) throw new Error('同一修订目标不能同时删除和写入。');
    if (existing) existing.blocks.push(block);
    else changes.push({ findingId, blocks: block.type === 'delete' ? [] : [block] });
  }
  return legacy.parse({ candidateDigest: parsed.candidateDigest, changes });
}

const sameBlock = (a, b) => Boolean(a && b) && a.type === b.type && a.section === b.section
  && a.learningUnitId === b.learningUnitId && a.learningRole === b.learningRole
  && JSON.stringify(a.learningRoles) === JSON.stringify(b.learningRoles)
  && JSON.stringify(a.teachingConceptIds) === JSON.stringify(b.teachingConceptIds)
  && JSON.stringify(a.teachingExampleIds) === JSON.stringify(b.teachingExampleIds)
  && a.text === b.text && JSON.stringify(a.items) === JSON.stringify(b.items)
  && JSON.stringify([...(a.sourcePages || [])].sort((x, y) => x - y)) === JSON.stringify([...(b.sourcePages || [])].sort((x, y) => x - y))
  && (a.sourceQuote || '') === (b.sourceQuote || '');

// Findings are audited individually. Only the writing operation is grouped:
// two independently confirmed issues in one paragraph must not overwrite each
// other or require regenerating an otherwise valid review.
export function revisionGroups(review) {
  const groups = [];
  for (const finding of review.findings) {
    let group = groups.find(g => targetKey(g.target) === targetKey(finding.target));
    if (!group) { group = { ...finding, relatedFindings: [] }; groups.push(group); }
    group.relatedFindings.push(finding);
  }
  return groups;
}

export function revisionContract(review) {
  return revisionGroups(review).map(g => ({ findingId:g.id, target:g.target, acceptedAliases:g.relatedFindings.map(f=>f.id) }));
}

function bindRevision(review, raw) {
  const value = structuredClone(typeof raw === 'string' ? JSON.parse(raw) : raw), contract = revisionContract(review);
  const collection = Object.hasOwn(value || {}, 'edits') ? 'edits' : 'changes';
  if (!Array.isArray(value?.[collection])) return { patch:parseRevision(value),normalizations:[] };
  const issues = [], normalizations = [];
  value[collection].forEach((edit,index) => {
    const group = contract.find(g => g.acceptedAliases.includes(edit?.findingId));
    if (!group) issues.push({path:[collection,index,'findingId'],code:'UNAUTHORIZED_REVISION_TARGET',
      message:'该问题不在已确认修订目标中；已撤销意见和旧草稿不是写作任务。',expected:contract});
    else if (edit.findingId !== group.findingId) {
      normalizations.push({kind:'same-target-alias',findingId:edit.findingId,canonicalId:group.findingId});
      edit.findingId = group.findingId;
    }
  });
  for (const group of contract) if (!value[collection].some(e=>e?.findingId===group.findingId))
    issues.push({path:[collection],code:'MISSING_REVISION_TARGET',message:'遗漏了已确认的写作目标。',expected:group});
  if (issues.length) throw Object.assign(new Error('修订目标不匹配；issues 给出多出或遗漏的具体目标。只依据当前已确认的目标修改，不恢复旧草稿意见。'),
    {code:'REVISION_TARGETS',issues});
  let patch = parseRevision(value);
  // Flat edits already preserve order after alias binding. Legacy changes can
  // split the same target across confirmed aliases; concatenate without losing
  // text, then map every audited finding back to the single writing operation.
  if (collection === 'changes') {
    const merged = [];
    for (const change of patch.changes) {
      const existing = merged.find(c=>c.findingId===change.findingId);
      if (existing) existing.blocks.push(...change.blocks); else merged.push(change);
    }
    patch = {...patch,changes:merged};
  }
  return {patch,normalizations};
}

export function applyRevision(candidate, review, raw) {
  validateRevisionTargets(candidate, review.findings);
  const {patch,normalizations} = bindRevision(review,raw), groups = revisionGroups(review);
  if (patch.candidateDigest !== candidateDigest(candidate) || review.candidateDigest !== patch.candidateDigest || patch.changes.length !== groups.length)
    throw new Error('修订与当前审查不匹配。');
  const changes = new Map();
  const replaced = new Set(review.findings.flatMap(f => targetIndices(f.target)));
  for (const change of patch.changes) {
    const finding = groups.find(f => f.id === change.findingId);
    if (changes.has(change.findingId) || !finding) throw new Error('修订目标重复或超出审查。');
    const blocks = structuredClone(change.blocks), index = finding.target.index;
    if (finding.target.type === 'delete' ? blocks.length !== 0 : blocks.length === 0)
      throw Object.assign(new Error('只有明确审核为 delete 的目标可以删除；其他目标必须提供实际正文。'), { code: 'REVISION_SCOPE' });
    // Only omit exact copies of an untouched adjacent block. Distinct prose,
    // formulas, citations and the user's original blocks are never removed.
    const beforeIndex = finding.target.type === 'replace' ? index - 1 : index;
    const afterIndex = index + 1;
    const omit = (side, neighbor) => {
      while (blocks.length > (['replace', 'merge'].includes(finding.target.type) ? 1 : 0)
        && !replaced.has(neighbor) && sameBlock(side === 'before' ? blocks[0] : blocks.at(-1), candidate.blocks[neighbor])) {
        if (side === 'before') blocks.shift(); else blocks.pop();
        normalizations.push({ findingId: finding.id, kind: 'copied-neighbor', retainedOriginalIndex: neighbor });
      }
    };
    omit('before', beforeIndex); omit('after', afterIndex);
    changes.set(change.findingId, blocks);
  }
  const blocks = [], changeMap = [], unchangedMap = [];
  const append = finding => {
    const start = blocks.length;
    blocks.push(...changes.get(finding.id));
    for (const related of finding.relatedFindings) changeMap.push({ findingId: related.id, previousTarget: related.target,
      previousIndices: targetIndices(related.target),
      currentIndices: Array.from({ length: blocks.length - start }, (_, i) => start + i) });
  };
  const insert = index => groups.filter(f => f.target.type === 'insertAfter' && f.target.index === index).forEach(append);
  insert(-1);
  candidate.blocks.forEach((block, index) => {
    const replacement = groups.find(f => f.target.type !== 'insertAfter' && f.target.index === index);
    if (replacement) append(replacement);
    else if (!replaced.has(index)) { unchangedMap.push({ previousIndex: index, currentIndex: blocks.length }); blocks.push(block); }
    insert(index);
  });
  if (!blocks.length) throw Object.assign(new Error('不能删除整章的全部正文。'), { code: 'REVISION_EMPTY' });
  return { candidate: { blocks: structuredClone(blocks), summary: candidate.summary || '' }, normalizations, changeMap, unchangedMap, patch };
}

export function repeatedReview(previous, next, changeMap) {
  return next.findings.length > 0 && next.findings.every(finding => previous.findings.some(prior =>
    prior.dimension === finding.dimension && prior.problem === finding.problem && prior.instruction === finding.instruction
    && changeMap.find(change => change.findingId === prior.id)?.currentIndices.includes(finding.target.index)));
}
