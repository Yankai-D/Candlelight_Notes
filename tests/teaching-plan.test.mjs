import test from 'node:test';
import assert from 'node:assert/strict';
import { progression as fixture } from '../evals/lectures/progression.mjs';
import { teachingContext, teachingKey, teachingIssues, makeTeachingRecord } from '../shared/teaching-plan.mjs';
import { validateBundlePlan, applyBundlePlan, compositionSchema } from '../shared/bundle-context.mjs';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';
import { applyResult, markdown } from '../shared/document.mjs';
import { storedDocumentSchema, restoreBackup } from '../shared/backup.mjs';
import { compositionContract } from '../shared/bundle-blueprint.mjs';
import { buildNoteReview, noteReviewTriggers } from '../server/note-review.mjs';
import { planChangeContext, planReviewContext } from '../server/bundle-plan-review.mjs';
import { freshTemplateLibrary, templateSnapshot } from '../shared/writing-templates.mjs';
import { executionScope } from '../server/execution.mjs';
import { startWorkflow, workflowRequest } from '../shared/workflow-review.mjs';

const response = value => new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
const config={apiKey:'offline-only',model:'fixture',baseUrl:'http://localhost'};
const input=()=>({action:'bundle-plan',title:'从有序信息到正确程序',intent:fixture.intent,units:fixture.sources.map((text,i)=>({id:`unit-${i+1}`,sourceId:`s${i+1}`,title:fixture.sections[i].title,pages:[i+1],excerpts:[{page:i+1,text}]}))});
const plan=()=>({sections:structuredClone(fixture.sections),teachingPlan:structuredClone(fixture.teachingPlan),analysis:{version:1,task:{kind:'lecture',requirements:[{id:'r1',text:fixture.intent,evidenceQuote:fixture.intent}],organization:'按能力递进',limitations:[]},materials:{units:fixture.sources.map((_,i)=>({id:`unit-${i+1}`,topics:['检索'],prerequisites:[],role:'原文',limitations:[]}))},reviewSummary:'离线样例',evidenceMode:'source-index-excerpts'}});
const document=()=>({id:'progression',title:input().title,subtitle:'原创跨章回归',filename:'authored.md',kind:'text',intent:fixture.intent,createdAt:1,updatedAt:1,revision:0,versions:[],pages:fixture.sources.map((text,i)=>({number:i+1,text,sourceId:`s${i+1}`,sourceTitle:fixture.sections[i].title,sourcePage:1})),chapters:[],currentChapter:'',currentPage:1,entryType:'note'});
const request=(doc,i)=>({action:'generate',scope:'chapter',instruction:fixture.intent,revision:doc.revision,chapterId:doc.chapters[i].id,composition:true,taskPlan:doc.composition.plan,document:doc,
  learning:{mode:'adaptive',template:'guided-v3',writingTemplate:templateSnapshot(freshTemplateLibrary(),'lecture')}});

test('whole-course plan is produced in existing four stages, survives persistence and exposes actual teaching evidence to review',async()=>{
  const data=input(),calls=[];
  const result=await executionScope({binding:'new-teaching-plan',limits:{calls:4,recoveries:0,perStage:0}},()=>runModel(config,buildMessages(data),undefined,async(_url,options)=>{
    const messages=JSON.parse(options.body).messages,protocol=messages[0].content.split('：')[0],context=JSON.parse(messages[1].content);calls.push(protocol);
    if(protocol==='bundle-intent-v1')return response(plan().analysis.task);
    if(protocol==='bundle-materials-v1')return response(plan().analysis.materials);
    if(protocol==='bundle-outline-v2')return response({sections:fixture.sections,teachingPlan:fixture.teachingPlan});
    assert.equal(protocol,'bundle-plan-review-v1');
    assert.ok(context.evidence.some(e=>e.id==='teaching-t1-section-3'));
    return response({candidateDigest:context.candidateDigest,verdict:'accept',checks:['goal','coverage','order','coherence'].map(dimension=>({dimension,status:'pass'})),findings:[],summary:'离线协议通过，不代表模型质量。'});
  }));
  const accepted=validateResult(data,result),saved=compositionSchema.parse({version:1,planned:true,plan:JSON.parse(JSON.stringify(accepted))});
  assert.equal(calls.length,4);assert.deepEqual(saved.plan.teachingPlan,fixture.teachingPlan);
});

test('unknown sources, cycles, future introductions and misplaced example uses are diagnosed; saved legacy outlines stay readable',()=>{
  assert.deepEqual(validateBundlePlan(input(),plan()),plan());
  const faults=[
    [p=>p.teachingPlan.concepts[0].unitIds=['fake'],'TEACHING_SOURCE'],
    [p=>{p.teachingPlan.concepts[0].prerequisites=['t2'];},'TEACHING_PREREQUISITE'],
    [p=>{p.teachingPlan.concepts[0].prerequisites=['t2'];p.teachingPlan.concepts[1].placements[0].section=1;},'TEACHING_CYCLE'],
    [p=>p.teachingPlan.concepts[0].placements[0].role='apply','TEACHING_ORDER'],
    [p=>p.teachingPlan.examples[0].uses[0].conceptIds=['t3'],'TEACHING_EXAMPLE_BINDING'],
    [p=>p.teachingPlan.examples[0].unitIds=['unit-1'],'TEACHING_EXAMPLE_SOURCE'],
    [p=>p.teachingPlan.concepts[0].placements[0].section=7,'TEACHING_SECTION'],
  ];
  for(const [change,code]of faults){const p=plan();change(p);assert.throws(()=>validateBundlePlan(input(),p),e=>e.issues.some(i=>i.code===code),code);}
  const legacy={sections:fixture.sections};assert.deepEqual(validateBundlePlan(input(),legacy),legacy);
  const after=plan();after.teachingPlan.concepts[0].placements[2].advance='比较新的查询条件';
  assert.deepEqual(planChangeContext(plan(),after).changedSections,[1,2,3]);
  assert.ok(planReviewContext(input(),after).evidence.some(e=>e.id==='teaching-e1'));
});

test('an explicitly recurring example keeps original sources available beyond three chapters, without allowing arbitrary repeated assignments',()=>{
  const source={...input(),units:[input().units[0]]},sections=Array.from({length:4},(_,i)=>({title:`任务${i+1}`,purpose:'应用同例回答不同问题',unitIds:['unit-1']}));
  const placements=sections.map((_,i)=>({section:i+1,role:i?'apply':'introduce',advance:`第${i+1}种用途`,difficultPoint:'',check:'解释本次变化'}));
  const teachingPlan={version:1,throughline:'逐步迁移',concepts:[{id:'t1',title:'比较',objective:'解释变化',prerequisites:[],unitIds:['unit-1'],placements}],examples:[{id:'e1',title:'原例',unitIds:['unit-1'],uses:placements.map(p=>({section:p.section,conceptIds:['t1'],purpose:p.advance}))}]};
  assert.doesNotThrow(()=>validateBundlePlan(source,{sections,teachingPlan}));
  const invalid=structuredClone(teachingPlan);invalid.examples[0].uses.pop();
  assert.throws(()=>validateBundlePlan(source,{sections,teachingPlan:invalid}),e=>e.issues.some(i=>i.code==='OVERUSED_UNITS'));
});

test('three consecutive chapters reuse one example with different duties, carry live prose and spend no additional routine review calls',async()=>{
  let doc=applyBundlePlan(document(),plan());const calls=[];
  const workflow=startWorkflow(undefined,3,'on-anomaly');
  for(let i=0;i<3;i++){
    const req=request(doc,i);req.workflow=workflowRequest(workflow,req.chapterId,3,i);
    const raw=await executionScope({binding:`progression-${i}`,limits:{calls:3,recoveries:0,perStage:0}},()=>runModel(config,buildMessages(req),undefined,async(_url,options)=>{
      const messages=JSON.parse(options.body).messages,ctx=JSON.parse(messages[1].content);
      if(messages[0].content.startsWith('lecture-outline')){calls.push('select');return response(ctx.analyses[0]);}
      const analysis=messages[0].content.startsWith('chapter-analysis'),teaching=(ctx.contract||ctx.composition.contract).teaching;
      calls.push(analysis?'analysis':'write');
      assert.equal(ctx.reviewTriggers,undefined);
      assert.deepEqual(teaching.examples.map(e=>e.id),['e1']);
      assert.equal(teaching.concepts.find(c=>c.id==='t1').role,['introduce','apply','deepen'][i]);
      if(i){assert.ok(teaching.prior.some(p=>p.status==='written'));assert.ok(teaching.evidence.some(e=>e.text.includes('[1,3,3,7]')));assert.equal(new Set(teaching.evidence.map(e=>e.id)).size,teaching.evidence.length);}
      if(analysis)return response({approach:'按当前能力和原文写作',connection:'从目标到构造再到论证',steps:[{focus:'本章任务',instruction:fixture.sections[i].purpose,sourceEvidenceIds:[ctx.source[0].excerpts[0].id]}],risks:[],synthesis:{units:[{id:'k1',topic:'本章主题',concept:'核心关系',method:['执行并解释'],conceptIds:teaching.concepts.map(c=>c.id),exampleIds:['e1'],sourceEvidenceIds:[ctx.source[0].excerpts[0].id],examples:[{aim:teaching.examples[0].purpose,sourceEvidenceIds:[ctx.source[0].excerpts[0].id]}],variants:[]}],merges:[]}});
      return response({blocks:fixture.prose[i].map((text,n)=>({type:'paragraph',text,sourcePages:[i+1],learningUnitId:'k1',learningRoles:n?['example']:['concept','method']}))});
    }));
    const result=validateResult(req,raw);
    assert.deepEqual(noteReviewTriggers(req,result),[]);
    assert.ok(!JSON.stringify(result.rendering).includes('teachingConceptIds'));
    const review=JSON.parse(buildNoteReview(req,result)[1].content);
    assert.deepEqual(review.composition.contract.teaching,compositionContract(req).teaching);
    doc=applyResult(doc,req,result);
    doc=storedDocumentSchema.parse(JSON.parse(JSON.stringify(doc)));
    assert.ok(doc.chapters[i].teachingRecord.entries.some(e=>e.kind==='example'&&e.id==='e1'));
  }
  assert.deepEqual(calls,['analysis','select','write','analysis','select','write','analysis','select','write']);
  assert.ok(!markdown(doc).includes('teachingRecord'));
  assert.match(markdown(doc),/正确性与终止性分开说明/);
  doc.sourceContext={version:1,folderId:'authored',folderName:'原创测试资料',capturedAt:1,sources:fixture.sources.map((text,i)=>({id:`s${i+1}`,title:fixture.sections[i].title,path:`source-${i+1}.md`,pages:[{number:1,text}],chapters:[]}))};
  const restored=restoreBackup(JSON.stringify({format:'reading-tree-v1',document:doc}));
  assert.deepEqual(restored.composition.plan.teachingPlan,doc.composition.plan.teachingPlan);
  assert.deepEqual(restored.chapters.map(c=>c.teachingRecord),doc.chapters.map(c=>c.teachingRecord));
  assert.ok(teachingContext(restored.composition.plan.teachingPlan,restored.chapters,3).prior.every(p=>p.status==='written'));
});

test('changed or removed prose cannot masquerade as completed prerequisites, and unrelated additions preserve live bindings',()=>{
  let doc=applyBundlePlan(document(),plan()),req=request(doc,0);
  const result=validateResult(req,{blocks:[{type:'paragraph',text:fixture.prose[0].join('\n\n'),sourcePages:[1],teachingConceptIds:['t1'],teachingExampleIds:['e1']}]});
  doc=applyResult(doc,req,result);
  let context=teachingContext(doc.composition.plan.teachingPlan,doc.chapters,2);
  assert.ok(context.prior.every(p=>p.status==='written'));const original=structuredClone(doc);
  doc.chapters[0].content.content[0].content[0].text='用户已经改变了该解释。';
  context=teachingContext(doc.composition.plan.teachingPlan,doc.chapters,2);
  assert.ok(context.prior.every(p=>p.status==='changed'));assert.ok(!JSON.stringify(context).includes(fixture.prose[0][0]));
  assert.ok(context.evidence.some(e=>e.edited&&e.text.includes('用户已经改变')));
  doc=structuredClone(original);doc.chapters[0].content.content.push({type:'paragraph',attrs:{id:'personal'},content:[{type:'text',text:'我的小纸条'}]});
  assert.ok(teachingContext(doc.composition.plan.teachingPlan,doc.chapters,2).prior.every(p=>p.status==='written'));
  delete doc.chapters[0].teachingRecord;assert.ok(teachingContext(doc.composition.plan.teachingPlan,doc.chapters,2).prior.every(p=>p.status==='untracked'));
  doc.chapters[0].content.content=[];assert.ok(teachingContext(doc.composition.plan.teachingPlan,doc.chapters,2).prior.every(p=>p.status==='not-written'));
  doc=structuredClone(original);doc.composition.plan.teachingPlan.throughline='修改了任务主线';
  assert.ok(teachingContext(doc.composition.plan.teachingPlan,doc.chapters,2).prior.every(p=>p.status==='changed'));
  assert.equal(teachingKey({a:1,b:2}),teachingKey({b:2,a:1}));
});

test('foreign teaching IDs cannot enter a notebook and headings cannot establish prose coverage',()=>{
  const doc=applyBundlePlan(document(),plan()),req=request(doc,0);
  assert.throws(()=>validateResult(req,{blocks:[{type:'paragraph',text:'伪造定位',sourcePages:[1],teachingConceptIds:['t3']}]}),e=>e.code==='STAGE_CONTRACT');
  const result=validateResult(req,{blocks:[{type:'heading',text:'只有标题',sourcePages:[1],teachingConceptIds:['t1']}]});
  const saved=applyResult(doc,req,result);assert.equal(saved.chapters[0].teachingRecord.entries.length,0);
});
