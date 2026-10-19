import { freshCases, freshOracles } from './cases.mjs';
import { fixtureReview, fixturePatch } from './fixtures.mjs';
import { simulatedClaimReply } from '../cases.mjs';
import { fingerprint, claimReviewPrompt, claimPatchPrompt, claimReviewBudget, buildClaimReviewMessages, buildClaimPatchMessages, runClaimReview, validateClaimReview, previewClaimPatch } from '../../../server/claim-review.mjs';
import { auditPrompt, auditPatchPrompt, auditBudget, buildAuditMessages, buildAuditPatchMessages, runClaimAudit, validateAudit, previewAuditPatch } from '../../../server/claim-audit.mjs';
import { noteBlocks } from '../../../shared/note-format.mjs';
import { renderNoteHTML, escapeHTML as esc } from '../../../shared/note-html.mjs';

const digest=({artifactHash,...run})=>fingerprint(run);
export function planComparison(ids=freshCases.map(c=>c.id)) {
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!freshCases.some(c=>c.id===id)))throw new Error('Unknown or duplicated comparison case');
  const cases=ids.map(id=>structuredClone(freshCases.find(c=>c.id===id)));
  const policy={v1:{review:claimReviewPrompt,patch:claimPatchPrompt},v2:{review:auditPrompt,patch:auditPatchPrompt}};
  const candidates=cases.flatMap((c,i)=>(i%2?['v2','v1']:['v1','v2']).map(arm=>({id:`${c.id}/${arm}`,caseId:c.id,arm,messages:arm==='v1'?buildClaimReviewMessages(c.snapshot):buildAuditMessages(c.snapshot)})));
  return {schema:2,ids,cases,policy,policyHash:fingerprint(policy),oracleHash:fingerprint(freshOracles),budget:claimReviewBudget,candidates,
    maxCalls:candidates.length*claimReviewBudget.maxCalls,maxCompletionTokens:candidates.length*claimReviewBudget.totalCompletionTokens,
    limitations:['新编开发探针和标签由 AI 协作编写，非独立留出评测，尚无人类独立标注。','比较的是两套协议整体，v2 同时改变定位、结构与提示，不能归因于某一句提示。','模型、来源、原稿、目标和实际调用预算相同；v2 的上下文与响应结构更大，需要单独报告用量。','每例每版只运行一次，无统计显著性或可靠性优势结论；语义判断仍未独立验证。']};
}
export async function runComparison(plan,{mode='simulation',config,fetcher=fetch,onStage=async()=>{},gitRevision=null,gitDirty=null}={}) {
  if(fingerprint(plan)!==fingerprint(planComparison(plan.ids)))throw new Error('Frozen comparison plan changed');
  if(!['simulation','live'].includes(mode))throw new Error('Invalid mode');
  if(mode==='live'&&(!config?.apiKey||!config?.baseUrl||!config?.model))throw new Error('Explicit model configuration required');
  const selected=mode==='simulation'?{apiKey:'offline-only',baseUrl:'https://example.invalid',model:'offline-fixture'}:config;
  const url=new URL(selected.baseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Invalid endpoint');
  const run={schema:2,mode,model:selected.model,endpoint:selected.baseUrl,createdAt:new Date().toISOString(),gitRevision,gitDirty,plan,planHash:fingerprint(plan),candidates:[]};
  for(const planned of plan.candidates) {
    const c=plan.cases.find(c=>c.id===planned.caseId),candidate={id:planned.id,caseId:c.id,arm:planned.arm,result:null};run.candidates.push(candidate);
    const provider=mode==='simulation'?async(url,options)=>{
      const body=JSON.parse(options.body),isReview=body.messages[0].content===(planned.arm==='v1'?claimReviewPrompt:auditPrompt);
      const raw=planned.arm==='v1'?simulatedClaimReply(c,isReview?'review':'patch'):isReview?fixtureReview(c):fixturePatch(c,fixtureReview(c),JSON.parse(body.messages[1].content).selection);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}));
    }:fetcher;
    const runner=planned.arm==='v1'?runClaimReview:runClaimAudit;
    candidate.result=await runner(c.snapshot,{config:selected,fetcher:provider,onStage:async result=>{candidate.result=result;await onStage(run,candidate);}});
  }
  run.artifactHash=digest(run);return run;
}
export function inspectComparison(run) {
  if(run.schema!==2||run.planHash!==fingerprint(run.plan)||run.artifactHash!==digest(run))throw new Error('Comparison artifact hash mismatch');
  if(run.plan.policyHash!==fingerprint(run.plan.policy)||fingerprint(run.plan.budget)!==fingerprint(auditBudget))throw new Error('Policy or budget changed');
  if(run.candidates.length!==run.plan.candidates.length||new Set(run.candidates.map(c=>c.id)).size!==run.candidates.length)throw new Error('Candidate coverage mismatch');
  const rows=run.candidates.map(c=>{
    const p=run.plan.candidates.find(p=>p.id===c.id),testCase=run.plan.cases.find(t=>t.id===c.caseId),r=c.result;
    if(!p||c.arm!==p.arm||c.caseId!==p.caseId||r.snapshotHash!==fingerprint(testCase?.snapshot)||fingerprint(r.snapshot)!==r.snapshotHash)throw new Error('Candidate identity changed');
    const v2=c.arm==='v2';
    if(r.version!==(v2?'claim-audit-v2':'claim-review-v1')||fingerprint(r.budget)!==fingerprint(run.plan.budget))throw new Error('Runner version or budget changed');
    if(v2&&r.audit&&fingerprint(validateAudit(r.snapshot,r.audit.raw))!==fingerprint(r.audit))throw new Error('Audit changed');
    if(!v2&&r.review&&fingerprint(validateClaimReview(r.snapshot,{checks:r.review.checks}))!==fingerprint(r.review))throw new Error('Review changed');
    const proposed=['proposal-ready','correction-proposed','withdrawal-proposed'].includes(r.status);
    if(proposed) {
      const preview=v2?previewAuditPatch(r.snapshot,r.audit,r.proposal):previewClaimPatch(r.snapshot,r.review,r.proposal);
      if(fingerprint(preview)!==fingerprint(r.preview))throw new Error('Preview changed');
    }else if(r.preview||r.proposal)throw new Error('Uncommitted outcome has a preview');
    if(!['proposal-ready','correction-proposed','no-change-proposed','needs-source','needs-narrower-scope','no-issue-found','needs-context','failed'].includes(r.status))throw new Error('Incomplete or unexpected outcome');
    if(v2&&r.withdrawUnsupported)throw new Error('Comparison did not authorize withdrawal');
    for(const t of r.trace) {
      if(!['review','patch'].includes(t.stage))throw new Error('Unknown provider stage');
      const messages=t.stage==='review'?p.messages:v2?buildAuditPatchMessages(r.snapshot,r.audit,r.selection):buildClaimPatchMessages(r.snapshot,r.review);
      if(fingerprint(messages)!==fingerprint(t.request.messages))throw new Error('Provider context changed');
      if(t.request.model!==run.model||t.request.temperature!==run.plan.budget.temperature)throw new Error('Provider configuration changed');
      if(!Number.isInteger(t.request.max_tokens)||t.request.max_tokens<1||t.request.max_tokens>run.plan.budget.maxCompletionTokens||JSON.stringify(messages).length>run.plan.budget.maxPromptCharacters)throw new Error('Request exceeded budget');
    }
    if(r.trace.length>2||r.trace.reduce((n,t)=>n+t.request.max_tokens,0)>run.plan.budget.totalCompletionTokens)throw new Error('Exceeded call or token budget');
    const decision=v2?(r.audit?(r.audit.claims.some(c=>c.route==='needs-source')?'needs-context':r.audit.claims.some(c=>['correct','qualify'].includes(c.route))?'issue':'no-issue-found'):null):r.review?.checks[0]?.verdict||null;
    if(r.status!=='failed') {
      const expectedStatus=decision==='needs-context'?(v2?'needs-source':'needs-context'):decision==='no-issue-found'?(v2?'no-change-proposed':'no-issue-found'):
        v2&&r.audit.claims.filter(c=>['correct','qualify'].includes(c.route)).length>3?'needs-narrower-scope':v2?'correction-proposed':'proposal-ready';
      if(!decision||r.status!==expectedStatus)throw new Error('Diagnosis and execution state disagree');
    }
    return {id:c.id,caseId:c.caseId,arm:c.arm,expected:testCase.expected,decision,labelAgreement:decision===testCase.expected,status:r.status,calls:r.trace.length,proposals:r.proposal?.edits.length||0};
  });
  const totals=candidates=>{
    const trace=candidates.flatMap(c=>c.result.trace),sum=key=>trace.length&&trace.every(t=>Number.isSafeInteger(t.response?.usage?.[key])&&t.response.usage[key]>=0)?trace.reduce((n,t)=>n+t.response.usage[key],0):null;
    return {candidates:candidates.length,calls:trace.length,promptTokens:sum('prompt_tokens'),completionTokens:sum('completion_tokens'),failures:candidates.filter(c=>c.result.status==='failed').length};
  };
  return {mode:run.mode,rows,totals:totals(run.candidates),byArm:Object.fromEntries(['v1','v2'].map(arm=>[arm,totals(run.candidates.filter(c=>c.arm===arm))])),qualityConclusion:null,semanticJudgment:'unverified',limitations:run.plan.limitations};
}
export function comparisonMarkdown(run) {
  const r=inspectComparison(run);
  return `# 主张级复核协议对照\n\n${run.mode==='live'?'真实模型输出，等待独立语义复核。':'离线模拟，真实模型调用 0 次，没有质量成绩。'}\n\n| 案例 | 协议 | 参考标签 | 诊断 | 执行结果 | 调用 |\n| --- | --- | --- | --- | --- | --- |\n${r.rows.map(r=>`| ${r.caseId} | ${r.arm} | ${r.expected} | ${r.decision||'无有效诊断'} | ${r.status} | ${r.calls} |`).join('\n')}\n\n| 协议 | 调用 | 输入 tokens | 输出 tokens | 执行失败 |\n| --- | --- | --- | --- | --- |\n${Object.entries(r.byArm).map(([arm,t])=>`| ${arm} | ${t.calls} | ${t.promptTokens??'未报告'} | ${t.completionTokens??'未报告'} | ${t.failures} |`).join('\n')}\n\n${r.limitations.map(l=>`- ${l}`).join('\n')}\n`;
}
const prose=text=>renderNoteHTML({type:'doc',content:noteBlocks(text)});
export function comparisonHTML(run) {
  const report=inspectComparison(run);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>主张级复核 · 协议对照</title><style>
*{box-sizing:border-box}body{background:#f4f2ea;color:#293d32;font:16px/1.9 system-ui,sans-serif;margin:0}main{max-width:1280px;margin:40px auto;padding:0 28px}article{background:#fffefa;border:1px solid #dfe3d6;border-radius:16px;padding:24px;margin:28px 0}h1{font-size:30px}h2{font-size:21px}h3{font-size:16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:28px}.pair>div{min-width:0}.label{font-size:13px;color:#68776a}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.8 ui-monospace,monospace}summary{cursor:pointer}blockquote{margin:10px 0;padding:8px 16px;border-left:3px solid #9caf92;background:#f2f5ee}.math-inline{display:inline-block;vertical-align:baseline;max-width:100%;overflow-x:auto}.math-display{display:block;max-width:100%;overflow-x:auto;text-align:center;margin:1em 0}.math-render mjx-container{margin:0!important}p{overflow-wrap:break-word}@media(max-width:760px){.pair{grid-template-columns:1fr}main{padding:0 14px}article{padding:18px}}
</style><main><h1>主张级复核 · 协议对照</h1><p>${run.mode==='live'?'真实模型候选，语义尚未独立审定。':'离线模拟，真实模型调用 0 次。'}引用匹配、范围校验和算术检查分别记录，原稿保留。</p><p class="label">${esc(run.model)} · ${report.totals.calls} 次${run.mode==='live'?'真实':'模拟'}请求 · 输入 ${report.totals.promptTokens??'未报告'} / 输出 ${report.totals.completionTokens??'未报告'} tokens</p>
${run.plan.cases.map(testCase=>`<article><h2>${esc(testCase.id)}</h2><p class="label">开发参考（AI 编写）：${esc(testCase.expected)}</p><h3>原稿</h3>${testCase.snapshot.blocks.filter(b=>testCase.snapshot.targetIds.includes(b.id)).map(b=>prose(b.text)).join('')}<div class="pair">${['v1','v2'].map(arm=>{
  const c=run.candidates.find(c=>c.caseId===testCase.id&&c.arm===arm),r=c.result;
  return `<div data-candidate="${esc(c.id)}"><h3>${arm==='v1'?'v1 · 段落级判断':'v2 · 主张与前提'}</h3><p class="label">${esc(r.status)} · ${r.trace.length} 次请求</p>${r.preview?r.preview.blocks.filter(b=>r.preview.targetIds.includes(b.id)).map(b=>prose(b.text)).join(''):'<p>原稿保持不变。</p>'}
${(r.audit?.claims||[]).map(claim=>`<details><summary>${esc(claim.support.kind)} → ${esc(claim.route)}</summary><blockquote>${prose(claim.text)}</blockquote><p>${esc(claim.support.reason)}</p><pre>${esc(JSON.stringify({premises:claim.premises,support:claim.support,arithmetic:claim.arithmetic},null,2))}</pre></details>`).join('')}
${(r.review?.checks||[]).map(check=>`<blockquote>${prose(check.claim)}</blockquote><p>${esc(check.reason)}</p>`).join('')}
${r.error?`<p>${esc(r.error.stage)} / ${esc(r.error.code)}</p>`:''}<details class="provider-trace"><summary>实际请求与原始响应</summary>${r.trace.map(t=>`<h3>${esc(t.stage)}</h3><pre>${esc(t.response?.choices?.[0]?.message?.content??'没有响应正文')}</pre><details><summary>发送的上下文</summary><pre>${esc(JSON.stringify(t.request.messages,null,2))}</pre></details>`).join('')}</details></div>`;
}).join('')}</div><details><summary>完整来源与开发参考</summary><pre>${esc(testCase.snapshot.source[0].text)}</pre><p>${esc(testCase.reference.reason)}</p><p>${esc(testCase.reference.counterexample||'')}</p></details></article>`).join('')}<p>${report.limitations.map(esc).join(' ')}</p></main></html>`;
}
