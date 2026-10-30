import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMessages,runModel,validateResult} from '../server/harness.mjs';
import {executionScope} from '../server/execution.mjs';
import {lectureAnalysisGroups,lectureDrafts} from '../server/lecture-drafting.mjs';
import {consolidateLecture} from '../server/chapter-analysis.mjs';
import {sourceEvidenceIndex} from '../server/source-evidence-index.mjs';
import {noteReviewTriggers,buildNoteReview} from '../server/note-review.mjs';
import {lectureEditorial,lectureLength} from '../shared/lecture-editorial.mjs';
import {freshTemplateLibrary,templateSnapshot,templateLibrarySchema} from '../shared/writing-templates.mjs';
import prior from '../shared/lecture-legacy-v2.json' with {type:'json'};
import {compositionContract} from '../shared/bundle-blueprint.mjs';
import {validateBundlePlan} from '../shared/bundle-context.mjs';
import {startWorkflow,workflowRequest} from '../shared/workflow-review.mjs';

const config={apiKey:'fixture',model:'offline',baseUrl:'http://localhost'};
const response=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
const unit=(id,refs)=>({id,topic:'均值与加权均值',concept:'用和除以数量计算中心。',method:['求和再除以数量'],sourceEvidenceIds:refs,examples:[],variants:[]});
const analysis=units=>({approach:'合并重复定义，只讲必要方法。',connection:'建立统计方法的基础。',steps:[{focus:'计算中心',instruction:'说明计算方法',sourceEvidenceIds:units.flatMap(u=>u.sourceEvidenceIds)}],risks:[],synthesis:{units,merges:[]}});
const input=()=>({action:'generate',scope:'chapter',chapterId:'c1',revision:0,composition:true,instruction:'整理精简复习讲义',learning:{mode:'adaptive',template:'guided-v3',writingTemplate:templateSnapshot(freshTemplateLibrary(),'lecture')},document:{title:'统计复习',intent:'整理均值方法与加权这一变体，不需要课堂过场。',chapters:[{id:'c1',title:'中心',sourcePages:[1,2,3],content:{type:'doc',content:[]}}],pages:[1,2,3].map(number=>({number,text:(number===3?'加权均值等于加权和除以权重总和。':'均值等于总和除以数量。')+'课堂重复过场，不是独有的知识。'.repeat(1400)}))}});

test('long lecture reads all source groups, consolidates once, then drafts selected knowledge rather than concatenating translations',async()=>{
  const request=input(),before=structuredClone(request),stages=[],read=[],sent=[];
  const raw=await executionScope({binding:'long-lecture-test',limits:{calls:5,recoveries:0,perStage:0}},()=>runModel(config,buildMessages(request),undefined,async(_url,options)=>{
    const messages=JSON.parse(options.body).messages,context=JSON.parse(messages[1].content),system=messages[0].content;
    if(system.startsWith('chapter-analysis')){
      stages.push('read');read.push(...context.source.map(p=>p.number));
      return response(analysis([unit('k1',[context.source[0].excerpts[0].id])]));
    }
    if(system.startsWith('lecture-outline')){
      stages.push('select');assert.deepEqual(read,[1,2,3]);
      const refs=context.sourceIndex.map(e=>e.id);assert.equal(refs.length,2);
      const selected=unit('k1',refs);selected.variants=[{difference:'权重不同时换分子分母',sourceEvidenceIds:[refs.at(-1)]}];
      return response(analysis([selected]));
    }
    stages.push('write');sent.push(...context.source.map(p=>p.number));
    assert.deepEqual(stages.slice(0,-1),['read','read','select']);
    assert.deepEqual(context.chapterAnalysis.draftingScope.topics,['均值与加权均值']);
    assert.ok(context.source.every(page=>request.document.pages.find(p=>p.number===page.number).text.includes(page.text)),'Writer receives exact selected evidence, not a generated summary');
    assert.ok(context.source.reduce((n,p)=>n+p.text.length,0)<2000);
    return response({blocks:[{type:'paragraph',text:'均值表示中心，用总和除以数量计算；权重不同时，改用加权和除以权重总和。',sourcePages:[1,3],learningUnitId:'k1',learningRoles:['concept','method','variant']}]});
  }));
  assert.deepEqual(stages,['read','read','select','write']);assert.deepEqual(sent,[1,3]);
  const result=validateResult(request,raw);assert.equal(result.blocks.length,1);assert.deepEqual(request,before);
  assert.doesNotMatch(JSON.stringify(result.rendering),/learningUnitId|draftingScope/);
});

test('source grouping preserves page identity and each selected knowledge unit has one writing owner',()=>{
  const pages=[{number:1,text:'first '.repeat(50)},{number:2,text:'second '.repeat(50)},{number:3,text:'third '.repeat(50)}];
  const groups=lectureAnalysisGroups(pages,400);assert.deepEqual(groups.flat(),pages);
  const evidence=sourceEvidenceIndex(pages),refs=pages.map(p=>evidence.source.find(s=>s.number===p.number).excerpts[0].id);
  const result=lectureDrafts(pages,analysis(refs.map((ref,i)=>unit(`k${i+1}`,[ref]))),400);
  assert.equal(result.length,1);assert.deepEqual(result.flatMap(r=>r.chapterAnalysis.synthesis.units.map(u=>u.id)),['k1','k2','k3']);
  assert.deepEqual(result.flatMap(r=>r.pages),pages);
  assert.equal(lectureAnalysisGroups([{number:1,text:'x'.repeat(500)}],100).length,1);
});

test('consolidation cannot silently discard a knowledge unit; explicit source-bound omission remains possible',async()=>{
  const request=input();request.document.pages=request.document.pages.map(p=>({...p,text:`source ${p.number}`}));
  const refs=sourceEvidenceIndex(request.document.pages).source.map(p=>p.excerpts[0].id);
  const analyses=[analysis([unit('k1',[refs[0]])]),analysis([unit('k1',[refs[2]])])];
  const bad=()=>consolidateLecture(request,analyses,async()=>JSON.stringify(analysis([unit('k1',[refs[0]])])));
  await assert.rejects(executionScope({binding:'no-silent-drop',limits:{calls:1,recoveries:0,perStage:0}},bad));
  const accepted=await consolidateLecture(request,analyses,async()=>JSON.stringify({...analysis([unit('k1',[refs[0]])]),synthesis:{units:[unit('k1',[refs[0]])],merges:[],omissions:[{sourceEvidenceIds:[refs[2]],reason:'重复同一方法，保留首次讲解。'}]}}));
  assert.equal(accepted.synthesis.omissions.length,1);
});

test('length is observational only while exact cross-chapter repetition is a review signal, never automatic rejection',()=>{
  const request=input();request.document.pages=[{number:1,text:'来源讲述一个方法。'}];request.document.chapters[0].sourcePages=[1];
  request.chapterAnalysis=analysis([unit('k1',['e1'])]);
  const text='这个很长的段落反复解释已经给过的同一个背景，却没有增加新的条件或判断。'.repeat(60);
  const candidate={blocks:[{type:'paragraph',text,sourcePages:[1],learningUnitId:'k1',learningRoles:['concept','method']}]};
  const before=structuredClone(candidate), info=lectureEditorial(request,candidate);
  assert.ok(info.actualLength>1600);assert.equal(info.suggestedLength,undefined);assert.ok(!noteReviewTriggers(request,candidate).includes('LECTURE_EXPANSION'));
  assert.doesNotThrow(()=>validateResult(request,candidate));assert.deepEqual(candidate,before);
  request.document.chapters.unshift({id:'previous',title:'前章',sourcePages:[1],content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}});
  assert.ok(noteReviewTriggers(request,candidate).includes('LECTURE_REDUNDANCY'));
  assert.equal(JSON.parse(buildNoteReview(request,candidate)[1].content).lectureEditorial.duplicates[0].matches.chapter,'前章');
  request.learning.mode='translation';assert.ok(!noteReviewTriggers(request,candidate).some(x=>x.startsWith('LECTURE_')));
});

test('teaching ownership persists and only references earlier chapters; considered sources need not become repeated prose',()=>{
  const units=[1,2].map(n=>({id:`u${n}`,sourceId:'a',title:'source',pages:[n],excerpts:[]})),plan={sections:[
    {title:'中心',purpose:'教会均值',unitIds:['u1'],teaching:{focus:['均值计算'],recallFrom:[],omit:['重复题合并']}},
    {title:'加权',purpose:'只解释权重差异',unitIds:['u2'],teaching:{focus:['权重改变分子分母'],recallFrom:[1],omit:['不再重讲均值定义']}},
  ]};
  const request={action:'bundle-plan',title:'复习',intent:'精简讲义',units};assert.deepEqual(validateBundlePlan(request,plan),plan);
  const invalid=structuredClone(plan);invalid.sections[0].teaching.recallFrom=[2];assert.throws(()=>validateBundlePlan(request,invalid),e=>e.issues.some(i=>i.code==='RECALL_BINDING'));
  const writing=input();writing.document.chapters=plan.sections.map((s,i)=>({id:`c${i+1}`,title:s.title,sourcePages:[i+1],content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'此前已经讲过的定义。'}]}]}}));writing.chapterId='c2';
  writing.taskPlan={...plan,analysis:{task:{kind:'lecture'},pendingChecks:[]}};
  assert.equal(compositionContract(writing).prerequisiteNotes[0].chapterId,'c1');
});

test('old textbook sample migrates without changing personal samples or saved notebook snapshots',()=>{
  const library=freshTemplateLibrary(),entry=library.templates.find(t=>t.id==='lecture'),current=structuredClone(entry);
  Object.assign(entry,structuredClone(prior));entry.personalSample={...structuredClone(prior.defaultSample),title:'My authored style'};entry.editCount=4;entry.selectedSample='personal';
  const migrated=templateLibrarySchema.parse(library).templates.find(t=>t.id==='lecture');
  assert.deepEqual(migrated.defaultSample,current.defaultSample);assert.deepEqual(migrated.personalSample,entry.personalSample);assert.equal(migrated.selectedSample,'personal');
  assert.ok(lectureLength(current.defaultSample.paragraphs.map(p=>p.text).join(''))<lectureLength(prior.defaultSample.paragraphs.map(p=>p.text).join('')));
});

test('length alone spends no review or forced shortening calls',async()=>{
  const request=input();request.document.intent='详细说明均值方法';request.document.pages=[{number:1,text:'均值等于总和除以数量。'}];request.document.chapters[0].sourcePages=[1];
  request.workflow=workflowRequest(startWorkflow(undefined,1),'c1',1,0);const stages=[];
  const raw=await runModel(config,buildMessages(request),undefined,async(_url,options)=>{
    const messages=JSON.parse(options.body).messages,context=JSON.parse(messages[1].content);
    if(messages[0].content.startsWith('chapter-analysis')){stages.push('analysis');return response(analysis([unit('k1',[context.source[0].excerpts[0].id])]));}
    if(messages[0].content.startsWith('lecture-outline')){stages.push('select');return response(context.analyses[0]);}
    assert.equal(context.reviewTriggers,undefined,'Length alone cannot schedule a review');
    stages.push('write');return response({blocks:[{type:'paragraph',text:'这里是用于验证软篇幅提示不会强制重写的长正文。'.repeat(100),sourcePages:[1],learningUnitId:'k1',learningRoles:['concept','method']}]});
  });
  assert.deepEqual(stages,['analysis','select','write']);assert.ok(JSON.parse(raw).blocks[0].text.length>1600);
});

test('cancelling while reading source groups never starts consolidation or writing',async()=>{
  const request=input(),control=new AbortController();let calls=0;
  await assert.rejects(runModel(config,buildMessages(request),control.signal,async(_url,options)=>{
    calls++;const context=JSON.parse(JSON.parse(options.body).messages[1].content);control.abort();return response(analysis([unit('k1',[context.source[0].excerpts[0].id])]));
  }),{name:'AbortError'});
  assert.equal(calls,1);
});
