import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import { freshTemplateLibrary, templateLibrarySchema, templateSnapshot, changeTemplateLibrary, writingTemplatePrompt, TEMPLATE_LIBRARY_KEY } from '../shared/writing-templates.mjs';
import { readTemplateLibrary, commitTemplateLibrary } from '../shared/template-library-store.mjs';
import { templateCatalog, selectedTemplate, templateRoutingRequest } from '../shared/template-routing.mjs';
import { templateRoutingCases, checkTemplateChoice } from '../evals/template-routing-cases.mjs';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';
import { createDemo } from '../src/demo.ts';
import { ensureNotebooks, selectNotebook, reviseNotebook, notebookSettings } from '../shared/notebooks.mjs';
import { bundlePlanRequest } from '../shared/bundle-context.mjs';
import { courseEditorialPrompt } from '../shared/course-policy.mjs';
import { noteBlocks } from '../shared/note-format.mjs';
import { explicitTask } from '../shared/template-decision.mjs';

const library = freshTemplateLibrary();
const catalog = templateCatalog(library);
const route = document => ({ action: 'select-template', catalog, document });
const decision = (overrides = {}) => ({ templateId: 'exercise', task: 'solve', material: 'exercises', fit: 'direct', adaptation: '', reason: '按题与小问逐一给出解法。', ...overrides });

test('legacy full libraries retain all personal samples, custom templates and CAS revisions on migration', async () => {
  const original = structuredClone(library); original.version = 1; original.templates.pop(); original.revision = 7;
  original.templates[0].selectedSample = 'personal'; original.templates[0].personalSample.paragraphs[0].text += '个人样稿';
  for (let i=0;i<3;i++) original.templates.push({ ...structuredClone(original.templates[1]), id:`custom-${i}`, name:i ? `旧自定${i}`:'题目讲解', layout:'custom' });
  const saved = structuredClone(original), upgraded = templateLibrarySchema.parse(original);
  assert.deepEqual(original,saved); assert.equal(upgraded.version,2); assert.equal(upgraded.templates.length,6);
  assert.equal(upgraded.revision,7);
  for(const item of original.templates) assert.deepEqual(upgraded.templates.find(t=>t.id===item.id),item);
  assert.deepEqual(templateLibrarySchema.parse(upgraded),upgraded);
  assert.throws(()=>changeTemplateLibrary(upgraded,{type:'add',id:'custom-new'}),/五套/);
  const dbName='exercise-migration-'+crypto.randomUUID(),db=await openDB(dbName,1,{upgrade(db){db.createObjectStore('preferences');}});
  try {
    await db.put('preferences',original,TEMPLATE_LIBRARY_KEY);
    assert.deepEqual(await readTemplateLibrary(db),upgraded);
    const edited=changeTemplateLibrary(upgraded,{type:'select',id:'exercise',selected:'personal'});
    await commitTemplateLibrary(db,edited,7);
    assert.deepEqual(await readTemplateLibrary(db),edited);
    await assert.rejects(commitTemplateLibrary(db,edited,7),/其他窗口/);
  }finally{db.close();await deleteDB(dbName);}
});

test('routing rejects task/genre conflicts, permits documented adaptation and custom suitability', () => {
  const input=route(templateRoutingCases.find(c=>c.id==='exercise-worked').document);
  assert.throws(()=>validateResult(input,decision({templateId:'lecture'})),/任务不匹配/);
  assert.throws(()=>validateResult(input,decision({task:'understand',templateId:'narrative',material:'argument'})),/用户明确要求/);
  assert.throws(()=>validateResult(input,decision({fit:'adapted'})),/具体处理|不完全适配/);
  const result=validateResult(input,decision({fit:'adapted',adaptation:'缺少第二题的图表，保留第一题解法，第二题列出缺项。'}));
  assert.equal(selectedTemplate(library,result).routing.fit,'adapted');
  for(const id of ['hints-not-answers','answers-only','create-quiz','revision-hints']){
    const c=templateRoutingCases.find(c=>c.id===id),task=c.expected.tasks[0];
    assert.equal(validateResult(route(c.document),decision({task})).task,task);
    assert.throws(()=>validateResult(route(c.document),decision({task:'understand'})),/任务不匹配/);
  }
  const custom={id:'custom-lab',name:'实验操作',audience:'实验指导',organization:'按操作与结果核对'};
  assert.equal(validateResult({...input,catalog:[...catalog,custom]},decision({templateId:custom.id})).templateId,custom.id);
});

test('routing repairs a wrong builtin once, keeps the task, and fails closed on persistent mismatch', async () => {
  const input=route(templateRoutingCases[3].document),messages=buildMessages(input);let calls=0;
  const config={baseUrl:'https://example.invalid/v1',model:'fixture',apiKey:'fixture'};
  const raw=await runModel(config,messages,undefined,async(_,options)=>{
    calls++; const body=JSON.parse(options.body);
    if(calls===2){assert.match(body.messages.at(-1).content,/templateId/);assert.doesNotMatch(body.messages.at(-1).content,/完整 rules 和 edits/);}
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision({templateId:calls===1?'lecture':'exercise'}))}}]}));
  });
  assert.equal(calls,2);assert.equal(validateResult(input,raw).templateId,'exercise');
  calls=0;
  await assert.rejects(runModel(config,messages,undefined,async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision({templateId:'narrative'}))}}]}));}),/任务不匹配/);
  assert.equal(calls,2);
});

test('exercise sample renders original subquestions; prompts avoid lecture rules and keep hint/local scope', () => {
  const snapshot=templateSnapshot(library,'exercise');
  for(const p of snapshot.sample.paragraphs)assert.ok(noteBlocks(p.text,{}, {strict:true}).length);
  const prompt=writingTemplatePrompt(snapshot);
  assert.match(prompt,/小题原文/);assert.match(prompt,/原语言/);assert.match(prompt,/一两句话/);assert.match(prompt,/停止在解法与最终答案之前/);
  assert.doesNotMatch(courseEditorialPrompt(snapshot),/一次生成一份讲义|按知识依赖和要解决的问题组织长文/);
  const doc=createDemo(),chapter=doc.chapters[0];
  for(const action of ['generate','explain','rewrite','style']){
    const input={action,scope:'chapter',revision:doc.revision,chapterId:chapter.id,anchorId:chapter.content.content[0].attrs.id,selection:'选区',instruction:'只给提示',learning:{mode:'adaptive',writingTemplate:snapshot},document:doc};
    const messages=buildMessages(input);
    assert.match(messages[0].content,/exercise-writing-v1/);assert.doesNotMatch(messages[0].content,/采用结构化讲义|每个知识单元可独立回查/);
    if(action!=='generate')assert.match(messages[0].content,/局部追问就地回答/);
  }
});

test('regeneration archives content, reroutes with feedback, preserves other editions and reaches planner/provider', () => {
  let doc=ensureNotebooks(createDemo());doc=selectNotebook(doc,'adaptive');
  doc.chapters[0].status='ready';const previous=structuredClone(doc),intent='逐题解答',feedback='只给提示，不要答案';
  const next=reviseNotebook(doc,{intent,feedback});
  assert.deepEqual(doc,previous);assert.deepEqual(next.versions[0].chapters,previous.chapters);
  assert.deepEqual(next.notebooks.translation,previous.notebooks.translation);
  assert.equal(next.preparation,undefined);assert.equal(notebookSettings(next).writingTemplate,undefined);
  assert.equal(templateRoutingRequest(next,library).document.feedback,feedback);
  assert.equal(bundlePlanRequest(next).feedback,feedback);
  const input={action:'generate',scope:'chapter',revision:next.revision,chapterId:next.chapters[0].id,instruction:'生成',learning:notebookSettings(next),document:next};
  assert.equal(JSON.parse(buildMessages(input)[1].content).revisionFeedback,feedback);
  assert.match(buildMessages(input)[0].content,/revision-feedback-v1/);
  assert.equal(notebookSettings(reviseNotebook(next,{intent,feedback:''})).regenerationFeedback,undefined);
});

test('routing benchmark contains authored positive, negative, mixed and unsupported cases with explicit scoring',()=>{
  assert.ok(templateRoutingCases.length>=12);
  assert.equal(checkTemplateChoice(templateRoutingCases[3],decision()).length,0);
  assert.ok(checkTemplateChoice(templateRoutingCases[3],decision({templateId:'lecture'})).length);
  for(const intent of ['不要只给提示，要完整解答','不仅要答案，还要说明理由','不要答案太啰嗦','整理复习讲义并生成练习题'])assert.equal(explicitTask(intent),null);
  assert.equal(explicitTask('生成练习题，不要答案'),'create-exercises');
});

test('observed subquestion headings render consistently without rewriting code, formulas or ordinary hashes', () => {
  const attrs = { sourcePages: [1], sourceQuote: 'Find the mean.' };
  const blocks = noteBlocks('###（a）\n\n**小题原文**\nFind the mean.\n\n###（b）\n\nFind the variance.', attrs, {strict:true});
  assert.deepEqual(blocks.filter(b => b.type === 'heading').map(b => b.content[0].text), ['（a）','（b）']);
  for (const heading of blocks.filter(b => b.type === 'heading')) {
    assert.equal(heading.attrs.level, 3); assert.deepEqual(heading.attrs.sourcePages, [1]);
  }
  for (const literal of ['`###（a）`', '```text\n###（a）\n```', '    ###（a）', 'text ###（a）', '###C', '###（a） is literal prose', String.raw`\[\text{###（a）}\]`]) {
    assert.ok(noteBlocks(literal).every(b => b.type !== 'heading'), literal);
  }
});
