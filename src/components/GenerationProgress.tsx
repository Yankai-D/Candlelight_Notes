import { useEffect, useState } from 'react'
import { generationStageLabel } from '../../shared/generation-progress.mjs'

export type GenerationProgressValue = {
  startedAt: number; updatedAt: number; state: string; stage?: string; phase?: string;
  chapter?: { title: string; done: number; total: number }; unavailable: boolean; observed: boolean;
  requests: number; reportedCalls: number; inputTokens: number; outputTokens: number;
  cacheHitTokens: number; cacheReportedCalls: number; repairs: number; indexReused: number;
  stages: { stage: string; requests: number; reportedCalls: number; inputTokens: number; outputTokens: number }[];
}
export function GenerationProgress({ value }: { value: GenerationProgressValue }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (value.state !== 'running') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [value.state, value.startedAt])
  const seconds = Math.max(0, Math.floor(((value.state === 'running' ? now : value.updatedAt) - value.startedAt) / 1000))
  const elapsed = seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`
  const status = value.state === 'running' ? value.unavailable ? '进度暂不可用，生成仍在继续' : generationStageLabel(value.stage)
    : value.state === 'complete' ? '本次处理完成' : value.state === 'paused' ? '本次已暂停' : '本次已停止'
  const unknown = Math.max(0, value.requests - value.reportedCalls)
  return <details className="generation-progress">
    <summary><span role="status">{status}</span><span>{elapsed}{value.observed && ` · ${value.requests} 次调用`}</span></summary>
    {value.chapter && <p>已完成 {value.chapter.done}/{value.chapter.total} 章 · {value.chapter.title}</p>}
    {value.observed ? <>
      <div className="generation-usage"><span>已报告输入 <strong>{value.inputTokens.toLocaleString()}</strong></span><span>已报告输出 <strong>{value.outputTokens.toLocaleString()}</strong></span></div>
      <p>{value.reportedCalls}/{value.requests} 次调用已报告完整用量{unknown > 0 && `，其余 ${unknown} 次尚未报告（含进行中或失败的请求）。`}</p>
      {(value.repairs > 0 || value.indexReused > 0 || value.cacheReportedCalls > 0) && <p>修复动作 {value.repairs} 次 · 复用资料片段 {value.indexReused} 个{value.cacheReportedCalls > 0 && ` · 已报告缓存命中 ${value.cacheHitTokens.toLocaleString()} token`}</p>}
      {value.stages.length > 0 && <table><thead><tr><th>阶段</th><th>调用</th><th>输入 / 输出 token</th></tr></thead><tbody>{value.stages.map(row => <tr key={row.stage}><td>{generationStageLabel(row.stage)}</td><td>{row.requests}</td><td>{row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()}{row.reportedCalls < row.requests && '（未齐）'}</td></tr>)}</tbody></table>}
    </> : <p>{value.state === 'running' ? '正在等待服务报告进度。' : '本次未取得实时用量，可在生成记录中核对。'}</p>}
    <p className="generation-usage-note">仅统计最近收到的进度；用量随模型响应更新，进行中的请求不会逐 token 更新，未报告部分不计入。费用以服务账单为准。</p>
  </details>
}
