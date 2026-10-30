import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen, Check, ChevronRight, FileText, Folder, Layers3, Library, MoreHorizontal, NotebookPen, PanelLeftOpen, Plus, Search, Trash2 } from 'lucide-react'
import type { Collection, CollectionFolder, Knowledge, LearningDocument, StudyStatus } from '../types'
import { orderLibraryDocuments } from '../../shared/library.mjs'
import { createFolder, deleteFolder, studyStatuses, updateCollectionItem, updateFolder } from '../../shared/collection.mjs'
import { bundleForDocument, bundleForFolder, folderAncestors, folderOutline, folderPath, descendantFolderIds } from '../../shared/folders.mjs'
import { bundleMaterials, defaultBundleIntent } from '../../shared/bundle-context.mjs'
import { WorkspaceBrand, WorkspaceHeader } from './AppShell'
import type { VisualTheme } from '../theme'
import { Modal } from './Modal'
import { StudyTree } from './StudyTree'
const IdealTree = lazy(() => import('./IdealTree').then(module => ({ default: module.IdealTree })))

export type LibraryFilter = { folder: string; status: StudyStatus | 'all'; query: string }

type Props = {
  documents: LearningDocument[]; collection: Collection; knowledge: Knowledge; activeId: string;
  view: 'library' | 'tree'; onView: (view: 'library' | 'tree') => void;
  onSave: (value: Collection) => Promise<void>; onOpen: (id: string, chapterId?: string) => void;
  onImport: (folderId?: string) => void; onDelete: (id: string, mode?: 'record' | 'trash') => Promise<void>; onProfile: () => void;
  onDiscover?: () => void; recoverableRemoval?: boolean;
  onRename: (id: string, title: string) => Promise<void>;
  onCreateNote: (folderId: string, title: string, intent: string) => Promise<void>;
  sourceProgress?: string;
  filter: LibraryFilter; onFilter: (filter: LibraryFilter) => void;
  sidebarOpen: boolean; onToggleSidebar: () => void; onCloseSidebar: () => void;
  theme: VisualTheme; onTheme: (theme: VisualTheme) => void; organizing: boolean; organizeError: string;
  onOrganize: () => void; onCancel: () => void;
  configured: boolean; onSettings: () => void; idealApi: (body: Record<string, unknown>) => Promise<any>;
  onIdealImport: (resource: { filename: string; data: string; url: string; title: string; sourceId: string; intent: string }) => Promise<string>;
}

export function LibraryHome(props: Props) {
  const { documents, collection, knowledge, view, onView, onSave, onOpen, onImport, onDelete, onProfile, filter, onFilter } = props
  const { folder, status, query } = filter
  const ancestorPath = JSON.stringify(folderAncestors(collection, folder).slice(1).map((item: CollectionFolder) => item.id))
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(JSON.parse(ancestorPath)))
  // Reveal a destination reached from a card, breadcrumb or import without
  // opening unrelated branches or undoing a manual collapse of the current path.
  useEffect(() => {
    const parents: string[] = JSON.parse(ancestorPath)
    if (parents.length) setExpandedFolders(current => parents.every(id => current.has(id)) ? current : new Set([...current, ...parents]))
  }, [folder, ancestorPath])
  const toggleFolder = (id: string) => setExpandedFolders(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const setFolder = (folder: string) => onFilter({ ...filter, folder })
  const setStatus = (status: LibraryFilter['status']) => onFilter({ ...filter, status })
  const setQuery = (query: string) => onFilter({ ...filter, query })
  const [folderForm, setFolderForm] = useState<{ id?: string; name: string; kind: 'folder' | 'bundle'; inTree: boolean; parentId?: string | null } | null>(null)
  const [noteForm, setNoteForm] = useState<{ title: string; intent: string } | null>(null)
  const [rename, setRename] = useState('')
  const [treeMode, setTreeMode] = useState<'materials' | 'ideal'>('materials')
  const editFolder = (folder: CollectionFolder) => { setError(''); setFolderForm({ ...folder, kind: folder.kind || 'folder', inTree: folder.inTree === true }) }
  const [managedId, setManagedId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const managed = documents.find(document => document.id === managedId)
  const managedBundle = managed && bundleForDocument(collection, managed.id)
  const inFolder = (document: LearningDocument) => folder === 'all' || (collection.items[document.id]?.folderId || '') === folder
  const folderDocuments = documents.filter(inFolder)
  const visible = (orderLibraryDocuments(folderDocuments) as LearningDocument[]).filter(document =>
    (status === 'all' || collection.items[document.id]?.status === status)
    && [document.title, document.subtitle, document.filename, document.library?.label, document.library?.authors].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const selectedFolder = collection.folders.find(item => item.id === folder)
  const path = folderAncestors(collection, folder).reverse() as CollectionFolder[]
  const outline = folderOutline(collection) as (CollectionFolder & { depth: number })[]
  const folderParents = new Set(collection.folders.map(item => item.parentId).filter(Boolean))
  const visibleFolders = outline.filter(item => folderAncestors(collection, item.id).slice(1).every((parent: CollectionFolder) => expandedFolders.has(parent.id)))
  const folderCounts = new Map<string, number>()
  for (const document of documents) {
    const id = collection.items[document.id]?.folderId
    if (!id) folderCounts.set('', (folderCounts.get('') || 0) + 1)
    else for (const ancestor of folderAncestors(collection, id)) folderCounts.set(ancestor.id, (folderCounts.get(ancestor.id) || 0) + 1)
  }
  const excludedParents = folderForm?.id ? descendantFolderIds(collection, folderForm.id) : new Set<string>()
  const childFolders = collection.folders.filter(item => (item.parentId || null) === (selectedFolder?.id || null))
  const packageScope = selectedFolder && bundleForFolder(collection, selectedFolder.id)
  const sources = selectedFolder ? bundleMaterials(documents, collection, selectedFolder.id) as LearningDocument[] : []
  const newFolder = () => { setError(''); setFolderForm({ name: '', kind: packageScope ? 'bundle' : 'folder', inTree: false, parentId: selectedFolder?.id || null }) }
  const currentDocument = documents.find(document => document.id === props.activeId)
  const perform = async (action: () => Promise<void>, done?: () => void) => {
    setSaving(true); setError('')
    try { await action(); done?.() } catch (error) { const failure = error as Error & { issues?: { message: string }[] }; setError(failure.issues?.map(issue => issue.message).join(' ') || failure.message) } finally { setSaving(false) }
  }
  const editItem = (changes: Partial<Collection['items'][string]>) => {
    if (managed) void perform(() => onSave(updateCollectionItem(collection, managed.id, changes) as Collection))
  }
  return <div className={`library-home ${props.sidebarOpen ? 'sidebar-open' : ''} ${view === 'tree' ? 'tree-browser' : ''}`}>
    <aside className="collection-sidebar">
      <WorkspaceBrand onHome={() => onView('library')} />
      <div className="collection-context"><span className="eyebrow">我的阅读空间</span><h2>{view === 'tree' ? '让知识相互连接' : '从一份资料开始'}</h2><p>{documents.filter(d => d.entryType !== 'note').length} 份资料 · {documents.filter(d => d.entryType === 'note').length} 份独立笔记</p></div>
      <div className="folder-heading"><span>文件夹与资料包</span><button aria-label="新建文件夹" onClick={newFolder}><Plus size={15} /></button></div>
      <nav className="collection-folders" aria-label="文件夹">
        {[{ id: 'all', name: '全部资料', depth: 0 }, ...visibleFolders, { id: '', name: '未分类', depth: 0 }].map(item => <div key={item.id} data-folder-id={item.id} style={{ paddingLeft: 4 + Math.min(item.depth, 5) * 12 }} className={`collection-folder-row ${view === 'library' && folder === item.id ? 'active' : ''}`}>
          {folderParents.has(item.id) ? <button className="folder-disclosure" aria-label={`${expandedFolders.has(item.id) ? '收起' : '展开'}文件夹 ${item.name}`} aria-expanded={expandedFolders.has(item.id)} onClick={() => toggleFolder(item.id)}><ChevronRight size={14} aria-hidden="true" /></button> : <span className="folder-disclosure-space" aria-hidden="true" />}
          <button className="collection-folder-link" title={item.id === 'all' || !item.id ? item.name : folderPath(collection, item.id)} aria-current={view === 'library' && folder === item.id ? 'page' : undefined} onClick={() => { setFolder(item.id); onView('library') }}>
            {item.id === 'all' ? <Library size={15} /> : collection.folders.find(folder => folder.id === item.id)?.kind === 'bundle' ? <Layers3 size={15} /> : <Folder size={15} />}<span>{item.name}</span><small>{item.id === 'all' ? documents.length : folderCounts.get(item.id) || 0}</small>
          </button>
        </div>)}
      </nav>
      <div className="collection-sidebar-bottom">
        {currentDocument && <button className="resume-reading" onClick={() => onOpen(currentDocument.id)}><span><BookOpen size={14} />继续阅读<ArrowUpRight size={14} /></span><strong>{currentDocument.library?.label || currentDocument.title}</strong><small>回到当前笔记</small></button>}
        <div className="sidebar-footer"><span className="small-seed">✧</span> 理解，在每一次追问中生长。</div>
      </div>
    </aside>
    <main className="collection-main">
      <WorkspaceHeader className="collection-header" theme={props.theme} onTheme={props.onTheme}><button className="icon-button mobile-toggle" aria-label="展开文件夹导航" onClick={props.onToggleSidebar}><PanelLeftOpen size={19} /></button><div className="collection-breadcrumb"><button className="breadcrumb-home" onClick={() => { setFolder('all'); onView('library') }}>资料库</button>{view === 'library' && path.length ? path.map(item => <span key={item.id}><ChevronRight size={12} /><button className="breadcrumb-current" onClick={() => setFolder(item.id)}>{item.name}</button></span>) : <><ChevronRight size={12} /><span className="breadcrumb-current">{view === 'tree' ? '学习树' : folder === 'all' ? '全部资料' : '未分类'}</span></>}</div></WorkspaceHeader>
      {view === 'tree' ? <><nav className="tree-mode-switch" aria-label="学习树功能"><button className={treeMode === 'materials' ? 'active' : ''} aria-pressed={treeMode === 'materials'} onClick={() => setTreeMode('materials')}>资料学习树</button><button className={treeMode === 'ideal' ? 'active' : ''} aria-pressed={treeMode === 'ideal'} onClick={() => setTreeMode('ideal')}>理想学习树</button></nav>
        {treeMode === 'ideal' ? <Suspense fallback={<p className="ideal-tree">正在打开理想学习树…</p>}><IdealTree documents={documents} knowledge={knowledge} configured={props.configured} onSettings={props.onSettings} api={props.idealApi} onOpen={onOpen} onImport={props.onIdealImport} /></Suspense> : <StudyTree documents={documents} collection={collection} knowledge={knowledge} onOpen={onOpen} onProfile={onProfile} onOpenFolder={id => { onFilter({ folder: id, status: 'all', query: '' }); onView('library') }}
        organizing={props.organizing} error={props.organizeError} onOrganize={props.onOrganize} onCancel={props.onCancel} />}</> : <div className="collection-content">
        <div className="collection-title"><div><span className="collection-eyebrow">{selectedFolder?.kind === 'bundle' ? 'MATERIAL BUNDLE' : 'LIBRARY'}</span><h1>{folder === 'all' ? '资料库' : selectedFolder?.name || '未分类'}</h1><p>{selectedFolder?.kind === 'bundle' && '联合资料包 · '}{folderDocuments.filter(d => d.entryType !== 'note').length} 份资料{folderDocuments.some(d => d.entryType === 'note') && ` · ${folderDocuments.filter(d => d.entryType === 'note').length} 份独立笔记`}{folder === 'all' ? ' · 从这里继续阅读' : ''}</p></div>
          <div className="collection-title-actions">{selectedFolder && <button className="secondary" aria-label="管理当前文件夹" title="文件夹类型与设置" onClick={() => editFolder(selectedFolder)}><MoreHorizontal size={16} /><span>管理</span></button>}{packageScope && <button className="secondary" onClick={() => { setError(''); setNoteForm({ title: '', intent: defaultBundleIntent }) }}><NotebookPen size={16} />新建笔记</button>}{props.onDiscover && <button className="secondary" onClick={props.onDiscover}><Search size={15}/>识别已有笔记</button>}<button className="primary" onClick={() => onImport(selectedFolder?.id)}><Plus size={16} />导入资料</button></div>
        </div>
        {packageScope && <div className="bundle-context-banner"><Layers3 size={19} strokeWidth={1.5} /><div><strong>把相关材料放在一起，写出自己的理解</strong><p>资料仍有各自的阅读笔记；新建独立笔记，可按要求整理当前包及下属内容。{sources.length} 份资料可供参考。</p></div></div>}
        {(selectedFolder || folder === 'all') && <section className="nested-folders" aria-label="下属文件夹">{childFolders.map(item => <button key={item.id} onClick={() => setFolder(item.id)} title={folderPath(collection, item.id)}>{item.kind === 'bundle' ? <Layers3 size={22} strokeWidth={1.4} /> : <Folder size={22} strokeWidth={1.4} />}<span><strong>{item.name}</strong><small>{item.kind === 'bundle' ? '联合资料包' : '文件夹'} · {folderCounts.get(item.id) || 0} 项</small></span><ChevronRight size={15} /></button>)}<button className="new-nested-folder" onClick={newFolder}><Plus size={18} /><span>{packageScope ? '新建下属资料包' : '新建文件夹'}</span></button></section>}
        <div className="collection-tools"><div className="collection-status-tabs" role="tablist" aria-label="学习状态">
          {(['all', ...Object.keys(studyStatuses)] as (StudyStatus | 'all')[]).map(value => <button key={value} role="tab" aria-selected={status === value} onClick={() => setStatus(value)}>{value === 'all' ? '全部' : studyStatuses[value]}<span>{value === 'all' ? folderDocuments.length : folderDocuments.filter(document => collection.items[document.id]?.status === value).length}</span></button>)}
        </div><label className="collection-search"><Search size={15} /><input aria-label="搜索学习资料" value={query} placeholder="搜索标题、作者或文件名" onChange={event => setQuery(event.target.value)} /></label></div>
        <div className="collection-table-heading"><span>资料与笔记</span><span>文件夹</span><span>学习状态</span><span /></div>
        <div className="collection-list paper-library" role="list" aria-label="已添加的资料">
          {visible.map(document => <div className="collection-row" role="listitem" key={document.id}>
            <button className="collection-document" aria-label={`打开 ${document.library?.label || document.title}`} onClick={() => onOpen(document.id)}><span className={`collection-file-icon ${document.entryType === 'note' ? 'standalone-note-icon' : ''}`}>{document.entryType === 'note' ? <NotebookPen size={22} strokeWidth={1.4} /> : <FileText size={22} strokeWidth={1.4} />}</span><span><strong>{document.library?.label || document.title}</strong><small>{document.entryType === 'note' ? document.intent : document.library ? document.title : document.filename}</small><span>{document.entryType === 'note' ? `独立笔记 · ${document.sourceContext?.sources.length || 0} 份参考资料` : [document.library?.authors, document.library?.year, document.kind === 'pdf' ? 'PDF' : '文本', document.sourceState === 'deferred' ? '原件已保存' : `${document.pages.length} 页`].filter(Boolean).join(' · ')}</span></span></button>
            <span className="collection-folder-label" title={folderPath(collection, collection.items[document.id]?.folderId)}><Folder size={13} />{collection.folders.find(folder => folder.id === collection.items[document.id]?.folderId)?.name || '未分类'}</span>
            <span className={`study-status status-${collection.items[document.id]?.status || 'imported'}`}><i />{studyStatuses[collection.items[document.id]?.status || 'imported']}</span>
            <button className="collection-row-menu" aria-label={`整理 ${document.library?.label || document.title}`} onClick={() => { setManagedId(document.id); setRename(document.library?.label || document.title); setConfirmDelete(false); setError('') }}><MoreHorizontal size={18} /></button>
          </div>)}
          {!visible.length && <div className="collection-empty"><BookOpen size={34} strokeWidth={1.2} /><h2>{query ? '没有找到匹配的资料' : '这里还没有资料'}</h2><p>{query ? '试试其他标题、作者或文件名。' : status === 'all' ? '导入资料，或把已有资料移入这个文件夹。' : '更改资料的学习状态后，会显示在这里。'}</p>{!query && status === 'all' && <button className="secondary" onClick={() => onImport(selectedFolder?.id)}><Plus size={14} />导入资料</button>}</div>}
        </div>
        <p className="collection-footnote">资料与笔记保存在本机 · 学习状态可随时调整</p>
      </div>}
    </main>
    {props.sidebarOpen && <button className="mobile-shade" aria-label="收起文件夹导航" onClick={props.onCloseSidebar} />}
    {folderForm && <Modal title={folderForm.id ? '管理文件夹' : '新建文件夹'} onClose={() => { if (!saving) setFolderForm(null) }}>
      <form className="collection-form" onSubmit={event => { event.preventDefault(); void perform(async () => {
        const next = folderForm.id ? updateFolder(collection, folderForm.id, folderForm) : createFolder(collection, folderForm.name, crypto.randomUUID(), { kind: folderForm.kind, inTree: folderForm.inTree, parentId: folderForm.parentId || null })
        await onSave(next as Collection)
      }, () => setFolderForm(null)) }}><label>文件夹名称<input autoFocus aria-label="文件夹名称" value={folderForm.name} maxLength={60} onChange={event => setFolderForm({ ...folderForm, name: event.target.value })} placeholder="例如：机器学习" /></label>
        <label className="folder-parent-field">所在位置<select aria-label="上级文件夹" value={folderForm.parentId || ''} onChange={event => setFolderForm({ ...folderForm, parentId: event.target.value || null })}><option value="">资料库顶层</option>{outline.filter(item => !excludedParents.has(item.id)).map(item => <option key={item.id} value={item.id}>{folderPath(collection, item.id)}</option>)}</select></label>
        <fieldset className="folder-kind-field"><legend>文件夹类型</legend><div className="folder-kind-options">
          <label className={folderForm.kind === 'folder' ? 'chosen' : ''}><input type="radio" name="folder-kind" value="folder" checked={folderForm.kind === 'folder'} onChange={() => setFolderForm({ ...folderForm, kind: 'folder', inTree: false })} /><Folder size={20} strokeWidth={1.5} /><span><strong>普通文件夹</strong><small>分类存放，每份资料独立管理。</small></span><Check className="folder-kind-check" size={15} /></label>
          <label className={folderForm.kind === 'bundle' ? 'chosen' : ''}><input type="radio" name="folder-kind" value="bundle" checked={folderForm.kind === 'bundle'} onChange={() => setFolderForm({ ...folderForm, kind: 'bundle', inTree: false })} /><Layers3 size={20} strokeWidth={1.5} /><span><strong>联合资料包</strong><small>笔记可参考包内资料，也可嵌套学科、单元。</small></span><Check className="folder-kind-check" size={15} /></label>
        </div></fieldset>
        {folderForm.kind === 'bundle' && <div className="folder-bundle-settings"><p>包内文件不单独编入学习树。开启下方选项后，整包作为一个节点展示。</p><label className="tree-inclusion"><span><strong>资料包编入学习树</strong><small>默认关闭，可随时调整</small></span><input type="checkbox" role="switch" aria-label="资料包编入学习树" checked={folderForm.inTree} onChange={event => setFolderForm({ ...folderForm, inTree: event.target.checked })} /><i aria-hidden="true" /></label></div>}
        {folderForm.id && <p className="field-help">切换类型保留原文件、笔记和阅读进度；改回普通文件夹后，恢复各文件原有的学习树设置。</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="modal-actions">{folderForm.id && <button type="button" className="text-button danger" disabled={saving} onClick={() => void perform(() => onSave(deleteFolder(collection, folderForm.id!) as Collection), () => { setFolderForm(null); setFolder('all') })}><Trash2 size={14} />删除文件夹</button>}<span className="spacer" /><button className="primary" disabled={saving || !folderForm.name.trim()}>{folderForm.id ? '保存设置' : folderForm.kind === 'bundle' ? '创建资料包' : '创建文件夹'}</button></div>
        {folderForm.id && <p className="field-help">删除此容器会将资料、笔记和下属文件夹移到上一级；顶层资料移到「未分类」。不会删除内容。</p>}
      </form>
    </Modal>}
    {managed && <Modal title={managed.entryType === 'note' ? '整理独立笔记' : '整理资料'} subtitle={managed.library?.label || managed.title} onClose={() => { if (!saving) setManagedId('') }}>
      <div className="collection-form"><label>{managed.entryType === 'note' ? '笔记名称' : '资料名称'}<div className="library-rename"><input aria-label="修改名称" value={rename} maxLength={managed.library ? 200 : 400} onChange={event => setRename(event.target.value)} /><button className="secondary" disabled={saving || !rename.trim() || rename.trim() === (managed.library?.label || managed.title)} onClick={() => void perform(() => props.onRename(managed.id, rename.trim()))}>保存名称</button></div></label><h3>学习状态</h3><div className="collection-choices">{Object.entries(studyStatuses).map(([value, label]) => <button className={collection.items[managed.id]?.status === value ? 'chosen' : ''} disabled={saving} key={value} onClick={() => editItem({ status: value as StudyStatus })}>{collection.items[managed.id]?.status === value && <Check size={13} />}{label}</button>)}</div>
        <h3>所在文件夹</h3><div className="collection-choices">{[{ id: '', name: '未分类' }, ...outline].map(folder => <button className={(collection.items[managed.id]?.folderId || '') === folder.id ? 'chosen' : ''} disabled={saving} key={folder.id} onClick={() => editItem({ folderId: folder.id || null })}><Folder size={13} />{folder.id ? folderPath(collection, folder.id) : folder.name}</button>)}</div>
        {managedBundle ? <div className="bundle-member-setting"><Layers3 size={16} /><p>此文件属于「{managedBundle.name}」联合资料包，不单独编入学习树。</p><button type="button" className="text-button" disabled={saving} onClick={() => { setManagedId(''); editFolder(managedBundle) }}>资料包设置<ChevronRight size={12} /></button></div> : <label className="tree-inclusion"><span><strong>编入学习树</strong><small>参与树状展示与自动分类</small></span><input type="checkbox" role="switch" aria-label="编入学习树" checked={collection.items[managed.id]?.inTree !== false} disabled={saving} onChange={event => editItem({ inTree: event.target.checked })} /><i aria-hidden="true" /></label>}
        {confirmDelete && <div className="maintenance-result">{props.recoverableRemoval ? <><p>仅移除记录会保留磁盘文件；移入回收站后也可恢复，永久删除需在“资料备份与恢复”中另行确认。</p><div className="modal-actions"><button className="secondary" disabled={saving} onClick={() => void perform(() => onDelete(managed.id, 'record'), () => setManagedId(''))}>仅移除记录</button><button className="secondary" disabled={saving} onClick={() => void perform(() => onDelete(managed.id, 'trash'), () => setManagedId(''))}>移入回收站</button></div></> : <><p>当前使用旧版浏览器存储。移除会删除此浏览器中的笔记，请先导出备份。</p><button className="secondary" disabled={saving} onClick={() => void perform(() => onDelete(managed.id), () => setManagedId(''))}>确认移除资料</button></>}</div>}
        {error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-actions"><button className="text-button" disabled={saving} onClick={() => setConfirmDelete(!confirmDelete)}><Trash2 size={13} />{confirmDelete ? '取消移除' : '移除资料'}</button><span className="spacer" /><button className="primary" disabled={saving} onClick={() => setManagedId('')}>完成</button></div>
      </div>
    </Modal>}
    {noteForm && selectedFolder && <Modal title="新建独立笔记" subtitle={folderPath(collection, selectedFolder.id)} onClose={() => { if (!saving) setNoteForm(null) }}><form className="collection-form new-bundle-note" onSubmit={event => { event.preventDefault(); void perform(() => props.onCreateNote(selectedFolder.id, noteForm.title, noteForm.intent), () => setNoteForm(null)) }}>
      <label>笔记名称<input aria-label="笔记名称" autoFocus maxLength={400} value={noteForm.title} placeholder="例如：数学期末复习讲义" onChange={event => setNoteForm({ ...noteForm, title: event.target.value })} /></label>
      <label>整理要求<textarea aria-label="整理要求" rows={4} maxLength={4000} value={noteForm.intent} onChange={event => setNoteForm({ ...noteForm, intent: event.target.value })} /></label>
      <details className="bundle-source-inventory"><summary>{sources.length} 份资料 · 包括下属资料包</summary>{sources.map(source => <div key={source.id}><FileText size={14} /><span>{source.library?.label || source.title}<small>{folderPath(collection, collection.items[source.id]?.folderId)} · {source.sourceState === 'deferred' ? '整理时读取' : `${source.pages.length} 页`}</small></span></div>)}</details>
      <p className="field-help">按要求生成一份独立笔记，之后可以直接编辑、追问或添加小纸条。来源随笔记保存。</p>
      {saving && <p className="field-help" role="status">{props.sourceProgress || '正在准备笔记…'}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" disabled={saving} onClick={() => setNoteForm(null)}>取消</button><button className="primary" disabled={saving || !sources.length || !noteForm.title.trim() || !noteForm.intent.trim()}>创建并打开笔记</button></div>
    </form></Modal>}
  </div>
}
