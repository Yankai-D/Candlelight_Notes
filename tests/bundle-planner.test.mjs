import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runModel, buildMessages, validateResult } from '../server/harness.mjs';
import { createGenerationRecord, readGenerationRecords } from '../server/generation-records.mjs';
import { validateBundlePlan, applyBundlePlan } from '../shared/bundle-context.mjs';
import { compositionSchema } from '../shared/bundle-context.mjs';
import { buildNoteReview } from '../server/note-review.mjs';
import { startWorkflow, workflowRequest } from '../shared/workflow-review.mjs';
import { executionScope } from '../server/execution.mjs';

const config = { apiKey: 'LOCAL_TEST_CANARY_ONLY', model: 'offline', baseUrl: 'http://localhost' };
const response = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
const input = (count = 2) => ({ action: 'bundle-plan', documentId: 'course-review', notebookId: 'adaptive', revision: 0,
  planningId: '9519f179-f5de-4ed6-9f72-04f282896c21', title: '复习与练习', intent: '给出简短思路和逐题解法',
  units: Array.from({ length: count }, (_, index) => ({ id: `unit-${index+1}`, sourceId: `file-${index}`, title: `练习 ${index+1}`,
    pages: [index+1], excerpts: [{ page: index+1, text: '求样本均值。解释求和后除以样本数量的原因。' }] })) });
function provider(request, hooks = {}) {
  const calls = [], count = {};
  return { calls, count, fetch: async (_url, options) => {
    const messages = JSON.parse(options.body).messages, system = messages[0].content;
    const protocol = system.split('：')[0], context = JSON.parse(messages[1].content);
    calls.push(protocol); count[protocol] = (count[protocol] || 0) + 1;
    const override = await hooks[protocol]?.({ context, messages, count: count[protocol] });
    if (override instanceof Response) return override;
    if (override) return response(override);
    if (protocol === 'bundle-intent-v1') return response({ kind: 'solutions', requirements: [{ id: 'r1', text: request.intent, evidenceQuote: request.intent }], organization: '逐题给原题、简短思路和解法。', limitations: [] });
    if (protocol === 'bundle-materials-v1') return response({ units: context.units.map(unit => ({ id: unit.id, topics: ['均值'], prerequisites: ['求和'], role: '原题和计算条件。', limitations: ['只依据当前摘录识别主题。'] })) });
    if (protocol === 'bundle-outline-v2') return response({ sections: context.units.map((unit, index) => ({ title: unit.title, purpose: '题目原文、简短思路与逐题解法。', unitIds: [unit.id], requirementIds: ['r1'], dependsOn: index ? [index] : [], handoff: '当前计算方法为下一题提供基础。' })) });
    if (protocol === 'bundle-plan-review-v1') return response({ candidateDigest: context.candidateDigest, verdict: 'accept', checks: ['goal','coverage','order','coherence'].map(dimension => ({ dimension, status: 'pass' })), findings: [], summary: '用户任务、来源覆盖和前后关系一致。' });
    if (protocol === 'bundle-plan-audit-v1') return response({ reviewDigest: context.reviewDigest, decisions: context.review.findings.map((finding, index) => ({ finding: index, verdict: 'confirm', reason: '当前规划与用户目标对照后，问题及修改建议均有明确依据，应执行对应的局部修订。', evidenceIds: ['goal-intent'] })) });
    if (protocol === 'bundle-plan-verify-v1') return response({ candidateDigest: context.candidateDigest, resolutions: context.previous.review.findings.map((_, index) => ({ finding: index, status: 'resolved', reason: '修订后的章节明确落实该项要求。', evidenceIds: ['section-1-purpose'] })), regressions: [] });
    assert.fail(`Unexpected protocol ${protocol}`);
  } };
}

test('lecture planning groups repeated source units by knowledge, and all planning stages share the concise contract with recovery disabled', async () => {
  const request = input(3);request.intent='精简整理概念、方法、资料例题和课内变体';
  const seen=[];
  const mock=provider(request,{
    'bundle-intent-v1':()=>({kind:'lecture',requirements:[{id:'r1',text:request.intent,evidenceQuote:request.intent}],organization:'按知识点和方法合并资料。',limitations:[]}),
    'bundle-materials-v1':({messages})=>{assert.match(messages[0].content,/lecture-synthesis-v3/);seen.push('materials');},
    'bundle-outline-v2':({messages,context})=>{
      assert.match(messages[0].content,/sourceSelection/);assert.match(messages[0].content,/不能决定章节数/);seen.push('outline');
      return {sections:[{title:'均值：条件、计算与变体',purpose:'说明概念和步骤，用代表原题展示计算，再比较不同条件。',unitIds:context.units.map(u=>u.id),requirementIds:['r1'],dependsOn:[],handoff:'用已学方法处理不同权重。'}],
        teachingPlan:{version:1,throughline:'从平均水平到权重条件。',concepts:[{id:'t1',title:'均值',objective:'独立计算并判断权重差异',prerequisites:[],unitIds:context.units.map(u=>u.id),placements:[{section:1,role:'introduce',advance:'定义、计算与权重变体',difficultPoint:'辨认分母',check:'能复算原题并解释分母'}]}],examples:[]}};
    },
    'bundle-plan-review-v1':({messages})=>{assert.match(messages[0].content,/lecture-synthesis-v3/);seen.push('review');},
  });
  const raw=await executionScope({binding:'lecture-planning-first-pass',limits:{calls:4,recoveries:0,perStage:0}},()=>runModel(config,buildMessages(request),undefined,mock.fetch));
  const plan=validateResult(request,raw);
  assert.deepEqual(seen,['materials','outline','review']);
  assert.equal(plan.sections.length,1);assert.equal(plan.sections[0].unitIds.length,3);
  assert.equal(mock.calls.length,4);assert.equal(plan.analysis.task.kind,'lecture');
});

test('bundle planning executes intent, material analysis, relationships and semantic review; repairs goal mismatch within the same request', async () => {
  const request = input();
  const mock = provider(request, {
    'bundle-plan-review-v1': ({ context, count }) => count === 1 && ({ candidateDigest: context.candidateDigest, verdict: 'revise',
      checks: ['goal','coverage','order','coherence'].map(dimension => ({ dimension, status: dimension === 'goal' ? 'issue' : 'pass' })),
      findings: [{ dimension: 'goal', section: 1, problem: '第一节应明确逐题解法。', instruction: '在第一节 purpose 明确写出逐题解法的交付要求。', evidenceQuote: request.intent }], summary: '第一节目标需要进一步明确。' }),
    'bundle-outline-v2': ({ context, count, messages }) => {
      if (count === 2) assert.equal(JSON.parse(messages.at(-1).content).failure.issues[0].code, 'PLAN_GOAL');
      return { sections: context.units.map((unit, index) => ({ title: unit.title,
        purpose: count === 1 && index === 0 ? '简单介绍各题涉及的概念。' : '原题、简短思路与逐题解法。',
        unitIds: [unit.id], requirementIds: ['r1'], dependsOn: index ? [1] : [], handoff: '说明各题方法的联系。' })) };
    },
  });
  let checkpoint;
  const raw = await runModel(config, buildMessages(request), undefined, mock.fetch, { saveCheckpoint: value => { checkpoint = value; } });
  const plan = validateResult(request, raw);
  assert.equal(plan.analysis.task.kind, 'solutions');
  assert.match(plan.sections[0].purpose, /逐题解法/);
  assert.equal(mock.count['bundle-intent-v1'], 1);
  assert.equal(mock.count['bundle-materials-v1'], 1);
  assert.equal(mock.count['bundle-outline-v2'], 2);
  assert.equal(mock.count['bundle-plan-review-v1'], 1);
  assert.equal(mock.count['bundle-plan-verify-v1'], 1);
  assert.equal(checkpoint.calls, 7);
  assert.ok(Object.values(checkpoint.stages).every(stage => stage.status === 'accepted'));
});

test('planning persists before failure, resumes accepted analyses after restart, and invalidates a changed task', async () => {
  // FileLibrary passes canonical roots to generation records. CI temporary
  // directories may be aliases, so give this direct fixture the same contract.
  const temporaryRoot = await realpath(tmpdir());
  const system = await mkdtemp(join(temporaryRoot, 'candlelight-plan-test-'));
  try {
    const request = input(25), first = provider(request, { 'bundle-outline-v2': () => new Response('{}', { status: 401 }) });
    const record = await createGenerationRecord(system, request, config.model, first.fetch);
    let failure;
    await assert.rejects(runModel(config, buildMessages(request), undefined, record.fetch, { checkpoint: record.checkpoint, saveCheckpoint: record.saveCheckpoint }), error => { failure = error; return error.code === 'MODEL_HTTP'; });
    await record.finish('failed', undefined, failure);
    assert.equal(first.count['bundle-materials-v1'], 3);
    const second = provider(request), resumed = await createGenerationRecord(system, request, config.model, second.fetch);
    assert.ok(resumed.checkpoint);
    const result = JSON.parse(await runModel(config, buildMessages(request), undefined, resumed.fetch, { checkpoint: resumed.checkpoint, saveCheckpoint: resumed.saveCheckpoint }));
    await resumed.finish('accepted', result);
    assert.deepEqual(second.calls, ['bundle-outline-v2','bundle-plan-review-v1']);
    assert.equal(result.sections.length, 25);
    const list = await readGenerationRecords(system, request.documentId);
    assert.equal(list.length, 2); assert.ok(list.every(item => item.chapterTitle === '整理规划'));
    const saved = await readGenerationRecords(system, request.documentId, resumed.id);
    assert.equal(saved.resumedFrom, record.id);
    assert.ok(!JSON.stringify(saved).includes(config.apiKey));
    const changed = await createGenerationRecord(system, { ...request, intent: '只整理概念，不解题' }, config.model, second.fetch);
    assert.equal(changed.checkpoint, undefined); await changed.finish('cancelled');
  } finally { assert.equal(dirname(await realpath(system)), temporaryRoot); await rm(system, { recursive: true, force: true }); }
});

test('planner diagnostics identify missing, unknown and forward references without hardcoded repair answers', () => {
  const request = input();
  assert.throws(() => validateBundlePlan(request, { sections: [{ title: '复习', purpose: '复习', unitIds: ['unknown'], dependsOn: [1] }] }), error => {
    assert.equal(error.code, 'STAGE_CONTRACT');
    assert.deepEqual(error.issues.find(issue => issue.code === 'MISSING_UNITS').refs, ['unit-1','unit-2']);
    assert.deepEqual(error.issues.find(issue => issue.code === 'UNKNOWN_UNITS').path, ['sections',0,'unitIds']);
    assert.equal(error.issues.find(issue => issue.code === 'FORWARD_DEPENDENCY').maximum, 0);
    return true;
  });
});

test('accepted task and chapter relationships survive storage and reach generation and knowledge review', async () => {
  const request = input(), mock = provider(request);
  const plan = JSON.parse(await runModel(config, buildMessages(request), undefined, mock.fetch));
  const document = { id: request.documentId, title: request.title, intent: request.intent, revision: 0,
    pages: request.units.map(unit => ({ number: unit.pages[0], text: unit.excerpts[0].text, sourceId: unit.sourceId, sourceTitle: unit.title, sourcePage: 1 })), versions: [] };
  const planned = applyBundlePlan(document, plan);
  assert.deepEqual(compositionSchema.parse(JSON.parse(JSON.stringify(planned.composition))).plan, plan);
  planned.chapters[0].content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '先求和，再除以样本数量。' }] }] };
  const generation = { action: 'generate', scope: 'chapter', instruction: request.intent, documentId: request.documentId,
    revision: 1, chapterId: planned.chapters[1].id, composition: true, taskPlan: plan, document: planned,
    learning: { mode: 'adaptive', template: 'guided-v3' } };
  const context = JSON.parse(buildMessages(generation)[1].content);
  const review = JSON.parse(buildNoteReview(generation, { blocks: [{ type: 'paragraph', text: '均值的计算。', sourcePages: [2], sourceQuote: '' }] })[1].content);
  assert.deepEqual(context.composition.contract.task, plan.analysis.task);
  assert.deepEqual(review.composition.contract, context.composition.contract);
  assert.match(context.composition.contract.prerequisiteNotes[0].excerpt, /先求和/);
  assert.equal(context.composition.contract.section.dependsOn[0], 1);
});

test('chapter analysis reads complete evidence before writing; actual concerns and pending source checks trigger knowledge review under on-anomaly policy', async () => {
  const request = input(), mock = provider(request);
  const plan = JSON.parse(await runModel(config, buildMessages(request), undefined, mock.fetch));
  const document = applyBundlePlan({ id: request.documentId, title: request.title, intent: request.intent, revision: 0,
    pages: request.units.map(unit => ({ number: unit.pages[0], text: unit.excerpts[0].text, sourceId: unit.sourceId, sourceTitle: unit.title, sourcePage: 1 })), versions: [] }, plan);
  for (const [suspicious, pending] of [[false, false], [true, false], [false, true]]) {
    plan.analysis.pendingChecks = pending ? [{ question: '原文是否解释样本数量与分母的关系？', unitIds: ['unit-1'] }] : [];
    const workflow = startWorkflow(undefined, 2, 'on-anomaly');
    const generation = { action: 'generate', scope: 'chapter', instruction: request.intent, documentId: request.documentId,
      revision: 1, chapterId: document.chapters[0].id, composition: true, taskPlan: plan, document,
      workflow: workflowRequest(workflow, document.chapters[0].id, 2, 0), learning: { mode: 'adaptive', template: 'guided-v3' } };
    const actions = []; let report;
    const raw = await runModel(config, buildMessages(generation), undefined, async (_url, options) => {
      const messages = JSON.parse(options.body).messages, system = messages[0].content, context = JSON.parse(messages[1].content);
      if (system.startsWith('chapter-analysis-v1')) {
        actions.push('analysis');
        assert.equal(context.source[0].excerpts.map(excerpt => excerpt.text).join(''), document.pages[0].text);
        assert.equal(context.contract.task.kind, 'solutions');
        const sourceEvidenceIds = [context.source[0].excerpts[0].id];
        return response({ approach: '给出均值解题步骤。', connection: '为后续变换题提供基础。',
          steps: [{ focus: '均值计算', instruction: '解释求和后除以数量。', sourceEvidenceIds }],
          risks: suspicious ? [{ problem: '需核对分母是样本数量而不是自由度。', sourceEvidenceIds }] : [] });
      }
      if (system.startsWith('note-self-review-v1')) {
        actions.push('review'); assert.equal(context.chapterAnalysis.risks.length, suspicious ? 1 : 0);
        assert.equal(context.composition.contract.pendingChecks.length, pending ? 1 : 0);
        return response({ candidateDigest: context.binding.candidateDigest, verdict: 'accept',
          checks: ['goal','coverage','grounding','clarity'].map(dimension => ({ dimension, status: 'pass' })), findings: [], summary: '分母正确，当前解题符合目标。' });
      }
      actions.push('write'); assert.equal(context.chapterAnalysis.steps.length, 1);
      return response({ blocks: [{ type: 'paragraph', text: '题目：求样本均值。思路：先把样本数值相加。解法：均值 = 数值总和 / 样本数量。', sourcePages: [1], sourceQuote: '' }] });
    }, { onWorkflowReport: value => { report = value; } });
    assert.match(JSON.parse(raw).blocks[0].text, /样本数量/);
    assert.deepEqual(actions, suspicious || pending ? ['analysis','write','review'] : ['analysis','write']);
    assert.equal(report.requiredReviewSegments, suspicious || pending ? 1 : 0);
    assert.equal(report.reviewTriggers.includes('ANALYSIS_RISK'), suspicious || pending);
  }
});

test('source checks survive a planning revision and remain assigned to the relevant source units', async () => {
  const request = input();
  const mock = provider(request, {
    'bundle-outline-v2': ({ context, count }) => ({ sections: context.units.map(unit => ({ title: unit.title, purpose: count === 1 ? '只列出题名。' : '原题、简短思路与逐题解法。', unitIds: [unit.id], requirementIds: ['r1'], dependsOn: [], handoff: '各题可独立阅读。' })) }),
    'bundle-plan-review-v1': ({ context, count }) => count === 1 && ({ candidateDigest: context.candidateDigest, verdict: 'revise',
      checks: ['goal','coverage','order','coherence'].map(dimension => ({ dimension, status: ['goal','coverage'].includes(dimension) ? 'issue' : 'pass' })),
      findings: [
        { dimension: 'goal', section: 1, problem: '目标分工尚不明确。', instruction: '写清逐题解法。', evidenceQuote: request.intent },
        { dimension: 'coverage', section: 1, problem: '均值计算条件可能不完整。', instruction: '核对完整资料。', evidenceQuote: request.units[0].excerpts[0].text },
      ], summary: '需修订分工并核对来源。' }),
    'bundle-plan-audit-v1': ({ context }) => ({ reviewDigest: context.reviewDigest, decisions: [
      { finding: 0, verdict: 'confirm', reason: '对照用户要求和当前规划，第一节确实需要明确写出交付的逐题解法。', evidenceIds: ['goal-intent'] },
      { finding: 1, verdict: 'defer', reason: '当前摘录未涵盖完整来源，无法据此判断均值计算的条件是否缺失，应在正文阶段核对。', evidenceIds: ['unit-1-excerpt-1'], question: '完整原文是否说明样本均值的计算条件？' },
    ] }),
  });
  const plan = JSON.parse(await runModel(config, buildMessages(request), undefined, mock.fetch));
  assert.equal(mock.count['bundle-outline-v2'], 2);
  assert.equal(plan.analysis.pendingChecks.length, 1);
  assert.deepEqual(plan.analysis.pendingChecks[0].unitIds, ['unit-1']);
  assert.throws(() => validateBundlePlan(request, { ...plan, analysis: { ...plan.analysis, pendingChecks: [{ question: '错误来源', unitIds: ['foreign'] }] } }), error => error.issues[0].code === 'PENDING_CHECK_SOURCE');
});

test('repair verification preserves settled decisions across restart, catches a new regression, and converges without restarting the critique', async () => {
  const request = input(); let checkpoint;
  const first = provider(request, {
    'bundle-plan-review-v1': ({ context }) => ({ candidateDigest: context.candidateDigest, verdict: 'revise',
      checks: ['goal','coverage','order','coherence'].map(dimension => ({ dimension, status: dimension === 'goal' ? 'issue' : 'pass' })),
      findings: [
        { dimension: 'goal', section: 1, problem: '第一题尚未写清解法。', instruction: '给出第一题的计算步骤。', evidenceIds: ['section-1-purpose'] },
        { dimension: 'goal', section: 2, problem: '应增加大量背景。', instruction: '拓展背景故事。', evidenceIds: ['goal-intent'] },
      ], summary: '待复核两项意见。' }),
    'bundle-plan-audit-v1': ({ context }) => ({ reviewDigest: context.reviewDigest, decisions: [
      { finding: 0, verdict: 'confirm', reason: '对照第一题和用户要求，这里确实应写清具体计算步骤，需要做局部修订。', evidenceIds: ['section-1-purpose'] },
      { finding: 1, verdict: 'dismiss', reason: '用户明确要求简短思路和逐题解法，增加大量背景是个人偏好，不属于任务。', evidenceIds: ['goal-intent'] },
    ] }),
    'bundle-outline-v2': ({ context, count }) => count === 1 ? ({ sections: context.units.map(unit => ({ title: unit.title, purpose: '原题与概念。', unitIds: [unit.id], requirementIds: ['r1'], dependsOn: [], handoff: '各题独立。' })) }) : new Response('{}', { status: 401 }),
  });
  await assert.rejects(runModel(config, buildMessages(request), undefined, first.fetch, { saveCheckpoint: value => { checkpoint = value; } }), error => error.code === 'MODEL_HTTP');
  const planning = Object.values(checkpoint.stages).find(stage => stage.stage === 'bundle-plan');
  assert.equal(planning.memory.planReview.review.findings.length, 1);
  assert.equal(planning.memory.settledDecisions[0].verdict, 'dismiss');
  // Simulate an authorized restart after provider credentials are restored.
  // The controller repairs exactly what the retained ledger still requires.
  const second = provider(request, {
    'bundle-plan-review-v1': () => assert.fail('A full critique must not restart after the ledger was saved'),
    'execution-recovery-plan-v1': ({ context }) => ({ failureId: context.failureId, strategy: 'patch', cause: '只改动未完成的计算步骤，已驳回的背景要求不重新执行。', candidateDigest: context.candidateDigest,
      operations: [{ op: 'set', path: ['sections',0,'purpose'], expected: JSON.parse(context.rejectedResult).sections[0].purpose,
        value: context.rejectedResult.includes('错误分母') ? '原题、简短思路、逐项求和后除以样本数量。' : '原题、计算步骤，但含错误分母。' }] }),
    'bundle-plan-verify-v1': ({ context, count }) => {
      assert.equal(context.settledDecisions[0].verdict, 'dismiss');
      return { candidateDigest: context.candidateDigest, resolutions: [{ finding: 0, status: 'resolved', reason: '对应要求已经通过当前修改落实。', evidenceIds: ['section-1-purpose'] }],
        regressions: count === 1 ? [{ dimension: 'goal', section: 1, problem: '修订加入了错误分母。', instruction: '将分母改为样本数量。', evidenceIds: ['section-1-purpose','unit-1-excerpt-1'], changedSections: [1] }] : [] };
    },
  });
  const result = JSON.parse(await runModel(config, buildMessages(request), undefined, second.fetch, { checkpoint, saveCheckpoint: value => { checkpoint = value; } }));
  assert.match(result.sections[0].purpose, /除以样本数量/);
  assert.equal(second.count['bundle-plan-review-v1'], undefined);
  assert.equal(second.count['bundle-plan-audit-v1'], 1); // Only the actual regression is independently audited.
  assert.equal(second.count['bundle-plan-verify-v1'], 2);
  const accepted = Object.values(checkpoint.stages).find(stage => stage.stage === 'bundle-plan');
  assert.equal(accepted.memory.planReview.review.verdict, 'accept');
});
