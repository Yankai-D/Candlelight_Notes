import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Modal } from './Modal'

export function RegenerateModal({ intent, label, configured, onClose, onSubmit, onSettings }: {
  intent: string; label: string; configured: boolean; onClose: () => void;
  onSubmit: (intent: string, feedback: string) => Promise<void>; onSettings: () => void
}) {
  const [goal, setGoal] = useState(intent), [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit() {
    if (busy || !goal.trim()) return
    setBusy(true); setError('')
    try { await onSubmit(goal.trim(), feedback.trim()) }
    catch (failure) { setError((failure as Error).message); setBusy(false) }
  }
  return <Modal title="调整并重新生成" subtitle={label} explicitCancel onClose={() => { if (!busy) onClose() }}>
    <form className="intent-form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <label>我的学习目标<textarea aria-label="我的学习目标" autoFocus rows={3} maxLength={4000} value={goal} disabled={busy} onChange={event => setGoal(event.target.value)} /></label>
      <label>哪里不合意，想怎样调整？<textarea aria-label="重新生成的调整要求" rows={3} maxLength={4000} value={feedback} disabled={busy} onChange={event => setFeedback(event.target.value)} placeholder="例如：太啰嗦。每个小问先放原文，简短说明思路，再给计算过程与答案。" /></label>
      <p className="field-help">当前正文与小纸条会先保留为历史版本。适应学习会根据目标和调整要求重新选择模板；纯翻译仍只翻译原文。</p>
      <p className="field-help">想长期调整表达方式，可到「设置 → 模板风格」修改个人样稿。</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button>{configured ? <button className="primary" disabled={busy || !goal.trim()}>{busy && <LoaderCircle size={14} className="spin" />}保存目标并重新生成</button> : <button type="button" className="primary" onClick={onSettings}>先连接模型</button>}</div>
    </form>
  </Modal>
}
