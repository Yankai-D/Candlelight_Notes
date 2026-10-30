import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {jsonStringEscapes,escapeJSONSequences} from '../server/json-escape-patch.mjs';
import {repairJSONSyntax} from '../server/json-syntax-repair.mjs';
import {candidateDigest,applyRecoveryPatch,recoveryPlanSchema} from '../server/recovery-workbench.mjs';
import {runStage,executionScope,reserveExecutionCall} from '../server/execution.mjs';
import {validateResult,buildMessages,runModel} from '../server/harness.mjs';
import {startWorkflow,workflowRequest} from '../shared/workflow-review.mjs';

test('escape inventory distinguishes already encoded text and ambiguous valid escapes; only selected sequences change',()=>{
  const raw=String.raw`{"literal":"\\q","unicode":"\u0061","tab":"line\tend","math":"\(x\times 2\)","unknown":"\novel"}`;
  const inventory=jsonStringEscapes(raw);
  assert.deepEqual(inventory.map(x=>x.sequence),[String.raw`\tend`,String.raw`\(`,String.raw`\times`,String.raw`\)`,String.raw`\novel`]);
  assert.ok(inventory.find(x=>x.sequence===String.raw`\times`).validJSONPrefix);
  assert.equal(repairJSONSyntax(raw),null); // Never infer intended string values automatically.
  const fixed=escapeJSONSequences(raw,[String.raw`\(`,String.raw`\times`,String.raw`\)`]);
  const value=JSON.parse(fixed);
  assert.equal(value.math,String.raw`\(x\times 2\)`);assert.equal(value.literal,String.raw`\q`);
  assert.equal(value.unicode,'a');assert.equal(value.tab,'line\tend');assert.equal(value.unknown,'\novel');
  assert.throws(()=>escapeJSONSequences(fixed,[String.raw`\times`]),/already JSON-escaped/);
  assert.throws(()=>escapeJSONSequences(raw,[String.raw`\times`,String.raw`\times`]),/distinct/);
});

test('escape operations bind to current candidate and reject absent sequences atomically; they never touch files or source context',()=>{
  const raw=String.raw`{"answer":"\(x\)"}`,base={failureId:'f'.repeat(64),strategy:'patch',targetDigest:candidateDigest(raw)};
  const plan=recoveryPlanSchema.parse({...base,operations:[{op:'json-escape',sequences:[String.raw`\(`,String.raw`\)`]}]});
  assert.equal(JSON.parse(applyRecoveryPatch(raw,plan)).answer,String.raw`\(x\)`);
  assert.throws(()=>applyRecoveryPatch(raw,{...plan,targetDigest:'a'.repeat(64)}),{code:'RECOVERY_TOOL_CONTRACT'});
  assert.throws(()=>applyRecoveryPatch(raw,{...plan,operations:[...plan.operations,{op:'json-escape',sequences:[String.raw`\notPresent`]}]}),{code:'RECOVERY_TOOL_CONTRACT'});
  assert.equal(raw,String.raw`{"answer":"\(x\)"}`);
});

test('observed 112 escape positions are fixed with one scripted controller decision and original validation, never regenerating prose',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/course-escapes-observed-v1.json',import.meta.url),'utf8'));
  const fixed=escapeJSONSequences(fixture.raw,fixture.sequences);
  assert.equal(createHash('sha256').update(fixed).digest('hex'),fixture.expectedSha256);
  const offsets=jsonStringEscapes(fixture.raw).filter(x=>fixture.sequences.includes(x.sequence)).flatMap(x=>x.offsets).sort((a,b)=>a-b);
  assert.equal(offsets.length,112);
  // Verify every byte other than the inserted serialization backslashes.
  let cursor=0,extra=0;
  for(const offset of offsets){assert.equal(fixed.slice(cursor+extra,offset+extra),fixture.raw.slice(cursor,offset));assert.equal(fixed[offset+extra],'\\');extra++;cursor=offset;}
  assert.equal(fixed.slice(cursor+extra),fixture.raw.slice(cursor));
  let calls=0;
  const result=await runStage({stage:'generate',messages:buildMessages(fixture.request),initialRaw:fixture.raw,limits:{calls:2},
    validate:raw=>validateResult(fixture.request,raw),complete:async(messages,stage)=>{
      await reserveExecutionCall();calls++;assert.equal(stage,'recovery-plan');
      const ctx=JSON.parse(messages[1].content);
      assert.deepEqual(ctx.toolState.stringEscapes.sequences.map(s=>s.sequence),fixture.sequences);
      return JSON.stringify({failureId:ctx.failureId,strategy:'patch',targetDigest:ctx.toolState.targetDigest,operations:[{op:'json-escape',sequences:fixture.sequences}]});
    }});
  assert.equal(calls,1);assert.equal(result.raw,fixed);assert.equal(result.recovered,true);assert.equal(result.syntaxOnlyRecovered,undefined);
});

test('model-chosen literal-escape patches still trigger content review unlike deterministic punctuation repair',async()=>{
  const document={title:'Original example',intent:'讲清概率记号',revision:0,pages:[{number:1,text:'p denotes a probability.'}],chapters:[{id:'c1',title:'概率',sourcePages:[1],content:{type:'doc',content:[]}}]};
  const request={action:'generate',scope:'chapter',chapterId:'c1',revision:0,instruction:'讲清概率记号',document,learning:{mode:'adaptive',template:'guided-v3'},workflow:workflowRequest(startWorkflow(undefined,1),'c1',1,0)};
  let calls=0,receipt;
  const raw=await executionScope({binding:'escape-review',limits:{calls:3}},()=>runModel({apiKey:'fixture',model:'offline',baseUrl:'https://example.invalid'},buildMessages(request),undefined,async(_url,options)=>{
    calls++;const messages=JSON.parse(options.body).messages,ctx=JSON.parse(messages[1].content);let content;
    if(calls===1)content=String.raw`{"blocks":[{"type":"paragraph","text":"令 \(p\) 表示概率。","sourcePages":[1]}]}`;
    else if(calls===2){assert.match(messages[0].content,/execution-recovery-plan-v1/);content=JSON.stringify({failureId:ctx.failureId,strategy:'patch',targetDigest:ctx.toolState.targetDigest,operations:[{op:'json-escape',sequences:[String.raw`\(`,String.raw`\)`]}]});}
    else{assert.equal(calls,3);assert.match(messages[0].content,/note-self-review-v1/);content=JSON.stringify({candidateDigest:ctx.binding.candidateDigest,verdict:'accept',findings:[],summary:'概率记号与来源一致。'});}
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));
  },{onWorkflowReport:r=>{receipt=r;}}));
  assert.equal(calls,3);assert.equal(validateResult(request,raw).blocks[0].text,String.raw`令 \(p\) 表示概率。`);
  assert.ok(receipt.reviewTriggers.includes('FORMAT_REPAIR'));
});
