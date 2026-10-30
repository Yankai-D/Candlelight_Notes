import {createHash, randomInt, randomUUID} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {join, resolve, relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {meteredFetcher} from '../../server/model-budget.mjs';

export const hash = value => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
// Evaluation-only safeguards. These do not alter product recovery behaviour.
export const pilotBudget = {maxCalls:14,maxCompletionTokens:8192,totalCompletionTokens:49152,maxPromptCharacters:180000,timeoutMs:480000,temperature:0};

export async function runtimeIdentity(directory) {
  const root=resolve(directory),files=[];
  async function walk(folder) {
    for(const entry of (await readdir(join(root,folder),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const name=join(folder,entry.name);
      if(entry.isDirectory())await walk(name);
      else if(entry.isFile()&&entry.name.endsWith('.mjs'))files.push([relative(root,join(root,name)).replaceAll('\\','/'),hash(await readFile(join(root,name),'utf8'))]);
    }
  }
  await walk('server');await walk('shared');
  for(const file of ['package.json','package-lock.json'])files.push([file,hash(await readFile(join(root,file),'utf8'))]);
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  return {root,version:pkg.version,fingerprint:hash(files),files};
}

export async function loadRuntime(root) {
  const module=path=>import(pathToFileURL(join(root,path)).href);
  const [harness,bundle,document,templates,workflow]=await Promise.all([
    module('server/harness.mjs'),module('shared/bundle-context.mjs'),module('shared/document.mjs'),
    module('shared/writing-templates.mjs'),module('shared/workflow-review.mjs')]);
  return {...harness,...bundle,...document,...templates,...workflow};
}

export async function planCourseExperiment(testCase,roots,{budget=pilotBudget,order}={}) {
  for(const key of ['maxCalls','maxCompletionTokens','totalCompletionTokens','maxPromptCharacters','timeoutMs'])if(!Number.isSafeInteger(budget[key])||budget[key]<1)throw new Error(`Invalid evaluation budget: ${key}`);
  if(!Number.isFinite(budget.temperature)||budget.temperature<0||budget.temperature>2)throw new Error('Invalid evaluation temperature');
  const arms=await Promise.all(['baseline','candidate'].map(async arm=>({arm,...await runtimeIdentity(roots[arm])})));
  if(arms[0].fingerprint===arms[1].fingerprint)throw new Error('Comparison requires two different runtime snapshots');
  const selected=order|| (randomInt(2)?['candidate','baseline']:['baseline','candidate']);
  if(selected.length!==2||new Set(selected).size!==2||selected.some(v=>!['baseline','candidate'].includes(v)))throw new Error('Invalid arm order');
  return {schema:'course-eval-v1',id:randomUUID(),createdAt:new Date().toISOString(),caseId:testCase.id,
    caseHash:hash(testCase),testCase:structuredClone(testCase),arms,order:selected,budget:{...budget},
    scope:'full planning and sequential chapter generation; lecture template fixed; anomaly review enabled',
    limitations:['One authored development case, one run per version; no statistical superiority or unseen generalization claim.',
      'Model configuration, sources, learner and goal are shared; runtime versions differ in more than one rule.',
      'Randomized arm order cannot remove provider cache and latency effects in a single pair.',
      'Structure, length and metadata are not teaching-quality scores. Independent human review remains pending.']};
}

const sum=(trace,key)=>trace.length&&trace.every(t=>Number.isSafeInteger(t.response?.usage?.[key])&&t.response.usage[key]>=0)?trace.reduce((n,t)=>n+t.response.usage[key],0):null;
export function usageReport(trace) {
  const group=rows=>({calls:rows.length,successfulResponses:rows.filter(t=>t.status==='received').length,
    promptTokens:sum(rows,'prompt_tokens'),completionTokens:sum(rows,'completion_tokens'),
    cacheHitTokens:sum(rows,'prompt_cache_hit_tokens'),cacheMissTokens:sum(rows,'prompt_cache_miss_tokens'),
    elapsedMs:rows.reduce((n,t)=>n+(t.elapsedMs||0),0),promptCharacters:rows.reduce((n,t)=>n+JSON.stringify(t.request.messages).length,0)});
  return {...group(trace),stages:[...new Set(trace.map(t=>t.stage))].map(stage=>({stage,...group(trace.filter(t=>t.stage===stage))})),
    currencyCost:null,note:'Only provider-reported tokens. Missing fields remain unknown. No price or cache-miss inference.'};
}

// Non-overlapping top-level character counts, plus exact repeated prompts.
// This describes what was sent; it cannot classify semantic redundancy.
export function contextInventory(messages) {
  const sections=[];
  for(const [index,message]of messages.entries()) {
    if(message.role!=='user'){sections.push({path:`message[${index}].${message.role}`,characters:message.content.length,hash:hash(message.content)});continue;}
    try {for(const [key,value]of Object.entries(JSON.parse(message.content)))sections.push({path:`message[${index}].${key}`,characters:JSON.stringify(value).length,hash:hash(value)});}
    catch {sections.push({path:`message[${index}].user`,characters:message.content.length,hash:hash(message.content)});}
  }
  return sections;
}

export async function runCourseArm(plan,arm,{config,mode='live',fetcher=fetch,runtime,onSave=async()=>{},onProgress=()=>{}}={}) {
  if(!['live','simulation'].includes(mode))throw new Error('Invalid mode');
  if(hash(plan.testCase)!==plan.caseHash)throw new Error('Frozen case changed');
  const identity=plan.arms.find(a=>a.arm===arm);if(!identity)throw new Error('Unknown arm');
  const current=await runtimeIdentity(identity.root);if(current.fingerprint!==identity.fingerprint)throw new Error('Frozen runtime changed');
  runtime ||= await loadRuntime(identity.root);
  const endpoint=new URL(config.baseUrl);
  if(!config.apiKey||!config.model||!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('Invalid model configuration');
  const result={schema:'course-arm-v1',id:randomUUID(),planId:plan.id,planHash:hash(plan),arm,mode,model:config.model,baseUrl:config.baseUrl,
    runtime:identity,status:'running',trace:[],events:[],chapters:[],startedAt:new Date().toISOString()};
  const began=performance.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('EVAL_TIME_BUDGET')),plan.budget.timeoutMs);
  // Fixtures omit provider usage. Reserve enough for every simulated call while
  // retaining the call limit; never fabricate zero-token provider measurements.
  const effectiveBudget=mode==='simulation'?{...plan.budget,totalCompletionTokens:plan.budget.maxCalls*plan.budget.maxCompletionTokens}:plan.budget;
  result.effectiveBudget=effectiveBudget;
  const bounded=meteredFetcher(fetcher,effectiveBudget,result.trace);
  let stage='unclassified',phase='planning',chapter=null;
  const save=async()=>{result.usage=usageReport(result.trace);await onSave(result);};
  const tracked=async(url,options)=>{
    const index=result.trace.length,tag={stage,phase,chapter};
    try{return await bounded(url,options);}
    finally {
      if(result.trace[index])Object.assign(result.trace[index],tag,{context:contextInventory(result.trace[index].request.messages)});
      // Abort retries once the experimental boundary was hit; product limits
      // are untouched, and completed chapters remain in the checkpoint.
      if(bounded.blockedReason)controller.abort(new Error(bounded.blockedReason));
      await save();onProgress({arm,stage,calls:result.trace.length,status:result.trace[index]?.status||'blocked'});
    }
  };
  const options={onRequest:info=>{stage=info.stage;},onCompletion:event=>result.events.push({phase,chapter,...event}),
    saveCheckpoint:async checkpoint=>{result.checkpoint={phase,chapter,state:checkpoint};await save();return true;}};
  try {
    const c=plan.testCase;
    const context={version:1,folderId:'evaluation-only',folderName:c.title,capturedAt:1,sources:c.sources.map(s=>({...s,path:s.title,chapters:[],pages:s.pages.map((text,i)=>({number:i+1,text}))}))};
    let doc=runtime.createBundleNote(context,c.title,c.intent,1);
    const input=runtime.bundlePlanRequest(doc);
    result.inputHash=hash({sources:doc.pages,intent:c.intent,profile:c.profile});
    const planned=runtime.validateResult(input,await runtime.runModel(config,runtime.buildMessages(input),controller.signal,tracked,options));
    doc=runtime.applyBundlePlan(doc,planned);result.document=doc;result.planning=planned;await save();
    let workflow=runtime.startWorkflow(undefined,doc.chapters.length,'on-anomaly');
    const settings={mode:'adaptive',template:'guided-v3',writingTemplate:runtime.templateSnapshot(runtime.freshTemplateLibrary(),'lecture','固定讲义模板；本实验不评测自动路由')};
    for(const [index,currentChapter]of doc.chapters.entries()) {
      phase='chapter';chapter=index+1;
      const request={action:'generate',scope:'chapter',instruction:c.intent,revision:doc.revision,chapterId:currentChapter.id,composition:true,
        taskPlan:doc.composition.plan,document:doc,learning:settings,knowledge:c.profile,
        workflow:runtime.workflowRequest(workflow,currentChapter.id,doc.chapters.length,index)};
      let receipt;
      const raw=await runtime.runModel(config,runtime.buildMessages(request),controller.signal,tracked,{...options,onWorkflowReport:value=>{receipt=value;}});
      const generated=runtime.validateResult(request,raw);
      workflow=runtime.acceptWorkflowReport(workflow,request.workflow,receipt,'accepted');
      doc=runtime.applyResult(doc,request,generated);
      result.chapters.push({id:currentChapter.id,number:index+1,title:currentChapter.title,result:generated,workflow:receipt});
      result.document=doc;result.workflow=workflow;result.markdown=runtime.markdown(doc);await save();
    }
    result.status='complete';
  }catch(error) {
    result.status='failed';result.failure={phase,chapter,stage,code:bounded.blockedReason||(controller.signal.aborted?'EVAL_TIME_BUDGET':error.code)||error.name,message:error.message};
  }finally {
    clearTimeout(timer);result.elapsedMs=Math.round(performance.now()-began);result.finishedAt=new Date().toISOString();
    const after=await runtimeIdentity(identity.root);result.runtimeUnchanged=after.fingerprint===identity.fingerprint;
    if(!result.runtimeUnchanged){result.status='invalidated';result.failure={code:'RUNTIME_CHANGED'};}
    result.qualityConclusion=null;await save();
  }
  return result;
}
