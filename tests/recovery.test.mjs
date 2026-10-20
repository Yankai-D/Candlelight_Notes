import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {atomicWrite} from '../server/atomic-file.mjs';
import {recoverOperation,optionalRecord,recoveryScope} from '../server/recovery.mjs';
import {runModel,buildMessages} from '../server/harness.mjs';
import {freshTemplateLibrary} from '../shared/writing-templates.mjs';
import {templateCatalog} from '../shared/template-routing.mjs';
import {createGenerationRecord} from '../server/generation-records.mjs';
import {createDemo} from '../src/demo.ts';
const noWait=async()=>{},config={baseUrl:'https://example.invalid/v1',apiKey:'test',model:'test'};
test('OneDrive-style EPERM replacement retries the same snapshot, keeping old bytes until commit',async()=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'candlelight-atomic-')),path=join(dir,'tree.json');await fs.writeFile(path,'old');let writes=0,renames=0;
 try{await atomicWrite(path,'new',{sleep:noWait,io:{...fs,writeFile:async(...args)=>{writes++;return fs.writeFile(...args)},rename:async(...args)=>{assert.equal(await fs.readFile(path,'utf8'),'old');if(++renames<4)throw Object.assign(new Error('locked'),{code:'EPERM'});return fs.rename(...args)}}});
 assert.equal(writes,1);assert.equal(renames,4);assert.equal(await fs.readFile(path,'utf8'),'new');assert.deepEqual(await fs.readdir(dir),['tree.json']);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
test('persistent lock is bounded; committed bytes are never unlinked and cleanup cannot overturn success',async()=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'candlelight-atomic-')),path=join(dir,'tree.json');await fs.writeFile(path,'old');let calls=0;
 try{await assert.rejects(atomicWrite(path,'new',{delays:[0,0],sleep:noWait,io:{...fs,rename:async()=>{calls++;throw Object.assign(new Error('lock'),{code:'EBUSY'})}}}),error=>error.code==='STORAGE_BUSY');assert.equal(calls,3);assert.equal(await fs.readFile(path,'utf8'),'old');
 await atomicWrite(path,'new',{io:{...fs,unlink:async()=>{throw Object.assign(new Error('cleanup lock'),{code:'EPERM'})}}});assert.equal(await fs.readFile(path,'utf8'),'new');
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
test('recovery respects cancellation and never retries permanent errors or blocks on optional diagnostics',async()=>{
 for(const code of ['ENOSPC','EINVAL','ENOENT']){let calls=0;await assert.rejects(recoverOperation(async()=>{calls++;throw Object.assign(new Error('failure'),{code})},{layer:'storage',sleep:noWait}));assert.equal(calls,1)}
 const controller=new AbortController();let calls=0;await assert.rejects(recoverOperation(async()=>{calls++;controller.abort();throw Object.assign(new Error('failure'),{retryable:true})},{layer:'transport',signal:controller.signal,sleep:noWait}));assert.equal(calls,1);
 assert.equal(await optionalRecord(async()=>{throw new Error('private details never logged')}),undefined);
});
test('template selection and ordinary generation automatically retry transient provider errors but not bad credentials',async()=>{
 const request={action:'select-template',catalog:templateCatalog(freshTemplateLibrary()),document:{title:'Exercise',intent:'逐题解答',chapters:['Q1'],excerpts:[{page:1,text:'Solve x+1=2.'}]}};
 for(const messages of [buildMessages(request),[{role:'user',content:'Return JSON'}]]){
  let calls=0;const result=await runModel(config,messages,undefined,async()=>++calls===1?new Response('busy',{status:503}):new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:messages.length===1?'{}':JSON.stringify({templateId:'exercise',task:'solve',material:'exercises',fit:'direct',adaptation:'',reason:'逐题解答'})}}]})),{retryDelays:[0]});assert.ok(result);assert.equal(calls,2);
 }
 let calls=0;await assert.rejects(runModel(config,[{role:'user',content:'x'}],undefined,async()=>{calls++;return new Response('unauthorized',{status:401})},{retryDelays:[0]}),/Key/);assert.equal(calls,1);
});
test('generation evidence storage disappearing after start cannot suppress a successful provider response',async()=>{
 // FileLibrary supplies a canonical system directory in production. Windows
 // runners may expose the temporary directory through a short-path alias.
 const dir=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'candlelight-record-'))),document=createDemo(),chapter=document.chapters[0];let calls=0;
 try{
  const record=await createGenerationRecord(dir,{action:'generate',scope:'chapter',documentId:document.id,revision:document.revision,chapterId:chapter.id,instruction:'整理',document},'test',async()=>{calls++;return new Response('{}')});
  await fs.rm(join(dir,'generation-records'),{recursive:true,force:true});
  assert.equal((await record.fetch('https://example.invalid',{body:JSON.stringify({messages:[],max_tokens:5})})).status,200);
  await record.finish('accepted',{summary:'done'});assert.equal(calls,1);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('nested completions share a bounded retry budget and empty provider responses get one recovery attempt',async()=>{
 let calls=0;
 await recoveryScope(async()=>{
  for(let stage=0;stage<3;stage++){
   let attempts=0;const work=()=>recoverOperation(async()=>{calls++;if(!attempts++)throw Object.assign(new Error('transient'),{retryable:true});return 'ok'},{layer:'transport',sleep:noWait});
   if(stage<2)assert.equal(await work(),'ok');else await assert.rejects(work(),/transient/);
  }
 });assert.equal(calls,5);
 calls=0;const raw=await runModel(config,[{role:'user',content:'JSON'}],undefined,async()=>new Response(JSON.stringify(++calls===1?{choices:[]}:{choices:[{finish_reason:'stop',message:{content:'{}'}}]})),{retryDelays:[0]});assert.equal(raw,'{}');assert.equal(calls,2);
});
