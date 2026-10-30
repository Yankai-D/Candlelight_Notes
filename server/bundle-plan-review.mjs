import { z } from 'zod';
import { executionIssue } from './execution.mjs';

export const planReviewDimensions = ['goal', 'coverage', 'order', 'coherence'];
const findingSchema = z.object({ dimension: z.enum(planReviewDimensions), section: z.number().int().min(0).max(300),
  problem: z.string().min(1).max(1600), instruction: z.string().min(1).max(1600),
  evidenceIds: z.array(z.string()).min(1).max(8).optional(),
  evidenceQuote: z.string().min(1).max(1200).optional(),
}).strict();
export const planReviewSchema = z.object({ candidateDigest: z.string().length(64), verdict: z.enum(['accept', 'revise']),
  checks: z.array(z.object({ dimension: z.enum(planReviewDimensions), status: z.enum(['pass', 'issue']) }).strict()).length(4),
  findings: z.array(findingSchema).max(12), summary: z.string().max(1600).default(''),
}).strict();

// PDF extraction and model quoting can differ in line wrapping. Normalize only
// whitespace, never words, punctuation, numbers or mathematical operators.
export const quoteText = text => text.replace(/\s+/gu, ' ').trim();

export function planReviewContext(request, candidate, task=candidate.analysis?.task) {
  return {
    sectionIndex: candidate.sections.map((section, index) => ({ number: index + 1, title: section.title })),
    evidence: [
      { id: 'goal-intent', kind: 'goal', text: request.intent },
      ...(candidate.sourceSelection?.omissions.map((item,i)=>({id:`source-omission-${i+1}`,kind:'plan',section:0,text:JSON.stringify(item)}))||[]),
      ...(task?.requirements?.some(r=>r.scope) ? task.requirements.map(r=>({id:`requirement-${r.id}`,kind:'goal',scope:r.scope||'section',text:JSON.stringify(r)})) : []),
      ...(request.feedback ? [{ id: 'goal-feedback', kind: 'goal', text: request.feedback }] : []),
      ...request.units.flatMap(unit => [ { id: `${unit.id}-title`, kind: 'source', unitId: unit.id, text: unit.title },
        ...unit.excerpts.map((excerpt, index) => ({ id: `${unit.id}-excerpt-${index + 1}`, kind: 'source', unitId: unit.id, text: excerpt.text })) ]),
      ...candidate.sections.flatMap((section, index) => ['title', 'purpose', 'handoff'].filter(field => section[field])
        .map(field => ({ id: `section-${index + 1}-${field}`, kind: 'plan', section: index + 1, text: section[field] }))),
      ...candidate.sections.flatMap((section, index) => ['unitIds', 'requirementIds', 'dependsOn', 'teaching'].filter(field => section[field])
        .map(field => ({ id: `section-${index + 1}-${field}`, kind: 'plan', section: index + 1, text: JSON.stringify(section[field]) }))),
      ...(candidate.teachingPlan ? [{ id: 'teaching-throughline', kind: 'plan', section: 0, text: candidate.teachingPlan.throughline },
        ...candidate.teachingPlan.concepts.map(c => ({ id: `teaching-${c.id}`, kind: 'plan', section: 0, text: JSON.stringify(c) })),
        ...candidate.teachingPlan.concepts.flatMap(c => c.placements.map(p => ({ id: `teaching-${c.id}-section-${p.section}`, kind: 'plan', section: p.section, text: JSON.stringify({ concept:c.id, ...p }) }))),
        ...candidate.teachingPlan.examples.map(e => ({ id: `teaching-${e.id}`, kind: 'plan', section: 0, text: JSON.stringify(e) }))] : []),
    ],
  };
}

export const planAuditSchema = z.object({ reviewDigest: z.string().length(64),
  decisions: z.array(z.object({ finding: z.number().int().nonnegative(), verdict: z.enum(['confirm', 'dismiss', 'defer']),
    reason: z.string().min(20).max(2000), evidenceIds: z.array(z.string()).min(1).max(8),
    question: z.string().min(1).max(1600).optional(),
  }).strict()).min(1).max(12),
}).strict();

export function applyPlanAudit(context, review, reviewDigest, raw) {
  const audit = planAuditSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const issues = [], seen = new Set(), evidence = new Map(context.evidence.map(item => [item.id, item]));
  if (audit.reviewDigest !== reviewDigest) issues.push({ path: ['reviewDigest'], code: 'PLAN_AUDIT_BINDING', expected: reviewDigest });
  audit.decisions.forEach((decision, index) => {
    const finding = review.findings[decision.finding], path = ['decisions', index];
    if (!finding || seen.has(decision.finding)) issues.push({ path: [...path, 'finding'], code: 'PLAN_AUDIT_FINDING', expected: review.findings.map((_, index) => index) });
    seen.add(decision.finding);
    if (decision.evidenceIds.some(id => !evidence.has(id))) issues.push({ path: [...path, 'evidenceIds'], code: 'PLAN_AUDIT_EVIDENCE', expected: 'IDs from evidence' });
    if (decision.verdict === 'defer' && (finding?.dimension !== 'coverage' || !decision.question || !decision.evidenceIds.some(id => evidence.get(id)?.kind === 'source'))) issues.push({ path: [...path, 'verdict'], code: 'PLAN_AUDIT_DEFER', expected: 'Only source coverage uncertainty may defer, with a concrete question and actual source evidence IDs; goal/order/coherence defects cannot defer' });
  });
  if (audit.decisions.length !== review.findings.length) issues.push({ path: ['decisions'], code: 'PLAN_AUDIT_COVERAGE', expected: review.findings.length });
  if (issues.length) throw executionIssue('规划意见复核未覆盖实际问题或缺少定位。', issues);
  const findings = review.findings.filter((_, index) => audit.decisions.find(decision => decision.finding === index).verdict === 'confirm');
  const pendingChecks = audit.decisions.filter(decision => decision.verdict === 'defer').map(decision => ({
    question: decision.question,
    unitIds: [...new Set(decision.evidenceIds.map(id => evidence.get(id)).filter(origin => origin.kind === 'source').map(origin => origin.unitId))],
  }));
  return { pendingChecks, decisions: audit.decisions, review: { ...review, findings, verdict: findings.length ? 'revise' : 'accept',
    checks: review.checks.map(check => ({ ...check, status: findings.some(finding => finding.dimension === check.dimension) ? 'issue' : 'pass' })),
    summary: audit.decisions.map(decision => `${decision.verdict}: ${decision.reason}`).join('\n').slice(0, 1600) } };
}

export function validatePlanReview(context, raw) {
  const review = planReviewSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const issues = [], { candidateDigest, sectionIndex, evidence } = context;
  if (review.candidateDigest !== candidateDigest) issues.push({ path: ['candidateDigest'], code: 'PLAN_REVIEW_BINDING', expected: candidateDigest });
  if (new Set(review.checks.map(check => check.dimension)).size !== planReviewDimensions.length) issues.push({ path: ['checks'], code: 'PLAN_REVIEW_DIMENSIONS', expected: planReviewDimensions });
  review.findings.forEach((finding, index) => {
    const path = ['findings', index], quote = quoteText(finding.evidenceQuote || '');
    const matches = finding.evidenceIds ? evidence.filter(origin => finding.evidenceIds.includes(origin.id))
      : quote ? evidence.filter(origin => quoteText(origin.text).includes(quote)) : [];
    if (finding.evidenceIds?.some(id => !evidence.some(origin => origin.id === id))) issues.push({ path: [...path, 'evidenceIds'], code: 'PLAN_REVIEW_EVIDENCE', expected: 'Existing IDs from evidence' });
    const matchedSections = [...new Set(matches.filter(origin => origin.kind === 'plan').map(origin => origin.section))];
    if (finding.section > sectionIndex.length) issues.push({ path: [...path, 'section'], code: 'PLAN_REVIEW_SECTION',
      message: `章节序号 ${finding.section} 不存在。只有 ${sectionIndex.length} 节；0 表示整体。引用文字是否匹配与这个序号错误是两件事。`,
      minimum: 0, maximum: sectionIndex.length, expected: sectionIndex, refs: matchedSections });
    else if (finding.section !== 0 && matches.length && matches.every(origin => origin.kind === 'plan') && !matchedSections.includes(finding.section)) issues.push({ path: [...path, 'section'], code: 'PLAN_REVIEW_LOCATION',
      message: '引文确实存在，但只在其他章节中；检查问题指向的章节，不要为了修复序号而改写真实引文。', expected: matchedSections, refs: matchedSections });
    if (!matches.length || (quote && !evidence.some(origin => quoteText(origin.text).includes(quote)))) issues.push({ path: [...path, 'evidenceQuote'], code: 'PLAN_REVIEW_QUOTE',
      message: '引文不是用户要求、来源摘录或当前规划中的连续原话；请从 evidence 中核对。', expected: 'verbatim substring of an evidence entry', context: finding.evidenceQuote });
    if (!review.checks.some(check => check.dimension === finding.dimension && check.status === 'issue')) issues.push({ path: [...path, 'dimension'], code: 'PLAN_REVIEW_CHECK',
      message: '该问题的维度在 checks 中未标记为 issue；应核对审查结论，不能通过删除真实问题规避。', expected: review.checks });
  });
  const problemChecks = review.checks.filter(check => check.status === 'issue');
  if ((review.verdict === 'accept' && (problemChecks.length || review.findings.length)) || (review.verdict === 'revise' && (!review.findings.length || problemChecks.some(check => !review.findings.some(finding => finding.dimension === check.dimension))))) issues.push({ path: ['verdict'], code: 'PLAN_REVIEW_VERDICT', message: '结论、检查维度和问题列表必须一致。' });
  if (issues.length) throw executionIssue('规划审查未通过校验；按具体字段诊断修复，不能把所有问题归因为引文。', issues);
  if (!review.summary.trim()) review.summary = (review.findings.length
    ? review.findings.map(finding => finding.problem).join('；')
    : review.checks.map(check => `${check.dimension}: ${check.status}`).join('；')).slice(0, 1600);
  return review;
}

// A repair is verified against the settled review, not a fresh unlimited wish
// list. Only regressions tied to actual changed sections can add new work.
export const planVerificationSchema = z.object({ candidateDigest: z.string().length(64),
  resolutions: z.array(z.object({ finding: z.number().int().nonnegative(), status: z.enum(['resolved', 'unresolved']),
    reason: z.string().min(1).max(2000), evidenceIds: z.array(z.string()).min(1).max(8),
  }).strict()).max(12),
  regressions: z.array(findingSchema.extend({ changedSections: z.array(z.number().int().min(1).max(300)).min(1).max(300) }).strict()).max(12),
}).strict();

export function planChangeContext(previous, candidate) {
  const changedSections = [], changedFields = [];
  for (let index = 0; index < Math.max(previous.sections.length, candidate.sections.length); index++) {
    const before = previous.sections[index], after = candidate.sections[index];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changedSections.push(index + 1);
      const fields = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter(field => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]));
      changedFields.push({ section: index + 1, fields });
    }
  }
  // A change in shared teaching duties can affect prose even when the section
  // titles and source assignments are unchanged. Recheck affected global ties.
  if (JSON.stringify(previous.teachingPlan) !== JSON.stringify(candidate.teachingPlan)||JSON.stringify(previous.sourceSelection)!==JSON.stringify(candidate.sourceSelection)) {
    for (let i = 1; i <= candidate.sections.length; i++) if (!changedSections.includes(i)) changedSections.push(i);
    changedFields.push({ section: 0, fields: ['teachingPlan','sourceSelection'].filter(key=>JSON.stringify(previous[key])!==JSON.stringify(candidate[key])) });
  }
  return { before: previous, changedSections, changedFields };
}

export function validatePlanVerification(context, previous, raw) {
  const result = planVerificationSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const issues = [], seen = new Set(), evidenceIds = new Set(context.evidence.map(item => item.id));
  if (result.candidateDigest !== context.candidateDigest) issues.push({ path: ['candidateDigest'], code: 'PLAN_REVIEW_BINDING', expected: context.candidateDigest });
  result.resolutions.forEach((resolution, index) => {
    if (!previous.review.findings[resolution.finding] || seen.has(resolution.finding)) issues.push({ path: ['resolutions', index, 'finding'], code: 'PLAN_VERIFY_FINDING', expected: previous.review.findings.map((_, index) => index) });
    seen.add(resolution.finding);
    if (resolution.evidenceIds.some(id => !evidenceIds.has(id))) issues.push({ path: ['resolutions', index, 'evidenceIds'], code: 'PLAN_REVIEW_EVIDENCE', expected: 'Existing IDs from current evidence' });
    if (resolution.status === 'resolved' && !context.changedSections.length) issues.push({ path: ['resolutions', index, 'status'], code: 'PLAN_VERIFY_UNCHANGED', expected: 'unresolved: candidate has not changed' });
  });
  if (result.resolutions.length !== previous.review.findings.length) issues.push({ path: ['resolutions'], code: 'PLAN_VERIFY_COVERAGE', expected: previous.review.findings.length });
  result.regressions.forEach((finding, index) => {
    if (finding.changedSections.some(section => !context.changedSections.includes(section))) issues.push({ path: ['regressions', index, 'changedSections'], code: 'PLAN_VERIFY_CHANGE', expected: context.changedSections });
  });
  if (result.resolutions.filter(item => item.status === 'unresolved').length + result.regressions.length > 12) issues.push({ path: ['regressions'], code: 'PLAN_VERIFY_CAPACITY', expected: 'At most 12 open root causes; consolidate duplicate symptoms without dropping actual requirements' });
  if (issues.length) throw executionIssue('修订核验必须逐项检查已有问题，并把新问题定位到实际修改。', issues);
  const unresolved = result.resolutions.filter(item => item.status === 'unresolved').map(item => {
    const finding = previous.review.findings[item.finding];
    const title = previous.candidate.sections[finding.section - 1]?.title;
    const locations = context.sectionIndex.filter(section => section.title === title);
    return { dimension: finding.dimension, section: locations.length === 1 ? locations[0].number : 0,
      problem: item.reason, instruction: finding.instruction, evidenceIds: item.evidenceIds };
  });
  const regressions = result.regressions.map(({ changedSections: _changes, ...finding }) => finding);
  const asReview = findings => ({ candidateDigest: context.candidateDigest, verdict: findings.length ? 'revise' : 'accept',
    checks: planReviewDimensions.map(dimension => ({ dimension, status: findings.some(finding => finding.dimension === dimension) ? 'issue' : 'pass' })), findings, summary: result.resolutions.map(item => `${item.status}: ${item.reason}`).join('\n').slice(0,1600) });
  // Existing unresolved issues retain their accepted instruction. Only new
  // regressions need an independent critique audit.
  validatePlanReview(context, asReview(unresolved));
  const regressionReview = validatePlanReview(context, asReview(regressions));
  return { unresolved, regressionReview, resolutions: result.resolutions, asSummary: asReview([]).summary };
}
