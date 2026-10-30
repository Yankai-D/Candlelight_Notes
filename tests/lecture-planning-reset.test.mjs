import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMessages,runModel,runFrozenWritingStage,validateResult} from '../server/harness.mjs';
import {executionScope} from '../server/execution.mjs';
import {lectureDrafts,expandLectureEvidence} from '../server/lecture-drafting.mjs';
import {sourceEvidenceIndex} from '../server/source-evidence-index.mjs';
import {createBundleNote,bundlePlanRequest,applyBundlePlan,validateBundlePlan} from '../shared/bundle-context.mjs';
import {storedDocumentSchema} from '../shared/backup.mjs';
import {freshTemplateLibrary,templateSnapshot} from '../shared/writing-templates.mjs';
import {planChangeContext} from '../server/bundle-plan-review.mjs';
import {analyzeChapter,consolidateLecture} from '../server/chapter-analysis.mjs';

const config={apiKey:'fixture',model:'offline',baseUrl:'https://example.invalid'};
const response=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
const knowledge=refs=>({id:'k1',topic:'计算均值',concept:'均值表示中心',method:['求和后除以样本数'],sourceEvidenceIds:refs,examples:[],variants:[]});
const analysis=refs=>({approach:'选取均值计算所需关系',connection:'本章只教会计算均值',steps:[{focus:'均值计算',instruction:'说明分子与分母',sourceEvidenceIds:refs}],risks:[],synthesis:{units:[knowledge(refs)],merges:[],omissions:[]}});
const sourceText='均值等于总和除以数量；2、4、6的均值为4。'+'重复课堂说明。'.repeat(700);
const input=count=>({action:'generate',scope:'chapter',chapterId:'c1',revision:0,instruction:'学会计算均值，精简整理',composition:true,
  learning:{mode:'adaptive',template:'guided-v3',writingTemplate:templateSnapshot(freshTemplateLibrary(),'lecture')},
  document:{title:'原创均值复习',intent:'学会计算均值，精简整理',pages:Array.from({length:count},(_,i)=>({number:i+1,text:sourceText})),
    chapters:[{id:'c1',title:'均值',sourcePages:Array.from({length:count},(_,i)=>i+1),content:{type:'doc',content:[]}}]}});

test('multiplying same-type source volume forty-fold increases reading only, not writing tasks, selected evidence or simulated prose',async()=>{
  async function run(count){const request=input(count),calls=[],wire=[];
    const raw=await executionScope({binding:{case:'volume-invariance',count},limits:{calls:20,recoveries:0}},()=>runModel(config,buildMessages(request),undefined,async(_url,options)=>{
      const messages=JSON.parse(options.body).messages,ctx=JSON.parse(messages[1].content),system=messages[0].content;
      if(system.startsWith('chapter-analysis')){calls.push('read');return response(analysis([ctx.source[0].excerpts[0].id]));}
      if(system.startsWith('lecture-outline')){
        calls.push('select');const refs=ctx.sourceIndex.map(e=>e.id),result=analysis([refs[0]]);
        result.synthesis.omissions=refs.slice(1).map(id=>({sourceEvidenceIds:[id],reason:'同一均值方法与例题的重复说明，不增加学习任务。'}));return response(result);
      }
      calls.push('write');wire.push(ctx.source);
      assert.equal(ctx.chapterAnalysis.draftingScope.finishWhen.length,1);
      assert.equal(ctx.chapterAnalysis.synthesis.units.length,1);
      return response({blocks:[{type:'paragraph',text:'均值是总和除以数量。计算2、4、6的均值：(2+4+6)/3=4。',sourcePages:[1],learningUnitId:'k1',learningRoles:['concept','method']}]});
    }));return {calls,wire,result:validateResult(request,raw)};
  }
  const small=await run(1),large=await run(40);
  assert.ok(large.calls.filter(x=>x==='read').length>small.calls.filter(x=>x==='read').length);
  assert.equal(large.calls.filter(x=>x==='select').length,1);
  assert.equal(small.calls.filter(x=>x==='write').length,1);assert.equal(large.calls.filter(x=>x==='write').length,1);
  assert.deepEqual(large.wire,small.wire);assert.deepEqual(large.result.blocks,small.result.blocks);
  assert.ok(large.wire[0][0].text.length<=800);
});

test('source expansion exposes exact original pages without changing the frozen learning tasks or creating a prose segment',async()=>{
  const request=input(1),before=structuredClone(request),writes=[];
  const raw=await executionScope({binding:'expand-not-split',limits:{calls:4,recoveries:0}},()=>runModel(config,buildMessages(request),undefined,async(_url,options)=>{
    const messages=JSON.parse(options.body).messages,ctx=JSON.parse(messages[1].content),system=messages[0].content;
    if(system.startsWith('chapter-analysis'))return response(analysis([ctx.source[0].excerpts[0].id]));
    if(system.startsWith('lecture-outline'))return response(ctx.analyses[0]);
    writes.push(ctx);
    if(writes.length===1){assert.ok(ctx.source[0].partial);return response({needsSource:true,sourcePages:[1],reason:'核对当前定义的完整上下文。'});}
    assert.equal(ctx.source[0].text,sourceText);assert.equal(ctx.source[0].partial,false);
    assert.deepEqual(ctx.chapterAnalysis.draftingScope,writes[0].chapterAnalysis.draftingScope);
    return response({blocks:[{type:'paragraph',text:'均值等于总和除以数量，2、4、6的均值为4。',sourcePages:[1],learningUnitId:'k1',learningRoles:['concept','method']}]});
  }));
  assert.equal(writes.length,2);assert.equal(JSON.parse(raw).blocks.length,1);assert.deepEqual(request,before);
  const pages=request.document.pages,ref=sourceEvidenceIndex(pages).source[0].excerpts[0].id,part=lectureDrafts(pages,analysis([ref]))[0];
  assert.throws(()=>expandLectureEvidence(part.evidencePacket,pages,[99]),{code:'STAGE_CONTRACT'});
  assert.throws(()=>expandLectureEvidence(expandLectureEvidence(part.evidencePacket,pages,[1]),pages,[1]),{code:'STAGE_CONTRACT'});
});

test('planner may consider then exclude irrelevant sources while retaining goal coverage, evidence review and backup',async()=>{
  const doc=createBundleNote({version:1,folderId:'authored',folderName:'原创统计材料',capturedAt:1,sources:[
    {id:'math',title:'均值定义',path:'math',pages:[{number:1,text:'均值为总和除以数量。'}],chapters:[]},
    {id:'admin',title:'课程通知',path:'admin',pages:[{number:1,text:'周一更换教室，签到后离开。'}],chapters:[]},
  ]},'均值复习','学会计算均值，省去行政信息',1);
  const input=bundlePlanRequest(doc);let calls=0;
  const proposed={sections:[{title:'均值',purpose:'计算均值',unitIds:['unit-1'],requirementIds:['r1'],dependsOn:[],handoff:'能独立完成计算'}],
    sourceSelection:{version:1,omissions:[{unitIds:['unit-2'],reason:'教室与签到信息不参与均值学习。'}]},
    teachingPlan:{version:1,throughline:'由定义到计算',concepts:[{id:'t1',title:'均值',objective:'计算均值',prerequisites:[],unitIds:['unit-1'],placements:[{section:1,role:'introduce',advance:'用和除以数量',difficultPoint:'样本数量',check:'计算2、4、6的均值'}]}],examples:[]}};
  const raw=await executionScope({binding:'source-selection',limits:{calls:4,recoveries:0}},()=>runModel(config,buildMessages(input),undefined,async(_url,options)=>{
    calls++;const messages=JSON.parse(options.body).messages,ctx=JSON.parse(messages[1].content),system=messages[0].content;
    if(system.startsWith('bundle-intent'))return response({kind:'lecture',requirements:[{id:'r1',scope:'section',text:'计算均值',evidenceQuote:'学会计算均值'}],organization:'按方法',limitations:[]});
    if(system.startsWith('bundle-materials'))return response({units:ctx.units.map(u=>({id:u.id,topics:[u.title],prerequisites:[],role:'待选材料',limitations:[]}))});
    if(system.startsWith('bundle-outline'))return response(proposed);
    assert.ok(ctx.evidence.some(e=>e.id==='source-omission-1'&&e.text.includes('unit-2')));
    return response({candidateDigest:ctx.candidateDigest,verdict:'accept',checks:['goal','coverage','order','coherence'].map(dimension=>({dimension,status:'pass'})),findings:[],summary:'均值进入正文，课程通知依据目标省略。'});
  }));
  assert.equal(calls,4);const plan=validateResult(input,raw),saved=storedDocumentSchema.parse(applyBundlePlan(doc,plan));
  assert.deepEqual(saved.composition.plan.sections[0].unitIds,['unit-1']);
  assert.deepEqual(saved.chapters[0].sourcePages,[1,2],'Proposed exclusions still undergo full-source reading, never discarded solely from previews');assert.equal(saved.pages.length,2);
  assert.deepEqual(saved.composition.plan.sourceSelection,proposed.sourceSelection);
  for(const ids of [['unit-1'],['missing'],['unit-2','unit-2']]){const bad=structuredClone(plan);bad.sourceSelection.omissions[0].unitIds=ids;assert.throws(()=>validateBundlePlan(input,bad));}
  const missing=structuredClone(plan);delete missing.sourceSelection;assert.throws(()=>validateBundlePlan(input,missing),e=>e.issues.some(x=>x.code==='MISSING_UNITS'));
  const task=structuredClone(plan);task.analysis.task.kind='solutions';assert.throws(()=>validateBundlePlan(input,task),e=>e.issues.some(x=>x.code==='TASK_SOURCE_SELECTION'));
  const changed=structuredClone(plan);changed.sourceSelection.omissions[0].reason='不同的取舍理由';assert.deepEqual(planChangeContext(plan,changed).changedSections,[1]);
});

test('knowledge complexity, not page size, changes the declared writing obligations; original sources remain local',()=>{
  const req=input(2),refs=sourceEvidenceIndex(req.document.pages).source.map(p=>p.excerpts[0].id),small=analysis([refs[0]]),larger=structuredClone(small);
  larger.synthesis.units.push({...knowledge([refs[1]]),id:'k2',topic:'加权均值',concept:'权重改变分子与分母',method:['求加权和，再除以权重和']});
  const one=lectureDrafts(req.document.pages,small)[0],two=lectureDrafts(req.document.pages,larger)[0];
  assert.equal(one.chapterAnalysis.draftingScope.finishWhen.length,1);assert.equal(two.chapterAnalysis.draftingScope.finishWhen.length,2);
  assert.equal(two.pages[1].text,sourceText);assert.ok(two.evidencePacket[1].text.length<sourceText.length);
});

test('legacy prompt evaluations explicitly freeze the writing stage while the production entry runs the full selection pipeline',async()=>{
  const request=input(1);let calls=0;
  const raw=await runFrozenWritingStage(config,buildMessages(request),undefined,async(_url,options)=>{
    calls++;const messages=JSON.parse(options.body).messages,ctx=JSON.parse(messages[1].content);
    assert.equal(ctx.source[0].text,sourceText);assert.equal(ctx.chapterAnalysis,undefined);
    assert.ok(!messages[0].content.startsWith('chapter-analysis'));
    return response({blocks:[{type:'paragraph',text:'均值等于总和除以数量。',sourcePages:[1]}]});
  });
  assert.equal(calls,1);assert.equal(validateResult(request,raw).blocks.length,1);
});

test('a reading batch with only administrative text creates no artificial learning unit or writing obligation',async()=>{
  const request=input(1);request.document.pages=[{number:1,text:'周一更换教室，签到后离开。'}];
  const empty=await executionScope({binding:'no-teaching-content',limits:{calls:1,recoveries:0}},()=>analyzeChapter(request,async messages=>{
    const ctx=JSON.parse(messages[1].content);
    return JSON.stringify({approach:'本批不含均值知识',connection:'与均值学习无关',steps:[],risks:[],synthesis:{units:[],merges:[],omissions:[{sourceEvidenceIds:[ctx.source[0].excerpts[0].id],reason:'只有行政通知'}]}});
  }));
  assert.deepEqual(empty.synthesis.units,[]);
  let writes=0;await assert.rejects(consolidateLecture(request,[empty],async()=>{writes++;}),{code:'LECTURE_SOURCE_INSUFFICIENT'});
  assert.equal(writes,0,'No fabricated lesson or repeated generation when all sources lack the requested knowledge');
});
