// Real wall-clock regression for the desktop's former 300s header timeout and
// service's former 360s total deadline. All upstream responses are LOCAL mocks.
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {startTestServer} from '../tests/support/server.mjs';
import {createLocalBridge} from '../desktop/local-bridge.mjs';
import {readLocalJSON} from '../shared/local-api.mjs';
import {startWorkflow,workflowRequest} from '../shared/workflow-review.mjs';
const {values}=parseArgs({options:{out:{type:'string'},'hold-ms':{type:'string'}}});
const hold=Number(values['hold-ms']||370000);assert.ok(Number.isFinite(hold)&&hold>=100&&hold<=420000);
const output=resolve(values.out||'artifacts/long-local-generation');assert.ok(relative(resolve('artifacts'),output)&&!relative(resolve('artifacts'),output).startsWith('..'));
await mkdir(output,{recursive:true});
let calls=0,aborted=0,service;const timers=new Set(),phases=[];const began=Date.now();
const mock=http.createServer(async(req,res)=>{
  if(req.url==='/silent-control'){
    const timer=setTimeout(()=>res.end('{}'),hold);timers.add(timer);res.on('close',()=>{clearTimeout(timer);timers.delete(timer);});return;
  }
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString()),context=JSON.parse(body.messages[1].content);
  const review=body.messages[0].content.startsWith('note-self-review');calls++;phases.push({phase:review?'review':'generate',at:Date.now()-began});
  assert.ok(calls<=2,'No duplicate or unexpected provider calls');
  res.writeHead(200,{'content-type':'application/json'});res.write(' ');
  const pulse=setInterval(()=>{if(!res.destroyed)res.write(' ');},10000);
  const timer=setTimeout(()=>{
    clearInterval(pulse);timers.delete(timer);
    const content=review?{candidateDigest:context.binding.candidateDigest,verdict:'accept',checks:['goal','coverage','grounding','clarity'].map(dimension=>({dimension,status:'pass'})),findings:[],summary:'Mock review accepted.'}
      :{blocks:[{type:'paragraph',text:'均值是观测值之和除以观测个数。',sourcePages:[1]}],summary:'Local synthetic note.'};
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}));
  },hold/2);timers.add(timer);
  res.on('close',()=>{clearTimeout(timer);clearInterval(pulse);timers.delete(timer);if(!res.writableEnded)aborted++;});
});
mock.listen(0,'127.0.0.1');await once(mock,'listening');const base=`http://127.0.0.1:${mock.address().port}`;
const report={schema:'long-local-generation-v1',status:'running',holdMs:hold,realModelCalls:0,syntheticProviderCalls:0,sourceHashes:{}};
for(const path of ['desktop/local-bridge.mjs','desktop/main.mjs','server/index.mjs','shared/local-api.mjs','shared/note-recovery.mjs'])report.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const progress=setInterval(()=>console.log(JSON.stringify({elapsedMs:Date.now()-began,syntheticProviderCalls:calls})),30000);
const controller=new AbortController(),watchdog=setTimeout(()=>controller.abort(),hold+60000);
try{
  service=await startTestServer({DEEPSEEK_API_KEY:'LOCAL-MOCK-ONLY',DEEPSEEK_BASE_URL:base,READING_TREE_FILE_STORAGE:'1'});
  const bridge=createLocalBridge(service.base);
  const config=await readLocalJSON(await bridge(new Request('pangzhu://app/api/config')));
  const baseline=hold>360000?fetch(base+'/silent-control',{signal:controller.signal}).then(async response=>{await response.text();return {errorCode:null};},error=>({errorCode:error.cause?.code||error.code||error.name,elapsedMs:Date.now()-began})):Promise.resolve({skipped:'accelerated smoke'});
  const state=startWorkflow(undefined,1,'always');
  const input={action:'generate',scope:'chapter',chapterId:'c1',documentId:'long-local-fixture',revision:0,instruction:'Explain the source.',learning:{mode:'adaptive',template:'guided-v3'},workflow:workflowRequest(state,'c1',1,0),
    document:{title:'Synthetic slow fixture',intent:'Understand the mean.',chapters:[{id:'c1',title:'Mean',sourcePages:[1],content:{type:'doc',content:[]}}],pages:[{number:1,text:'The mean is the sum of observations divided by their count.'}]}};
  const reply=await readLocalJSON(await bridge(new Request('pangzhu://app/api/edit',{method:'POST',signal:controller.signal,headers:{'content-type':'application/json','x-reading-tree-token':config.token},body:JSON.stringify(input)})));
  assert.equal(reply.result.blocks.length,1);assert.equal(reply.workflow.outcome,'accepted');assert.equal(reply.workflow.reviewedSegments,1);assert.equal(calls,2);assert.equal(aborted,0);
  report.elapsedMs=Date.now()-began;report.baseline=await baseline;
  if(hold>360000){assert.ok(report.elapsedMs>360000);assert.equal(report.baseline.errorCode,'UND_ERR_HEADERS_TIMEOUT');}
  report.status=hold>360000?'pass':'accelerated-smoke-pass';report.syntheticProviderCalls=calls;report.phases=phases;report.cancelledProviderCalls=aborted;
  report.result={blocks:reply.result.blocks.length,workflowOutcome:reply.workflow.outcome,recordSaved:!!reply.recordId};
}catch(error){report.status='fail';report.error=error.message;process.exitCode=1;}
finally{
  clearInterval(progress);clearTimeout(watchdog);controller.abort();for(const timer of timers)clearTimeout(timer);
  await service?.stop();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
