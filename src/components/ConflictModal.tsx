import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import type { LearningDocument } from '../types'
import { maintainWorkspace, saveConflictCopy, reloadWorkspace } from '../storage'
import { textOf } from '../../shared/document.mjs'
export function ConflictModal({ document, onClose }: { document: LearningDocument; onClose: () => void }) {
  const [disk, setDisk] = useState<LearningDocument|null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false)
  useEffect(() => { void maintainWorkspace({ action: 'conflict-read', id: document.id }).then(value => setDisk(value.document)).catch(e => setError(e.message)) }, [document.id])
  const excerpt = (value: LearningDocument) => value.chapters.map(chapter => `${chapter.title}\n${textOf(chapter.content)}`).join('\n\n').slice(0,4000)
  return <Modal title="处理保存冲突" subtitle="保留两份修改，再决定使用哪一份。" onClose={() => { if (!busy) onClose() }} wide>
    <div className="settings-form"><div className="recovery-columns"><div><strong>当前窗口的修改</strong><pre>{excerpt(document)}</pre></div><div><strong>磁盘上的笔记</strong><pre>{disk ? excerpt(disk) : '正在读取…'}</pre></div></div><p className="field-help">这里展示正文节选。另存会保留完整阅读版本、纸条与历史，不会覆盖磁盘上的笔记。</p>
      <div className="modal-actions"><button className="secondary" disabled={busy || !disk} onClick={() => confirm ? reloadWorkspace() : setConfirm(true)}>{confirm ? '确认放弃当前窗口修改并重新打开' : '使用磁盘版本…'}</button><span className="spacer"/><button className="primary" disabled={busy} onClick={() => { setBusy(true); void saveConflictCopy(document).then(() => reloadWorkspace()).catch(e => { setError(e.message); setBusy(false) }) }}>当前修改另存为新笔记</button></div>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  </Modal>
}
