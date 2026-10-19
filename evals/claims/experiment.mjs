import { claimCases, claimOracles, simulatedClaimReply } from './cases.mjs';
import { CLAIM_REVIEW_VERSION, claimReviewBudget, claimReviewPrompt, claimPatchPrompt, fingerprint, buildClaimReviewMessages, buildClaimPatchMessages, runClaimReview, validateClaimReview, previewClaimPatch } from '../../server/claim-review.mjs';
import { noteBlocks } from '../../shared/note-format.mjs';
import { renderNoteHTML, escapeHTML as esc } from '../../shared/note-html.mjs';

export function planClaims(ids=claimCases.map(c=>c.id)) {
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!claimCases.some(c=>c.id===id)))throw new Error('Unknown or duplicated claim case');
  const cases=ids.map(id=>structuredClone(claimCases.find(c=>c.id===id)));
  const policy={version:CLAIM_REVIEW_VERSION,review:claimReviewPrompt,patch:claimPatchPrompt};
  return {schema:1,ids,cases,policy,policyHash:fingerprint(policy),oracleHash:fingerprint(claimOracles),budget:claimReviewBudget,
    prompts:cases.map(c=>({caseId:c.id,messages:buildClaimReviewMessages(c.snapshot),hash:fingerprint(buildClaimReviewMessages(c.snapshot))})),
    maxCalls:cases.length*claimReviewBudget.maxCalls,maxCompletionTokens:cases.length*claimReviewBudget.totalCompletionTokens,
    limitations:['开发探针与参考判断由 AI 协作编写，未经过独立人工复核，不是未见留出集。','正确对照、错误对照和缺上下文分开统计；与参考标签一致不等于语义正确率。','同一模型诊断并修订，可能共享盲点；引文存在不证明引文支持判断。','每例一次运行，不估计方差；只生成候选预览，不接入日常笔记写入。']};
}
const artifactHash=({artifactHash,...run})=>fingerprint(run);

export async function runClaims(plan,{mode='simulation',config,fetcher=fetch,onStage=async()=>{},gitRevision=null,gitDirty=null}={}) {
  if(!['simulation','live'].includes(mode))throw new Error('Unknown run mode');
  if(fingerprint(plan)!==fingerprint(planClaims(plan.ids)))throw new Error('Frozen claim plan changed');
  if(mode==='live'&&(!config?.apiKey||!config?.model||!config?.baseUrl))throw new Error('Live run requires explicit provider configuration');
  const selected=mode==='simulation'?{apiKey:'offline-test-key',model:'offline-fixture',baseUrl:'https://example.invalid'}:config;
  const endpoint=new URL(selected.baseUrl);
  if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('Unsafe provider URL');
  const run={schema:1,mode,createdAt:new Date().toISOString(),model:selected.model,endpoint:selected.baseUrl,gitRevision,gitDirty,plan,planHash:fingerprint(plan),candidates:[]};
  for(const testCase of plan.cases) {
    const candidate={id:testCase.id,result:null};run.candidates.push(candidate);
    const provider=mode==='simulation'?async(url,options)=>{
      const stage=JSON.parse(options.body).messages[0].content===claimReviewPrompt?'review':'patch';
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(simulatedClaimReply(testCase,stage))}}]}));
    }:fetcher;
    candidate.result=await runClaimReview(testCase.snapshot,{config:selected,fetcher:provider,onStage:async result=>{
      candidate.result=result;await onStage(run,candidate);
    }});
  }
  run.artifactHash=artifactHash(run);return run;
}

export function inspectClaims(run) {
  if(run.schema!==1||run.planHash!==fingerprint(run.plan)||run.artifactHash!==artifactHash(run))throw new Error('Claim artifact hash mismatch');
  if(run.plan.policyHash!==fingerprint(run.plan.policy)||fingerprint(run.plan.budget)!==fingerprint(claimReviewBudget))throw new Error('Claim policy/budget changed');
  if(run.candidates.length!==run.plan.cases.length||new Set(run.candidates.map(c=>c.id)).size!==run.candidates.length)throw new Error('Missing or duplicate candidates');
  const rows=run.candidates.map(c=>{
    const testCase=run.plan.cases.find(t=>t.id===c.id),r=c.result;
    if(!testCase||fingerprint(r.snapshot)!==fingerprint(testCase.snapshot)||r.snapshotHash!==fingerprint(r.snapshot))throw new Error('Snapshot changed');
    if(!['proposal-ready','no-issue-found','needs-context','failed'].includes(r.status))throw new Error('Run is incomplete');
    const prompt=run.plan.prompts.find(p=>p.caseId===c.id);
    if(!prompt||prompt.hash!==fingerprint(prompt.messages))throw new Error('Frozen prompt changed');
    if(r.review&&fingerprint(validateClaimReview(r.snapshot,{checks:r.review.checks}))!==fingerprint(r.review))throw new Error('Review evidence changed');
    if(r.status==='proposal-ready') {
      if(!r.proposal||fingerprint(previewClaimPatch(r.snapshot,r.review,r.proposal))!==fingerprint(r.preview))throw new Error('Preview changed');
    }else if(r.proposal||r.preview)throw new Error('A failed or withheld repair cannot have a preview');
    if(r.status==='no-issue-found'&&!r.review?.checks.every(c=>c.verdict==='no-issue-found'))throw new Error('Status/diagnosis mismatch');
    if(r.status==='needs-context'&&!r.review?.checks.some(c=>c.verdict==='needs-context'))throw new Error('Missing context diagnosis');
    for(const t of r.trace) {
      if(!['review','patch'].includes(t.stage))throw new Error('Missing stage identity');
      const messages=t.stage==='review'?prompt.messages:buildClaimPatchMessages(r.snapshot,r.review);
      if(fingerprint(t.request.messages)!==fingerprint(messages))throw new Error('Actual provider context changed');
      if(t.request.max_tokens>run.plan.budget.maxCompletionTokens||t.request.max_tokens<1||JSON.stringify(t.request.messages).length>run.plan.budget.maxPromptCharacters)throw new Error('Provider request exceeded bound');
    }
    const reserved=r.trace.reduce((n,t)=>n+t.request.max_tokens,0);
    if(r.trace.length>run.plan.budget.maxCalls||reserved>run.plan.budget.totalCompletionTokens)throw new Error('Provider calls exceeded bound');
    const verdict=r.review?.checks[0]?.verdict||null;
    return {id:c.id,expected:testCase.expected,verdict,labelAgreement:verdict===testCase.expected,status:r.status,calls:r.trace.length,patches:r.proposal?.edits.length||0};
  });
  const trace=run.candidates.flatMap(c=>c.result.trace),sum=key=>trace.length&&trace.every(t=>Number.isSafeInteger(t.response?.usage?.[key])&&t.response.usage[key]>=0)?trace.reduce((n,t)=>n+t.response.usage[key],0):null;
  return {mode:run.mode,rows,totals:{cases:rows.length,calls:trace.length,promptTokens:sum('prompt_tokens'),completionTokens:sum('completion_tokens'),proposals:rows.reduce((n,r)=>n+r.patches,0),failed:rows.filter(r=>r.status==='failed').length},
    labelAgreement:run.mode==='live'?rows.filter(r=>r.labelAgreement).length:null,qualityConclusion:null,semanticJudgment:'unverified',limitations:run.plan.limitations};
}

export function claimsMarkdown(run) {
  const report=inspectClaims(run),t=report.totals;
  return `# 条件与量词复核实验\n\n${run.mode==='live'?'真实模型运行；尚无独立人工评定。':'离线模拟；真实模型调用 0 次，无质量成绩。'}\n\n${t.cases} 例，${t.calls} 次${run.mode==='live'?'真实':'模拟'}请求，${t.proposals} 项修订候选，${t.failed} 例执行失败。输入 ${t.promptTokens??'未报告'} / 输出 ${t.completionTokens??'未报告'} tokens。\n\n| 探针 | 参考标签 | 模型诊断 | 执行结果 | 请求数 |\n| --- | --- | --- | --- | --- |\n${report.rows.map(r=>`| ${r.id} | ${r.expected} | ${r.verdict||'无有效诊断'} | ${r.status} | ${r.calls} |`).join('\n')}\n\n${report.limitations.map(s=>`- ${s}`).join('\n')}\n`;
}
const prose=text=>renderNoteHTML({type:'doc',content:noteBlocks(text)});
export function claimsHTML(run) {
  const report=inspectClaims(run);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>条件与量词 · 复核记录</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f2ea;color:#293d32;font:16px/1.9 system-ui,sans-serif}main{max-width:1240px;margin:40px auto;padding:0 28px}h1{font-size:30px}h2{font-size:21px}h3{font-size:15px;color:#627568}article{background:#fffefa;border:1px solid #dfe3d6;border-radius:16px;padding:24px;margin:28px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:28px}.pair>div{min-width:0}.label{font-size:13px;color:#68776a}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 ui-monospace,monospace}blockquote{margin:12px 0;padding:8px 16px;border-left:3px solid #9caf92;background:#f2f5ee}summary{cursor:pointer}.math-inline{display:inline-block;vertical-align:baseline;max-width:100%;overflow-x:auto}.math-display{display:block;max-width:100%;overflow-x:auto;text-align:center;margin:1em 0}.math-render mjx-container{margin:0!important}svg{max-width:none}p{overflow-wrap:break-word}@media(max-width:760px){.pair{grid-template-columns:1fr}main{padding:0 14px}article{padding:18px}}@media print{body{background:#fff}article{break-inside:avoid}}
</style><main><h1>条件与量词 · 复核记录</h1><p>${run.mode==='live'?'真实模型提出的诊断与修订候选。':'离线模拟输出，真实模型调用 0 次。'}原稿保留，修订未写入应用；来源匹配与格式通过不代表语义正确。</p><p class="label">${esc(run.model)} · ${report.totals.cases} 例 · ${report.totals.calls} 次${run.mode==='live'?'真实':'模拟'}请求 · ${report.totals.proposals} 项候选 · ${report.totals.failed} 例失败</p>
${report.rows.map(row=>{
  const c=run.candidates.find(c=>c.id===row.id),r=c.result,testCase=run.plan.cases.find(c=>c.id===row.id);
  return `<article data-case="${esc(c.id)}"><h2>${esc(c.id)}</h2><p class="label">参考标签（AI 编写）：${esc(row.expected)} · 模型诊断：${esc(row.verdict||'无有效诊断')} · ${esc(row.status)}</p><div class="pair"><div><h3>保留的原稿</h3>${r.snapshot.blocks.filter(b=>r.snapshot.targetIds.includes(b.id)).map(b=>prose(b.text)).join('')}</div><div><h3>${r.preview?'局部修订候选':'没有修改'}</h3>${r.preview?r.preview.blocks.filter(b=>r.preview.targetIds.includes(b.id)).map(b=>prose(b.text)).join(''):'<p>原稿保持不变。</p>'}</div></div>
${(r.review?.checks||[]).map(ch=>`<h3>模型复核依据</h3><blockquote>${prose(ch.claim)}</blockquote><p>${esc(ch.reason)}</p><p>${esc(ch.counterexample||ch.missingContext)}</p>${ch.evidence.map(e=>`<p class="label">来源第 ${e.page} 页</p><pre>${esc(e.quote)}</pre>`).join('')}`).join('')}
${(r.proposal?.edits||[]).map(e=>`<details><summary>精确替换范围</summary><pre>before: ${esc(e.before)}\n\nafter: ${esc(e.after)}</pre></details>`).join('')}
${r.error?`<p>未提交候选：${esc(r.error.stage)} / ${esc(r.error.code)}</p>`:''}
<details class="provider-trace"><summary>实际请求与原始响应（含未通过校验的内容）</summary>${r.trace.map(t=>`<h3>${esc(t.stage)} · 第 ${t.call} 次请求</h3><p class="label">${esc(t.status)} · 输入 ${esc(t.response?.usage?.prompt_tokens??'未报告')} / 输出 ${esc(t.response?.usage?.completion_tokens??'未报告')} tokens</p><h3>原始响应</h3><pre>${esc(t.response?.choices?.[0]?.message?.content??'没有收到正文')}</pre><details><summary>发送的上下文</summary><pre>${esc(JSON.stringify(t.request.messages,null,2))}</pre></details>`).join('')}</details>
<details><summary>完整来源与上下文</summary>${r.snapshot.source.map(p=>`<h3>第 ${p.number} 页</h3><pre>${esc(p.text)}</pre>`).join('')}${r.snapshot.blocks.filter(b=>!r.snapshot.targetIds.includes(b.id)).map(b=>prose(b.text)).join('')}</details><details><summary>开发参考判断（未发送给模型）</summary><p>${esc(testCase.reference.reason)}</p><p>${esc(testCase.reference.counterexample||testCase.reference.missingContext||'')}</p></details></article>`;
}).join('')}<p>${report.limitations.map(esc).join(' ')}</p></main></html>`;
}
