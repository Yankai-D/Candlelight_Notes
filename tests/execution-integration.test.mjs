import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createDemo } from '../src/demo.ts';
import { buildMessages, runModel } from '../server/harness.mjs';
import { createGenerationRecord, readGenerationRecords } from '../server/generation-records.mjs';
import { startWorkflow, workflowRequest, acceptWorkflowReport } from '../shared/workflow-review.mjs';

const config = { model: 'offline', baseUrl: 'https://example.test', apiKey: 'DO-NOT-PERSIST' };
const paragraph = text => ({ type: 'paragraph', text, sourcePages: [8], sourceQuote: '' });
function fixture() {
  const document = createDemo(); document.id = 'execution-fixture';
  document.pages = [{ number: 8, text: 'Each observation has a unit. Values can only be compared after conversion to the same unit.' }];
  document.chapters = [{ id: 'c1', title: '单位', sourcePages: [8], status: 'empty', content: { type: 'doc', content: [] } }];
  const state = startWorkflow(undefined, 1, 'always');
  return { state, request: { action: 'generate', scope: 'chapter', documentId: document.id, document, chapterId: 'c1',
    revision: document.revision, instruction: '解释单位', learning: { mode: 'adaptive', template: 'guided-v3' },
    workflow: workflowRequest(state, 'c1', 1, 0) } };
}
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const pass = context => ({ candidateDigest: context.binding.candidateDigest, verdict: 'accept',
  checks: ['goal', 'coverage', 'grounding', 'clarity'].map(dimension => ({ dimension, status: 'pass' })), findings: [] });
const plan = (context, strategy) => ({ failureId: context.failureId, strategy, cause: 'The previous answer did not address the validator context.',
  instruction: 'Use the original task and exact evidence to reconsider this stage only.' });
function findings(context) {
  return { ...pass(context), verdict: 'revise',
    checks: pass(context).checks.map(c => ({ ...c, status: c.dimension === 'clarity' ? 'issue' : 'pass' })),
    findings: [0, 1].map(index => ({ id: `f${index+1}`, dimension: 'clarity', target: { type: 'replace', index },
      noteEvidenceId: context.blocks[index].evidenceId, sourceEvidenceIds: [], problem: `第 ${index+1} 段没有解释单位转换。`,
      instruction: `在第 ${index+1} 段补上单位转换的具体意义。` })) };
}

test('uncertain review is diagnosed, reframed and resolved without regenerating or editing correct prose', async () => {
  const { request } = fixture(); let generations = 0, audits = 0, planners = 0, report;
  const candidate = { blocks: [paragraph('只有转换为相同单位，数值之间的比较才有意义。'), paragraph('单位决定数值的含义。')] };
  const raw = await runModel(config, buildMessages(request), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content), system = messages[0].content;
    if (system.startsWith('note-self-review')) return response(findings(context));
    if (system.startsWith('execution-recovery-plan')) { planners++; return response(plan(context, 'reframe')); }
    if (system.startsWith('note-review-audit')) {
      audits++;
      return response({ candidateDigest: context.binding, decisions: context.review.findings.map(f => ({ findingId: f.id,
        verdict: audits < 3 ? 'uncertain' : 'dismiss', sourceEvidenceIds: [],
        reason: '完整正文已说明单位转换与比较的关系，原审查的遗漏判断不成立，应保留原文。' })) });
    }
    assert.ok(!system.startsWith('note-review-patch'), 'Correct content cannot be patched to satisfy an uncertain critic');
    generations++; return response(candidate);
  }, { onWorkflowReport: value => { report = value; } });
  assert.deepEqual(JSON.parse(raw).blocks, candidate.blocks);
  assert.equal(generations, 1); assert.equal(audits, 3); assert.equal(planners, 1);
  assert.equal(report.repairsUsed, 0); assert.equal(report.execution.recoveryActions, 2); assert.equal(report.execution.calls, 6);
});

test('multiple failing patch targets are partitioned against the same snapshot and committed atomically', async () => {
  const { request } = fixture(); let reviews = 0, generations = 0, batches = 0, singles = 0;
  const candidate = { blocks: [paragraph('第一段不清晰。'), paragraph('第二段不清晰。'), paragraph('这一段必须保留。')] };
  const result = JSON.parse(await runModel(config, buildMessages(request), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content), system = messages[0].content;
    if (system.startsWith('execution-recovery-plan')) return response(plan(context, 'partition'));
    if (system.startsWith('note-self-review')) return response(++reviews === 1 ? findings(context) : pass(context));
    if (system.startsWith('note-review-audit')) return response({ candidateDigest: context.binding, decisions: context.review.findings.map(f => ({
      findingId: f.id, verdict: 'confirm', sourceEvidenceIds: [], reason: '目标段落没有解释数值比较所需的单位转换，定向补充这一关系符合当前目标。' })) });
    if (system.startsWith('note-review-patch')) {
      assert.deepEqual(context.blocks.map(b => b.text), candidate.blocks.map(b => b.text));
      if (context.review.findings.length > 1) { batches++; return response({ candidateDigest: context.binding, edits: [] }); }
      singles++;
      return response({ candidateDigest: context.binding, edits: [{ findingId: context.review.findings[0].id,
        ...paragraph(`通过统一单位后再比较数值，解决第 ${context.review.findings[0].target.index+1} 段的问题。`) }] });
    }
    generations++; return response(candidate);
  }));
  assert.equal(generations, 1); assert.equal(batches, 2); assert.equal(singles, 2);
  assert.equal(result.blocks.length, 3); assert.equal(result.blocks[2].text, candidate.blocks[2].text);
  assert.match(result.blocks[0].text, /第 1 段/); assert.match(result.blocks[1].text, /第 2 段/);
});

test('review recovery retains rejected drafts for audit without freezing their wording into an editing requirement', async () => {
  const { request } = fixture(); let reviews = 0, audits = 0;
  const candidate = { blocks: [paragraph('单位决定数值的含义。'), paragraph('比较数值前先统一单位。')] };
  const raw = await runModel(config, buildMessages(request), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content), system = messages[0].content;
    if (system.startsWith('execution-recovery-plan')) return response(plan(context, 'reframe'));
    if (system.startsWith('note-self-review')) {
      reviews++;
      const value = findings(context);
      if (reviews === 1) delete value.findings[0].instruction;
      else value.findings[0].problem += '这里补全措辞但保留问题身份。';
      return response(value);
    }
    if (system.startsWith('note-review-audit')) {
      audits++; assert.equal(context.review.recoveryFindings.length, 2);
      assert.equal(context.review.recoveryFindings[0].problem, '第 1 段没有解释单位转换。');
      return response({ candidateDigest: context.binding, decisions: context.review.findings.map(f => ({
        findingId: f.id, verdict: 'dismiss', sourceEvidenceIds: [], reason: '原问题与补全后的描述均已核对，正文明确说明单位的意义和统一单位后比较的关系。' })) });
    }
    assert.ok(!system.startsWith('note-review-patch')); return response(candidate);
  });
  assert.deepEqual(JSON.parse(raw).blocks, candidate.blocks);
  assert.equal(reviews, 2); assert.equal(audits, 1);
});

test('persisted recovery resumes accepted generation and review, with honest cached-review receipt and no secrets', async () => {
  // Windows runners may expose TEMP through an 8.3 alias. Match the canonical
  // workspace paths supplied by the application before testing record safety.
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'candlelight-execution-'));
  try {
    const { request, state } = fixture(), candidate = { blocks: [paragraph('单位需要明确。'), paragraph('数值需要比较。')] };
    let generations = 0, reviews = 0, fail = true;
    const fetcher = async (_, options) => {
      const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content), system = messages[0].content;
      if (system.startsWith('note-self-review')) { reviews++; return response(findings(context)); }
      if (system.startsWith('note-review-audit')) {
        if (fail) return new Response('denied', { status: 401 });
        return response({ candidateDigest: context.binding, decisions: context.review.findings.map(f => ({
          findingId: f.id, verdict: 'dismiss', sourceEvidenceIds: [], reason: '审查要求超出本章任务分工，当前说明已经满足目标，不需要追加要求。' })) });
      }
      generations++; return response(candidate);
    };
    const first = await createGenerationRecord(directory, request, config.model, fetcher);
    await assert.rejects(runModel(config, buildMessages(request), undefined, first.fetch, { saveCheckpoint: first.saveCheckpoint }), { code: 'MODEL_HTTP' });
    await first.finish('failed', undefined, { code: 'MODEL_AUTH' });
    const resumedState = startWorkflow(state, 1, 'always');
    request.workflow = workflowRequest(resumedState, 'c1', 1, 0);
    request.workflow.priorDiagnoses = ['REVIEW_UNRESOLVED'];
    request.document.preparation = { status: 'running', errors: { c1: 'Previous interruption' }, currentErrorIds: [] };
    const second = await createGenerationRecord(directory, request, config.model, fetcher); fail = false;
    assert.ok(second.checkpoint);
    let report;
    const raw = await runModel(config, buildMessages(request), undefined, second.fetch, { checkpoint: second.checkpoint,
      saveCheckpoint: second.saveCheckpoint, onWorkflowReport: value => { report = value; } });
    assert.deepEqual(JSON.parse(raw).blocks, candidate.blocks); assert.equal(generations, 1); assert.equal(reviews, 1);
    assert.equal(report.reusedReviewStages, 1); assert.equal(report.reviewCalls, 1); assert.equal(report.execution.calls, 1);
    assert.equal(acceptWorkflowReport(resumedState, request.workflow, report, 'accepted').history.length, 1);
    await second.finish('accepted', JSON.parse(raw));
    const stored = await readGenerationRecords(directory, request.documentId, second.id);
    assert.equal(stored.resumedFrom, first.id); assert.ok(!JSON.stringify(stored).includes(config.apiKey));
    const fresh = await createGenerationRecord(directory, { ...request, instruction: 'Different goal' }, config.model, fetcher);
    assert.equal(fresh.checkpoint, undefined); await fresh.finish('cancelled');
  } finally {
    assert.equal(dirname(resolve(directory)), temporaryRoot);
    await rm(directory, { recursive: true, force: true });
  }
});
