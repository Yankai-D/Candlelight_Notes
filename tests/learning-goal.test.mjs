import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.ts';
import { buildMessages, runModel, splitSource, validateResult } from '../server/harness.mjs';
import { templateSettings, defaultGenerationInstruction } from '../shared/learning-templates.mjs';
import { learningGoalPrompt } from '../shared/learning-goal.mjs';
import { defaultKnowledge } from '../shared/learning.mjs';
import { freshTemplateLibrary, templateSnapshot } from '../shared/writing-templates.mjs';
import { templateRoutingRequest } from '../shared/template-routing.mjs';
import { parseMaterial } from '../server/material-import.mjs';
import { applyResult, textOf } from '../shared/document.mjs';

function request(action = 'generate', mode = 'adaptive') {
  const document = createDemo(), chapter = document.chapters[0];
  document.intent = '能独立推导注意力的缩放项，解释它的假设和适用边界。';
  return { action, scope: 'chapter', instruction: '处理当前内容', revision: document.revision,
    chapterId: chapter.id, anchorId: chapter.content.content[0].attrs.id, selection: '注意力',
    learning: templateSettings(mode), knowledge: defaultKnowledge, document };
}

test('every action and reading mode carries the current goal with explicit, scoped system constraints', () => {
  for (const mode of ['adaptive', 'translation']) for (const action of ['generate', 'explain', 'rewrite', 'style']) {
    const input = request(action, mode), messages = buildMessages(input);
    assert.equal(JSON.parse(messages[1].content).learningIntent, input.document.intent);
    assert.ok(messages[0].content.includes(learningGoalPrompt(input.learning, action)));
    assert.match(messages[0].content, /必须落实到正文|仍须完整、忠实/);
    assert.match(messages[0].content, /不改变默认文风|固定文风不随目标或知识画像改变/);
    assert.match(messages[0].content, /不能借目标删去原文的实质内容/);
    const updated = { ...input, document: { ...input.document, intent: '判断方法能否用于我的序列任务，明确适用条件。' } };
    const next = buildMessages(updated);
    assert.equal(JSON.parse(next[1].content).learningIntent, updated.document.intent);
    assert.equal(next[0].content, messages[0].content, 'Different goals do not swap out the editorial voice or format contract');
    if (mode === 'translation') assert.equal(JSON.parse(next[1].content).learner, undefined);
  }
});

test('split generation and bounded format repair retain the full goal contract in every provider request', async () => {
  const input = request();
  input.document.pages = [{ number: 1, text: 'Source for the current argument.\n'.repeat(1800) }];
  input.document.chapters[0].sourcePages = [1];
  const segments = splitSource(input.document.pages);
  assert.ok(segments.length > 1);
  const calls = [], attempts = new Map();
  const raw = await runModel({ baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: 'test-only' }, buildMessages(input), undefined, async (_url, options) => {
    const body = JSON.parse(options.body), context = JSON.parse(body.messages[1].content);
    calls.push(body);
    if (body.messages[0].content.startsWith('execution-recovery-plan-v1')) {
      assert.equal(context.taskContext[0].fields.learningIntent, input.document.intent);
      assert.ok(context.originalContract.includes(learningGoalPrompt(input.learning, input.action)));
      assert.equal(context.taskContext[0].fields.segment.index, 1);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        failureId: context.failureId, strategy: 'patch', targetDigest: context.candidateDigest,
        operations: [{ op: 'set', path: ['blocks'], expected: [], value: [{ type: 'paragraph', text: '片段 1 的解释。', sourcePages: [1] }] }],
      }) } }] }));
    }
    assert.equal(context.learningIntent, input.document.intent);
    assert.ok(body.messages[0].content.includes(learningGoalPrompt(input.learning, input.action)));
    const segment = context.segment.index;
    attempts.set(segment, (attempts.get(segment) || 0) + 1);
    const result = segment === 1 && attempts.get(segment) === 1 ? { blocks: [] } : { blocks: [{ type: 'paragraph', text: `片段 ${segment} 的解释。`, sourcePages: [1] }] };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }));
  }, { action: 'generate' });
  assert.equal(calls.length, segments.length + 1);
  assert.equal(JSON.parse(raw).blocks.length, segments.length);
  assert.ok(calls[1].messages[0].content.startsWith('execution-recovery-plan-v1'));
});

test('HTML exercise task reaches routing and generation; new derivations render with question anchors without requiring an original answer',async()=>{
  const html='<main><h1>原创练习</h1><form><p>第1题：计算观测 2、4、6 的均值。</p></form></main>';
  const parsed=await parseMaterial({name:'exercise.html',data:Buffer.from(html).toString('base64')});
  const input=request(),chapter=input.document.chapters[0];
  input.document.intent='给我每道题的手写过程和答案';
  input.document.pages=[{number:1,text:parsed.sections[0].text}];chapter.sourcePages=[1];
  const library=freshTemplateLibrary();
  const routing=buildMessages(templateRoutingRequest(input.document,library));
  assert.equal(JSON.parse(routing[1].content).document.intent,input.document.intent);
  assert.match(routing[0].content,/不能撤销明确的作答/);
  for(const id of ['narrative','lecture']){
    input.learning={...templateSettings('adaptive'),writingTemplate:templateSnapshot(library,id)};
    input.instruction=defaultGenerationInstruction(input.learning);
    let calls=0;
    const raw=await runModel({baseUrl:'https://example.invalid/v1',apiKey:'test-only',model:'test'},buildMessages(input),undefined,async(_url,options)=>{
      calls++;const body=JSON.parse(options.body),context=JSON.parse(body.messages[1].content);
      assert.equal(context.learningIntent,input.document.intent);assert.equal(context.writingTemplate.id,id);
      assert.match(context.source[0].text,/第1题/);assert.match(context.instruction,/过程与答案/);
      assert.match(body.messages[0].content,/原文没附答案不代表不能求解/);
      assert.match(body.messages[0].content,/手写字体/);assert.match(body.messages[0].content,/仅要求答案/);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({blocks:[
        {type:'heading',text:'第1题',sourcePages:[1],sourceQuote:'第1题：计算观测 2、4、6 的均值。'},
        {type:'paragraph',text:String.raw`共三个观测，\(\bar{x}=(2+4+6)/3=4\)。答案为 4。`,sourcePages:[1],sourceQuote:''}
      ]})}}]}));
    },{action:'generate'});
    const updated=applyResult(input.document,input,validateResult(input,raw));
    assert.equal(calls,1);assert.match(textOf(updated.chapters[0].content),/答案为 4/);
    assert.equal(updated.chapters[0].content.content[0].attrs.sourceQuote,'第1题：计算观测 2、4、6 的均值。');
    assert.doesNotMatch(input.document.pages[0].text,/答案为 4/,'Derived answers must not be copied back into source evidence');
  }
});

test('explicit translation and local editing keep their scope even when the document goal asks for solutions',()=>{
  const input=request('generate','translation');input.document.intent='给我手写过程和答案';
  input.instruction=defaultGenerationInstruction(input.learning);
  const messages=buildMessages(input);
  assert.match(messages[0].content,/纯翻译的约束/);assert.doesNotMatch(messages[0].content,/worked-solutions-v1/);
  assert.match(JSON.parse(messages[1].content).instruction,/不额外作答/);
  const local=request('rewrite');local.document.intent=input.document.intent;
  local.instruction='只改写这一句，暂时不要答案';
  const edit=buildMessages(local);assert.equal(JSON.parse(edit[1].content).instruction,local.instruction);
  assert.match(edit[0].content,/只在 selection 内/);assert.doesNotMatch(edit[0].content,/worked-solutions-v1/);
});
