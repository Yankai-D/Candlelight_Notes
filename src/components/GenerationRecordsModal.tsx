import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { maintainWorkspace } from '../storage'
const actions: Record<string,string> = { generate: '章节整理', explain: '讲解纸条', rewrite: '局部改写', style: '风格调整' }
const states: Record<string,string> = { accepted: '格式与范围校验通过', failed: '生成失败', cancelled: '已取消', running: '未记录结束状态' }
export function GenerationRecordsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [items, setItems] = useState<any[]>([]), [selected, setSelected] = useState<any>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  useEffect(() => { void maintainWorkspace({ action: 'records-list', id }).then(setItems).catch(e => setError(e.message)).finally(() => setLoading(false)) }, [id])
  function download() { const url = URL.createObjectURL(new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `generation-${selected.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  return <Modal title="这份笔记的生成记录" subtitle="查看当时的目标、画像、模板与实际调用。" onClose={onClose}>
    <div className="settings-form"><p className="field-help">保留最近 20 次、每份资料最多 64 MB。记录包含本机学习内容，不含连接密钥；校验通过不等于已写入笔记或内容已经人工审定。</p>
      <div className="record-list">{items.map(item => <button className="record-row" key={item.id} onClick={() => void maintainWorkspace({ action: 'record-read', id, recordId: item.id }).then(setSelected).catch(e => setError(e.message))}><span>{actions[item.action]} · {item.chapterTitle || item.chapterId}<small>{new Date(item.startedAt).toLocaleString('zh-CN')}</small></span><span>{states[item.status]}<small>{item.calls} 次调用 · {item.repairs} 次修复</small></span></button>)}</div>
      {!items.length && <p>{loading ? '正在读取…' : '还没有生成记录。此前的生成不会补造追溯信息。'}</p>}
      {selected && <div className="record-detail"><dl><dt>模型</dt><dd>{selected.model}</dd><dt>学习目标</dt><dd>{selected.request.document.intent || '看懂这篇文章'}</dd><dt>模板</dt><dd>{selected.request.learning?.writingTemplate?.name || selected.request.learning?.template || selected.request.learning?.mode}</dd><dt>生成前修订</dt><dd>{selected.request.revision}</dd><dt>调用次数</dt><dd>{selected.calls.length}</dd><dt>结果</dt><dd>{states[selected.status]}{selected.errorCode && ` · ${selected.errorCode}`}</dd></dl>
        <details><summary>当时的画像</summary><pre>{selected.request.learning?.mode === 'translation' ? '纯翻译：未使用学习画像。' : JSON.stringify(selected.request.knowledge || {}, null, 2)}</pre></details>
        <details><summary>模板与样稿快照</summary><pre>{JSON.stringify(selected.request.learning || {}, null, 2)}</pre></details>
        {selected.request.workflow && <details><summary>任务进度与审查预算</summary><pre>{JSON.stringify(selected.request.workflow, null, 2)}</pre></details>}
        <details><summary>调用、审查与修复记录</summary><pre>{JSON.stringify(selected.events, null, 2)}</pre></details>
        <p className="field-help">完整记录包含原文及请求上下文，可导出用于复核。{selected.compacted && '这次记录较大，部分重复调用正文仅保留摘要。'}</p><button className="secondary" onClick={download}>导出这次生成记录</button>
      </div>}{error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  </Modal>
}
