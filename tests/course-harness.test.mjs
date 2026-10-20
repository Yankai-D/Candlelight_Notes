import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { coursePolicy } from '../shared/course-policy.mjs';
import { courseRequest, buildCourseMessages, validateCoursePlan, validateCourseSection, runCourseLecture, courseCompletion } from '../server/course-harness.mjs';
import { referenceRequest, referencePlan, reference, compactReference, numericCases, fullPlan, courseRequestFixture, sources } from '../examples/course/descriptive-statistics/reference.mjs';
import { renderCourseReference } from '../scripts/render-course-reference.mjs';
import { freshTemplateLibrary, templateSnapshot } from '../shared/writing-templates.mjs';

const clone = structuredClone;
const validate = raw => validateCourseSection(referenceRequest, referencePlan, 'summary', raw);
const rejectMutation = (original, mutation, fn, code) => {
  const changed = clone(original); mutation(changed);
  assert.throws(() => fn(changed), error => error.code === code);
};

test('new multi-source course jobs use the same structured snapshot while legacy style jobs keep their contract', () => {
  const snapshot = templateSnapshot(freshTemplateLibrary(), 'lecture');
  const input = { ...referenceRequest, writingTemplate: snapshot };
  for (const options of [{}, { plan: referencePlan, sectionId: 'summary' }]) {
    const messages = buildCourseMessages(input, options), context = JSON.parse(messages[1].content);
    assert.deepEqual(context.writingTemplate, snapshot); assert.equal(context.writingStyle, undefined);
    assert.match(messages[0].content, /每个知识单元可独立回查/); assert.doesNotMatch(messages[0].content, /不拆成教学栏目/);
  }
  const body = clone(reference); body.blocks[0].text = '## 中心与离散\n\n' + body.blocks[0].text;
  assert.equal(validateCourseSection(input, referencePlan, 'summary', body).rendering.blocks[0].type, 'heading');
  assert.equal(JSON.parse(buildCourseMessages(referenceRequest)[1].content).writingTemplate.id, 'lecture');
  const old = JSON.parse(buildCourseMessages({ ...referenceRequest, writingStyle: { selected: 'default' } })[1].content);
  assert.equal(old.writingTemplate, undefined); assert.ok(old.writingStyle.paragraphs.length);
});

test('public fixture has a complete eight-topic plan; the authored sample is explicitly one section', () => {
  assert.equal(validateCoursePlan(courseRequestFixture, fullPlan).sections.length, 4);
  assert.equal(courseRequestFixture.requirements.length, 8);
  const result = validate(reference);
  assert.equal(result.rendering.format, 'reading-tree-note-v1');
  assert.equal(result.rendering.blocks.length, reference.blocks.length);
  assert.equal(result.provenance.length, result.rendering.blocks.length);
  assert.ok(result.provenance.every(p => p.nodeId.startsWith('summary/')));
  assert.ok(result.provenance.some(p => p.origin === 'supplement'));
  assert.equal(sources.find(s => s.id === 'textbook').pages.find(p => p.number === 4).originalPage, 47);
});

test('course voice is invariant; goal is explicit and only stable profile enters prompts', () => {
  const a = buildCourseMessages(referenceRequest);
  const b = buildCourseMessages({ ...referenceRequest, learningIntent: '解释累计等待总量与均值的关系。',
    learner: { background: '已学统计推断', foundations: ['概率论'], materials: [{ title: 'Do not use this reading history' }] },
    tree: { nodes: ['Do not infer mastery'] }, style: 'chatty', status: 'completed' });
  assert.equal(a[0].content, b[0].content);
  assert.notEqual(JSON.parse(a[1].content).learningIntent, JSON.parse(b[1].content).learningIntent);
  assert.deepEqual(JSON.parse(b[1].content).learner, { background: '已学统计推断', foundations: ['概率论'] });
  assert.ok(!b[1].content.includes('Do not'));
  assert.match(a[0].content, /course-lecture-v1/);
  assert.match(a[0].content, /跨文件、跨章节重组/);
  assert.ok(!a[0].content.includes('不跨越章节或片段边界'));
  assert.equal(courseRequest({ ...referenceRequest, learningIntent: undefined }).learningIntent, '看懂这篇文章');
});

test('input rejects duplicate file identities, duplicate page numbers and dependency cycles', () => {
  rejectMutation(referenceRequest, r => r.sources.push(clone(r.sources[0])), courseRequest, 'COURSE_INPUT');
  rejectMutation(referenceRequest, r => r.sources[0].pages.push(clone(r.sources[0].pages[0])), courseRequest, 'COURSE_INPUT');
  rejectMutation(referenceRequest, r => r.requirements[0].dependsOn.push('choice'), courseRequest, 'COURSE_INPUT');
  rejectMutation(referenceRequest, r => r.requirements[0].dependsOn.push('unknown'), courseRequest, 'COURSE_INPUT');
});

test('coverage plans reject omissions, duplicate topics, broken dependencies and missing evidence', () => {
  const fn = value => validateCoursePlan(courseRequestFixture, value);
  rejectMutation(fullPlan, p => p.sections.pop(), fn, 'COURSE_PLAN');
  rejectMutation(fullPlan, p => p.sections[0].topics.push('center'), fn, 'COURSE_PLAN');
  rejectMutation(fullPlan, p => p.sections.reverse(), fn, 'COURSE_PLAN');
  rejectMutation(fullPlan, p => p.sections[1].sourceRefs.pop(), fn, 'COURSE_PLAN');
  rejectMutation(fullPlan, p => p.artifacts = [{ kind: 'exam' }], fn, 'COURSE_PLAN');
});

test('notice pages, unknown pages and known image-only formulas cannot serve as source evidence', () => {
  for (const sourceRef of [{ sourceId: 'textbook', page: 1 }, { sourceId: 'missing', page: 4 }, { sourceId: 'textbook', page: 100 }, { sourceId: 'numerical', page: 4 }]) {
    rejectMutation(referenceRequest, r => r.requirements[0].sourceRefs = [sourceRef], courseRequest, 'COURSE_INPUT');
  }
  const sent = JSON.parse(buildCourseMessages(courseRequestFixture)[1].content);
  assert.ok(sent.sources.every(s => s.pages.every(p => p.kind === 'content' && !p.needsReview)));
});

test('source identities are not flattened into page numbers; quotes must match the specified file', () => {
  rejectMutation(reference, r => { r.blocks.find(b => b.id === 'median').sourceRefs[0].sourceId = 'textbook'; }, validate, 'COURSE_SECTION');
  rejectMutation(reference, r => { r.blocks[0].sourceRefs[0].quote = 'This quotation does not exist in this source.'; }, validate, 'COURSE_SECTION');
  rejectMutation(reference, r => { r.blocks[0].sourceRefs[0].page = 1; }, validate, 'COURSE_SECTION');
  rejectMutation(reference, r => { r.blocks[0].topicIds = ['denominators']; }, validate, 'COURSE_SECTION');
  rejectMutation(reference, r => { r.blocks.filter(b => b.topicIds.includes('choice')).forEach(b => b.origin = 'supplement'); }, validate, 'COURSE_SECTION');
});

test('course prose shares the compiler, rejects malformed math, foreign rendering and teaching columns', () => {
  rejectMutation(reference, r => { r.blocks[0].text = String.raw`未闭合公式 \(x`; }, validate, 'COURSE_SECTION');
  rejectMutation(reference, r => { r.blocks[0].text = String.raw`\(\unknowncommand{x}\)`; }, validate, 'COURSE_SECTION');
  rejectMutation(reference, r => { r.blocks[0].text = '## 必要背景'; }, validate, 'COURSE_SECTION');
  rejectMutation(reference, r => { r.rendering = { format: 'reading-tree-note-v1', blocks: [] }; }, validate, 'COURSE_SECTION');
  rejectMutation(reference, r => { r.sectionId = 'other'; }, validate, 'COURSE_SECTION');
  const walk = node => node.type === 'math' ? [node] : (node.content || []).flatMap(walk);
  const math = validate(reference).rendering.blocks.flatMap(walk);
  assert.ok(math.length > 30);
  assert.ok(math.some(n => n.attrs.display) && math.some(n => !n.attrs.display));
});

test('authored synthetic examples are independently recomputed, including quartile convention and whiskers', () => {
  const median = values => values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
  for (const item of numericCases) {
    const values = [...item.data].sort((a, b) => a - b);
    assert.ok(item.blockIds.every(id => reference.blocks.some(b => b.id === id)));
    if (item.quartileMethod) {
      const q1 = median(values.slice(0, values.length / 2)), q3 = median(values.slice(values.length / 2));
      const iqr = q3 - q1, fences = [q1 - 1.5 * iqr, q3 + 1.5 * iqr];
      const inside = values.filter(n => n >= fences[0] && n <= fences[1]);
      assert.deepEqual({ q1, q3, iqr, fences, whiskers: [inside[0], inside.at(-1)], outliers: values.filter(n => !inside.includes(n)) },
        { q1: item.q1, q3: item.q3, iqr: item.iqr, fences: item.fences, whiskers: item.whiskers, outliers: item.outliers });
    } else {
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const squaredDeviations = values.reduce((s, v) => s + (v - mean) ** 2, 0);
      const sampleVariance = squaredDeviations / (values.length - 1);
      assert.deepEqual({ mean, median: median(values), squaredDeviations, sampleVariance, sampleSDRounded: Number(Math.sqrt(sampleVariance).toFixed(2)) },
        { mean: item.mean, median: item.median, squaredDeviations: item.squaredDeviations, sampleVariance: item.sampleVariance, sampleSDRounded: item.sampleSDRounded });
    }
  }
  // Check the prose actually carries the reviewed results, not only a detached ledger.
  const prose = Object.fromEntries(reference.blocks.map(b => [b.id, b.text]));
  for (const literal of ['s^2=10/4=2.5', 's^2=40', '1.58', '6.32']) assert.ok(prose['spread-calculation'].includes(literal));
  assert.ok(prose.extreme.includes('80/5=16') && prose.extreme.includes('14.58'));
  assert.match(prose['box-example'], /Q_1=9.*Q_3=11.*IQR.*=2.*6 和 14.*8 和 11/s);
});

test('profile comparison only shrinks prerequisite calculation; core exposition and evidence stay identical', () => {
  validate(compactReference);
  assert.equal(compactReference.blocks.length, reference.blocks.length - 1);
  for (const block of reference.blocks.filter(b => b.origin === 'source')) {
    assert.deepEqual(compactReference.blocks.find(b => b.id === block.id), block);
  }
  assert.equal(coursePolicy.voice, 'reading-notes-v1');
});

// Two-step fake completion uses actual source anchors. It tests orchestration,
// not pedagogical quality, and never invokes the network or a paid model.
function twoSections() {
  const request = { ...referenceRequest, requirements: referenceRequest.requirements.filter(r => ['center', 'spread'].includes(r.id)) };
  const plan = { title: '测试讲义', sections: request.requirements.map(r => ({ id: r.id, title: r.label, purpose: r.label,
    topics: [r.id], sourceRefs: r.sourceRefs })) };
  const output = {
    center: { sectionId: 'center', blocks: reference.blocks.filter(b => ['mean', 'median'].includes(b.id)) },
    spread: { sectionId: 'spread', blocks: reference.blocks.filter(b => ['deviation', 'variance'].includes(b.id)) },
  };
  return { request, plan, output };
}
test('runner repairs only the failing step once and passes actual preceding prose into the next section', async () => {
  const { request, plan, output } = twoSections(), before = clone(request), calls = [];
  const result = await runCourseLecture(request, { complete: async (messages, { stage }) => {
    calls.push({ messages, stage });
    if (calls.length === 1) return '{bad json';
    return JSON.stringify(stage === 'plan' ? plan : output[stage]);
  } });
  assert.deepEqual(calls.map(c => c.stage), ['plan', 'plan', 'center', 'spread']);
  assert.match(calls[1].messages.at(-1).content, /JSON/);
  assert.ok(JSON.parse(calls[3].messages[1].content).previousTail.includes('总体均值'));
  assert.deepEqual(result.sections.map(s => s.sectionId), ['center', 'spread']);
  assert.equal(result.status, 'structurally-validated');
  assert.equal(result.semanticReview, 'required');
  assert.deepEqual(request, before);
});

test('late failure has no committable result, abort is honored, and transport errors are not repaired', async () => {
  const { request, plan, output } = twoSections(), before = clone(request), stages = [];
  await assert.rejects(runCourseLecture(request, { complete: async (_, { stage }) => {
    stages.push(stage); return stage === 'plan' ? plan : stage === 'center' ? output.center : '{}';
  } }), { code: 'EXECUTION_BLOCKED' });
  assert.deepEqual(stages, ['plan', 'center', 'spread', 'spread', 'recovery-plan', 'spread', 'recovery-plan']);
  assert.deepEqual(request, before);
  const controller = new AbortController(); let count = 0;
  await assert.rejects(runCourseLecture(request, { signal: controller.signal, complete: async (_, { signal }) => {
    count++; assert.equal(signal, controller.signal); controller.abort(); return plan;
  } }), { name: 'AbortError' });
  assert.equal(count, 1);
  count = 0;
  await assert.rejects(runCourseLecture(request, { complete: async () => { count++; throw new Error('transport failure'); } }), /transport failure/);
  assert.equal(count, 1);
});

test('oversized source input fails before calling a provider instead of silently truncating evidence', async () => {
  const input = clone(referenceRequest);
  input.sources.push({ id: 'large', title: 'large', pages: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, text: 'x'.repeat(35000) })) });
  let called = false;
  await assert.rejects(runCourseLecture(input, { complete: async () => { called = true; } }), { code: 'COURSE_INPUT' });
  assert.equal(called, false);
});

test('completion adapter reuses JSON provider protocol and propagates cancellation', async () => {
  const controller = new AbortController(); let sent;
  const complete = courseCompletion({ baseUrl: 'https://example.test/v1', apiKey: 'synthetic-test-key', model: 'fake' }, async (_, options) => {
    sent = options; return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }) };
  });
  assert.equal(await complete([{ role: 'user', content: '{}' }], { signal: controller.signal }), '{"ok":true}');
  assert.equal(sent.signal, controller.signal);
  assert.equal(JSON.parse(sent.body).response_format.type, 'json_object');
});

test('review page renders shared math, switches depth and reveals traceable sources without network', () => {
  const dom = new JSDOM(renderCourseReference(), { runScripts: 'dangerously', url: 'http://127.0.0.1:5173/review/course.html' });
  const document = dom.window.document;
  assert.ok(document.querySelectorAll('[role="math"] svg').length > 30);
  assert.equal(document.querySelectorAll('.math-invalid').length, 0);
  document.querySelector('[data-select="compact"]').click();
  assert.equal(document.querySelector('[data-variant="compact"]').hidden, false);
  assert.equal(document.querySelector('[data-variant="expanded"]').hidden, true);
  document.getElementById('sources').click();
  assert.ok([...document.querySelectorAll('.source-detail')].every(n => !n.hidden));
  assert.ok([...document.querySelectorAll('[data-server-href]')].every(a => a.href.includes('/api/library/')));
  assert.match(document.querySelector('footer').textContent, /CC BY-SA 3.0/);
  dom.window.close();
});
