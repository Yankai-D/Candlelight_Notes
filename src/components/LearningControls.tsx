import { UserRound } from 'lucide-react'
import type { LearningDocument } from '../types'
import { notebookStatus, notebookLabel, notebookSettings } from '../../shared/notebooks.mjs'
import { defaultNotebookId, noteTemplates } from '../../shared/learning-templates.mjs'

export function LearningControls({ document, onChange, onKnowledge, locked }: {
  document: LearningDocument; onChange: (id: string) => void; onKnowledge: () => void; locked: boolean
}) {
  const current = document.activeNotebookId || defaultNotebookId
  const notebooks = document.notebooks || {}
  const chosen = notebookSettings(document).writingTemplate
  const options = [...Object.values(noteTemplates), ...Object.values(notebooks).filter(n => !(n.id in noteTemplates))]
  return <div className="learning-controls">
    <div className="learning-control-heading"><span>{document.entryType === 'note' ? '独立笔记' : '阅读方式 · 分别保存'}</span><button aria-label="学习画像" onClick={onKnowledge}><UserRound size={13} /> 学习画像</button></div>
    {document.entryType !== 'note' && <select aria-label="阅读方式" value={current} disabled={locked} onChange={e => onChange(e.target.value)}>
      {options.map(option => <option value={option.id} key={option.id}>{option.label} · {notebookStatus(notebooks[option.id])}</option>)}
    </select>}
    <div className="notebook-status"><span>{locked ? '正在处理当前笔记…' : notebookStatus(notebooks[current]) + (document.entryType === 'note' ? ' · 按整理要求生成' : ' · 切换保留各自编辑')}</span>
    </div>
    <p title={chosen?.reason}>{current === 'translation' ? '忠实保留原文 · 不使用个人知识库' : chosen ? `${chosen.name} · 沿用本篇模板` : current === 'adaptive' ? document.preparation || document.chapters.some(c => c.status === 'ready') ? '已有笔记沿用原来的讲述方式' : '首次整理自动选择合适的模板' : '旧版笔记已保留，可继续阅读与编辑'}</p>
  </div>
}
