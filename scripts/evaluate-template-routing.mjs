import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { freshTemplateLibrary } from '../shared/writing-templates.mjs';
import { templateCatalog } from '../shared/template-routing.mjs';
import { templateRoutingCases, checkTemplateChoice } from '../evals/template-routing-cases.mjs';
import { buildMessages, runModel, validateResult } from '../server/harness.mjs';
const { values } = parseArgs({ options: { live:{type:'boolean'}, out:{type:'string'} } });
const directory=resolve(values.out || `artifacts/template-routing-${Date.now()}`),within=relative(resolve('artifacts'),directory);
if(!within||within.startsWith('..')||resolve('artifacts',within)!==directory)throw new Error('Output must be under artifacts.');
await mkdir(directory,{recursive:false});
const catalog=templateCatalog(freshTemplateLibrary()),results=[];
let config,calls=0,completionTokens=0;
if(values.live){
  try{process.loadEnvFile('.env');}catch(error){if(error.code!=='ENOENT')throw error;}
  config={apiKey:process.env.DEEPSEEK_API_KEY,model:process.env.DEEPSEEK_MODEL,baseUrl:process.env.DEEPSEEK_BASE_URL};
  if(!config.apiKey||!config.model||!config.baseUrl)throw new Error('Configure the provider in local .env; never pass credentials on the command line.');
}
const hash=value=>createHash('sha256').update(value).digest('hex');
for(const testCase of templateRoutingCases){
  const request={action:'select-template',catalog,document:testCase.document},messages=buildMessages(request),trace=[];
  let result,failures=[],error;
  try{
    if(values.live){
      const raw=await runModel(config,messages,AbortSignal.timeout(120000),async(url,options)=>{
        if(trace.length>=2||calls>=templateRoutingCases.length*2)throw new Error('Evaluation call budget reached.');
        const body=JSON.parse(options.body);body.max_tokens=Math.min(body.max_tokens,1024);
        const entry={messages:body.messages,maxTokens:body.max_tokens};trace.push(entry);calls++;
        const response=await fetch(url,{...options,body:JSON.stringify(body)});
        const payload=await response.clone().json().catch(()=>null);
        entry.content=payload?.choices?.[0]?.message?.content;entry.usage=payload?.usage;
        completionTokens+=payload?.usage?.completion_tokens||0;
        return response;
      });
      result=validateResult(request,raw);failures=checkTemplateChoice(testCase,result);
    }else{
      // Offline only validates inputs and freezes an executable test plan.
      // It deliberately does not substitute expected labels for model outputs.
      assert.equal(JSON.parse(messages[1].content).document.intent,testCase.document.intent);
    }
  }catch(failure){error=failure.message;failures.push(error);}
  results.push({id:testCase.id,request,expected:testCase.expected,promptSha256:hash(JSON.stringify(messages)),result,failures,trace});
  await writeFile(join(directory,'report.json'),JSON.stringify({mode:values.live?'live-routing':'offline-plan',model:config?.model,calls,completionTokens,maxCalls:templateRoutingCases.length*2,maxTokensPerCall:1024,results,limitations:'Small authored cases; not a general accuracy benchmark. Offline mode makes no model-selection claim.'},null,2));
  console.log(`${testCase.id}: ${error?'error':values.live?failures.length?'mismatch':'pass':'planned'}`);
}
const failed=results.filter(r=>r.failures.length).length;
console.log(JSON.stringify({mode:values.live?'live-routing':'offline-plan',cases:results.length,failed,calls,completionTokens,report:join(directory,'report.json')}));
if(failed)process.exitCode=1;
