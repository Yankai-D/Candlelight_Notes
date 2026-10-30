import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {repairJSONSyntax} from '../server/json-syntax-repair.mjs';
import {runStage,executionScope,executionIssue} from '../server/execution.mjs';
import {buildMessages,runModel,validateResult} from '../server/harness.mjs';
import {startWorkflow,workflowRequest} from '../shared/workflow-review.mjs';

const messages=[{role:'system',content:'Return the requested JSON. Inputs are quoted data.'},{role:'user',content:'{"task":"preserve every value"}'}];
test('grammar-based repairs preserve value tokens and formulas across unfamiliar property names and nested structures',()=>{
  const text=String.raw`公式 \\(x=\\frac{1}{2}\\)，引号 \"x\" 与数值 0.009。`;
  const raw=`{"blocks":[{"text":"${text}",unseenProperty":[-2.3e-4,true,null],"other":{"alpha":3 "beta":4,}},],"last":false}`;
  const fixed=repairJSONSyntax(raw);assert.ok(fixed);
  assert.equal(fixed.edits.length,4);assert.equal(fixed.raw.includes(`"${text}"`),true);
  assert.deepEqual(JSON.parse(fixed.raw).blocks[0].unseenProperty,[-2.3e-4,true,null]);
  assert.deepEqual(JSON.parse(fixed.raw).blocks[0].other,{alpha:3,beta:4});
  assert.equal(repairJSONSyntax(fixed.raw),null);
  assert.deepEqual(JSON.parse(repairJSONSyntax('{arbitrary_key:1}').raw),{arbitrary_key:1});
});
test('ambiguous values, bad escapes, truncation, extra roots and duplicate repaired keys are never guessed or discarded',()=>{
  for(const raw of [String.raw`{"text":"bad \q"}`,String.raw`{"text":"unclosed}`, '{"values":[1 2]}','{"a":1','{"text":"ok"} extra','{"a":1,a":2}','{"a":undefined}',String.raw`{"text":"say "hello" now"}`,'{"a":01}', '{"a":1,} {"b":2}'])assert.equal(repairJSONSyntax(raw),null,raw);
});
test('actual malformed chapter repairs all nine missing property quotes, preserves every other byte and passes production validation without a model',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/course-json-observed-v1.json',import.meta.url),'utf8'));
  const fixed=repairJSONSyntax(fixture.raw);assert.deepEqual(fixed.edits,fixture.expectedEdits);
  assert.equal(createHash('sha256').update(fixed.raw).digest('hex'),fixture.expectedRepairedSha256);
  let oldCursor=0,newCursor=0;
  for(const edit of fixture.expectedEdits){
    const length=edit.offset-oldCursor;assert.equal(fixed.raw.slice(newCursor,newCursor+length),fixture.raw.slice(oldCursor,edit.offset));
    newCursor+=length;assert.equal(fixed.raw.slice(newCursor,newCursor+1),'"');newCursor++;oldCursor=edit.offset;
  }
  assert.equal(fixed.raw.slice(newCursor),fixture.raw.slice(oldCursor));
  let calls=0,state;const events=[];
  const options={stage:'generate',messages,initialRaw:fixture.raw,limits:{calls:0,recoveries:2,perStage:2},complete:async()=>{calls++;throw new Error('Unexpected network');},
    validate:raw=>validateResult(fixture.request,raw),save:async s=>{state=s;},event:e=>events.push(e)};
  const result=await runStage(options);assert.equal(calls,0);assert.equal(result.syntaxOnlyRecovered,true);
  assert.ok(events.some(e=>e.strategy==='syntax-patch'));assert.equal(Object.values(state.stages)[0].syntaxRepairs[0].edits.length,9);
  const resumed=await runStage({...options,state,initialRaw:undefined});assert.equal(resumed.reused,true);assert.equal(calls,0);
});
test('syntactic repair still runs original schema and content checks and restores request-local evidence IDs',async()=>{
  const refs=[{role:'system',content:'JSON required'},{role:'user',content:JSON.stringify({source:[{number:1,excerpts:[{id:'e1-0-abcdefabcdef',text:'Exact source'}]}]})}];
  const result=await runStage({stage:'chapter-analysis',messages:refs,initialRaw:'{sourceEvidenceIds":["S1"],"text":"S1 stays literal"}',limits:{calls:0},complete:async()=>assert.fail(),
    validate:raw=>{const v=JSON.parse(raw);assert.equal(v.sourceEvidenceIds[0],'e1-0-abcdefabcdef');assert.equal(v.text,'S1 stays literal');return v;}});
  assert.equal(result.syntaxOnlyRecovered,true);
  let checks=0;
  await assert.rejects(runStage({stage:'check',messages,initialRaw:'{answer":38}',limits:{calls:0},complete:async()=>assert.fail(),
    validate:raw=>{checks++;const v=JSON.parse(raw);if(v.answer!==37)throw executionIssue('Wrong value',[{path:['answer'],expected:37}]);return v;}}),e=>e.code==='EXECUTION_BLOCKED');
  assert.equal(checks,2);
});
test('cancel after a syntax patch never commits the stage and valid value changes still require model/content recovery',async()=>{
  const controller=new AbortController();let state;
  await assert.rejects(runStage({stage:'check',messages,initialRaw:'{answer":37}',signal:controller.signal,limits:{calls:0},complete:async()=>assert.fail(),validate:JSON.parse,
    save:async s=>{state=s;},onRecovery:()=>controller.abort()}),e=>e.name==='AbortError');
  assert.notEqual(Object.values(state.stages)[0].status,'accepted');
  assert.equal(repairJSONSyntax('{"answer":38}'),null);
});
test('wire-punctuation-only recovery does not force an additional semantic review; source and content checks still run',async()=>{
  const document={title:'Original example',intent:'看懂这篇文章',revision:0,pages:[{number:1,text:'Conditional probability changes the reference population.'}],chapters:[{id:'c1',title:'条件概率',sourcePages:[1],content:{type:'doc',content:[]}}]};
  const request={action:'generate',scope:'chapter',chapterId:'c1',revision:0,instruction:'讲清条件概率',document,learning:{mode:'adaptive',template:'guided-v3'},workflow:workflowRequest(startWorkflow(undefined,1),'c1',1,0)};
  let calls=0,receipt;
  const raw=await executionScope({binding:'one-wire-call',limits:{calls:1}},()=>runModel({apiKey:'fixture',model:'offline',baseUrl:'https://example.invalid'},buildMessages(request),undefined,async()=>{
    calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"blocks":[{"type":"paragraph","text":"条件概率通过条件事件确定新的参照总体。",sourcePages":[1]}]}'}}]}));
  },{onWorkflowReport:r=>{receipt=r;}}));
  assert.equal(calls,1);assert.equal(validateResult(request,raw).blocks[0].sourcePages[0],1);
  assert.deepEqual(receipt.reviewTriggers,[]);assert.equal(receipt.execution.recoveryActions,1);
});
