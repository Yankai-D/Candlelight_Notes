import test from 'node:test';
import assert from 'node:assert/strict';
import { planReviewContext, planReviewSchema, validatePlanReview, applyPlanAudit, planChangeContext, validatePlanVerification } from '../server/bundle-plan-review.mjs';
import { withOutputContract } from '../server/output-contract.mjs';
import { taskContractSchema, materialAnalysisSchema } from '../shared/bundle-blueprint.mjs';
import { executionScope, runStage, reserveExecutionCall } from '../server/execution.mjs';

const request = { intent: '独立使用的复习讲义', feedback: '清楚讲解知识点', units: [{ id: 'unit-1', title: '数据课程', excerpts: [{ text: '从例子到一般方法。' }] }] };
const candidate = { sections: ['抽样基础', '推断方法', '知识串联'].map(title => ({ title, purpose: `${title}的原理与实例`, handoff: '' })) };
const context = { ...planReviewContext(request, candidate), candidateDigest: 'a'.repeat(64) };
const review = () => ({ candidateDigest: context.candidateDigest, verdict: 'revise',
  checks: ['goal', 'coverage', 'order', 'coherence'].map(dimension => ({ dimension, status: dimension === 'goal' ? 'issue' : 'pass' })),
  findings: [{ dimension: 'goal', section: 4, problem: '这里的分工没有说明如何串联。', instruction: '在知识串联章说明与前文的联系。', evidenceQuote: candidate.sections[2].purpose }], summary: '需要完善章节分工。' });

test('valid quote with nonexistent chapter reports the chapter field and matching index, not a quote error', () => {
  assert.throws(() => validatePlanReview(context, review()), error => {
    assert.deepEqual(error.issues.map(issue => issue.code), ['PLAN_REVIEW_SECTION']);
    assert.deepEqual(error.issues[0].path, ['findings', 0, 'section']);
    assert.equal(error.issues[0].maximum, 3);
    assert.deepEqual(error.issues[0].refs, [3]);
    return true;
  });
});

test('mislocated real quotations, fabricated quotations and inconsistent dimensions are diagnosed independently', () => {
  const wrongLocation = review(); wrongLocation.findings[0].section = 2;
  assert.throws(() => validatePlanReview(context, wrongLocation), error => error.issues[0].code === 'PLAN_REVIEW_LOCATION');
  const fabricated = review(); fabricated.findings[0].section = 3; fabricated.findings[0].evidenceQuote = '并不存在的引文';
  fabricated.checks[0].status = 'pass';
  assert.throws(() => validatePlanReview(context, fabricated), error => {
    assert.deepEqual(error.issues.map(issue => issue.code), ['PLAN_REVIEW_QUOTE', 'PLAN_REVIEW_CHECK']); return true;
  });
  const goalQuote = review(); goalQuote.findings[0].section = 3; goalQuote.findings[0].evidenceQuote = request.intent;
  assert.equal(validatePlanReview(context, goalQuote).verdict, 'revise'); // User requirements need not be chapter-local prose.
  const overall = review(); overall.findings[0].section = 0;
  assert.equal(validatePlanReview(context, overall).verdict, 'revise');
  const badBinding = review(); badBinding.candidateDigest = 'b'.repeat(64); badBinding.findings[0].section = 3;
  assert.throws(() => validatePlanReview(context, badBinding), error => error.issues[0].code === 'PLAN_REVIEW_BINDING');
});

test('output contracts expose the actual validator fields, types and limits before the first call', () => {
  const messages = [{ role: 'system', content: 'protocol：instructions' }, { role: 'user', content: 'untrusted material' }];
  for (const schema of [taskContractSchema, materialAnalysisSchema, planReviewSchema]) {
    const wrapped = withOutputContract(messages, schema), generated = JSON.parse(wrapped[0].content.split('\n').at(-1));
    assert.equal(generated.additionalProperties, false);
    assert.deepEqual(wrapped[1], messages[1]);
    if (schema === materialAnalysisSchema) assert.equal(generated.properties.units.items.properties.topics.maxItems, 6);
    if (schema === planReviewSchema) {
      assert.ok(generated.properties.findings.items.required.includes('dimension'));
      assert.equal(generated.properties.findings.items.properties.section.type, 'integer');
    }
  }
  assert.equal(messages[0].content, 'protocol：instructions');
});

test('line wrapping and a missing summary do not consume recovery calls; actual quote content stays strict', () => {
  const expanded = { ...context, evidence: [...context.evidence, { id: 'wrapped', kind: 'source', unitId: 'unit-1', text: 'sample\n  mean\tand variance' }] };
  const value = review(); value.findings[0].section = 0; value.findings[0].evidenceQuote = 'sample mean and variance'; delete value.summary;
  const accepted = validatePlanReview(expanded, value);
  assert.match(accepted.summary, /分工/);
  assert.equal(accepted.findings[0].evidenceQuote, value.findings[0].evidenceQuote);
  value.findings[0].evidenceQuote = 'sample mean and covariance';
  assert.throws(() => validatePlanReview(expanded, value), error => error.issues.some(issue => issue.code === 'PLAN_REVIEW_QUOTE'));
});

test('audit cannot silently omit findings or defer known goal defects; source uncertainty retains an explicit verification task', () => {
  const value = review(); value.findings[0].dimension = 'coverage';
  const decision = { finding: 0, verdict: 'defer', reason: '当前只有少量来源摘录，不能据此断定原文缺少该知识点，需要读取完整资料核对。', evidenceIds: ['unit-1-excerpt-1'], question: '完整资料是否解释从例子到一般方法的步骤？' };
  const digest = 'c'.repeat(64), raw = { reviewDigest: digest, decisions: [decision] };
  const result = applyPlanAudit(context, value, digest, raw);
  assert.equal(result.review.verdict, 'accept');
  assert.deepEqual(result.pendingChecks, [{ question: decision.question, unitIds: ['unit-1'] }]);
  assert.throws(() => applyPlanAudit(context, review(), digest, raw), error => error.issues.some(issue => issue.code === 'PLAN_AUDIT_DEFER'));
  assert.throws(() => applyPlanAudit(context, value, digest, { ...raw, reviewDigest: 'd'.repeat(64) }), error => error.issues.some(issue => issue.code === 'PLAN_AUDIT_BINDING'));
  assert.throws(() => applyPlanAudit(context, value, digest, { ...raw, decisions: [decision, decision] }), error => error.issues.some(issue => issue.code === 'PLAN_AUDIT_FINDING'));
  assert.throws(() => applyPlanAudit(context, value, digest, { ...raw, decisions: [{ ...decision, evidenceIds: ['foreign'] }] }), error => error.issues.some(issue => issue.code === 'PLAN_AUDIT_EVIDENCE'));
});

test('controller uses precise failure evidence to patch a chapter reference without replacing valid quotes or accepting the plan', async () => {
  const initial = review(); let calls = 0, investigation = 0, journal;
  const messages = withOutputContract([{ role: 'system', content: 'review：check all findings' }, { role: 'user', content: JSON.stringify(context) }], planReviewSchema);
  const result = await executionScope({ binding: 'mislocated-review', save: value => { journal = value; } }, () => runStage({
    stage: 'bundle-plan-review', messages, initialRaw: JSON.stringify(initial), validate: raw => validatePlanReview(context, raw),
    complete: async (messages, stage) => {
      await reserveExecutionCall(); calls++;
      if (stage !== 'recovery-plan') return JSON.stringify(initial); // An ineffective rewrite must not end recovery.
      const data = JSON.parse(messages[1].content), issue = data.failure.issues[0];
      assert.equal(issue.code, 'PLAN_REVIEW_SECTION');
      const base = { failureId: data.failureId, cause: '引用正确，但章节编号不存在。', instruction: '核对编号后只修正定位。' };
      if (++investigation === 1) return JSON.stringify({ ...base, strategy: 'inspect', target: 'candidate', path: ['findings', 0] });
      return JSON.stringify({ ...base, strategy: 'patch', candidateDigest: data.candidateDigest,
        operations: [{ op: 'set', path: issue.path, expected: initial.findings[0].section, value: issue.refs[0] }] });
    },
  }));
  assert.equal(calls, 3);
  assert.equal(journal.recoveries, 2);
  assert.deepEqual(result.value.findings[0], { ...initial.findings[0], section: 3 });
  assert.equal(result.value.verdict, 'revise'); // Fixing a review envelope does not waive its substantive objection.
});

test('reviews can cite multiple evidence IDs without retyping quotes; fabricated IDs still fail', () => {
  const value = review(); value.findings[0].section = 3;
  delete value.findings[0].evidenceQuote;
  value.findings[0].evidenceIds = ['goal-intent', 'section-3-purpose'];
  assert.equal(validatePlanReview(context, value).verdict, 'revise');
  value.findings[0].evidenceIds.push('invented');
  assert.throws(() => validatePlanReview(context, value), error => error.issues.some(issue => issue.code === 'PLAN_REVIEW_EVIDENCE'));
});

test('repair verification cannot forget an unresolved defect, approve unchanged work, or reopen unchanged chapters as regressions', () => {
  const priorReview = review(); priorReview.findings[0].section = 3;
  const previous = { candidate, review: priorReview };
  const revised = structuredClone(candidate); revised.sections[2].purpose += '，并串联前文。';
  const current = { ...planReviewContext(request, revised), candidateDigest: 'b'.repeat(64), ...planChangeContext(candidate, revised) };
  const resolution = { finding: 0, status: 'resolved', reason: '补充了与前文的联系。', evidenceIds: ['section-3-purpose'] };
  const raw = { candidateDigest: current.candidateDigest, resolutions: [resolution], regressions: [] };
  assert.equal(validatePlanVerification(current, previous, raw).unresolved.length, 0);
  assert.throws(() => validatePlanVerification(current, previous, { ...raw, resolutions: [] }), error => error.issues.some(issue => issue.code === 'PLAN_VERIFY_COVERAGE'));
  assert.throws(() => validatePlanVerification(current, previous, { ...raw, resolutions: [resolution, resolution] }), error => error.issues.some(issue => issue.code === 'PLAN_VERIFY_FINDING'));
  assert.throws(() => validatePlanVerification({ ...current, changedSections: [] }, previous, raw), error => error.issues.some(issue => issue.code === 'PLAN_VERIFY_UNCHANGED'));
  const regression = { ...priorReview.findings[0], changedSections: [1] };
  assert.throws(() => validatePlanVerification(current, previous, { ...raw, regressions: [regression] }), error => error.issues.some(issue => issue.code === 'PLAN_VERIFY_CHANGE'));
  const unresolved = validatePlanVerification(current, previous, { ...raw, resolutions: [{ ...resolution, status: 'unresolved' }] });
  assert.equal(unresolved.unresolved[0].instruction, priorReview.findings[0].instruction);
  assert.equal(unresolved.unresolved[0].section, 3);
  assert.throws(() => validatePlanVerification(current, previous, { ...raw, resolutions: [{ ...resolution, evidenceIds: ['unknown'] }] }), error => error.issues.some(issue => issue.code === 'PLAN_REVIEW_EVIDENCE'));
});
