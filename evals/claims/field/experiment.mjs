import { evaluationCase, smokeOutput } from '../../notes/cases.mjs';
import { buildMessages, runModel, validateResult } from '../../../server/harness.mjs';
import { fingerprint, normalizeSnapshot } from '../../../server/claim-review.mjs';
import { auditUnits } from '../../../server/claim-audit.mjs';
import { conditionPrompt, buildConditionMessages, validateConditions } from '../../../server/condition-review.mjs';
import { runDiagnostic, diagnosticBudget } from '../focused/experiment.mjs';
import { meteredFetcher } from '../../../server/model-budget.mjs';

export const fieldVersion='field-review-v1';
export const generationBudget=Object.freeze({...diagnosticBudget,maxCalls:2,maxCompletionTokens:4096,totalCompletionTokens:8192});
export const windowPolicy=Object.freeze({targetUnits:8,targetBlocks:4,contextBlocksEachSide:2,maxWindows:8});
const digest=({artifactHash,...value})=>fingerprint(value);
const fail=message=>{throw new Error(message);};
export function planField() {
  const c=evaluationCase('openintro-mean','foundation');
  return {version:fieldVersion,material:c.material,request:c.request,generationMessages:buildMessages(c.request),reviewPrompt:conditionPrompt,
    generationBudget,diagnosticBudget,windowPolicy,maxCalls:10,maxCompletionTokens:24576,
    scope:'One new model-generated chapter from an already used public textbook; not an unseen holdout or a complete textbook.',
    evidencePolicy:'Reviewers receive all supplied chapter pages; generated citations are retained in the original result but do not restrict the evidence search.'};
}
const blockText=block=>block.type==='bulletList'?block.items.join('\n'):block.text;
export function planWindows(request,result) {
  const source=structuredClone(request.document.pages),pages=source.map(p=>p.number);
  const blocks=result.blocks.map((block,i)=>({id:`b${i+1}`,text:blockText(block),sourcePages:[...pages]}));
  const base={documentId:'public-course',chapterId:request.chapterId,revision:request.revision,title:request.document.title,goal:request.document.intent,source};
  const units=blocks.map(block=>auditUnits({...base,blocks:[block],targetIds:[block.id]}));
  const windows=[];
  for(let start=0;start<blocks.length;) {
    let end=start,count=0;
    while(end<blocks.length&&end-start<windowPolicy.targetBlocks&&(end===start||count+units[end].length<=windowPolicy.targetUnits))count+=units[end++].length;
    const contextStart=Math.max(0,start-windowPolicy.contextBlocksEachSide),contextEnd=Math.min(blocks.length,end+windowPolicy.contextBlocksEachSide);
    const snapshot=normalizeSnapshot({...base,blocks:blocks.slice(contextStart,contextEnd),targetIds:blocks.slice(start,end).map(b=>b.id)});
    auditUnits(snapshot); // Fail before making any review call; never trim a hard paragraph.
    windows.push({id:`w${windows.length+1}`,startBlock:start,endBlock:end,snapshot,messages:buildConditionMessages(snapshot)});start=end;
  }
  if(windows.length>windowPolicy.maxWindows)fail('Entire note exceeds the frozen review budget; no partial success or silent omission');
  return {blocks,units:units.flat(),windows};
}
export async function runField(plan,{mode='simulation',config,fetcher=fetch,onStage=async()=>{},gitRevision=null,gitDirty=null,signal}={}) {
  if(fingerprint(plan)!==fingerprint(planField()))fail('Frozen field plan changed');
  if(!['simulation','live'].includes(mode))fail('Invalid execution mode');
  const selected=mode==='simulation'?{apiKey:'offline-only',baseUrl:'https://api.deepseek.com',model:'offline-fixture'}:config;
  if(!selected?.apiKey||!selected?.model||!selected?.baseUrl)fail('Explicit model configuration required');
  const endpoint=new URL(selected.baseUrl);if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)fail('Invalid endpoint');
  const run={version:fieldVersion,mode,createdAt:new Date().toISOString(),model:selected.model,endpoint:selected.baseUrl,gitRevision,gitDirty,plan,planHash:fingerprint(plan),generation:{status:'running',trace:[],events:[],result:null},reviewPlan:null,reviews:[],status:'running'};
  const reply=raw=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}));
  const bounded=meteredFetcher(mode==='simulation'?async()=>reply(smokeOutput(plan.request)):fetcher,generationBudget,run.generation.trace);
  const active=signal?AbortSignal.any([signal,AbortSignal.timeout(generationBudget.timeoutMs)]):AbortSignal.timeout(generationBudget.timeoutMs);
  try {
    active.throwIfAborted();
    const raw=await runModel(selected,buildMessages(plan.request),active,bounded,{action:'generate',onCompletion:e=>run.generation.events.push(e)});
    active.throwIfAborted();run.generation.result=validateResult(plan.request,raw);run.generation.status='accepted';
  }catch(error){run.generation.status='failed';run.generation.error={code:bounded.blockedReason||error.code||error.name};run.status='generation-failed';}
  await onStage(run);
  if(run.generation.status==='accepted') {
    try {run.reviewPlan=planWindows(plan.request,run.generation.result);}catch(error){run.status='planning-failed';run.error={message:error.message};}
    await onStage(run);
    if(run.reviewPlan) {
      for(const w of run.reviewPlan.windows) {
        if(signal?.aborted){run.status='cancelled';break;}
        const provider=mode==='simulation'?async()=>reply({checks:auditUnits(w.snapshot).filter(u=>u.target).map(u=>({unitId:u.id,verdict:'retain'}))}):fetcher;
        const result=await runDiagnostic('focused',w.snapshot,{config:selected,fetcher:provider,signal});
        run.reviews.push({windowId:w.id,result});await onStage(run);
      }
      if(run.status!=='cancelled')run.status=run.reviews.every(r=>r.result.status==='diagnosed')?'awaiting-human-review':'review-incomplete';
    }
  }
  run.artifactHash=digest(run);return run;
}
export function inspectField(run) {
  if(run.version!==fieldVersion||run.planHash!==fingerprint(run.plan)||run.artifactHash!==digest(run))fail('Field artifact hash mismatch');
  if(!['simulation','live'].includes(run.mode)||run.plan.reviewPrompt!==conditionPrompt||fingerprint(run.plan.generationBudget)!==fingerprint(generationBudget)||fingerprint(run.plan.diagnosticBudget)!==fingerprint(diagnosticBudget)||fingerprint(run.plan.windowPolicy)!==fingerprint(windowPolicy))fail('Unknown protocol or budget');
  const validateTrace=(trace,budget,messages,repair=false)=>{
    if(trace.length>budget.maxCalls)fail('Call budget exceeded');
    for(const t of trace) {
      const sent=t.request;
      if(sent.model!==run.model||sent.temperature!==budget.temperature||!Number.isInteger(sent.max_tokens)||sent.max_tokens<1||sent.max_tokens>budget.maxCompletionTokens||JSON.stringify(sent.messages).length>budget.maxPromptCharacters)fail('Provider configuration or budget changed');
      if(fingerprint(repair?sent.messages.slice(0,messages.length):sent.messages)!==fingerprint(messages))fail('Provider context changed');
    }
  };
  validateTrace(run.generation.trace,generationBudget,run.plan.generationMessages,true);
  const g=run.generation;
  if(g.status==='accepted') {
    const raw=g.trace.at(-1)?.response?.choices?.[0];
    if(raw?.finish_reason!=='stop'||fingerprint(validateResult(run.plan.request,raw.message.content))!==fingerprint(g.result))fail('Generated note differs from raw response');
  }else if(g.status!=='failed'||g.result||!g.error?.code||run.reviewPlan||run.reviews.length||run.status!=='generation-failed')fail('Invalid generation failure');
  let coverage=[];
  if(run.reviewPlan) {
    if(fingerprint(planWindows(run.plan.request,g.result))!==fingerprint(run.reviewPlan))fail('Review window plan changed');
    if(run.reviews.length>run.reviewPlan.windows.length)fail('Unexpected review windows');
    for(const [i,item] of run.reviews.entries()) {
      const w=run.reviewPlan.windows[i],r=item.result;
      if(item.windowId!==w.id||r.arm!=='focused'||fingerprint(r.snapshot)!==fingerprint(w.snapshot)||r.snapshotHash!==fingerprint(w.snapshot)||fingerprint(r.budget)!==fingerprint(diagnosticBudget))fail('Review window identity changed');
      validateTrace(r.trace,diagnosticBudget,w.messages);
      if(r.status==='diagnosed') {
        const raw=r.trace[0]?.response?.choices?.[0];
        if(raw?.finish_reason!=='stop'||fingerprint(validateConditions(w.snapshot,raw.message.content))!==fingerprint(r.diagnostic))fail('Diagnosis differs from raw response');
      }else if(r.status!=='failed'||r.diagnostic||!r.error?.code)fail('Invalid failed diagnosis');
    }
    coverage=run.reviewPlan.units.map(unit=>{
      const w=run.reviewPlan.windows.find(w=>w.snapshot.targetIds.includes(unit.blockId)),r=run.reviews.find(r=>r.windowId===w.id)?.result;
      const diagnosis=r?.diagnostic?.checks.find(c=>c.unitId===unit.id)||null;
      return {...unit,windowId:w.id,status:r?.status||'not-run',diagnosis};
    });
    const complete=run.reviews.length===run.reviewPlan.windows.length&&run.reviews.every(r=>r.result.status==='diagnosed');
    if((run.status==='awaiting-human-review')!==complete||!['awaiting-human-review','review-incomplete','cancelled'].includes(run.status))fail('Coverage and execution status disagree');
  }else if(g.status==='accepted') {
    let refused=false;try{planWindows(run.plan.request,g.result);}catch{refused=true;}
    if(!refused||run.status!=='planning-failed'||run.reviews.length)fail('Missing review plan');
  }
  const traces=[...g.trace,...run.reviews.flatMap(r=>r.result.trace)];
  const sum=k=>traces.length&&traces.every(t=>Number.isSafeInteger(t.response?.usage?.[k])&&t.response.usage[k]>=0)?traces.reduce((n,t)=>n+t.response.usage[k],0):null;
  return {status:run.status,mode:run.mode,coverage,calls:traces.length,promptTokens:sum('prompt_tokens'),completionTokens:sum('completion_tokens'),
    windows:run.reviewPlan?.windows.length||0,failedWindows:run.reviews.filter(r=>r.result.status==='failed').length,qualityConclusion:null,semanticJudgment:'awaiting-independent-review'};
}
