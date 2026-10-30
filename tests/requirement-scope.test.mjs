import test from 'node:test';
import assert from 'node:assert/strict';
import {taskContractSchema,validateTaskContract,requirementCoverage,compositionContract} from '../shared/bundle-blueprint.mjs';
import {createBundleNote,bundlePlanRequest,applyBundlePlan,validateBundlePlan} from '../shared/bundle-context.mjs';
import {storedDocumentSchema} from '../shared/backup.mjs';
import {buildMessages,runModel,validateResult} from '../server/harness.mjs';
import {executionScope} from '../server/execution.mjs';
import {buildNoteReview} from '../server/note-review.mjs';
import {planReviewContext,validatePlanReview} from '../server/bundle-plan-review.mjs';

const intent='整理两章精简讲义，教会计算均值和计算样本方差，省去行政信息。';
const document=()=>createBundleNote({version:1,folderId:'test',folderName:'原创统计资料',capturedAt:1,sources:[
  {id:'mean',title:'均值',path:'课件',pages:[{number:1,text:'均值为总和除以观测数量。1、3、5的均值为3。'}],chapters:[]},
  {id:'variance',title:'方差',path:'课件',pages:[{number:1,text:'样本方差为平方偏差和除以n-1，要求n>1。1、3、5的样本方差为4。'}],chapters:[]},
]},'统计复习',intent,1);
const task=()=>({kind:'lecture',requirements:[
  {id:'r1',scope:'global',text:'整份讲义两章且精简',evidenceQuote:'两章精简讲义'},
  {id:'r2',scope:'section',text:'教会计算均值',evidenceQuote:'计算均值'},
  {id:'r3',scope:'section',text:'教会计算样本方差',evidenceQuote:'计算样本方差'},
  {id:'r4',scope:'global',text:'排除课程行政内容',evidenceQuote:'省去行政信息'},
],organization:'按依赖组织',limitations:[]});
const outline=()=>({sections:[
  {title:'均值',purpose:'定义并计算均值',unitIds:['unit-1'],requirementIds:['r2'],dependsOn:[],handoff:'以均值定义偏差'},
  {title:'方差',purpose:'计算平方偏差并解释分母',unitIds:['unit-2'],requirementIds:['r3'],dependsOn:[1],handoff:'理解离散程度'},
],teachingPlan:{version:1,throughline:'中心与离散程度',concepts:[
  {id:'t1',title:'均值',objective:'正确计算均值',prerequisites:[],unitIds:['unit-1'],placements:[{section:1,role:'introduce',advance:'理解平均与总和',difficultPoint:'',check:'复算1、3、5的均值'}]},
  {id:'t2',title:'方差',objective:'正确计算样本方差',prerequisites:['t1'],unitIds:['unit-2'],placements:[{section:2,role:'introduce',advance:'从偏差到平方偏差',difficultPoint:'分母',check:'复算1、3、5的样本方差'}]},
],examples:[]}});
const response=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));

test('global requirements remain in intent, review and persistence without redundant chapter tags or outline repair',async()=>{
  const doc=document(),input=bundlePlanRequest(doc),stages=[];
  const raw=await executionScope({binding:'scoped-requirements',limits:{calls:4,recoveries:0}},()=>runModel({apiKey:'fixture',model:'offline',baseUrl:'https://example.invalid'},buildMessages(input),undefined,async(_url,options)=>{
    const messages=JSON.parse(options.body).messages,protocol=messages[0].content.split('：')[0],ctx=JSON.parse(messages[1].content);stages.push(protocol);
    if(protocol==='bundle-intent-v1'){
      assert.match(messages[0].content,/requirement-scope-v1/);assert.match(messages[0].content,/"scope"/);return response(task());
    }
    if(protocol==='bundle-materials-v1')return response({units:ctx.units.map(u=>({id:u.id,topics:[u.title],prerequisites:[],role:'当前知识',limitations:[]}))});
    if(protocol==='bundle-outline-v2'){assert.doesNotMatch(messages[0].content,/每条 requirement 至少由一节/);return response(outline());}
    assert.equal(protocol,'bundle-plan-review-v1');assert.deepEqual(ctx.requirementCoverage,{required:['r2','r3'],global:['r1','r4'],missing:[],unknown:[]});
    assert.ok(ctx.evidence.some(e=>e.id==='requirement-r1'&&e.scope==='global'));assert.equal(ctx.task.requirements.length,4);
    return response({candidateDigest:ctx.candidateDigest,verdict:'accept',checks:['goal','coverage','order','coherence'].map(dimension=>({dimension,status:'pass'})),findings:[],summary:'两章结构满足全局要求，具体计算各有章节负责。'});
  }));
  const plan=validateResult(input,raw);assert.equal(stages.length,4);
  const saved=storedDocumentSchema.parse(JSON.parse(JSON.stringify(applyBundlePlan(doc,plan))));
  assert.deepEqual(saved.composition.plan.analysis.task,task());
  const req={action:'generate',scope:'chapter',chapterId:saved.chapters[0].id,revision:saved.revision,instruction:intent,document:saved,composition:true,taskPlan:saved.composition.plan,learning:{mode:'adaptive',template:'guided-v3'}};
  const contract=compositionContract(req);assert.deepEqual(contract.globalRequirements.map(r=>r.id),['r1','r4']);assert.deepEqual(contract.sectionRequirements.map(r=>r.id),['r2']);
  const review=JSON.parse(buildNoteReview(req,{blocks:[{type:'paragraph',text:'均值为3。',sourcePages:[1],sourceQuote:''}]})[1].content);
  assert.deepEqual(review.composition.contract.globalRequirements,contract.globalRequirements);
});
test('specific deliverables and unknown IDs still fail; legacy unscoped requirements retain their original assignment rules',()=>{
  const input=bundlePlanRequest(document()),base=outline();
  base.analysis={version:1,task:task(),materials:{units:input.units.map(u=>({id:u.id,topics:[u.title],prerequisites:[],role:'来源',limitations:[]}))},reviewSummary:'scope test',evidenceMode:'source-index-excerpts'};
  assert.doesNotThrow(()=>validateBundlePlan(input,base));
  const missing=structuredClone(base);missing.sections[1].requirementIds=[];
  assert.throws(()=>validateBundlePlan(input,missing),e=>e.issues.some(i=>i.refs?.includes('r3')));
  const unknown=structuredClone(base);unknown.sections[0].requirementIds.push('r99');
  assert.throws(()=>validateBundlePlan(input,unknown),e=>e.issues.some(i=>i.unknown?.includes('r99')));
  const legacy=structuredClone(base);for(const r of legacy.analysis.task.requirements)delete r.scope;
  assert.deepEqual(taskContractSchema.parse(legacy.analysis.task),legacy.analysis.task);
  assert.throws(()=>validateBundlePlan(input,legacy),e=>e.issues.some(i=>i.refs?.includes('r1')&&i.refs?.includes('r4')));
  const invalid=task();invalid.requirements[0].scope='ignore';assert.throws(()=>validateTaskContract(input,invalid));
  const forged=task();forged.requirements[0].evidenceQuote='原目标没有这句话';assert.throws(()=>validateTaskContract(input,forged));
});
test('global constraints can fail semantic review at whole-plan location even when all concrete tasks are assigned',()=>{
  const input=bundlePlanRequest(document()),plan=outline();plan.sections.push({...plan.sections[1],title:'额外复述'});
  const context={...planReviewContext(input,plan,task()),candidateDigest:'a'.repeat(64)};
  const review=validatePlanReview(context,{candidateDigest:context.candidateDigest,verdict:'revise',checks:['goal','coverage','order','coherence'].map(dimension=>({dimension,status:dimension==='goal'?'issue':'pass'})),
    findings:[{dimension:'goal',section:0,problem:'用户要求两章，实际提供三章且额外复述。',instruction:'合并重复章节并保留具体计算任务。',evidenceIds:['requirement-r1','section-3-title']}],summary:'全局结构不符合原目标。'});
  assert.equal(review.verdict,'revise');assert.equal(review.findings[0].section,0);
  assert.deepEqual(requirementCoverage(task(),plan.sections).missing,[]);
});
