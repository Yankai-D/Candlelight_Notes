import { z } from 'zod';
import { hash } from './experiment.mjs';
import { inspectRun } from './diagnostics.mjs';
import { createReview, summarizeReview, rubric } from './review.mjs';

export const regressionPolicy = z.object({
  version: z.literal(1).default(1), maxInputRatio: z.number().finite().min(1).default(1.25),
  maxOutputRatio: z.number().finite().min(1).default(1.25), maxLatencyRatio: z.number().finite().min(1).default(1.5),
  maxCostRatio: z.number().finite().min(1).default(1.25), allowedScoreDrop: z.number().min(0).max(4).default(0), minimumScore: z.number().min(0).max(4).default(3),
}).strict();
export const regressionPrices = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  model: z.string().min(1), baseUrl: z.string().url(), inputPerMillion: z.number().finite().nonnegative(),
  outputPerMillion: z.number().finite().nonnegative(), cacheHitInputPerMillion: z.number().finite().nonnegative().optional(),
}).strict();
const validToken = value => Number.isSafeInteger(value) && value >= 0;
const total = (items, key) => items.every(item => Number.isFinite(item[key])) ? items.reduce((n,item) => n + item[key], 0) : null;
const percentile = (values, fraction) => {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) return null;
  const sorted = [...values].sort((a,b) => a - b); return sorted[Math.ceil(sorted.length * fraction) - 1];
};
const endpoint = value => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid benchmark endpoint');
  return url.href.replace(/\/+$/, '');
};
function contract(run) {
  return { scope: run.plan.scope, budget: run.plan.budget, repeats: run.plan.repeats, arms: run.plan.selectedArms.slice().sort(),
    cases: run.plan.cases.map(item => {
      const { learning, ...request } = item.request;
      const { writingTemplate: _template, ...settings } = learning;
      return { id: item.id, request, learning: settings, criteria: item.material.criteria, split: item.material.split };
    }).sort((a,b) => a.id.localeCompare(b.id)) };
}
function cost(trace, prices) {
  if (!prices) return null;
  let amount = 0;
  for (const item of trace) {
    const usage = item.response?.usage;
    if (!validToken(usage?.prompt_tokens) || !validToken(usage?.completion_tokens)) return null;
    let input = usage.prompt_tokens * prices.inputPerMillion;
    if (prices.cacheHitInputPerMillion !== undefined) {
      const hit = usage.prompt_cache_hit_tokens, miss = usage.prompt_cache_miss_tokens;
      if (!validToken(hit) || !validToken(miss) || hit + miss !== usage.prompt_tokens) return null;
      input = hit * prices.cacheHitInputPerMillion + miss * prices.inputPerMillion;
    }
    amount += (input + usage.completion_tokens * prices.outputPerMillion) / 1e6;
  }
  return amount;
}
function measure(candidate, prices) {
  const trace = candidate.trace, stages = new Map();
  const tokens = key => trace.every(item => validToken(item.response?.usage?.[key])) ? trace.reduce((sum,item) => sum + item.response.usage[key], 0) : null;
  for (const item of trace) {
    const stage = item.stage || 'unclassified-legacy';
    if (!stages.has(stage)) stages.set(stage, { stage, calls: 0, reportedCalls: 0, inputTokens: 0, outputTokens: 0 });
    const row = stages.get(stage); row.calls++;
    const usage = item.response?.usage;
    if (validToken(usage?.prompt_tokens) && validToken(usage?.completion_tokens)) row.reportedCalls++;
    if (validToken(usage?.prompt_tokens)) row.inputTokens += usage.prompt_tokens;
    if (validToken(usage?.completion_tokens)) row.outputTokens += usage.completion_tokens;
  }
  return { status: candidate.status, calls: trace.length, reportedCalls: trace.filter(item => validToken(item.response?.usage?.prompt_tokens) && validToken(item.response?.usage?.completion_tokens)).length,
    inputTokens: tokens('prompt_tokens'), outputTokens: tokens('completion_tokens'), estimatedCost: cost(trace, prices),
    elapsedMs: Number.isFinite(candidate.elapsedMs) && candidate.elapsedMs >= 0 ? candidate.elapsedMs : null,
    recoveryActions: (candidate.events || []).filter(e => e.phase === 'execution' && e.status === 'recovering').length,
    stages: [...stages.values()], errorCode: candidate.error?.code || null };
}

export function compareNoteRuns(baseline, candidate, { baselineReview, candidateReview, policy = {}, prices, arms = ['harness'] } = {}) {
  const before = inspectRun(baseline), after = inspectRun(candidate);
  if (before.missingCandidates.length || after.missingCandidates.length || !before.recordedLimitsPassed || !after.recordedLimitsPassed) throw new Error('Incomplete or out-of-contract run; retain it for diagnosis, not a paired benchmark');
  if (baseline.mode !== candidate.mode || baseline.model !== candidate.model || endpoint(baseline.baseUrl) !== endpoint(candidate.baseUrl)) throw new Error('Paired benchmark requires the same mode, model and endpoint');
  if (hash(contract(baseline)) !== hash(contract(candidate))) throw new Error('Sources, task, learner, criteria, case matrix or evaluation budget changed; create a new benchmark');
  if (!arms.length || new Set(arms).size !== arms.length || arms.some(arm => !baseline.plan.selectedArms.includes(arm))) throw new Error('Invalid benchmark arms');
  const policySnapshot = regressionPolicy.parse(policy), priceSnapshot = prices ? regressionPrices.parse(prices) : null;
  if (priceSnapshot && (priceSnapshot.model !== candidate.model || endpoint(priceSnapshot.baseUrl) !== endpoint(candidate.baseUrl))) throw new Error('Price sheet belongs to a different provider/model');
  const reviews = [baselineReview, candidateReview], runs = [baseline, candidate];
  const quality = runs.map((run,index) => summarizeReview(run, reviews[index] || createReview(run).review));
  const reviewed = quality.every(q => q.status === 'human-reviewed') && reviews.every(review => review?.rubricHash === hash(rubric));
  const findings = runIndex => {
    if (!reviewed) return new Map();
    const mapping = createReview(runs[runIndex]).mapping;
    return new Map(reviews[runIndex].records.map(record => [mapping[record.id], record]));
  };
  const oldReviews = findings(0), newReviews = findings(1), flags = [], rows = [];
  for (const right of candidate.candidates.filter(c => arms.includes(c.arm))) {
    const left = baseline.candidates.find(c => c.id === right.id);
    const a = measure(left, priceSnapshot), b = measure(right, priceSnapshot), ratios = {};
    if (b.status !== 'accepted') flags.push({ id: right.id, kind: 'delivery-failed', before: a.status, after: b.status });
    // Failed partial work may be cheap. Never report its cost as a saving.
    if (a.status === 'accepted' && b.status === 'accepted') for (const [metric, threshold] of [['inputTokens','maxInputRatio'],['outputTokens','maxOutputRatio'],['elapsedMs','maxLatencyRatio'],['estimatedCost','maxCostRatio']]) {
      ratios[metric] = a[metric] > 0 && Number.isFinite(b[metric]) ? b[metric] / a[metric] : null;
      if (ratios[metric] > policySnapshot[threshold] || a[metric] === 0 && b[metric] > 0) flags.push({ id: right.id, kind: metric, before: a[metric], after: b[metric], threshold: policySnapshot[threshold] });
    }
    let ratings = null;
    if (reviewed && b.status === 'accepted') {
      const next = newReviews.get(right.id);
      if (next.criticalReview === 'issues') flags.push({ id: right.id, kind: 'critical-content-error', count: next.criticalErrors.length });
      for (const d of rubric) if (next.ratings[d.id].score < policySnapshot.minimumScore) flags.push({ id: right.id, kind: 'quality-below-standard', dimension: d.id, score: next.ratings[d.id].score });
    }
    if (reviewed && a.status === 'accepted' && b.status === 'accepted') {
      const old = oldReviews.get(left.id), next = newReviews.get(right.id);
      ratings = Object.fromEntries(rubric.map(d => [d.id, { before: old.ratings[d.id].score, after: next.ratings[d.id].score }]));
      for (const [dimension, score] of Object.entries(ratings)) if (score.after < score.before - policySnapshot.allowedScoreDrop) flags.push({ id: right.id, kind: 'quality-drop', dimension, ...score });
    }
    rows.push({ id: right.id, arm: right.arm, caseId: right.caseId, baseline: a, candidate: b, ratios, ratings,
      promptChanged: left.promptHash !== right.promptHash });
  }
  if (reviewed) for (const pair of quality[1].profilePairs || []) if (arms.includes(pair.arm) && ['stableVoice','preservedFacts','appropriateDepth'].some(key => pair[key] === false)) flags.push({ id: pair.id, kind: 'profile-consistency' });
  const metricsComplete = rows.every(row => [row.baseline, row.candidate].every(value => value.inputTokens !== null && value.outputTokens !== null && value.elapsedMs !== null && (!priceSnapshot || value.estimatedCost !== null)));
  const summarize = key => { const values = rows.map(row => row[key]); return { cases: values.length, accepted: values.filter(v => v.status === 'accepted').length, calls: total(values, 'calls'),
    inputTokens: total(values, 'inputTokens'), outputTokens: total(values, 'outputTokens'), estimatedCost: priceSnapshot ? total(values, 'estimatedCost') : null,
    p50Ms: percentile(values.map(v => v.elapsedMs), .5), p95Ms: percentile(values.map(v => v.elapsedMs), .95) }; };
  return { schema: 'note-quality-cost-regression-v1', createdAt: new Date().toISOString(), mode: candidate.mode,
    status: candidate.mode === 'simulation' ? 'simulation-only' : flags.length ? 'needs-attention' : !reviewed ? 'awaiting-human-review' : !metricsComplete ? 'incomplete-usage' : 'no-observed-regression',
    contractHash: hash(contract(candidate)), rubricHash: hash(rubric), policy: policySnapshot, policyHash: hash(policySnapshot), prices: priceSnapshot,
    comparedArms: arms, model: candidate.model, endpoint: endpoint(candidate.baseUrl),
    baseline: { id: baseline.id, artifactHash: baseline.artifactHash, revision: baseline.gitRevision || null, planHash: baseline.planHash, ...summarize('baseline') },
    candidate: { id: candidate.id, artifactHash: candidate.artifactHash, revision: candidate.gitRevision || null, planHash: candidate.planHash, ...summarize('candidate') },
    quality: { reviewed, baseline: quality[0].status, candidate: quality[1].status, conclusion: null }, metricsComplete, flags, rows,
    limitations: ['当前公开开发材料不等于独立留出集；人工评分不自动代表独立专家评测。', '金额仅按显式提供的同一价格表估算；未报告用量保持未知，不把失败的低用量当成节省。',
      'P50/P95 为当前配对样本的最近秩描述统计，不代表线上分布或统计显著性。', '相同模型名称不能锁定供应商内部权重。首次索引与索引复用须另行固定条件测试；本套单章对照不证明整学期讲义的费用或质量。',
      '继承冻结运行的范围：当前 product-scenarios 比较固定模板、单章正文及格式恢复，不覆盖规划、自动路由、异常语义审查或全文衔接。'] };
}

const escape = value => String(value ?? '未知').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function regressionHTML(report) {
  const display = value => value == null ? '未知' : Number.isInteger(value) ? value.toLocaleString('en-US') : Number(value.toFixed(6)).toString();
  const pair = (row, key) => `${display(row.baseline[key])} → ${display(row.candidate[key])}`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>烛光笔记 · 质量与成本回归</title><style>body{font:15px/1.8 system-ui,sans-serif;background:#fafaf6;color:#253b2c;margin:32px auto;padding:0 24px;max-width:1200px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;border-bottom:1px solid #d9dfd4;padding:9px;overflow-wrap:anywhere}section{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf0e7;padding:16px}summary{cursor:pointer}small{color:#596454}</style><h1>质量与成本回归</h1><p>${report.mode === 'simulation' ? '离线模拟 · 不产生模型质量结论' : '真实记录对照 · 人工内容审阅与资源记录分别核对'}</p><p>状态：<strong>${escape(report.status)}</strong> · 方法：${report.comparedArms.map(escape).join('、')}</p><p>基线 ${escape(report.baseline.id)} → 当前 ${escape(report.candidate.id)}</p><p>交付 ${report.baseline.accepted}/${report.baseline.cases} → ${report.candidate.accepted}/${report.candidate.cases}；P50 ${display(report.baseline.p50Ms)} → ${display(report.candidate.p50Ms)} ms；P95 ${display(report.baseline.p95Ms)} → ${display(report.candidate.p95Ms)} ms。</p><p>内容审阅：${report.quality.reviewed ? '两轮已完成带正文依据的评分' : '尚未完成，不能据此通过质量验收'}。${report.prices ? `估算币种 ${escape(report.prices.currency)}，价格表日期 ${escape(report.prices.asOf)}` : '未提供价格表，只比较实际报告的 token。'}</p><section><table><thead><tr><th>案例</th><th>交付</th><th>调用</th><th>输入</th><th>输出</th><th>耗时 ms</th><th>估算金额</th></tr></thead><tbody>${report.rows.map(row => `<tr><td>${escape(row.id)}</td><td>${escape(row.baseline.status)} → ${escape(row.candidate.status)}</td><td>${pair(row,'calls')}</td><td>${pair(row,'inputTokens')}</td><td>${pair(row,'outputTokens')}</td><td>${pair(row,'elapsedMs')}</td><td>${pair(row,'estimatedCost')}</td></tr>`).join('')}</tbody></table></section><h2>需要核对的变化</h2><pre>${escape(JSON.stringify(report.flags,null,2))}</pre>${report.rows.map(row => `<details><summary>${escape(row.id)} · 阶段用量与内容评分</summary><pre>${escape(JSON.stringify({ baseline: row.baseline.stages, candidate: row.candidate.stages, ratings: row.ratings },null,2))}</pre></details>`).join('')}<h2>范围</h2><ul>${report.limitations.map(item => `<li>${escape(item)}</li>`).join('')}</ul><details><summary>冻结的验收规则</summary><pre>${escape(JSON.stringify({ policy:report.policy,contractHash:report.contractHash,rubricHash:report.rubricHash },null,2))}</pre></details></html>`;
}
