import { confirmedAudit } from './support/review-audit.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { startTestServer } from './support/server.mjs';
import { createDemo } from '../src/demo.ts';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';
import { buildNoteReview, validateNoteReview, applyReviewPatch, noteReviewTriggers } from '../server/note-review.mjs';
import { startWorkflow, workflowRequest, acceptWorkflowReport } from '../shared/workflow-review.mjs';
import { prepareDocument } from '../shared/preparation.mjs';
import { noteFailureMetadata, preparationInterruption } from '../shared/note-recovery.mjs';

const config = { baseUrl: 'https://api.deepseek.com', model: 'test-only', apiKey: 'test-only' };
const sourceQuote = 'The sample mean is the sum of observations divided by the number of observations.';
const original = { blocks: [{ type: 'paragraph', text: '题目：求 2、4、6 的均值。均值反映数据的集中位置。', sourcePages: [8], sourceQuote }, { type: 'paragraph', text: '这一段已有的背景保持不变。', sourcePages: [8], sourceQuote }] };
const solved = { type: 'paragraph', text: '题目：求 2、4、6 的均值。思路：总和除以个数。解法：(2+4+6)/3=4。', sourcePages: [8], sourceQuote };
function fixture() {
  const document = createDemo(); document.intent = '给出每道题的简要思路、手写解题过程与答案';
  document.pages = [{ number: 8, text: sourceQuote, sourcePage: 1, sourceTitle: '练习' }];
  document.chapters = [{ id: 'c1', title: '均值练习', sourcePages: [8], status: 'empty', content: { type: 'doc', content: [] } }];
  const state = startWorkflow(undefined, 1, 'always');
  return { action: 'generate', scope: 'chapter', composition: true, instruction: document.intent, revision: document.revision, chapterId: 'c1', document, learning: { mode: 'adaptive', template: 'guided-v3' }, workflow: workflowRequest(state, 'c1', 1, 0) };
}
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
function review(context, revise = false) {
  return { candidateDigest: context.binding.candidateDigest, verdict: revise ? 'revise' : 'accept',
    checks: ['goal', 'coverage', 'grounding', 'clarity'].map(dimension => ({ dimension, status: revise && dimension === 'goal' ? 'issue' : 'pass' })),
    findings: revise ? [{ id: 'f1', dimension: 'goal', target: { type: 'replace', index: 0 }, noteQuote: context.blocks[0].text,
      sourcePages: [], sourceQuote: '', problem: '目标要求过程与答案，当前只讲了概念。', instruction: '保留题目，补充简要思路、计算步骤与最终答案。' }] : [], summary: revise ? '需要实际作答。' : '当前片段通过检查。' };
}

test('workflow performs generation and independent review before accepting a chapter', async () => {
  const input = fixture(), calls = []; let report;
  const raw = await runModel(config, buildMessages(input), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages; calls.push(messages);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    return response(messages[0].content.includes('note-self-review-v1') ? review(JSON.parse(messages[1].content)) : original);
  }, { action: 'generate', onWorkflowReport: value => { report = value; } });
  assert.equal(calls.length, 2); assert.equal(report.outcome, 'accepted'); assert.equal(report.reviewedSegments, 1); assert.equal(report.reviewCalls, 1);
  assert.equal(report.repairsUsed, 0); assert.deepEqual(JSON.parse(raw).blocks.map(b => b.text), original.blocks.map(b => b.text));
  assert.equal(JSON.parse(calls[1][1].content).goal, input.document.intent);
});

test('the default anomaly policy avoids unnecessary model review and triggers on suspicious goal fulfillment', async () => {
  assert.equal(startWorkflow(undefined, 10).reviewPolicy, 'on-anomaly');
  const input = fixture(); input.workflow.reviewPolicy = 'on-anomaly'; let calls = 0, report;
  await runModel(config, buildMessages(input), undefined, async () => { calls++; return response({ blocks: [solved] }); }, { action: 'generate', onWorkflowReport: value => { report = value; } });
  assert.equal(calls, 1); assert.equal(report.reviewCalls, 0); assert.deepEqual(report.reviewTriggers, []);
  const candidate = validateResult(input, original);
  assert.ok(noteReviewTriggers(input, candidate).includes('MISSING_SOLUTION'));
  assert.ok(!noteReviewTriggers({ ...input, learning: { mode: 'translation' } }, candidate).includes('MISSING_SOLUTION'));
  assert.ok(!noteReviewTriggers({ ...input, document: { ...input.document, intent: '不要给答案，只讲背景' } }, candidate).includes('MISSING_SOLUTION'));
  const long = { ...input, document: { ...input.document, pages: [{ number: 8, text: sourceQuote.repeat(30) }] } };
  assert.ok(noteReviewTriggers(long, { blocks: [{ type: 'heading', text: '只有提纲', sourcePages: [] }] }).includes('SHORT_RESPONSE'));
});

test('goal diagnosis repairs only the targeted block, then independently rechecks the result', async () => {
  const input = fixture(), phases = [], events = []; let report, reviews = 0;
  const raw = await runModel(config, buildMessages(input), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.includes('note-self-review-v1')) { phases.push('review'); return response(review(context, reviews++ === 0)); }
    if (messages[0].content.includes('note-review-patch-v1')) { phases.push('patch'); return response({ candidateDigest: context.binding, changes: [{ findingId: 'f1', blocks: [solved] }] }); }
    phases.push('generate'); return response(original);
  }, { action: 'generate', onCompletion: value => events.push(value), onWorkflowReport: value => { report = value; } });
  assert.deepEqual(phases, ['generate', 'review', 'patch', 'review']);
  const result = JSON.parse(raw); assert.equal(result.blocks[0].text, solved.text); assert.equal(result.blocks[1].text, original.blocks[1].text);
  assert.equal(report.reviewCalls, 3); assert.equal(report.repairsUsed, 1); assert.ok(report.diagnoses.includes('GOAL_MISMATCH'));
  assert.deepEqual(events.filter(e => e.review).map(e => [e.phase, e.review.verdict]), [['review', 'revise'], ['recheck', 'accept']]);
});

test('review conclusions require exact note targets, current source evidence and a matching snapshot', () => {
  const input = fixture(), candidate = validateResult(input, original), context = JSON.parse(buildNoteReview(input, candidate)[1].content);
  const valid = review(context, true);
  for (const change of [r => { r.candidateDigest = 'a'.repeat(64); }, r => { r.findings[0].noteQuote = 'invented note text'; }, r => { r.findings[0].target.index = 99; }, r => { r.findings[0].sourcePages = [1]; }, r => { r.checks[0].status = 'pass'; }, r => { r.verdict = 'accept'; }, r => { r.findings.push(r.findings[0]); }, r => { r.findings[0].dimension = 'grounding'; r.findings[0].sourceQuote = 'invented source'; }]) {
    const invalid = structuredClone(valid); change(invalid); assert.throws(() => validateNoteReview(input, candidate, invalid));
  }
  assert.throws(() => applyReviewPatch(candidate, valid, { candidateDigest: valid.candidateDigest, changes: [{ findingId: 'foreign', blocks: [solved] }] }));
  assert.throws(() => applyReviewPatch(candidate, valid, { candidateDigest: 'b'.repeat(64), changes: [{ findingId: 'f1', blocks: [solved] }] }));
});

test('targeted review repairs retain the protocol of unfinished legacy notebooks', async () => {
  const input = fixture(); input.learning.template = 'guided-v1'; let reviews = 0;
  const raw = await runModel(config, buildMessages(input), undefined, async (_, options) => {
    const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.includes('note-self-review-v1')) return response(review(context, reviews++ === 0));
    if (messages[0].content.includes('note-review-patch-v1')) {
      assert.match(messages[0].content, /须保留 section 字段/);
      return response({ candidateDigest: context.binding, changes: [{ findingId: 'f1', blocks: [{ ...solved, section: 'translation' }] }] });
    }
    return response({ blocks: original.blocks.map(block => ({ ...block, section: 'translation' })) });
  }, { action: 'generate' });
  assert.equal(JSON.parse(raw).blocks[0].section, 'translation');
  assert.equal(JSON.parse(raw).blocks[1].text, original.blocks[1].text);
});

test('invalid reviewer output changes strategy within a finite budget and cannot approve a note', async () => {
  let calls = 0;
  await assert.rejects(runModel(config, buildMessages(fixture()), undefined, async () => { calls++; return response(calls === 1 ? original : { verdict: 'accept' }); }, { action: 'generate' }), error => {
    assert.equal(error.code, 'WORKFLOW_REVIEW_FAILED'); assert.equal(error.workflow.outcome, 'blocked'); assert.equal(error.workflow.repairsUsed, 0);
    assert.equal(error.workflow.execution.recoveryActions, 2); return true;
  });
  assert.equal(calls, 6);
});

test('unresolved recheck stops without returning a chapter or starting another repair loop', async () => {
  let calls = 0;
  await assert.rejects(runModel(config, buildMessages(fixture()), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages, context = JSON.parse(messages[1].content);
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    if (messages[0].content.includes('note-self-review-v1')) return response(review(context, true));
    if (messages[0].content.includes('note-review-patch-v1')) return response({ candidateDigest: context.binding, changes: [{ findingId: 'f1', blocks: [solved] }] });
    return response(original);
  }, { action: 'generate' }), { code: 'WORKFLOW_REVIEW_FAILED' });
  assert.equal(calls, 9);
});

test('shared remaining budget can prohibit repairs but still allow normal reviewed generation', async () => {
  const input = fixture(); input.workflow.repairAllowance = 0; let calls = 0;
  await assert.rejects(runModel(config, buildMessages(input), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages;
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    return response(calls === 1 ? original : review(JSON.parse(messages[1].content), true));
  }, { action: 'generate' }), error => error.code === 'WORKFLOW_REVIEW_FAILED' && error.workflow.repairsUsed === 0);
  assert.equal(calls, 3, 'Advice can be audited, but no patch is sent after the task budget is exhausted');
});

test('local citation recovery is followed by review, and prior diagnosis is carried into subsequent chapter prompts', async () => {
  const input = fixture(); let calls = 0, report;
  await runModel(config, buildMessages(input), undefined, async (_, options) => {
    calls++; const messages = JSON.parse(options.body).messages;
    const audit = confirmedAudit(messages); if (audit) return response(audit);
    return response(calls === 1 ? { blocks: original.blocks.map(block => ({ ...block, sourcePages: [1] })) } : review(JSON.parse(messages[1].content)));
  }, { action: 'generate', onWorkflowReport: value => { report = value; } });
  assert.equal(calls, 2); assert.equal(report.repairsUsed, 0); assert.ok(report.diagnoses.includes('ORIGINAL_PAGE_AS_ID'));
  input.workflow.priorDiagnoses = report.diagnoses;
  assert.match(buildMessages(input)[0].content, /任务审查记忆/);
  assert.deepEqual(JSON.parse(buildMessages(input)[1].content).workflow.priorDiagnoses, report.diagnoses);
});

test('cancellation between generation and review prevents additional model calls', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(runModel(config, buildMessages(fixture()), controller.signal, async () => { calls++; controller.abort(); return response(original); }, { action: 'generate' }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('task state carries diagnosis and consumed budget across chapters; accepted reports cannot be forged or replayed', async () => {
  let latest = fixture().document;
  latest.chapters = ['c1', 'c2', 'c3', 'c4'].map(id => ({ ...structuredClone(latest.chapters[0]), id }));
  latest.currentChapter = 'c1'; const requests = [];
  await prepareDocument({ document: latest, reviewPolicy: 'always', settings: { mode: 'translation' }, getLatest: () => latest, save: async document => { latest = document; },
    request: async (_, chapterId, _settings, _knowledge, _signal, workflow) => {
      requests.push(workflow);
      return { result: original, workflow: { version: 1, id: workflow.id, attempt: workflow.attempt, chapterId, outcome: 'accepted', totalSegments: 1, reviewedSegments: 1, reviewCalls: 2, repairsUsed: chapterId === 'c1' ? 1 : 0, diagnoses: chapterId === 'c1' ? ['GOAL_MISMATCH'] : [] } };
    } });
  assert.equal(latest.preparation.status, 'complete'); assert.equal(latest.preparation.workflow.history.length, 4);
  assert.equal(requests[1].repairAllowance, requests[0].repairAllowance - 1); assert.equal(requests[1].completedChapters, 1); assert.deepEqual(requests[1].priorDiagnoses, ['GOAL_MISMATCH']);
  const state = startWorkflow(undefined, 4), request = workflowRequest(state, 'c1', 4, 0), previous = latest.preparation.workflow.history[0];
  assert.throws(() => acceptWorkflowReport(state, request, previous, 'accepted'), { code: 'WORKFLOW_REVIEW_FAILED' });
  const receipt = { ...previous, id: state.id, attempt: state.attempt };
  const accepted = acceptWorkflowReport(state, request, receipt, 'accepted');
  assert.throws(() => acceptWorkflowReport(accepted, request, receipt, 'accepted'), { code: 'WORKFLOW_REVIEW_FAILED' });
  assert.throws(() => acceptWorkflowReport(state, request, { ...receipt, reviewCalls: 0 }, 'accepted'), { code: 'WORKFLOW_REVIEW_FAILED' });
  assert.equal(noteFailureMetadata({ code: 'WORKFLOW_REVIEW_FAILED' }).recovery.stopRun, true);
  assert.equal(preparationInterruption({ workflow: { ...receipt, outcome: 'blocked' } }, 1, 'c1').code, 'WORKFLOW_REVIEW_FAILED');
});

test('production preparation cannot commit a generated chapter without its review receipt', async () => {
  let latest = fixture().document, calls = 0;
  await prepareDocument({ document: latest, reviewPolicy: 'always', settings: { mode: 'translation' }, getLatest: () => latest, save: async document => { latest = document; }, request: async () => { calls++; return { result: original }; } });
  assert.equal(calls, 1); assert.equal(latest.chapters[0].status, 'empty');
  assert.equal(latest.preparation.interruption.code, 'WORKFLOW_REVIEW_FAILED');
});

test('HTTP and preparation preserve task memory and budget across a reviewed correction and an ordinary chapter', { timeout: 60000 }, async () => {
  const inputs = []; let upstreamCalls = 0, initialReview = true;
  const upstream = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const { messages } = JSON.parse(raw), context = JSON.parse(messages[1].content); upstreamCalls++;
    let result;
    if (messages[0].content.startsWith('note-review-audit-v1')) result = confirmedAudit(messages);
    else if (messages[0].content.includes('note-self-review-v1')) { result = review(context, initialReview); initialReview = false; }
    else if (messages[0].content.includes('note-review-patch-v1')) result = { candidateDigest: context.binding, changes: [{ findingId: 'f1', blocks: [solved] }] };
    else { inputs.push(context.workflow); result = inputs.length === 1 ? original : { blocks: [solved] }; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); let server;
  try {
    server = await startTestServer({ DEEPSEEK_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, DEEPSEEK_API_KEY: 'test-only' });
    const connection = await (await fetch(server.base + '/api/config')).json(), base = fixture(); let latest = base.document;
    latest.chapters = ['c1', 'c2'].map(id => ({ ...structuredClone(latest.chapters[0]), id })); latest.currentChapter = 'c1';
    await prepareDocument({ document: latest, reviewPolicy: 'on-anomaly', settings: base.learning, getLatest: () => latest, save: async value => { latest = value; },
      request: async (document, chapterId, learning, _knowledge, _signal, workflow) => {
        const response = await fetch(server.base + '/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reading-Tree-Token': connection.token }, body: JSON.stringify({ ...base, revision: document.revision, document, chapterId, learning, workflow }) });
        const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.error), noteFailureMetadata(body)); return body;
      } });
    assert.equal(latest.preparation.status, 'complete'); assert.equal(upstreamCalls, 6);
    assert.equal(latest.preparation.workflow.history.length, 2); assert.equal(latest.preparation.workflow.repairsUsed, 1);
    assert.equal(inputs[1].completedChapters, 1); assert.equal(inputs[1].repairAllowance, inputs[0].repairAllowance - 1);
    assert.ok(inputs[1].priorDiagnoses.includes('GOAL_MISMATCH'));
    assert.ok(latest.preparation.workflow.history[0].reviewTriggers.includes('MISSING_SOLUTION'));
    assert.equal(latest.preparation.workflow.history[1].reviewCalls, 0);
  } finally { if (server) await server.stop(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});
