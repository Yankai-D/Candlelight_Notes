export const generationStageLabels = {
  generate: '撰写正文', explain: '补充讲解', rewrite: '修改选区', style: '调整表达',
  'select-template': '选择模板', 'bundle-intent': '分析学习目标', 'bundle-materials': '分析资料',
  'bundle-plan': '规划章节', 'bundle-plan-review': '检查章节规划', 'knowledge-index': '建立资料索引',
  'chapter-analysis': '分析本章', 'note-review': '复查正文', 'note-review-audit': '核对审查意见',
  'lecture-outline': '合并知识并精简选材',
  'note-review-patch': '修订正文', 'reference-repair': '核对原文定位', 'recovery-plan': '诊断并寻找修复办法',
}
export const generationStageLabel = stage => generationStageLabels[stage] || (stage?.startsWith('bundle-materials-') ? '分析资料' : '处理当前步骤')
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0

// One user operation may contain planning, routing and several chapter HTTP
// requests. Snapshots replace prior snapshots; polling never double-counts.
export function generationSession(update, now = Date.now) {
  const requests = new Map(), startedAt = now()
  let current, chapter, state = 'running', unavailable = false
  const publish = () => {
    const values = [...requests.values()]
    const stages = new Map()
    for (const value of values) for (const stage of value.stages || []) {
      if (!stages.has(stage.stage)) stages.set(stage.stage, { stage: stage.stage, requests: 0, reportedCalls: 0, inputTokens: 0, outputTokens: 0 })
      const row = stages.get(stage.stage)
      for (const key of ['requests', 'reportedCalls', 'inputTokens', 'outputTokens']) row[key] += count(stage[key])
    }
    update({ startedAt, updatedAt: now(), state, chapter, unavailable, stage: current?.stage,
      stages: [...stages.values()],
      phase: current?.phase, requests: values.reduce((n, v) => n + count(v.requests), 0),
      reportedCalls: values.reduce((n, v) => n + count(v.reportedCalls), 0),
      inputTokens: values.reduce((n, v) => n + count(v.inputTokens), 0), outputTokens: values.reduce((n, v) => n + count(v.outputTokens), 0),
      cacheHitTokens: values.reduce((n, v) => n + count(v.cacheHitTokens), 0), cacheReportedCalls: values.reduce((n, v) => n + count(v.cacheReportedCalls), 0),
      repairs: values.reduce((n, v) => n + count(v.repairs), 0), indexReused: values.reduce((n, v) => n + count(v.indexReused), 0),
      observed: values.length > 0 })
  }
  publish()
  return {
    observe(value) {
      if (state !== 'running') return
      if (!value) { unavailable = true; publish(); return }
      if (typeof value.id !== 'string' || !Number.isFinite(value.updatedAt)) return
      if ((requests.get(value.id)?.updatedAt || 0) > value.updatedAt) return
      requests.set(value.id, value); current = value; unavailable = false; publish()
    },
    chapter(value) { chapter = value; publish() },
    finish(value) { state = value; publish() },
  }
}

// The edit is sent exactly once. Progress polling is observational: it never
// retries a mutation, fails generation, or waits for a broken status endpoint.
export async function observedGeneration(post, input, signal, observe, { interval = 1000, timeout = 3000, id = crypto.randomUUID() } = {}) {
  let stopped = false, timer, polling
  const poll = async () => {
    polling = new AbortController()
    const deadline = setTimeout(() => polling.abort(), timeout)
    try {
      const value = await post('/api/generation-progress', { id }, polling.signal)
      if (!stopped && value) observe(value)
    } catch { if (!stopped && !signal?.aborted) observe(null) }
    finally { clearTimeout(deadline); if (!stopped) timer = setTimeout(poll, interval) }
  }
  timer = setTimeout(poll, 0)
  try {
    const result = await post('/api/edit', { ...input, progressId: id }, signal)
    if (result.progress) observe(result.progress)
    return result
  } catch (error) {
    if (error.progress) observe(error.progress)
    throw error
  } finally { stopped = true; clearTimeout(timer); polling?.abort() }
}
