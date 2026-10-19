import { hash, artifactHash, experimentLimitations } from './experiment.mjs';

// Read-only inspection: no provider, credentials, model judge or quality score.
// Use the wire trace, not runner events: the evaluation meter can reduce the
// runner's requested maxTokens before the request reaches the provider.
export function inspectRun(run) {
  if (run.planHash !== hash(run.plan) || run.artifactHash !== artifactHash(run)) throw new Error('Run artifact hash mismatch');
  const expected = new Set(run.plan.cases.flatMap(c => Array.from({length:run.plan.repeats}, (_,i) => run.plan.selectedArms.map(arm => `${c.id}/${i+1}/${arm}`)).flat()));
  const seen = new Set();
  const candidates = run.candidates.map(c => {
    if (!expected.has(c.id) || seen.has(c.id) || c.id !== `${c.caseId}/${c.repeat}/${c.arm}` || !['accepted','failed'].includes(c.status)) throw new Error('Unknown, duplicate or unfinished candidate');
    seen.add(c.id);
    const violations = [];
    if (c.trace.length > run.plan.budget.maxCalls) violations.push('call-limit');
    let charged = 0;
    const attempts = c.trace.map((t,i) => {
      const ceiling = t.request.max_tokens;
      if (!Number.isSafeInteger(ceiling) || ceiling < 1 || ceiling > run.plan.budget.maxCompletionTokens) violations.push(`attempt-${i+1}:request-limit`);
      if (ceiling > run.plan.budget.totalCompletionTokens-charged) violations.push(`attempt-${i+1}:reservation-limit`);
      if (JSON.stringify(t.request.messages).length > run.plan.budget.maxPromptCharacters) violations.push(`attempt-${i+1}:context-limit`);
      const actual = t.response?.usage?.completion_tokens;
      const known = Number.isSafeInteger(actual) && actual >= 0;
      // Unknown usage retains the entire reservation; a reported overrun is
      // not clamped or hidden from the diagnostic.
      charged += known ? actual : ceiling;
      if (known && actual > ceiling) violations.push(`attempt-${i+1}:reported-overrun`);
      const completion = (c.events || []).filter(e => !e.repair)[i];
      return {call:i+1,status:t.status,httpStatus:t.httpStatus ?? null,
        requestedMaxTokens:completion?.maxTokens ?? null,effectiveMaxTokens:ceiling,
        providerModel:t.response?.model ?? null,finishReason:t.response?.choices?.[0]?.finish_reason ?? null,
        promptTokens:token(t,'prompt_tokens'),completionTokens:token(t,'completion_tokens'),elapsedMs:t.elapsedMs};
    });
    if (charged > run.plan.budget.totalCompletionTokens) violations.push('total-output-limit');
    return {id:c.id,arm:c.arm,status:c.status,errorCode:c.error?.code ?? null,
      attempts,usage:{calls:c.trace.length,promptTokens:total(attempts,'promptTokens'),completionTokens:total(attempts,'completionTokens')},
      reservedOrReportedCompletionTokens:charged,repairEvents:(c.events||[]).filter(e=>e.repair).length,
      truncatedResponses:attempts.filter(t=>t.finishReason==='length').length,
      quotesRemoved:c.evidence?.quotesRemoved ?? null,elapsedMs:c.elapsedMs,violations};
  });
  const aggregate = values => ({candidates:values.length,accepted:values.filter(c=>c.status==='accepted').length,failed:values.filter(c=>c.status==='failed').length,
    calls:values.reduce((n,c)=>n+c.usage.calls,0),promptTokens:total(values.map(c=>c.usage),'promptTokens'),completionTokens:total(values.map(c=>c.usage),'completionTokens'),
    repairEvents:values.reduce((n,c)=>n+c.repairEvents,0),truncatedResponses:values.reduce((n,c)=>n+c.truncatedResponses,0),
    elapsedMs:total(values,'elapsedMs')});
  return {version:'note-diagnostics-v1',runId:run.id,artifactHash:run.artifactHash,mode:run.mode,model:run.model,
    gitRevision:run.gitRevision ?? null,gitDirty:run.gitDirty ?? null,
    scope:run.plan.scope,qualityConclusion:null,
    plannedCandidates:expected.size,missingCandidates:[...expected].filter(id=>!seen.has(id)),
    recordedLimitsPassed:candidates.every(c=>!c.violations.length),budget:run.plan.budget,
    totals:aggregate(candidates),byArm:Object.fromEntries(run.plan.selectedArms.map(arm=>[arm,aggregate(candidates.filter(c=>c.arm===arm))])),candidates,
    limitations:['结构接受不代表内容正确；来源引文存在不代表支持段落。',
      '用量缺失保持 null；保留额度不是实际消耗。无价格换算或质量分数。',
      '请求上限读取实际发送的 trace.request；runner 的 maxTokens 只是裁剪前的请求值。',
      '小样本耗时包含网络、缓存与服务时段影响，不能归因为模型或 harness 的固有速度。',
      ...experimentLimitations(run.plan)]};
}

const token = (trace,key) => Number.isSafeInteger(trace.response?.usage?.[key]) && trace.response.usage[key] >= 0 ? trace.response.usage[key] : null;
const total = (values,key) => values.length && values.every(v=>Number.isSafeInteger(v[key]) && v[key]>=0) ? values.reduce((n,v)=>n+v[key],0) : null;
const display = value => value === null ? '未知' : String(value);
export function diagnosticsMarkdown(report) {
  return `# 笔记对照运行诊断\n\n${report.mode==='live'?'真实调用':'离线模拟'}；只汇总交付、边界和资源记录，不产生教学质量结论。\n\n运行：\`${report.runId}\`；模型：\`${report.model}\`；版本：\`${report.gitRevision ?? '未知'}\`。\n\n计划 ${report.plannedCandidates} 份，已记录 ${report.totals.candidates} 份，缺少 ${report.missingCandidates.length} 份。记录中的调用与输出限制${report.recordedLimitsPassed?'通过':'存在越界'}。\n\n| 方法 | 接受 / 总数 | 请求 | 输入 token | 输出 token | 格式修复 | 截断响应 | 本机累计耗时 ms |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${Object.entries(report.byArm).map(([arm,a])=>`| ${arm} | ${a.accepted} / ${a.candidates} | ${a.calls} | ${display(a.promptTokens)} | ${display(a.completionTokens)} | ${a.repairEvents} | ${a.truncatedResponses} | ${display(a.elapsedMs)} |`).join('\n')}\n\n实际每次请求输出上限：${[...new Set(report.candidates.flatMap(c=>c.attempts.map(a=>a.effectiveMaxTokens)))].join('、')}。\n\n${report.limitations.map(v=>`- ${v}`).join('\n')}\n`;
}

// This only verifies attachment to actual text. It must not certify an AI's
// semantic interpretation as independent human review.
export function validateFindings(run, findings) {
  inspectRun(run);
  if (findings.version !== 'note-findings-v1' || findings.runId !== run.id || findings.artifactHash !== run.artifactHash || findings.reviewKind !== 'ai-preliminary' || findings.independentReview !== 'pending') throw new Error('Findings require matching run and explicit provisional provenance');
  if (!Array.isArray(findings.findings) || !findings.findings.length) throw new Error('Missing findings');
  const ids = new Set();
  for (const finding of findings.findings) {
    if (!finding.id || ids.has(finding.id)) throw new Error('Duplicate finding');
    ids.add(finding.id);
    if (!finding.reason || !finding.hypothesis || !finding.counterRisk || !finding.verification) throw new Error('Incomplete finding');
    if (!finding.noteEvidence?.length || !finding.sourceEvidence?.length) throw new Error('Missing finding evidence');
    for (const evidence of finding.noteEvidence) {
      const candidate = run.candidates.find(c=>c.id===evidence.candidateId);
      const block = candidate?.result?.blocks[evidence.block-1];
      const text = [block?.text,...(block?.items||[])].filter(Boolean).join('\n');
      if (typeof evidence.quote !== 'string' || evidence.quote.trim().length < 6 || !text.includes(evidence.quote)) throw new Error('Note evidence is not present');
      if (evidence.attachedSourceQuote !== undefined && evidence.attachedSourceQuote !== block.sourceQuote) throw new Error('Attached source quote does not match');
    }
    for (const evidence of finding.sourceEvidence) {
      const testCase = run.plan.cases.find(c=>c.id===evidence.caseId);
      const page = testCase?.request.document.pages.find(p=>p.number===evidence.page);
      if (typeof evidence.quote !== 'string' || evidence.quote.trim().length < 6 || !page?.text.includes(evidence.quote)) throw new Error('Source evidence is not present');
    }
  }
  return {status:'evidence-linked',semanticJudgment:'unverified',findings:findings.findings.length};
}
