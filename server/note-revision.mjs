import { createHash } from 'node:crypto';
import { z } from 'zod';

export const candidateDigest = candidate => createHash('sha256').update(JSON.stringify(candidate.blocks)).digest('hex');
const legacy = z.object({ candidateDigest: z.string().length(64), changes: z.array(z.object({
  findingId: z.string(), blocks: z.array(z.unknown()).min(1).max(30),
}).strict()).min(1).max(8) }).strict();
const flat = z.object({ candidateDigest: z.string().length(64), edits: z.array(z.object({
  findingId: z.string(), type: z.enum(['paragraph', 'heading', 'bulletList']),
  text: z.string().optional(), items: z.array(z.string()).optional(),
  sourcePages: z.array(z.number().int().positive()).default([]), sourceQuote: z.string().max(2000).default(''),
  section: z.enum(['translation', 'background', 'intuition', 'principles']).optional(),
}).strict()).min(1).max(240) }).strict();

// A flat list avoids repeatedly nesting/closing changes[].blocks[] for several
// findings. Existing saved/provider responses retain their original protocol.
export function parseRevision(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Object.hasOwn(value || {}, 'edits')) return legacy.parse(value);
  const parsed = flat.parse(value), changes = [];
  for (const { findingId, ...block } of parsed.edits) {
    const existing = changes.find(change => change.findingId === findingId);
    if (existing) existing.blocks.push(block);
    else changes.push({ findingId, blocks: [block] });
  }
  return legacy.parse({ candidateDigest: parsed.candidateDigest, changes });
}

const sameBlock = (a, b) => Boolean(a && b) && a.type === b.type && a.section === b.section
  && a.text === b.text && JSON.stringify(a.items) === JSON.stringify(b.items)
  && JSON.stringify([...(a.sourcePages || [])].sort((x, y) => x - y)) === JSON.stringify([...(b.sourcePages || [])].sort((x, y) => x - y))
  && (a.sourceQuote || '') === (b.sourceQuote || '');

export function applyRevision(candidate, review, raw) {
  const patch = parseRevision(raw);
  if (patch.candidateDigest !== candidateDigest(candidate) || review.candidateDigest !== patch.candidateDigest || patch.changes.length !== review.findings.length)
    throw new Error('修订与当前审查不匹配。');
  const changes = new Map(), normalizations = [];
  const replaced = new Set(review.findings.filter(f => f.target.type === 'replace').map(f => f.target.index));
  for (const change of patch.changes) {
    const finding = review.findings.find(f => f.id === change.findingId);
    if (changes.has(change.findingId) || !finding) throw new Error('修订目标重复或超出审查。');
    const blocks = structuredClone(change.blocks), index = finding.target.index;
    // Only omit exact copies of an untouched adjacent block. Distinct prose,
    // formulas, citations and the user's original blocks are never removed.
    const beforeIndex = finding.target.type === 'replace' ? index - 1 : index;
    const afterIndex = index + 1;
    const omit = (side, neighbor) => {
      while (blocks.length > (finding.target.type === 'replace' ? 1 : 0)
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
    changeMap.push({ findingId: finding.id, previousTarget: finding.target,
      currentIndices: Array.from({ length: blocks.length - start }, (_, i) => start + i) });
  };
  const insert = index => review.findings.filter(f => f.target.type === 'insertAfter' && f.target.index === index).forEach(append);
  insert(-1);
  candidate.blocks.forEach((block, index) => {
    const replacement = review.findings.find(f => f.target.type === 'replace' && f.target.index === index);
    if (replacement) append(replacement);
    else { unchangedMap.push({ previousIndex: index, currentIndex: blocks.length }); blocks.push(block); }
    insert(index);
  });
  return { candidate: { blocks: structuredClone(blocks), summary: candidate.summary || '' }, normalizations, changeMap, unchangedMap };
}

export function repeatedReview(previous, next, changeMap) {
  return next.findings.length > 0 && next.findings.every(finding => previous.findings.some(prior =>
    prior.dimension === finding.dimension && prior.problem === finding.problem && prior.instruction === finding.instruction
    && changeMap.find(change => change.findingId === prior.id)?.currentIndices.includes(finding.target.index)));
}
