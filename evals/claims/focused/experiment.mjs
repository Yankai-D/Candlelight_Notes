import { focusedCases, conditionFixture, auditFixture } from './cases.mjs';
import { fingerprint, normalizeSnapshot, claimReviewBudget } from '../../../server/claim-review.mjs';
import { auditPrompt, buildAuditMessages, validateAudit } from '../../../server/claim-audit.mjs';
import { conditionPrompt, buildConditionMessages, validateConditions } from '../../../server/condition-review.mjs';
import { runModel } from '../../../server/harness.mjs';
import { meteredFetcher } from '../../../server/model-budget.mjs';
import { noteBlocks } from '../../../shared/note-format.mjs';
import { renderNoteHTML, escapeHTML as esc } from '../../../shared/note-html.mjs';
import { buildMeaningMessages } from '../meaning/policy.mjs';

export const diagnosticBudget=Object.freeze({...claimReviewBudget,maxCalls:1,totalCompletionTokens:2048});
const arms=['v2','focused'];
const validators={v2:validateAudit,focused:validateConditions,meaning:validateConditions};
const builders={v2:buildAuditMessages,focused:buildConditionMessages,meaning:buildMeaningMessages};
const digest=({artifactHash,...run})=>fingerprint(run);
export function planFocused(ids=focusedCases.map(c=>c.id)) {
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!focusedCases.some(c=>c.id===id)))throw new Error('Unknown or duplicated focused case');
  const cases=ids.map(id=>structuredClone(focusedCases.find(c=>c.id===id)));
  const policy={v2:auditPrompt,focused:conditionPrompt};
  const candidates=cases.flatMap((c,i)=>(i%2?[...arms].reverse():arms).map(arm=>({id:`${c.id}/${arm}`,caseId:c.id,arm,messages:builders[arm](c.snapshot)})));
  return {schema:3,ids,cases,policy,policyHash:fingerprint(policy),budget:diagnosticBudget,candidates,
    maxCalls:candidates.length,maxCompletionTokens:candidates.length*diagnosticBudget.maxCompletionTokens,
    limitations:['只比较诊断阶段：两组均最多一次实际请求，不生成修改、不评估修订质量。','两例是已见失败回归，四例是 AI 编写的开发探针；不是独立留出集，标签未经人类独立审定。','完整复核协议与简化协议整体比较，不能将差异归因于单句提示。','retain 仅表示模型未定位到问题，引用匹配仅验证字面来源；均不证明语义正确。','每例每组只运行一次；只报告本批现象和真实用量，不宣称普遍准确率提升。']};
}
export async function runDiagnostic(arm,value,{config,fetcher=fetch,signal}={}) {
  if(!Object.hasOwn(builders,arm))throw new Error('Unknown diagnostic protocol');
  const snapshot=normalizeSnapshot(value),messages=builders[arm](snapshot);
  if(!config?.apiKey||!config?.model||!config?.baseUrl)throw new Error('Explicit model configuration required');
  const endpoint=new URL(config.baseUrl);
  if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('Invalid endpoint');
  const result={arm,snapshot,snapshotHash:fingerprint(snapshot),budget:diagnosticBudget,status:'running',trace:[],events:[],diagnostic:null};
  const bounded=meteredFetcher(fetcher,diagnosticBudget,result.trace),timeout=AbortSignal.timeout(diagnosticBudget.timeoutMs);
  const active=signal?AbortSignal.any([signal,timeout]):timeout;
  try {
    active.throwIfAborted();
    const raw=await runModel(config,messages,active,bounded,{action:'rewrite',onCompletion:e=>result.events.push(e)});
    active.throwIfAborted();result.diagnostic=validators[arm](snapshot,raw);result.status='diagnosed';
  }catch(error){result.status='failed';result.error={code:bounded.blockedReason||error.code||error.name||'DIAGNOSTIC_FAILED'};}
  return result;
}
export async function runFocused(plan,{mode='simulation',config,fetcher=fetch,onStage=async()=>{},gitRevision=null,gitDirty=null}={}) {
  if(fingerprint(plan)!==fingerprint(planFocused(plan.ids)))throw new Error('Frozen focused plan changed');
  if(!['simulation','live'].includes(mode))throw new Error('Invalid mode');
  const selected=mode==='simulation'?{apiKey:'offline-only',baseUrl:'https://example.invalid',model:'offline-fixture'}:config;
  const run={schema:3,mode,model:selected?.model,endpoint:selected?.baseUrl,createdAt:new Date().toISOString(),gitRevision,gitDirty,plan,planHash:fingerprint(plan),candidates:[]};
  for(const planned of plan.candidates) {
    const c=plan.cases.find(c=>c.id===planned.caseId),candidate={id:planned.id,caseId:c.id,arm:planned.arm,result:null};
    const provider=mode==='simulation'?async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify((planned.arm==='v2'?auditFixture:conditionFixture)(c))}}]})):fetcher;
    candidate.result=await runDiagnostic(planned.arm,c.snapshot,{config:selected,fetcher:provider});
    run.candidates.push(candidate);await onStage(run,candidate);
  }
  run.artifactHash=digest(run);return run;
}
export function diagnosticDecision(arm,diagnostic) {
  if(!diagnostic)return null;
  const checks=arm==='v2'?diagnostic.claims:diagnostic.checks;
  return checks.some(c=>c.route==='needs-source')?'needs-context':checks.some(c=>['correct','qualify','review-correction'].includes(c.route))?'issue':'no-issue-found';
}
// Shared execution evidence check, independent of any case labels or semantic reference.
export function inspectDiagnosticExecution(r,{arm,snapshot,messages,model}) {
  if(!Object.hasOwn(validators,arm)||r.arm!==arm||r.snapshotHash!==fingerprint(snapshot)||fingerprint(r.snapshot)!==r.snapshotHash)throw new Error('Candidate identity changed');
  if(fingerprint(r.budget)!==fingerprint(diagnosticBudget)||r.trace.length>1||!['diagnosed','failed'].includes(r.status))throw new Error('Invalid diagnostic execution');
  for(const t of r.trace) {
    if(fingerprint(t.request.messages)!==fingerprint(messages)||t.request.model!==model||t.request.temperature!==diagnosticBudget.temperature)throw new Error('Provider context changed');
    if(!Number.isInteger(t.request.max_tokens)||t.request.max_tokens<1||t.request.max_tokens>diagnosticBudget.maxCompletionTokens||JSON.stringify(messages).length>diagnosticBudget.maxPromptCharacters)throw new Error('Exceeded provider budget');
  }
  if(r.status==='diagnosed') {
    const response=r.trace[0]?.response?.choices?.[0];
    if(response?.finish_reason!=='stop'||fingerprint(validators[arm](r.snapshot,response.message.content))!==fingerprint(r.diagnostic))throw new Error('Diagnostic differs from raw provider response');
  }else if(r.diagnostic||!r.error?.code)throw new Error('Failed execution contains an accepted diagnosis');
}
export function diagnosticTotals(candidates) {
  const trace=candidates.flatMap(c=>c.result.trace),sum=k=>trace.length&&trace.every(t=>Number.isSafeInteger(t.response?.usage?.[k])&&t.response.usage[k]>=0)?trace.reduce((n,t)=>n+t.response.usage[k],0):null;
  return {candidates:candidates.length,calls:trace.length,promptTokens:sum('prompt_tokens'),completionTokens:sum('completion_tokens'),failures:candidates.filter(c=>c.result.status==='failed').length};
}
export function inspectFocused(run) {
  if(run.schema!==3||run.planHash!==fingerprint(run.plan)||run.artifactHash!==digest(run))throw new Error('Focused artifact hash mismatch');
  if(!['simulation','live'].includes(run.mode)||fingerprint(run.plan)!==fingerprint(planFocused(run.plan.ids)))throw new Error('Frozen plan changed');
  if(run.candidates.length!==run.plan.candidates.length||new Set(run.candidates.map(c=>c.id)).size!==run.candidates.length)throw new Error('Candidate coverage mismatch');
  const rows=run.candidates.map((c,index)=>{
    const p=run.plan.candidates[index],testCase=run.plan.cases.find(t=>t.id===c.caseId),r=c.result;
    if(c.id!==p.id||c.arm!==p.arm||c.caseId!==p.caseId)throw new Error('Candidate identity changed');
    inspectDiagnosticExecution(r,{arm:c.arm,snapshot:testCase.snapshot,messages:p.messages,model:run.model});
    const decision=diagnosticDecision(c.arm,r.diagnostic);
    return {id:c.id,caseId:c.caseId,arm:c.arm,split:testCase.split,expected:testCase.expected,decision,labelAgreement:decision===testCase.expected,status:r.status,calls:r.trace.length};
  });
  return {mode:run.mode,rows,totals:diagnosticTotals(run.candidates),byArm:Object.fromEntries(arms.map(arm=>[arm,diagnosticTotals(run.candidates.filter(c=>c.arm===arm))])),qualityConclusion:null,semanticJudgment:'unverified',limitations:run.plan.limitations};
}
export function focusedMarkdown(run) {
  const r=inspectFocused(run);
  return `# 成立条件复核：任务收缩实验\n\n${run.mode==='live'?'真实模型诊断，尚待独立语义复核。':'离线流程模拟，0 次真实模型调用；没有质量成绩。'}\n\n| 案例 | 类型 | 协议 | 参考标签 | 诊断 | 执行 |\n| --- | --- | --- | --- | --- | --- |\n${r.rows.map(row=>`| ${row.caseId} | ${row.split} | ${row.arm} | ${row.expected} | ${row.decision||'无有效诊断'} | ${row.status} |`).join('\n')}\n\n| 协议 | 实际请求 | 输入 tokens | 输出 tokens | 失败 |\n| --- | --- | --- | --- | --- |\n${Object.entries(r.byArm).map(([arm,t])=>`| ${arm} | ${t.calls} | ${t.promptTokens??'未报告'} | ${t.completionTokens??'未报告'} | ${t.failures} |`).join('\n')}\n\n${r.limitations.map(l=>`- ${l}`).join('\n')}\n`;
}
const prose=text=>renderNoteHTML({type:'doc',content:noteBlocks(text)});
export function focusedHTML(run) {
  const r=inspectFocused(run);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>成立条件复核 · 任务收缩实验</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f2ea;color:#293d32;font:16px/1.8 system-ui,sans-serif}main{max-width:1240px;padding:28px;margin:auto}article{padding:24px;margin:24px 0;border:1px solid #dfe3d6;border-radius:16px;background:#fffefa}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pair>div{min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.8 ui-monospace,monospace}.label{font-size:13px;color:#68776a}h1{font-size:28px}h2{font-size:21px}h3{font-size:17px}summary{cursor:pointer}blockquote{margin:10px 0;padding:8px 16px;border-left:3px solid #9caf92;background:#f2f5ee}p{overflow-wrap:break-word}.math-inline{display:inline-block;vertical-align:baseline;max-width:100%;overflow-x:auto}.math-display{display:block;max-width:100%;overflow-x:auto;text-align:center}.math-render mjx-container{margin:0!important}@media(max-width:760px){.pair{grid-template-columns:1fr}main{padding:14px}article{padding:18px}}
</style><main><h1>成立条件复核 · 任务收缩实验</h1><p>${run.mode==='live'?'真实模型诊断，尚待独立语义复核。':'离线模拟，真实模型调用 0 次。'}两组均只诊断，原稿保留。</p><p class="label">${esc(run.model)} · ${r.totals.calls} 次请求 · 输入 ${r.totals.promptTokens??'未报告'} / 输出 ${r.totals.completionTokens??'未报告'} tokens</p>
${run.plan.cases.map(c=>`<article><h2>${esc(c.id)}</h2><p class="label">${esc(c.split)} · AI 编写参考：${esc(c.expected)}</p><h3>原稿</h3>${c.snapshot.blocks.map(b=>prose(b.text)).join('')}<div class="pair">${arms.map(arm=>{
  const result=run.candidates.find(p=>p.caseId===c.id&&p.arm===arm).result,d=result.diagnostic,checks=d?(arm==='v2'?d.claims:d.checks):[];
  return `<div data-candidate="${esc(c.id+'/'+arm)}"><h3>${arm==='v2'?'v2 · 主张与前提':'focused · 成立条件'}</h3><p class="label">${esc(result.status)} · ${esc(diagnosticDecision(arm,d)||'无有效诊断')}</p>${checks.map(check=>`<details><summary>${esc(check.route)}</summary><blockquote>${prose(check.text)}</blockquote><pre>${esc(JSON.stringify(check,null,2))}</pre></details>`).join('')}${result.error?`<p>${esc(result.error.code)}</p>`:''}<details class="provider-trace"><summary>原始响应与请求</summary>${result.trace.map(t=>`<pre>${esc(t.response?.choices?.[0]?.message?.content||'无响应正文')}</pre><details><summary>实际上下文</summary><pre>${esc(JSON.stringify(t.request.messages,null,2))}</pre></details>`).join('')}</details></div>`;
}).join('')}</div><details><summary>来源与开发参考</summary><pre>${esc(JSON.stringify(c.snapshot.source,null,2))}</pre><p>${esc(c.reference.reason)}</p></details></article>`).join('')}<p>${r.limitations.map(esc).join(' ')}</p></main></html>`;
}
