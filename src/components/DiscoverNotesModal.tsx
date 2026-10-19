import { useEffect, useState } from 'react'
import { FileSearch, LoaderCircle } from 'lucide-react'
import { Modal } from './Modal'
import { StorageLocation } from './StorageLocation'
import { attachNotes, scanNotes, storageSettings, type DiscoveredNotes } from '../storage'
import '../settings.css'

export function DiscoverNotesModal({ onClose, onAdded }: { onClose: () => void; onAdded: (ids: string[]) => Promise<void> }) {
  const [directory, setDirectory] = useState(''), [scan, setScan] = useState<DiscoveredNotes | null>(null)
  const [selected, setSelected] = useState<string[]>([]), [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(''), [error, setError] = useState('')
  useEffect(() => { void storageSettings().then(settings => setDirectory(settings.directory || '')).catch(error => setError(error.message)) }, [])
  async function search() {
    setBusy('scan'); setError(''); setScan(null); setSelected([])
    try { const found = await scanNotes(directory.trim()); setScan(found); setDirectory(found.directory); setSelected(found.items.filter(item => item.status === 'new' || item.status === 'moved').map(item => item.key)) }
    catch (error) { setError((error as Error).message) } finally { setBusy('') }
  }
  async function add() {
    if (!scan) return
    setBusy('attach'); setError('')
    try { const result = await attachNotes(scan.id, selected, remember); await onAdded(result.ids); onClose() }
    catch (error) { setError((error as Error).message); setScan(null) } finally { setBusy('') }
  }
  return <Modal title="识别已有笔记" subtitle="找回另一安装版本、旧资料目录或备份文件夹中的学习笔记。" onClose={() => { if (!busy) onClose() }}>
    <div className="settings-form discovery-form">
      <StorageLocation label="识别目录" value={directory} disabled={!!busy} onChange={value => { setDirectory(value); setScan(null); setSelected([]) }} help="扫描此文件夹及子文件夹中的烛光笔记文件，关联配套原文。普通 PDF 可通过“导入资料”添加。" />
      <button className="secondary discovery-search" disabled={!!busy || !directory.trim()} onClick={() => void search()}>{busy === 'scan' ? <LoaderCircle className="spin" size={15} /> : <FileSearch size={15} />}扫描目录</button>
      {scan && <>
        <p className="discovery-summary" role="status">找到 {scan.items.length} 份笔记 · 已选择 {selected.length} 份</p>
        <div className="discovery-list">{scan.items.map(item => {
          const selectable = item.status === 'new' || item.status === 'moved'
          return <label className={`discovery-item ${selectable ? '' : 'unavailable'}`} key={item.key}>
            <input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected.includes(item.key)} disabled={!!busy || !selectable} onChange={event => setSelected(keys => event.target.checked ? [...keys, item.key] : keys.filter(key => key !== item.key))} />
            <span><strong>{item.title}</strong><small>{item.status === 'known' ? '已在资料库' : item.status === 'conflict' ? '编号冲突 · 保留现有记录' : item.status === 'moved' ? '原位置已失效 · 更新文件关联' : item.ignored ? '曾移除的记录 · 可重新加入' : '可加入资料库'}{item.missingSource && ' · 原文缺失，保留已存笔记'}</small><span className="discovery-path">{item.path}</span></span>
          </label>
        })}</div>
        {!scan.items.length && <p className="field-help">没有找到烛光笔记。请选择包含 note.candlelight.json 的资料目录。</p>}
        {scan.issueCount > 0 && <details className="discovery-issues"><summary>{scan.issueCount} 个文件或目录未能识别</summary>{scan.issues.map((issue, index) => <p key={index}>{issue.reason}<small>{issue.path}</small></p>)}</details>}
        <label className="discovery-remember"><input type="checkbox" checked={remember} disabled={!!busy} onChange={event => setRemember(event.target.checked)} />以后启动时也识别此目录</label>
        <p className="field-help">直接关联现有文件，保留正文、纸条与阅读版本。不会复制文件、重新生成笔记或导入其他版本的画像和 API Key。</p>
        <div className="modal-actions"><div className="spacer"/><button className="primary" disabled={!!busy || (!selected.length && !remember)} onClick={() => void add()}>{busy === 'attach' && <LoaderCircle className="spin" size={15}/>} {selected.length ? `加入 ${selected.length} 份笔记` : '记住识别目录'}</button></div>
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  </Modal>
}
