import { useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check } from 'lucide-react'
import { Modal } from './Modal'
import { learnerProfile, restoreKnowledge } from '../../shared/learning.mjs'
import { profileFromFields } from '../../shared/learner-setup.mjs'
import type { Knowledge, LearnerProfile } from '../types'

export function KnowledgeModal({ knowledge, onSave, onReset, onClose }: { knowledge: Knowledge; onSave: (value: Knowledge) => Promise<void>; onReset: () => Promise<void>; onClose: () => void }) {
  const [background, setBackground] = useState(knowledge.background)
  const [foundations, setFoundations] = useState(knowledge.foundations.join('、'))
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [resetting, setResetting] = useState(false)
  async function save(profile: LearnerProfile) {
    setSaving(true); setError(''); setMessage('')
    try {
      const valid = learnerProfile(profile)
      await onSave({ ...knowledge, ...valid })
      setBackground(valid.background); setFoundations(valid.foundations.join('、')); setMessage('学习画像已保存')
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  function backup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'reading-tree-profile-v1', profile: learnerProfile(knowledge) }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = '根系-学习画像.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <Modal title="根系 · 学习画像" subtitle="明确自己的学习基础，让讲解有稳定的起点。" onClose={() => { if (!saving) onClose() }}>
    <div className="knowledge-space">
      <div className="knowledge-toolbar"><p>由你明确维护，不随阅读状态或学习树整理自动改变。</p><div><button className="icon-button" aria-label="导出学习画像" onClick={backup}><ArrowDownToLine size={16} /></button><button className="icon-button" aria-label="导入学习画像" disabled={saving} onClick={() => input.current?.click()}><ArrowUpFromLine size={16} /></button></div></div>
      <input ref={input} type="file" accept=".json" hidden onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
        try { const raw = await file.text(); const data = JSON.parse(raw); await save(learnerProfile(data.format === 'reading-tree-profile-v1' ? data.profile : restoreKnowledge(raw))) }
        catch { setError('请选择有效的学习画像或旧版知识库备份。') }
      }} />
      <form className="knowledge-profile" onSubmit={event => { event.preventDefault(); try { void save(profileFromFields(background, foundations)) } catch (reason) { setError((reason as Error).message) } }}>
        <label>学习背景<textarea aria-label="学习背景" value={background} rows={3} maxLength={4000} onChange={event => setBackground(event.target.value)} /></label>
        <label>已具备的基础<textarea aria-label="已具备的基础" value={foundations} rows={3} onChange={event => setFoundations(event.target.value)} placeholder="用顿号或换行分隔，例如：高等数学、概率论" /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="modal-actions"><span role="status">{message}</span><span className="spacer" /><button className="primary" disabled={saving}><Check size={14} />{saving ? '保存中…' : '保存学习画像'}</button></div>
      </form>
      <p className="field-help">适应学习依据这里的画像和当前资料的学习目标生成。学习树用于知识结构与索引；纯翻译不使用画像。</p>
      <div className="knowledge-reset">{resetting ? <><p>清除当前学习背景和基础，返回首次设置重新填写。已有资料、笔记、学习树和模型连接会保留。</p><div className="modal-actions"><button className="secondary" disabled={saving} onClick={() => setResetting(false)}>取消</button><button className="primary" disabled={saving} onClick={async () => { setSaving(true); setError(''); try { await onReset() } catch (reason) { setError((reason as Error).message) } finally { setSaving(false) } }}>确认清除画像</button></div></> : <button className="text-button" disabled={saving} onClick={() => setResetting(true)}>清除画像，重新填写</button>}</div>
    </div>
  </Modal>
}
