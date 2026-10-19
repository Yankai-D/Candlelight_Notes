import { useEffect, useState } from 'react'
import { ArchiveRestore, Check, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import { StorageLocation } from './StorageLocation'
import { maintainWorkspace, storageSettings, reloadWorkspace } from '../storage'
import '../settings.css'

export function MaintenanceModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('backup'), [directory, setDirectory] = useState(''), [backupPath, setBackupPath] = useState('')
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [created, setCreated] = useState<any>(null), [preview, setPreview] = useState<any>(null)
  const [retired, setRetired] = useState<any[]>([]), [purge, setPurge] = useState(''), [previous, setPrevious] = useState(false), [confirm, setConfirm] = useState(false)
  useEffect(() => { void storageSettings().then(s => { setDirectory(s.directory || ''); setPrevious(!!s.previousWorkspaceAvailable) }).catch(e => setError(e.message)); void loadRetired() }, [])
  async function loadRetired() { try { setRetired(await maintainWorkspace({ action: 'retired-list' })) } catch (e) { setError((e as Error).message) } }
  async function run(label: string, operation: () => Promise<void>) { setBusy(label); setError(''); try { await operation() } catch (e) { setError((e as Error).message) } finally { setBusy('') } }
  return <Modal title="资料备份与恢复" subtitle="把学习成果留在自己手中。" onClose={() => { if (!busy) onClose() }}>
    <div className="settings-form maintenance-form">
      <div className="maintenance-tabs" role="tablist" aria-label="资料维护">{[['backup','完整备份'],['restore','恢复空间'],['removed','移除记录与回收站']].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} disabled={!!busy} className={tab === value ? 'selected' : ''} onClick={() => { setTab(value); setError(''); setConfirm(false) }}>{label}</button>)}</div>
      {tab === 'backup' && <>
        <div className="maintenance-intro"><ShieldCheck size={24}/><p>保存全部阅读版本、原文、纸条、历史、画像、模板、文件夹及学习树。生成记录与移除记录一并保留。</p></div>
        <StorageLocation label="备份保存位置" value={directory} onChange={setDirectory} disabled={!!busy} help="在此位置创建独立备份文件夹，完成后可自行压缩或复制到其他设备。"/>
        <p className="field-help">不包含 API Key。模型连接与阅读启动设置由当前应用保留。</p>
        <div className="modal-actions"><div className="spacer"/><button className="primary" disabled={!!busy || !directory.trim()} onClick={() => void run('正在校验并备份…', async () => setCreated(await maintainWorkspace({ action: 'workspace-backup', directory })))}>创建完整备份</button></div>
        {created && <div className="maintenance-result" role="status"><strong><Check size={16}/>{created.warnings.length ? '备份已保存，存在缺失文件' : '备份已完成并校验'}</strong><p>{created.documents} 份资料 · {created.files} 个文件</p><p className="missing-file-path">{created.directory}</p>{created.warnings.map((warning: string, index: number) => <p key={index}>{warning}</p>)}</div>}
      </>}
      {tab === 'restore' && <>
        <StorageLocation label="已有备份文件夹" value={backupPath} onChange={value => { setBackupPath(value); setPreview(null); setConfirm(false) }} disabled={!!busy} help="选择含 candlelight-workspace.json 的完整备份文件夹。先检查，再恢复。"/>
        <button className="secondary" disabled={!!busy || !backupPath.trim()} onClick={() => void run('正在检查备份…', async () => { setPreview(await maintainWorkspace({ action: 'workspace-preview', directory: backupPath })); setConfirm(false) })}>检查备份</button>
        {preview && <div className="maintenance-result"><strong>{preview.documents} 份资料 · {preview.trees} 棵理想学习树</strong><p>备份时间：{new Date(preview.createdAt).toLocaleString('zh-CN')} · {preview.retired} 条移除记录</p>{preview.warnings.map((warning: string, index: number) => <p key={index}>{warning}</p>)}
          <StorageLocation label="恢复资料保存位置" value={directory} onChange={setDirectory} disabled={!!busy} help="文件将复制到新的学习空间目录；原资料文件保持原位，之后可返回原空间。"/>
          <label className="discovery-remember"><input type="checkbox" checked={confirm} disabled={!!busy} onChange={e => setConfirm(e.target.checked)}/>切换到备份中的学习空间</label>
          <button className="primary" disabled={!!busy || !confirm || !directory.trim()} onClick={() => void run('正在恢复并校验…', async () => { await maintainWorkspace({ action: 'workspace-restore', previewId: preview.id, directory, confirm: true }); reloadWorkspace() })}><ArchiveRestore size={15}/>恢复并打开</button>
        </div>}
        {previous && <div className="maintenance-previous"><p>可以返回上一次切换前的学习空间，两边的资料文件都会保留。</p><button className="secondary" disabled={!!busy} onClick={() => void run('正在返回…', async () => { await maintainWorkspace({ action: 'workspace-undo', confirm: true }); reloadWorkspace() })}>返回上一个学习空间</button></div>}
      </>}
      {tab === 'removed' && <>
        <p className="field-help">移除和移入回收站都保留原位置的文件。永久删除会影响所有关联这些文件的安装版本，不能撤销。</p>
        <div className="maintenance-retired">{retired.length ? retired.map(item => <div className="maintenance-retired-item" key={item.id}><strong>{item.title}</strong><small>{item.mode === 'trash' ? '回收站' : '已移除记录'} · {new Date(item.time).toLocaleString('zh-CN')}</small><p className="missing-file-path">{item.path}</p><div className="modal-actions"><button className="secondary" disabled={!!busy} onClick={() => void run('正在恢复记录…', async () => { await maintainWorkspace({ action: 'retired-restore', id: item.id }); reloadWorkspace() })}>恢复到资料库</button>{item.mode === 'trash' && <button className="text-button danger" disabled={!!busy} onClick={() => purge === item.id ? void run('正在永久删除…', async () => { await maintainWorkspace({ action: 'retired-purge', id: item.id, confirm: true }); setPurge(''); await loadRetired() }) : setPurge(item.id)}><Trash2 size={13}/>{purge === item.id ? '确认永久删除磁盘文件' : '永久删除…'}</button>}</div>{purge === item.id && <p className="inline-error">将删除这份笔记及应用保存的原文副本。其他安装版本也将无法打开这些文件。</p>}</div>) : <p>这里还没有移除的资料。</p>}</div>
      </>}
      {busy && <p className="maintenance-progress" role="status"><LoaderCircle className="spin" size={16}/>{busy}</p>}{error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  </Modal>
}
