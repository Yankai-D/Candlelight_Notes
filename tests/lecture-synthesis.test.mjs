import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lectureSynthesisSchema, validateLectureSynthesis, validateLectureCoverage } from '../shared/lecture-synthesis.mjs';
import { freshTemplateLibrary, templateSnapshot, templateLibrarySchema, writingTemplatePrompt } from '../shared/writing-templates.mjs';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';
import { buildNoteReview } from '../server/note-review.mjs';
import { executionScope } from '../server/execution.mjs';
import { candidateDigest, inspectRecoveryCandidate, applyRecoveryPatch } from '../server/recovery-workbench.mjs';

const response = value => new Response(JSON.stringify({ choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}] }));
const input = () => ({ action:'generate', scope:'chapter', chapterId:'c1', revision:0, composition:true, instruction:'按知识点整理成精简讲义',
  learning:{mode:'adaptive',template:'guided-v3',writingTemplate:templateSnapshot(freshTemplateLibrary(),'lecture')},
  document:{title:'课程复习',intent:'整理方法、代表例题和课内变体',chapters:[{id:'c1',title:'样本均值',sourcePages:[3,7],content:{type:'doc',content:[]}}],
    pages:[{number:3,text:'样本均值等于总和除以数量。例题：2、4、6的均值为4。'}, {number:7,text:'复习：均值是总和除以数量。各数权重不同，要用加权均值：加权总和除以权重和。'}]} });
const synthesis = ids => ({units:[{id:'k1',topic:'均值的计算',concept:'用均值描述中心',method:['先求和，再除以数量'],sourceEvidenceIds:ids,
  examples:[{aim:'用给定三数计算均值',sourceEvidenceIds:[ids[0]]}],variants:[{difference:'权重不同改用加权总和与权重和',sourceEvidenceIds:[ids[1]]}]}],
  merges:[{sourceEvidenceIds:[ids[1]],intoUnit:'k1',reason:'重复均值定义只讲一次，保留加权这一变体。'}]});

test('a bundle lecture extracts units and writes concept/method/example/variant with recovery disabled; metadata stays out of rendering', async () => {
  const request=input(), stages=[]; let analyzed;
  const raw=await executionScope({binding:'first-pass-lecture',limits:{calls:3,recoveries:0,perStage:0}},()=>runModel({apiKey:'test',model:'offline',baseUrl:'http://localhost'},buildMessages(request),undefined,async(_url,options)=>{
    const messages=JSON.parse(options.body).messages, data=JSON.parse(messages[1].content);
    if(messages[0].content.startsWith('chapter-analysis')){
      stages.push('extract'); analyzed=synthesis(data.source.flatMap(page=>page.excerpts.map(e=>e.id)));
      assert.match(messages[0].content,/lecture-synthesis-v1/);
      return response({approach:'合并定义，按方法整理。',connection:'用于之后比较方法。',steps:[{focus:'均值',instruction:'计算并比较权重变体',sourceEvidenceIds:analyzed.units[0].sourceEvidenceIds}],risks:[],synthesis:analyzed});
    }
    stages.push('write'); assert.deepEqual(data.chapterAnalysis.synthesis,analyzed);
    assert.match(messages[0].content,/learningRole/);
    return response({blocks:[
      {type:'heading',text:'样本均值',sourcePages:[3]},
      ...['均值描述数据中心。','方法：相加再除以数量。','例题：2、4、6。均值为 (2+4+6)/3=4。','变体：权重不同时用加权总和除以权重和。'].map((text,index)=>({type:'paragraph',text,sourcePages:[index===3?7:3],learningUnitId:'k1',learningRole:['concept','method','example','variant'][index]}))]});
  }));
  const result=JSON.parse(raw);
  assert.deepEqual(stages,['extract','write']);
  validateLectureCoverage(analyzed,result.blocks);
  assert.ok(!JSON.stringify(result.rendering).includes('learningUnitId'));
  const review=buildNoteReview({...request,chapterAnalysis:{synthesis:analyzed}},result)[0].content;
  assert.match(review,/重复材料已合并不算遗漏/);
  assert.doesNotMatch(writingTemplatePrompt(request.learning.writingTemplate),/不将整理写成压缩摘要/);
});

test('lecture coverage rejects label-only headings, omitted selected examples, invented evidence and nonexistent merge targets',()=>{
  const value=lectureSynthesisSchema.parse(synthesis(['a','b'])), evidence=new Map([['a',{}],['b',{}]]);
  validateLectureSynthesis(value,evidence);
  assert.throws(()=>validateLectureCoverage(value,[{type:'heading',text:'例题',learningUnitId:'k1',learningRole:'example'}]),error=>error.issues.some(issue=>issue.expected.learningRole==='example'));
  const foreign=structuredClone(value);foreign.units[0].variants[0].sourceEvidenceIds=['foreign'];
  assert.throws(()=>validateLectureSynthesis(foreign,evidence),error=>error.issues[0].code==='SYNTHESIS_EVIDENCE');
  const badMerge=structuredClone(value);badMerge.merges[0].intoUnit='k2';
  assert.throws(()=>validateLectureSynthesis(badMerge,evidence),error=>error.issues[0].code==='SYNTHESIS_MERGE_TARGET');
});

test('a concise paragraph may cover concept and method without duplication or visible metadata',()=>{
  const value=lectureSynthesisSchema.parse(synthesis(['a','b']));
  const blocks=[{type:'paragraph',text:'均值表示中心，求和后除以数量就是计算流程。',sourcePages:[3],learningUnitId:'k1',learningRoles:['concept','method']},
    {type:'paragraph',text:'2、4、6的均值为4；如果权重不同改用加权总和除以权重和。',sourcePages:[3,7],learningUnitId:'k1',learningRoles:['example','variant']}];
  validateLectureCoverage(value,blocks);
  const result=validateResult({...input(),chapterAnalysis:{synthesis:value}},{blocks});
  assert.equal(result.blocks.length,2);assert.deepEqual(result.blocks[0].learningRoles,['concept','method']);
  assert.ok(!JSON.stringify(result.rendering).includes('learningRoles'));
  const headingOnly=structuredClone(blocks);headingOnly[0].type='heading';
  assert.throws(()=>validateLectureCoverage(value,headingOnly),error=>error.issues.some(i=>i.expected.learningRole==='concept'));
  const missing=structuredClone(blocks);missing[1].learningRoles=['example'];
  assert.throws(()=>validateLectureCoverage(value,missing),error=>error.issues.some(i=>i.expected.learningRole==='variant'));
});

test('invalid JSON provides the actual character location and raw context for local repair',()=>{
  const broken=String.raw`{"blocks":[{"type":"paragraph","text":"broken \q command"}]}`;
  assert.throws(()=>validateResult(input(),broken),error=>{
    assert.equal(error.code,'INVALID_EDIT_FORMAT');assert.equal(error.issues[0].code,'JSON_PARSE');
    assert.ok(Number.isSafeInteger(error.issues[0].offset));assert.ok(error.issues[0].context.includes(String.raw`\q`));return true;
  });
});

test('tool binding is distinct from an embedded prose digest, and original context is inspectable by decoded JSON path',()=>{
  const raw=JSON.stringify({candidateDigest:'a'.repeat(64),decisions:[{verdict:'uncertain'}]});
  const messages=[{role:'system',content:'audit'},{role:'user',content:JSON.stringify({blocks:[{text:'真实正文'}]})}];
  const observed=inspectRecoveryCandidate(raw,messages,{strategy:'inspect',target:'context',path:[0,'content','blocks',0],start:0,length:3000});
  assert.equal(observed.value.text,'真实正文');assert.equal(observed.targetDigest,candidateDigest(raw));
  const operation={operations:[{op:'set',path:['decisions',0,'verdict'],expected:'uncertain',value:'refine'}]};
  assert.throws(()=>applyRecoveryPatch(raw,{...operation,targetDigest:'a'.repeat(64)}),error=>error.issues[0].expected===candidateDigest(raw));
  assert.equal(JSON.parse(applyRecoveryPatch(raw,{...operation,targetDigest:observed.targetDigest})).candidateDigest,'a'.repeat(64));
});

test('known old lecture defaults migrate without deleting edited samples, undo, choice or CAS revision',async()=>{
  const legacy=JSON.parse(await readFile(new URL('./fixtures/lecture-template-v2.json',import.meta.url),'utf8'));
  const current=freshTemplateLibrary(), old=structuredClone(current); old.templates[1]={...old.templates[1],...legacy,personalSample:structuredClone(legacy.defaultSample),selectedSample:'personal',editCount:2};
  old.templates[1].personalSample.paragraphs[0].text+=' 用户自己的表达。'; old.templates[1].undo={selectedSample:'default',personalSample:structuredClone(legacy.defaultSample),editCount:0}; old.revision=9;
  const migrated=templateLibrarySchema.parse(old);
  assert.deepEqual(migrated.templates[1].defaultSample,current.templates[1].defaultSample);
  assert.deepEqual(migrated.templates[1].personalSample,old.templates[1].personalSample);
  assert.deepEqual(migrated.templates[1].undo,old.templates[1].undo);
  assert.equal(migrated.templates[1].selectedSample,'personal');assert.equal(migrated.revision,9);
  assert.deepEqual(templateLibrarySchema.parse(migrated),migrated);
  assert.equal(old.templates[1].organization,legacy.organization);
  const untouched=structuredClone(old);untouched.templates[1].personalSample=structuredClone(legacy.defaultSample);untouched.templates[1].editCount=0;
  assert.deepEqual(templateLibrarySchema.parse(untouched).templates[1].personalSample,current.templates[1].defaultSample);
  const tampered=structuredClone(old);tampered.templates[1].defaultSample.title+=' forged';
  assert.throws(()=>templateLibrarySchema.parse(tampered),/内置模板/);
});
