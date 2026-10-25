import assert from 'node:assert/strict';
import { createDemo } from '../../src/demo.ts';
import { buildMessages, validateResult } from '../../server/harness.mjs';
import { buildNoteReview, validateNoteReview } from '../../server/note-review.mjs';
import { buildReviewAudit, applyReviewAudit } from '../../server/note-review-audit.mjs';
import { executionIssue, runStage } from '../../server/execution.mjs';

// Original miniature learning materials. No private library or saved provider
// responses. These are fault-injection probes, not a teaching-quality benchmark.
export function agentCases() {
  const document = createDemo();
  document.id = 'recovery-agent-public-fixture';
  document.title = '原创恢复测试材料'; document.intent = '看懂这份材料';
  document.pages = [
    { number: 41, text: 'A sample contains 20 observations: 5 successes and 15 failures. The observed success proportion is 5/20 = 0.25.' },
    { number: 73, text: 'Linearity of expectation does not require independent random variables. The expectation of X+Y equals the sum of their expectations.' },
  ];
  document.chapters = [{ id: 'c1', title: '比例与期望', sourcePages: [41, 73], status: 'empty', content: { type: 'doc', content: [] } }];
  document.currentChapter = 'c1';
  const request = { action: 'generate', scope: 'chapter', chapterId: 'c1', revision: document.revision, document,
    instruction: '解释比例与期望', learning: { mode: 'adaptive', template: 'guided-v3' } };
  const block = (text, sourcePages) => ({ type: 'paragraph', text, sourcePages, sourceQuote: '' });
  const baseline = { blocks: [block('样本共有 20 个观测，其中 5 个成功，15 个失败。', [41]),
    block('成功比例按成功次数除以观测总数计算。', [41]), block('因此成功比例为 \\(5/20 = 0.25\\)。', [41]),
    block('期望的线性性不要求随机变量独立。', [73])] };
  validateResult(request, baseline);
  const corrupt = structuredClone(baseline);
  corrupt.blocks[0].type = 'text'; corrupt.blocks[1].sourcePages = [1];
  corrupt.blocks[2].text = '因此成功比例为 5/20 = 0.25\\)。';
  const candidate = { blocks: [structuredClone(baseline.blocks[3])] };
  const context = JSON.parse(buildNoteReview(request, candidate)[1].content);
  const review = validateNoteReview(request, candidate, { candidateDigest: context.binding.candidateDigest, verdict: 'revise',
    checks: ['goal', 'coverage', 'grounding', 'clarity'].map(dimension => ({ dimension, status: dimension === 'grounding' ? 'issue' : 'pass' })),
    findings: [{ id: 'f1', dimension: 'grounding', target: { type: 'replace', index: 0 }, noteEvidenceId: context.blocks[0].evidenceId,
      sourceEvidenceIds: [context.source[1].excerpts[0].id], problem: '声称期望的线性性不需要独立。', instruction: '补上独立条件。' }] });
  return [
    { id: 'compound-adaptation', stage: 'generate', messages: buildMessages(request), initialRaw: JSON.stringify(corrupt),
      description: 'Malformed block type, wrong source namespace, and unmatched math delimiter; a correct unrelated block must survive.',
      validate: raw => validateResult(request, raw),
      verify: result => {
        const raw = JSON.parse(result.raw);
        assert.equal(raw.blocks.length, baseline.blocks.length);
        assert.deepEqual(raw.blocks[3], baseline.blocks[3]);
        assert.ok(result.value.blocks.every(b => b.sourcePages.every(id => [41, 73].includes(id))));
        assert.match(result.value.blocks[2].text, /0\.25/);
      } },
    { id: 'false-criticism', stage: 'note-review-audit', messages: buildReviewAudit(request, candidate, review),
      description: 'Missing audit field and uncertain decision; source contradicts the critic, so acceptance must dismiss the criticism.',
      initialRaw: JSON.stringify({ candidateDigest: review.candidateDigest, decisions: [{ findingId: 'f1', verdict: 'uncertain', reason: '尚未核对。' }] }),
      validate: raw => {
        const result = applyReviewAudit(request, candidate, review, raw);
        if (result.review.verdict === 'blocked') throw executionIssue('复核未解决分歧。', result.audit.decisions.map(d => ({ path: ['decisions', d.findingId], message: d.reason })));
        return result;
      },
      verify: result => { assert.equal(result.value.audit.decisions[0].verdict, 'dismiss'); assert.equal(result.value.review.verdict, 'accept');
        assert.deepEqual(candidate.blocks[0], baseline.blocks[3]); } },
  ];
}

export async function executeAgentCase(scenario, { complete, signal }) {
  let injectedFailedRepairs = 0;
  const result = await runStage({ ...scenario, signal,
    complete: async (messages, action) => {
      // Deliberately exercise recovery after an unsuccessful first correction.
      // This one response is injected, never counted as a model achievement.
      if (!injectedFailedRepairs) { injectedFailedRepairs++; return scenario.initialRaw; }
      return complete(messages, action);
    },
  });
  scenario.verify(result);
  return { injectedFailedRepairs, result };
}
