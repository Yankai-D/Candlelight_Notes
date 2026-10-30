import { z } from 'zod';

export const resolutionSchema = z.array(z.object({ findingId: z.string(),
  status: z.enum(['resolved', 'unresolved']), reason: z.string().min(1).max(1200),
}).strict()).max(8);
const failure = (message, path, expected) => Object.assign(new Error(message), {
  code: 'REVIEW_PROGRESS', issues: [{ path, message, expected }],
});

// The follow-up is a verification of explicit obligations, not another open
// editorial pass. New factual defects remain admissible; new style preferences
// on unchanged blocks do not reopen a completed edit.
export function validateFollowup(review, previous) {
  if (!previous) return review;
  const resolutions = review.resolutions ?? (review.verdict === 'accept'
    ? previous.findings.map(f => ({ findingId: f.id, status: 'resolved', reason: review.summary || '当前正文已通过复查。' })) : undefined);
  if (!resolutions || resolutions.length !== previous.findings.length
    || new Set(resolutions.map(r => r.findingId)).size !== resolutions.length
    || resolutions.some(r => !previous.findings.some(f => f.id === r.findingId)))
    throw failure('复查必须逐项给出上一轮 findings 的 resolutions，不重新开始一份独立审查。', ['resolutions'], {
      previous: previous.findings.map(({ id, problem, target }) => ({ id, problem, target })),
      rule: '每个旧 id 恰好一项 {findingId,status:resolved|unresolved,reason}；核对实际修改后决定，不猜测状态。',
    });
  for (const [index, resolution] of resolutions.entries()) {
    const related = review.findings.filter(f => f.priorFindingId === resolution.findingId);
    if ((resolution.status === 'unresolved') !== (related.length > 0))
      throw failure('unresolved 必须有携带 priorFindingId 的当前问题；resolved 不能同时仍要求修订同一问题。', ['resolutions', index], {
        prior: previous.findings.find(f => f.id === resolution.findingId), relatedFindings: related.map(({ id, priorFindingId }) => ({ id, priorFindingId })),
        rule: '依据当前正文核对是状态写错还是漏了问题关联；修正该字段或对应 finding.priorFindingId，不重新审查整章。',
      });
  }
  for (const [index, finding] of review.findings.entries()) {
    if (finding.priorFindingId) {
      if (!resolutions.some(r => r.findingId === finding.priorFindingId && r.status === 'unresolved'))
        throw failure('priorFindingId 必须对应上一轮尚未解决的问题。', ['findings', index, 'priorFindingId'], resolutions);
    } else if (finding.introducedBy?.length) {
      if (finding.introducedBy.some(id => !previous.changeMap.some(change => change.findingId === id)))
        throw failure('新回归必须用 introducedBy 指向实际发生的修订，并在 problem 中说明因果关系。', ['findings', index, 'introducedBy'], previous.changeMap);
    } else if (finding.dimension === 'clarity' || !finding.sourceEvidenceIds?.length) {
      throw failure('复查中新提出的问题须说明由哪次修改引入（introducedBy），或给出遗漏事实错误的来源证据；不能在未改段落上追加文风润色。', ['findings', index], { previousIds: previous.findings.map(f => f.id), changes: previous.changeMap });
    }
  }
  if (review.verdict === 'accept' && resolutions.some(r => r.status !== 'resolved')) throw failure('尚有未解决问题不能通过。', ['verdict'], resolutions.filter(r => r.status !== 'resolved'));
  return { ...review, resolutions };
}

export function createReviewLedger() {
  const issues = [];
  return {
    context: () => issues.map(({ id, status, problem, instruction, reason, revisions, dimension }) =>
      ({ id, status, problem, instruction, reason, revisions, dimension })),
    register(review, candidate, audit) {
      for (const finding of review.findings) {
        let issue = issues.find(i => i.id === finding.issueId);
        if (!issue) {
          issue = { id: `issue-${issues.length + 1}`, dimension: finding.dimension, problem: finding.problem,
            instruction: finding.instruction, status: 'open', revisions: 0 };
          issues.push(issue);
        }
        finding.issueId = issue.id;
        const decision = audit?.decisions.find(d => d.findingId === finding.id);
        if (decision?.verdict === 'dismiss') { issue.status = 'dismissed'; issue.reason = decision.reason; }
      }
    },
    settle(previous, review) {
      for (const resolution of review.resolutions || []) {
        const old = previous.findings.find(f => f.id === resolution.findingId), issue = issues.find(i => i.id === old?.issueId);
        if (!issue) continue;
        issue.status = resolution.status; issue.reason = resolution.reason; issue.revisions++;
        for (const finding of review.findings.filter(f => f.priorFindingId === resolution.findingId)) finding.issueId = issue.id;
      }
    },
    // A recurring obligation changes the next repair approach, never consumes
    // a fixed retry allowance or silently approves questionable content.
    strategy: review => review.findings.some(f => (issues.find(i => i.id === f.issueId)?.revisions || 0) > 0)
      ? '此前局部改写未解决同一问题。先核对可执行操作：重复内容应明确 delete 或 merge 相关块；不要用另一种说法保留重复段落。必要时在下一次审查中重定目标范围，并交由复核确认。'
      : '一次落实同一目标的全部已确认问题，保留其他内容。',
  };
}
