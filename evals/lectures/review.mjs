import {randomInt} from 'node:crypto';
import {escapeHTML as escape, renderNoteHTML} from '../../shared/note-html.mjs';
import {textOf} from '../../shared/document.mjs';
import {hash} from './experiment.mjs';

export function createCourseReview(plan,results,oracle,{reverse=randomInt(2)===1}={}) {
  const order=reverse?[...results].reverse():results;
  const mapping=order.map((r,i)=>({label:String.fromCharCode(65+i),arm:r.arm,resultHash:hash(r)}));
  const packet={schema:'course-review-v1',planId:plan.id,mode:results.every(r=>r.mode==='simulation')?'simulation':'live',title:plan.testCase.title,
    goal:plan.testCase.intent,sources:plan.testCase.sources,oracle,
    candidates:order.map((r,i)=>({label:mapping[i].label,resultHash:hash(r),status:r.status,
      chapters:r.document?.chapters.map(c=>({id:c.id,title:c.title,content:c.content}))||[]}))};
  const review={schema:'course-ratings-v1',planId:plan.id,packetHash:hash(packet),reviewer:null,reviewerKind:null,
    candidates:packet.candidates.map(c=>({label:c.label,resultHash:c.resultHash,checks:oracle.required.map(check=>({id:check.id,verdict:null,noteQuotes:[],sourceRefs:[],reason:''})),transfer:oracle.transfer.map(q=>({id:q.id,supported:null,reason:''}))})),
    preference:null,reason:''};
  return {packet,mapping,review};
}

export function validateCourseRatings(packet,review) {
  if(review.planId!==packet.planId||review.packetHash!==hash(packet))throw new Error('Review does not match this packet');
  if(!review.reviewer?.trim()||!['human','assistant'].includes(review.reviewerKind))throw new Error('Identify reviewer and reviewer kind');
  if(review.candidates.length!==packet.candidates.length||new Set(review.candidates.map(c=>c.label)).size!==packet.candidates.length)throw new Error('Review every candidate once');
  const sourceRefs=new Set(packet.sources.flatMap(s=>s.pages.map((_,i)=>`${s.id}:${i+1}`)));
  for(const candidate of review.candidates) {
    const original=packet.candidates.find(c=>c.label===candidate.label);
    if(!original||candidate.resultHash!==original.resultHash)throw new Error('Candidate changed');
    const prose=original.chapters.map(c=>textOf(c.content)).join('\n');
    if(candidate.checks.length!==packet.oracle.required.length||new Set(candidate.checks.map(c=>c.id)).size!==candidate.checks.length)throw new Error('Missing or duplicate criteria');
    for(const check of candidate.checks) {
      if(!packet.oracle.required.some(c=>c.id===check.id)||!['met','partial','missing','incorrect','unassessable'].includes(check.verdict)||!check.reason?.trim())throw new Error('Incomplete quality judgment');
      if(!Array.isArray(check.noteQuotes)||check.noteQuotes.some(q=>!q.trim()||!prose.includes(q)))throw new Error('Review quote is absent from actual prose');
      if(['met','partial','incorrect'].includes(check.verdict)&&!check.noteQuotes.length)throw new Error('Judgment requires actual prose');
      if(!check.sourceRefs?.length||check.sourceRefs.some(id=>!sourceRefs.has(id)))throw new Error('Review requires valid source locations');
    }
    if(candidate.transfer.length!==packet.oracle.transfer.length||new Set(candidate.transfer.map(c=>c.id)).size!==candidate.transfer.length||candidate.transfer.some(c=>!packet.oracle.transfer.some(q=>q.id===c.id)||!['yes','partial','no','unassessable'].includes(c.supported)||!c.reason?.trim()))throw new Error('Incomplete transfer review');
  }
  if(!['A','B','tie','neither','unassessable'].includes(review.preference)||!review.reason?.trim())throw new Error('Explain the preference');
  return {status:packet.mode==='simulation'?'simulation-only':review.reviewerKind==='human'?'human-reviewed':'assistant-reviewed-awaiting-human',preference:review.preference,
    statisticalAdvantageEstablished:false,learningOutcomesMeasured:false};
}

export function reviewHTML(packet) {
  const prose=packet.candidates.map(c=>`<article id="${c.label}"><h2>版本 ${c.label}</h2><p class="status">${escape(c.status==='complete'?'全文生成完成；内容待评审':'未完整生成；保留已完成正文')}</p>${c.chapters.map((chapter,i)=>`<section><h3>${i+1}. ${escape(chapter.title)}</h3><div class="note-prose">${renderNoteHTML(chapter.content)}</div></section>`).join('')}</article>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><title>完整讲义对照</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f6f5f0;color:#27352e;font:16px/1.9 "Microsoft YaHei",sans-serif}header,aside{max-width:1040px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.45}h1{font-size:30px}nav a{display:inline-block;padding:8px 22px;margin:8px;background:#345c47;color:white;border-radius:6px;text-decoration:none}.columns{display:grid;grid-template-columns:1fr 1fr;gap:28px;max-width:1680px;margin:auto;padding:20px 32px}article{min-width:0;background:#fffefa;border:1px solid #e0e2d6;border-radius:14px;padding:32px 40px}section{padding-block:8px;border-top:1px solid #e5e6df}.status,summary{color:#616b62}p{overflow-wrap:anywhere}pre{white-space:pre-wrap}.math-display{display:block;overflow-x:auto;text-align:center;margin:18px 0}.math-inline{display:inline-block;max-width:100%;vertical-align:middle}.math-render svg{max-width:100%;height:auto}.note-prose{line-height:1.9}.note-prose p{margin:14px 0}details{margin:16px 0}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #ddd;padding:10px}@media(max-width:1100px){.columns{display:block;max-width:900px;padding:16px}article{padding:24px;margin-bottom:24px}}@media print{.columns{display:block}article{break-before:page;border:0}nav{display:none}body{background:white}}
  </style></head><body><header><p>CANDLELIGHT NOTES · 完整讲义对照</p><h1>${escape(packet.title)}</h1><p>${escape(packet.goal)}</p><p>${packet.mode==='simulation'?'本页为离线模拟，不含真实模型结果。':'A/B 隐藏运行版本；两份正文均未经人工润色。一次小样本对照不证明稳定优势。'}</p><nav><a href="#A">阅读 A</a><a href="#B">阅读 B</a><a href="#criteria">评审依据</a></nav></header><main class="columns">${prose}</main><aside id="criteria"><h2>如何评审</h2><p>${escape(packet.oracle.instruction)}</p><ol>${packet.oracle.required.map(c=>`<li><b>${escape(c.id)}</b>：${escape(c.question)}</li>`).join('')}</ol><details><summary>迁移问题与核对答案（未提供给生成模型）</summary>${packet.oracle.transfer.map(q=>`<p><b>${escape(q.question)}</b><br>${escape(q.answer)}</p>`).join('')}</details><details><summary>展开全部来源</summary>${packet.sources.map(s=>`<h3>${escape(s.title)}</h3>${s.pages.map((p,i)=>`<p><b>${escape(s.id)}:${i+1}</b> ${escape(p)}</p>`).join('')}`).join('')}</details><p>填写 review.template.json；审阅者身份、引文与来源均需记录。assistant 评审不会计为独立人工验收。</p></aside></body></html>`;
}

export function costHTML(plan,results,mapping) {
  const number=v=>v==null?'未报告':Number(v).toLocaleString('zh-CN');
  const rows=results.flatMap(result=>result.usage.stages.map(stage=>`<tr><td>${escape(mapping.find(m=>m.arm===result.arm)?.label||result.arm)}</td><td>${escape(stage.stage)}</td><td>${number(stage.calls)}</td><td>${number(stage.promptTokens)}</td><td>${number(stage.completionTokens)}</td><td>${number(stage.cacheHitTokens)}</td><td>${number(Math.round(stage.elapsedMs/1000))}</td></tr>`)).join('');
  const summary=results.map(r=>({arm:r.arm,version:r.runtime.version,status:r.status,chapters:r.chapters.length,usage:r.usage,elapsedSeconds:Math.round(r.elapsedMs/1000),failure:r.failure,context:r.trace.map(t=>({call:t.call,stage:t.stage,phase:t.phase,chapter:t.chapter,parts:t.context}))}));
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>讲义调用账单</title><style>body{font:15px/1.7 system-ui;margin:40px;color:#25352b}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:26px}</style><h1>调用与上下文账单</h1><p>包含失败、重试、分析和审查调用。缺失 token 保持未知；不推算货币费用。字数与输入字符仅供诊断，不代表质量。运行预算仅适用于这次独立评测，不改变产品恢复逻辑。</p><table><tr><th>匿名版本</th><th>阶段</th><th>调用</th><th>输入 token</th><th>输出 token</th><th>缓存命中 token</th><th>秒</th></tr>${rows}</table><details><summary>揭晓版本并查看详细上下文体量</summary><pre>${escape(JSON.stringify({mapping,budget:plan.budget,summary},null,2))}</pre></details>`;
}
