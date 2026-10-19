import { useState } from 'react'
import { restoreSource, reloadWorkspace } from '../storage'
import { materialAccept } from '../../shared/material-formats.mjs'
export function SourceRepair({ id }: { id: string }) {
  const [file, setFile] = useState<File|null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <div className="maintenance-result"><strong>重新选择原文</strong><p>请选择这份笔记原来对应的文件。它会复制到笔记目录，现有正文保持不变；此操作不会重新分析或生成笔记。</p><input type="file" accept={materialAccept} aria-label="选择缺失的原文" disabled={busy} onChange={e => setFile(e.target.files?.[0] || null)}/>{file && <div className="modal-actions"><span>{file.name}</span><button className="secondary" disabled={busy} onClick={() => { setBusy(true); setError(''); void restoreSource(id, file).then(reloadWorkspace).catch(e => { setError(e.message); setBusy(false) }) }}>确认恢复这份原文</button></div>}{error && <p className="inline-error" role="alert">{error}</p>}</div>
}
