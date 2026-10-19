import { HelpModal, type HelpAction } from './components/HelpModal'
import { Onboarding } from './components/Onboarding'
import { BrandMark } from './components/BrandMark'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { brand } from '../shared/brand.mjs'
import type { Editor, JSONContent } from '@tiptap/core'
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Library, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, FilePlus2, FileText, Focus, History, Leaf, LoaderCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, Sparkles, Sprout, StickyNote, Trash2, Upload, X } from 'lucide-react'
import { SourceReader } from './components/SourceContext'
import { ContinuousNotes } from './components/ContinuousNotes'
import { ReadingToolbar } from './components/ReadingToolbar'
import { applyVisualTheme, readVisualTheme, saveVisualTheme, type VisualTheme } from './theme'
import { ReadingRoute } from './components/ReadingRoute'
import { LibraryHome, type LibraryFilter } from './components/LibraryHome'
import { AppNavigation, WorkspaceBrand, WorkspaceHeader } from './components/AppShell'
import { LearningControls } from './components/LearningControls'
import { KnowledgeModal } from './components/KnowledgeModal'
import { TemplateStyleModal as CourseStyleModal } from './components/TemplateStyleModal'
import { SettingsModal } from './components/SettingsModal'
import { DiscoverNotesModal } from './components/DiscoverNotesModal'
import { MaintenanceModal } from './components/MaintenanceModal'
import { GenerationRecordsModal } from './components/GenerationRecordsModal'
import { ConflictModal } from './components/ConflictModal'
import { SourceRepair } from './components/SourceRepair'
import { StorageLocation } from './components/StorageLocation'
import { templateRoutingRequest, selectedTemplate } from '../shared/template-routing.mjs'
import { Modal } from './components/Modal'
import { hydrateDemoSources } from './demo'
import * as storage from './storage'
import { applyResult, markdown, paragraph, textOf, uid, withIds } from '../shared/document.mjs'
import { collectReadingLayout, locateReading, sourceAt } from '../shared/reading.mjs'
import { mergeLibrary, orderLibraryDocuments } from '../shared/library.mjs'
import { defaultKnowledge, learnerProfile } from '../shared/learning.mjs'
import { collectionSchema, reconcileCollection, updateCollectionItem } from '../shared/collection.mjs'
import { organizationInput, treeFingerprint, validateTree } from '../shared/study-tree.mjs'
import { defaultEditInstruction } from '../shared/learning-templates.mjs'
import { defaultLearningIntent, normalizeLearningIntent } from '../shared/learning-intent.mjs'
import { commitNotebook, ensureNotebooks, selectNotebook, regenerateNotebook, restoreNotebookVersion, notebookSettings, notebookLabel, notebookKey, notebookStatus } from '../shared/notebooks.mjs'
import { prepareDocument, remainingChapters } from '../shared/preparation.mjs'
import { applyBundlePlan, bundlePlanRequest, captureBundleContext, contextForMaterial, createBundleNote } from '../shared/bundle-context.mjs'
import { repairFormulaDocument } from '../shared/formula-layout.mjs'
import { upgradeMathDocument } from '../shared/math-references.mjs'
import { mathText } from '../shared/math-syntax.mjs'
import { resultRendering, upgradeNoteFormat } from '../shared/note-format.mjs'
import type { Collection, EditRequest, Knowledge, LearnerProfile, LearningSettings, LearningDocument, ModelConfig, SelectionContext, SourcePosition } from './types'

type ModalName = 'import' | 'discover' | 'maintenance' | 'records' | 'conflict' | 'settings' | 'startup-settings' | 'storage-settings' | 'choose-reader' | 'course-style' | 'history' | 'source' | 'references' | 'reference-source' | 'intent' | 'help' | 'knowledge' | 'regenerate' | null
const NotePreview = lazy(() => import('./components/NotePreview').then(module => ({ default: module.NotePreview })))
type Pending = { request: EditRequest; result: any; selection: SelectionContext | null; model: string }
const initialConfig: ModelConfig = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', configured: false, token: '' }
const initialContext: SelectionContext = { from: 1, to: 1, text: '', anchorId: '', label: '' }

function download(name: string, content: string, mime = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function snapshot(doc: LearningDocument, label: string): LearningDocument {
  return { ...doc, versions: [{ id: uid(), time: Date.now(), label, chapters: structuredClone(doc.chapters) }, ...doc.versions].slice(0, 20) }
}

export default function App() {
  const [documents, setDocuments] = useState<LearningDocument[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'library' | 'tree' | 'reader'>('library')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>({ folder: 'all', status: 'all', query: '' })
  const [importFolderId, setImportFolderId] = useState<string | null>(null)
  const [collection, setCollection] = useState<Collection>({ version: 1, folders: [], items: {} })
  const collectionRef = useRef(collection); collectionRef.current = collection
  const collectionWrites = useRef<Promise<void>>(Promise.resolve())
  const [organizing, setOrganizing] = useState(false)
  const [organizeError, setOrganizeError] = useState('')
  const organizationJob = useRef<AbortController | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState('已保存到本机')
  const [saveError, setSaveError] = useState('')
  const [config, setConfig] = useState<ModelConfig>(initialConfig)
  const [configReady, setConfigReady] = useState(false)
  const [readingChoice, setReadingChoice] = useState<{id:string;chapterId?:string}|null>(null)
  const [modal, setModal] = useState<ModalName>(null)
  const [missingDocument, setMissingDocument] = useState<{ id: string; title: string; paths: string[]; canRead: boolean } | null>(null)
  const [importLocation, setImportLocation] = useState<{ title: string; directory: string; resolve: (path: string | null) => void } | null>(null)
  const [toast, setToast] = useState('')
  const [context, setContext] = useState<SelectionContext>(initialContext)
  const [instruction, setInstruction] = useState('')
  const [action, setAction] = useState<EditRequest['action']>('explain')
  const [scope, setScope] = useState<EditRequest['scope']>('selection')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [focused, setFocused] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [progress, setProgress] = useState(0)
  const [chapterProgress, setChapterProgress] = useState(0)
  const [sourcePosition, setSourcePosition] = useState<SourcePosition>({ page: 1, fraction: 0, quote: '', approximate: false })
  const [sourceOverride, setSourceOverride] = useState<number | null>(null)
  const [referenceSource, setReferenceSource] = useState<LearningDocument | null>(null)
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [fontSize, setFontSize] = useState(17)
  const [theme, setTheme] = useState<VisualTheme>(readVisualTheme)
  useEffect(() => { applyVisualTheme(theme) }, [theme])
  const [knowledge, setKnowledge] = useState<Knowledge>(defaultKnowledge)
  const [onboarding, setOnboarding] = useState<'profile' | 'connection' | null>('profile')
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const preparationJob = useRef(false)
  const editors = useRef(new Map<string, Editor>())
  const contextChapter = useRef('')
  const restoredDocument = useRef('')
  const scrollFrame = useRef(0)
  const chapterNavigation = useRef<{ id: string; top: number } | null>(null)
  const article = useRef<HTMLElement | null>(null)
  const promptInput = useRef<HTMLTextAreaElement>(null)
  const abort = useRef<AbortController | null>(null)
  const docsRef = useRef(documents); docsRef.current = documents
  const activeRef = useRef(activeId); activeRef.current = activeId
  const configRef = useRef(config); configRef.current = config
  const doc = documents.find(d => d.id === activeId)
  const docRef = useRef(doc); docRef.current = doc
  const desktopBusy = useRef(false); desktopBusy.current = !!busy || preparing || organizing || exporting || !!pending || onboardingBusy
  const chapter = doc?.chapters.find(c => c.id === doc.currentChapter) || doc?.chapters[0]
  const chapterIndex = doc && chapter ? doc.chapters.findIndex(c => c.id === chapter.id) : 0

  const notify = useCallback((message: string) => setToast(message), [])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer) }, [toast])
  useEffect(() => {
    void (async () => {
      try {
        let stored = (await storage.readDocuments()).map(hydrateDemoSources)
        stored = await Promise.all(stored.map(async document => {
          if (document.storageIssue) return document
          const repaired = ensureNotebooks(upgradeMathDocument(upgradeNoteFormat(repairFormulaDocument(normalizeLearningIntent(document))))) as LearningDocument
          if (repaired !== document) await storage.saveDocument(repaired)
          return repaired
        }))
        const catalog = await fetch('/api/library').then(response => response.ok ? response.json() : null).catch(() => null)
        const removed = await storage.getPreference('removed-library-papers') || []
        const merged = mergeLibrary(stored, Array.isArray(catalog?.documents) ? catalog.documents : [], removed)
        await Promise.all(merged.added.map((paper: LearningDocument) => storage.saveDocument(ensureNotebooks(paper) as LearningDocument)))
        stored = merged.documents.map((paper: LearningDocument) => paper.storageIssue ? paper : ensureNotebooks(paper) as LearningDocument)
        const last = await storage.getPreference('active-document')
        const size = await storage.getPreference('font-size')
        const savedTheme = await storage.getPreference('visual-theme')
        if (['sage','dark','light'].includes(savedTheme)) { setTheme(savedTheme); saveVisualTheme(savedTheme) }
        const learner = await storage.readLearner()
        setKnowledge(learner.knowledge); setOnboarding(learner.step)
        const organization = reconcileCollection(await storage.getPreference('collection'), stored, learner.knowledge) as Collection
        await storage.setPreference('collection', organization)
        setCollection(organization); collectionRef.current = organization
        setDocuments(stored); setActiveId(stored.some(d => d.id === last) ? last : stored[0]?.id || '')
        if (size) setFontSize(size)
      } catch (error) { setLoadError(`无法打开本机资料库：${(error as Error).message}。原数据已保留，请检查保存位置后重新打开。`) }
      finally { setLoading(false) }
    })()
    fetch('/api/config').then(r => r.json()).then(setConfig).catch(() => notify(window.pangzhuDesktop ? '应用连接暂时不可用，请保存笔记后重新打开。' : '模型服务未连接。阅读与编辑仍可使用，请检查本地服务。')).finally(()=>setConfigReady(true))
  }, [notify])
  useEffect(() => {
    if (loading || !doc) return
    setSaved('保存中…')
    const timer = setTimeout(() => { storage.saveDocument(doc).then(() => { setSaved('已保存到本机'); setSaveError('') }).catch(e => { setSaved('保存失败，请立即导出备份'); setSaveError(e.message) }) }, 400)
    return () => clearTimeout(timer)
  }, [doc, loading])
  useEffect(() => {
    const flush = () => { if (docRef.current) void storage.saveDocument(docRef.current).catch(e => setSaveError(e.message)) }
    window.addEventListener('pagehide', flush)
    const visibility = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => { if (activeId) void storage.setPreference('active-document', activeId) }, [activeId])
  useEffect(() => {
    const handler = () => setModal('import')
    window.addEventListener('pangzhu:import', handler)
    return () => window.removeEventListener('pangzhu:import', handler)
  }, [])
  useEffect(() => {
    const handler = () => setModal('help')
    const shortcut = (event: KeyboardEvent) => { if (event.key === 'F1') { event.preventDefault(); handler() } }
    window.addEventListener('pangzhu:help', handler); window.addEventListener('keydown', shortcut)
    return () => { window.removeEventListener('pangzhu:help', handler); window.removeEventListener('keydown', shortcut) }
  }, [])
  useEffect(() => window.pangzhuDesktop?.onCloseRequest(async phase => {
    if (phase === 'status') return { busy: desktopBusy.current }
    abort.current?.abort(); organizationJob.current?.abort()
    const deadline = Date.now() + 10000
    while (preparationJob.current || abort.current || organizationJob.current) {
      if (Date.now() > deadline) throw new Error('任务仍在保存，请稍后再退出。')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    await collectionWrites.current
    if (docRef.current) await storage.saveDocument(docRef.current)
    await storage.flushWrites()
    return {}
  }), [])
  useEffect(() => {
    const handler = (e: Event) => {
      const page = (e as CustomEvent<number>).detail
      if (docRef.current && page >= 1 && page <= docRef.current.pages.length) {
        setSourceOverride(page); setModal('source')
      }
    }
    window.addEventListener('source-page', handler)
    return () => window.removeEventListener('source-page', handler)
  }, [])
  useEffect(() => {
    setContext(initialContext); contextChapter.current = ''; setPending(null); setError(''); setSourceOverride(null)
    const root = article.current
    if (root && chapterNavigation.current) root.scrollTo({ top: root.scrollTop, behavior: 'instant' })
    chapterNavigation.current = null
    restoredDocument.current = ''
  }, [activeId, doc?.activeNotebookId])
  useEffect(() => {
    if (!doc || !article.current || restoredDocument.current === notebookKey(doc) || !doc.chapters.every(c => { const editor = editors.current.get(notebookKey(doc, c.id)); return editor && !editor.isDestroyed })) return
    restoredDocument.current = notebookKey(doc)
    const anchor = doc.readingAnchor
    const targetId = anchor?.chapterId || doc.currentChapter
    const section = Array.from(article.current.querySelectorAll<HTMLElement>('[data-note-chapter]')).find(el => el.dataset.noteChapter === targetId)
    if (!section) return
    const block = anchor?.blockId ? Array.from(section.querySelectorAll<HTMLElement>('[data-block-id]')).find(el => el.dataset.blockId === anchor.blockId) : null
    const target = block || section
    const offset = block ? block.getBoundingClientRect().height * (anchor?.fraction || 0) - 86 : -32
    const top = Math.max(0, target.getBoundingClientRect().top - article.current.getBoundingClientRect().top + article.current.scrollTop + offset)
    // A chapter index opens at the heading. Keep that explicit choice while
    // the editors finish mounting, just as for a click in the reading route.
    // Wheel, touch and keyboard input release the navigation normally.
    if (!block) chapterNavigation.current = { id: targetId, top }
    article.current.scrollTo({ top, behavior: 'instant' })
    const current = doc.chapters.find(c => c.id === targetId) || doc.chapters[0]
    setSourcePosition(sourceAt(current, anchor?.blockId, anchor?.fraction || 0))
    setChapterProgress(0)
  }, [activeId, editorEpoch, doc])
  useEffect(() => () => { cancelAnimationFrame(scrollFrame.current); organizationJob.current?.abort() }, [])
  useEffect(() => {
    const current = docRef.current
    if (!onboarding && view === 'reader' && !loading && !modal && config.configured && current && remainingChapters(current).length > 0 && !current.preparation && !preparationJob.current) void generateRemaining(current)
  }, [onboarding, view, loading, activeId, doc?.activeNotebookId, doc?.preparation, config.configured, modal])
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !modal) { e.preventDefault(); promptInput.current?.focus() }
      if (e.key === 'Escape' && !modal) { setPending(null); setShowExport(false) }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [modal])

  function mutate(update: (doc: LearningDocument) => LearningDocument) {
    setDocuments(current => current.map(d => d.id === activeRef.current ? commitNotebook(update(d)) as LearningDocument : d))
  }
  function changeContent(chapterId: string, content: JSONContent, identity: string) {
    if (!docRef.current || notebookKey(docRef.current) !== identity) return
    mutate(d => ({ ...d, revision: d.revision + 1, updatedAt: Date.now(), chapters: d.chapters.map(c => c.id === chapterId ? { ...c, content, status: textOf(content).trim() ? 'ready' : c.status } : c) }))
  }
  function followReading() {
    const root = article.current, current = docRef.current
    if (!root || !current || restoredDocument.current !== notebookKey(current) || root.clientHeight <= 0) return
    const location = locateReading(current.chapters, collectReadingLayout(root), root.scrollTop, root.clientHeight, root.scrollHeight)
    if (!location) return
    setProgress(location.progress * 100)
    const navigation = chapterNavigation.current
    if (navigation) {
      const destination = Math.max(0, Math.min(navigation.top, root.scrollHeight - root.clientHeight))
      // Intermediate smooth-scroll frames must not undo the explicit chapter
      // choice. A short last chapter may never reach the reading line; keep its
      // heading selected until the reader takes over scrolling again.
      if (Math.abs(root.scrollTop - destination) > 1 || location.chapterId !== navigation.id) return
      chapterNavigation.current = null
    }
    setChapterProgress(location.chapterProgress)
    setSourcePosition({ ...location.source, fraction: Math.round(location.source.fraction * 100) / 100, readingOffset: root.scrollTop })
    setSourceOverride(null)
    if (contextChapter.current && contextChapter.current !== location.chapterId) { setContext(initialContext); contextChapter.current = '' }
    const anchor = { chapterId: location.chapterId, blockId: location.blockId, fraction: Math.round(location.withinBlock * 100) / 100 }
    mutate(d => d.currentChapter === location.chapterId && d.currentPage === location.source.page && JSON.stringify(d.readingAnchor) === JSON.stringify(anchor) ? d : ({ ...d, currentChapter: location.chapterId, currentPage: location.source.page, readingAnchor: anchor }))
  }
  function scheduleReading() {
    cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = requestAnimationFrame(followReading)
  }
  function interruptChapterNavigation() {
    if (!chapterNavigation.current) return
    chapterNavigation.current = null
    const root = article.current
    if (root) root.scrollTo({ top: root.scrollTop, behavior: 'instant' })
    scheduleReading()
  }
  function selectInChapter(id: string, selection?: SelectionContext) {
    contextChapter.current = id
    if (selection) setContext(selection)
    const target = docRef.current?.chapters.find(c => c.id === id)
    if (target) {
      const source = sourceAt(target, selection?.anchorId || docRef.current?.readingAnchor?.blockId, 0)
      setSourcePosition(source)
      mutate(d => ({ ...d, currentChapter: id, currentPage: source.page, readingAnchor: { chapterId: id, blockId: selection?.anchorId || '', fraction: 0 } }))
    }
  }
  async function api(path: string, body: unknown, signal?: AbortSignal) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reading-Tree-Token': configRef.current.token }, body: JSON.stringify(path === '/api/edit' ? { ...(body as object), workspaceToken: configRef.current.workspaceToken } : body), signal })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '请求失败，请重试。')
    return data
  }
  async function saveCollection(value: Collection) {
    const next = collectionSchema.parse(value) as Collection
    const previous = collectionRef.current
    collectionRef.current = next; setCollection(next)
    const write = collectionWrites.current.catch(() => {}).then(() => storage.setPreference('collection', next)).then(() => {})
    collectionWrites.current = write
    try { await write } catch { if (collectionRef.current === next) { collectionRef.current = previous; setCollection(previous) }; throw new Error('资料库整理未能保存，请检查本机存储空间与写入权限。') }
  }
  async function importIdealSource(resource: { filename: string; data: string; url: string; title: string; sourceId: string; intent: string }) {
    if (busy || preparationJob.current) throw new Error('请先暂停当前笔记整理，再导入资料。')
    const links = await storage.getPreference('ideal-source-links') || {}
    const { idealSourceIdentity } = await import('../shared/ideal-tree.mjs')
    const identity = idealSourceIdentity(resource.url)
    const linked = docsRef.current.find(d => d.id === links[resource.sourceId] || identity && (d.id === links[identity] || idealSourceIdentity(d.subtitle?.replace(/^来源：/, '')) === identity))
    if (linked) { switchDocument(linked.id); return linked.id }
    const directory = await confirmImportLocation(resource.title)
    const bytes = Uint8Array.from(atob(resource.data), c => c.charCodeAt(0))
    const file = new File([bytes], resource.filename, { type: /\.pdf$/i.test(resource.filename) ? 'application/pdf' : 'text/plain' })
    const { importMaterial } = await import('./pdf')
    const imported = await importMaterial(file, resource.intent, notify)
    const material = ensureNotebooks({ ...imported, title: resource.title, subtitle: `来源：${resource.url}` }) as LearningDocument
    await storage.importDocument(material, file, directory)
    const next = orderLibraryDocuments([material, ...docsRef.current]) as LearningDocument[]
    await saveCollection(reconcileCollection(collectionRef.current, next, knowledge) as Collection)
    await storage.setPreference('ideal-source-links', { ...links, [resource.sourceId]: material.id, ...(identity ? { [identity]: material.id } : {}) })
    docsRef.current = next; setDocuments(next); switchDocument(material.id)
    notify('资料已导入，学习目标已带入这份笔记')
    return material.id
  }
  function showLibrary(next: 'library' | 'tree' = 'library') {
    if (busy) { notify('请先暂停当前 AI 请求，再返回资料库。'); return }
    if (docRef.current) void storage.saveDocument(docRef.current)
    restoredDocument.current = ''; setModal(null); setView(next); setShowSidebar(false)
  }
  async function confirmImportLocation(title: string) {
    const settings = await storage.storageSettings()
    if (!settings.enabled) return undefined
    const directory = await new Promise<string | null>(resolve => setImportLocation({ title, directory: settings.directory!, resolve }))
    if (directory === null) throw new Error('已取消导入。')
    return directory
  }
  async function showDiscovery() {
    if (desktopBusy.current) { notify('请先完成或暂停当前任务，再识别已有笔记。'); return }
    try { if (docRef.current) await storage.saveDocument(docRef.current); await storage.flushWrites(); setModal('discover') }
    catch (error) { notify((error as Error).message) }
  }
  async function refreshDiscovered(ids: string[]) {
    const found = await storage.readDocuments()
    const next = orderLibraryDocuments(found.map(document => document.storageIssue ? document : ensureNotebooks(document))) as LearningDocument[]
    await saveCollection(reconcileCollection(collectionRef.current, next, knowledge) as Collection)
    const removed: string[] = await storage.getPreference('removed-library-papers') || []
    await storage.setPreference('removed-library-papers', removed.filter(id => !ids.includes(id)))
    docsRef.current = next; setDocuments(next); docRef.current = next.find(document => document.id === activeRef.current)
    setView('library'); setLibraryFilter({ folder: 'all', status: 'all', query: '' })
    notify(ids.length ? `已识别并加入 ${ids.length} 份笔记，原有正文与阅读版本已保留` : '识别目录已记住')
  }
  async function removeDocument(id: string, mode: 'record' | 'trash' | boolean = 'record') {
    if (busy || organizing) throw new Error('请先取消当前整理，再移除资料。')
    const removed = await storage.getPreference('removed-library-papers') || []
    if (config.fileStorage) await storage.maintainWorkspace({ action: 'retire', id, mode: mode === 'trash' ? 'trash' : 'record' })
    else await storage.removeDocument(id, true)
    await storage.setPreference('removed-library-papers', [...new Set([...removed, id])])
    const remaining = docsRef.current.filter(document => document.id !== id)
    await saveCollection(reconcileCollection(collectionRef.current, remaining, knowledge) as Collection)
    docsRef.current = remaining; setDocuments(remaining)
    if (id === activeRef.current) { setActiveId(remaining[0]?.id || ''); docRef.current = remaining[0] }
    notify(!config.fileStorage ? '已从当前浏览器移除资料' : mode === 'trash' ? '已移入回收站 · 可在资料备份与恢复中找回' : '记录已移除，磁盘文件保留 · 可在资料备份与恢复中找回')
  }
  async function showMaintenance() {
    if (desktopBusy.current) { notify('请先完成或暂停当前任务，再备份或恢复。'); return }
    try { if (docRef.current) await storage.saveDocument(docRef.current); await collectionWrites.current; await storage.setPreference('visual-theme', theme); await storage.flushWrites(); setModal('maintenance') }
    catch (e) { notify((e as Error).message) }
  }
  async function renameDocument(id: string, title: string) {
    if (busy || preparationJob.current) throw new Error('请先暂停当前生成，再修改名称。')
    const current = docsRef.current.find(document => document.id === id)
    if (!current) throw new Error('资料或笔记已不存在。')
    if (current.storageIssue) throw new Error('请恢复文件或重新识别资料目录后，再修改名称。')
    if (!title.trim() || title.length > (current.library ? 200 : 400)) throw new Error('名称为空或过长。')
    const next = { ...current, title: title.trim(), ...(current.library ? { library: { ...current.library, label: title.trim() } } : {}), updatedAt: Date.now() }
    await storage.saveDocument(next)
    docsRef.current = docsRef.current.map(document => document.id === id ? next : document); setDocuments(docsRef.current)
    if (activeRef.current === id) docRef.current = next
  }
  async function newBundleNote(folderId: string, title: string, intent: string) {
    if (busy || preparationJob.current) throw new Error('请先暂停当前生成，再新建笔记。')
    const context = captureBundleContext(docsRef.current, collectionRef.current, folderId)
    const directory = await confirmImportLocation(title)
    const note = ensureNotebooks(createBundleNote(context, title, intent)) as LearningDocument
    const nextDocuments = orderLibraryDocuments([note, ...docsRef.current]) as LearningDocument[]
    let nextCollection = reconcileCollection(collectionRef.current, nextDocuments, knowledge) as Collection
    nextCollection = updateCollectionItem(nextCollection, note.id, { folderId, inTree: false }) as Collection
    await collectionWrites.current
    if (directory) { await storage.importDocument(note, undefined, directory); await storage.setPreference('collection', nextCollection) }
    else await storage.saveDocumentInCollection(note, nextCollection)
    collectionRef.current = nextCollection; setCollection(nextCollection)
    docsRef.current = nextDocuments; setDocuments(nextDocuments)
    openDocument(note.id)
  }
  async function organizeLibrary() {
    if (organizationJob.current) return
    if (!configRef.current.configured) { setModal('settings'); return }
    const input = organizationInput(docsRef.current, collectionRef.current)
    if (!input.documents.length) return
    const fingerprint = treeFingerprint(docsRef.current, collectionRef.current)
    const controller = new AbortController(); organizationJob.current = controller
    setOrganizing(true); setOrganizeError('')
    try {
      const data = await api('/api/organize', input, controller.signal)
      if (controller.signal.aborted) return
      if (fingerprint !== treeFingerprint(docsRef.current, collectionRef.current)) throw new Error('整理期间资料或分类发生变化，请重新整理；原学习树已保留。')
      const result = validateTree(input, data.result)
      await saveCollection({ ...collectionRef.current, tree: { ...result, version: 'study-tree-v1', fingerprint, generatedAt: Date.now(), model: data.model } })
      notify('学习树已整理，画像与笔记保持不变')
    } catch (error) { if ((error as Error).name !== 'AbortError') setOrganizeError((error as Error).message) }
    finally { organizationJob.current = null; setOrganizing(false) }
  }
  function switchDocument(id: string, chapterId?: string) {
    if (busy) { notify('请先取消当前 AI 请求，再切换资料。'); return }
    if (!configReady) { notify('正在读取阅读设置，请稍后打开资料。'); return }
    if (docsRef.current.find(document => document.id === id)?.entryType === 'note') { openDocument(id, chapterId); return }
    if (configRef.current.startupMode === 'manual') {setReadingChoice({id,chapterId});setModal('choose-reader');return}
    openDocument(id,chapterId,configRef.current.startupMode)
  }
  async function openDocument(id: string, chapterId?: string, mode?: string, readSaved = false) {
    let target = docsRef.current.find(document => document.id === id)
    if (!target) return
    try {
      const status = await storage.inspectDocument(id)
      if (status.missing.length || target.storageIssue) {
        const paths = status.missing.length ? status.missing : target.storageIssue!.missing
        const canRead = !!target.chapters.length && !paths.includes(status.notePath || '') && !target.storageIssue?.error
        if (!readSaved || !canRead) { setMissingDocument({ id, title: target.title, paths, canRead }); setModal(null); return }
        target = { ...target, storageIssue: { missing: paths, notePath: status.notePath!, sourcePath: status.sourcePath } }
      }
    } catch (error) { notify((error as Error).message); return }
    // Older running servers have no startupMode field; keep their last edition
    // until upgraded. The current server explicitly defaults to adaptive.
    const selected = !readSaved && mode && target.entryType !== 'note' ? selectNotebook(target,mode) as LearningDocument : target
    const chapter = selected.chapters.find(chapter => chapter.id === chapterId)
    const next = chapter ? commitNotebook({ ...selected, currentChapter: chapter.id, currentPage: chapter.sourcePages[0], readingAnchor: { chapterId: chapter.id, blockId: '', fraction: 0 } }) as LearningDocument : selected
    if (docRef.current) void storage.saveDocument(docRef.current)
    if (next !== target) {docsRef.current=docsRef.current.map(document=>document.id===id?next:document);setDocuments(docsRef.current);void storage.saveDocument(next)}
    docRef.current = next; activeRef.current = id; restoredDocument.current = ''
    if (readSaved) { docsRef.current = docsRef.current.map(document => document.id === id ? next : document); setDocuments(docsRef.current) }
    setActiveId(id); setView('reader'); setModal(null); setShowSidebar(false);setReadingChoice(null)
    if (collectionRef.current.items[id]?.status === 'imported') void saveCollection(updateCollectionItem(collectionRef.current, id, { status: 'studying' }) as Collection).catch(error => notify(error.message))
  }
  async function switchNotebook(id: string) {
    if (busy || preparationJob.current || !docRef.current) return
    const current = docRef.current
    const next = commitNotebook(upgradeMathDocument(upgradeNoteFormat(repairFormulaDocument(selectNotebook(current, id))))) as LearningDocument
    if (next === current) return
    cancelAnimationFrame(scrollFrame.current); clearSelection(); setPending(null); setError(''); setInstruction(''); setSourceOverride(null)
    editors.current.clear()
    restoredDocument.current = ''; setProgress(0); setChapterProgress(0)
    docRef.current = next
    setDocuments(items => items.map(d => d.id === next.id ? next : d))
    await storage.saveDocument(next)
  }
  async function regenerateCurrentNotebook() {
    if (docRef.current?.storageIssue) { notify('请恢复原文后重新打开，再重新生成笔记。'); return }
    if (busy || preparationJob.current || !docRef.current) return
    if (!configRef.current.configured) { setModal('settings'); return }
    let next = regenerateNotebook(docRef.current) as LearningDocument
    if (next.entryType === 'note') next = { ...next, composition: { version: 1, planned: false } }
    clearSelection(); setPending(null); setError(''); restoredDocument.current = ''
    docRef.current = next
    setDocuments(items => items.map(d => d.id === next.id ? next : d))
    await storage.saveDocument(next)
    setModal(null)
  }
  function switchChapter(id: string) {
    const root = article.current
    const target = root && Array.from(root.querySelectorAll<HTMLElement>('[data-note-chapter]')).find(el => el.dataset.noteChapter === id)
    if (!root || !target) return
    const top = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - 32))
    cancelAnimationFrame(scrollFrame.current)
    chapterNavigation.current = { id, top }
    setContext(initialContext); contextChapter.current = ''; setSourceOverride(null); setChapterProgress(0)
    const chapter = docRef.current!.chapters.find(c => c.id === id)!
    setSourcePosition(sourceAt(chapter, '', 0))
    mutate(d => ({ ...d, currentChapter: id, currentPage: chapter.sourcePages[0], readingAnchor: { chapterId: id, blockId: '', fraction: 0 } }))
    root.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    scheduleReading()
    setShowSidebar(false)
  }
  function addNote(targetChapter = docRef.current?.currentChapter) {
    if (docRef.current?.storageIssue) return
    const editor = doc && editors.current.get(notebookKey(doc, targetChapter))
    if (!editor || !doc || !chapter) return
    const { $from } = editor.state.selection
    let position = $from.depth ? $from.after(1) : editor.state.doc.content.size
    if (contextChapter.current !== targetChapter && doc.readingAnchor?.chapterId === targetChapter) {
      editor.state.doc.forEach((node, offset) => { if (node.attrs.id === doc.readingAnchor?.blockId) position = offset + node.nodeSize })
    }
    mutate(d => snapshot(d, '添加小纸条之前'))
    editor.chain().focus().insertContentAt(position, withIds({ type: 'explanation', attrs: { title: '我的理解', sourcePages: [], origin: 'user' }, content: [paragraph('在这里写下你的理解或问题。')] })).run()
    notify('纸条已贴在当前段落后，可以直接编辑。')
  }
  function makeRequest(current: LearningDocument, requestedAction: EditRequest['action'], requestedScope: EditRequest['scope'], prompt: string, targetChapter?: string, settings = notebookSettings(current), background: LearnerProfile = knowledge): EditRequest {
    const target = current.chapters.find(c => c.id === (targetChapter || current.currentChapter))!
    const selection = contextChapter.current === target.id ? context : initialContext
    const readingBlock = current.readingAnchor?.chapterId === target.id ? current.readingAnchor.blockId : ''
    return { action: requestedAction, scope: requestedScope, instruction: prompt, revision: current.revision, notebookId: current.activeNotebookId, chapterId: target.id, anchorId: selection.anchorId || readingBlock || target.content.content?.[0]?.attrs?.id, selection: selection.text,
      learning: settings, documentId: current.id, ...(settings.mode === 'adaptive' ? { knowledge: learnerProfile(background) } : {}),
      bundleContext: current.entryType === 'note' ? undefined : current.preparation?.sourceContext,
      composition: current.entryType === 'note',
      document: { title: current.title, intent: current.intent, chapters: current.chapters, pages: current.pages } }
  }
  async function requestEdit(override?: EditRequest['action'], prompt?: string, targetChapter?: string) {
    if (!doc || busy) return
    if (doc.storageIssue) { notify('当前只读查看已保存笔记。请恢复原文后重新打开，再进行编辑。'); return }
    if (!config.configured) { setModal('settings'); return }
    const selectedAction = override || action
    if (selectedAction === 'generate') return
    if (selectedAction === 'rewrite' && !context.text) { setError('先在正文中选中要改写的文字，再告诉 AI 你的想法。'); return }
    const request = makeRequest(doc, selectedAction, selectedAction === 'style' ? scope === 'document' ? 'document' : 'chapter' : 'selection', prompt || instruction.trim() || defaultEditInstruction(notebookSettings(doc), selectedAction), targetChapter)
    const submittedSelection = { ...context }
    clearSelection()
    setBusy('正在结合原文思考…'); setError(''); setPending(null)
    abort.current = new AbortController()
    try {
      const data = await api('/api/edit', request, abort.current.signal)
      setPending({ request, result: data.result, selection: submittedSelection, model: data.model })
    } catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message) }
    finally { setBusy(''); abort.current = null }
  }
  function clearSelection() {
    const editor = doc && editors.current.get(notebookKey(doc, contextChapter.current))
    if (editor && !editor.isDestroyed) {
      editor.chain().setMeta('reading-tree-clear-selection', true).setMeta('addToHistory', false).setTextSelection(editor.state.selection.to).run()
      const native = window.getSelection()
      if (native?.anchorNode && editor.view.dom.contains(native.anchorNode)) native.removeAllRanges()
    }
    setContext(initialContext); contextChapter.current = ''
  }
  function applyPending() {
    if (!pending || !doc) return
    try {
      if (doc.activeNotebookId !== pending.request.notebookId || doc.revision !== pending.request.revision) throw new Error('笔记已在生成期间发生变化。为保留你的编辑，请重新发起修改。')
      const before = snapshot(doc, `${pending.request.action === 'explain' ? '添加 AI 纸条' : pending.request.action === 'rewrite' ? '选区改写' : pending.request.action === 'style' ? '风格调整' : '生成本章'}之前`)
      if (pending.request.action === 'rewrite') {
        const editor = editors.current.get(notebookKey(doc, pending.request.chapterId))
        if (!editor || !pending.selection) throw new Error('原选区已失效，请重新选中文字。')
        const { from, to, text } = pending.selection
        if (editor.state.doc.textBetween(from, to, '\n', mathText) !== text) throw new Error('原选区内容已变化，请重新选择。')
        mutate(() => before)
        editor.chain().focus().command(({ tr }) => {
          const marks = tr.doc.resolve(from).marks().map(mark => mark.toJSON())
          const nodes = resultRendering('rewrite', pending.result).inline.map((node: JSONContent) => editor.schema.nodeFromJSON(node.type === 'text' ? { ...node, marks: [...marks.filter(mark => !node.marks?.some(m => m.type === mark.type)), ...(node.marks || [])] } : node))
          tr.replaceWith(from, to, nodes); return true
        }).run()
      } else {
        const updated = applyResult(before, pending.request, pending.result) as LearningDocument
        mutate(() => updated)
      }
      setPending(null); setInstruction(''); setContext(initialContext); notify('已写入学习笔记 · 可在修改记录中撤销')
    } catch (e) { setError((e as Error).message) }
  }
  async function generateRemaining(target?: LearningDocument) {
    let current = target || docRef.current
    if (current?.storageIssue) return
    if (!current || busy || preparationJob.current || current.preparation?.status === 'complete') return
    if (!configRef.current.configured) { setModal('settings'); return }
    preparationJob.current = true; setPreparing(true)
    abort.current = new AbortController(); setError(''); setPending(null); setBusy(`正在生成${notebookLabel(current)}笔记…`)
    const signal = abort.current.signal
    try {
      const persist = async (updated: LearningDocument) => {
        if (!current || !docRef.current || notebookKey(docRef.current) !== notebookKey(current)) throw new Error('当前笔记已切换，生成已停止。')
        updated = commitNotebook(updated) as LearningDocument
        docRef.current = updated; docsRef.current = docsRef.current.map(d => d.id === updated.id ? updated : d); setDocuments(docsRef.current)
        await storage.saveDocument(updated)
      }
      if (current.entryType === 'note' && !current.composition?.planned) {
        // Persist the planning checkpoint first: failures cannot trigger an
        // automatic retry loop, and closing the app keeps the frozen sources.
        current = { ...current, preparation: { startedAt: Date.now(), ...current.preparation, status: 'running', completedIds: [], errors: {}, settings: notebookSettings(current), knowledge: current.preparation?.knowledge || learnerProfile(knowledge), templateRouting: 'pending' } }
        await persist(current)
        const before = current
        try {
          setBusy('正在按整理要求规划章节与资料覆盖…')
          const data = await api('/api/edit', bundlePlanRequest(before), signal)
          signal.throwIfAborted()
          const latest = docRef.current!
          if (latest.revision !== before.revision || latest.intent !== before.intent) throw new Error('规划期间笔记发生编辑，请重新继续。')
          current = applyBundlePlan(latest, data.result) as LearningDocument
          editors.current.clear(); restoredDocument.current = ''; setProgress(0); setChapterProgress(0)
          await persist(current)
        } catch (failure) {
          const latest = docRef.current!
          await persist({ ...latest, preparation: { ...current.preparation!, status: signal.aborted ? 'paused' : 'partial', errors: signal.aborted ? {} : { __plan: (failure as Error).message.slice(0, 2000) } } })
          throw failure
        }
      }
      const result = await prepareDocument({ document: current, settings: notebookSettings(current), knowledge,
        sourceContext: current.entryType === 'note' ? undefined : current.preparation ? current.preparation.sourceContext : contextForMaterial(current, docsRef.current, collectionRef.current),
        selectTemplate: async (source: LearningDocument, requestSignal: AbortSignal) => {
          setBusy('正在根据资料内容与学习目标选择模板…')
          const library = await storage.readTemplates()
          const data = await api('/api/edit', templateRoutingRequest(source, library), requestSignal)
          return selectedTemplate(library, data.result)
        },
        getLatest: () => docRef.current || current,
        save: persist, signal,
        onProgress: ({ chapter, done, total }: { chapter: { title: string }; done: number; total: number }) => setBusy(`${notebookLabel(current)} · 已完成 ${done}/${total} · ${chapter.title}`),
        request: async (latest: LearningDocument, chapterId: string, settings: LearningSettings, background: LearnerProfile, requestSignal: AbortSignal) => {
          const request = makeRequest(latest, 'generate', 'chapter', latest.entryType === 'note' ? '按学习目标及本节分工整合所分配的来源全文，写成完整正文；保留关键知识、公式与条件。' : '按所选阅读方式完整处理目标章节，忠实保留原文的全部实质内容、公式和论证。', chapterId, settings, background)
          return (await api('/api/edit', request, requestSignal)).result
        },
      })
      if (result.preparation.status === 'complete') notify('全文笔记已就绪。之后的追问与修改会留在这份笔记里。')
      else if (!signal.aborted) notify('已保存完成章节，未完成部分可继续初始化。')
    } catch (e) { if ((e as Error).name !== 'AbortError') setError(`${(e as Error).message} 已完成章节已保留。`) }
    finally { setBusy(''); setPreparing(false); preparationJob.current = false; abort.current = null }
  }
  async function saveKnowledge(value: Knowledge) { setKnowledge(await storage.saveLearner(value, 'complete')) }
  async function resetKnowledge() {
    if (desktopBusy.current) throw new Error('请先完成或暂停正在进行的任务，再清除画像。')
    setKnowledge(await storage.resetLearner()); setOnboarding('profile'); setModal(null); setView('library')
  }
  async function finishReading() {
    if (!doc) return
    try { await saveCollection(updateCollectionItem(collectionRef.current, doc.id, { status: 'completed' }) as Collection); notify('已移入「已完成」，学习画像保持不变。') }
    catch { setError('学习状态保存失败，请检查本机存储空间与写入权限后重试。') }
  }
  const cancelRequest = () => { abort.current?.abort(); notify('已取消。已保存的笔记不受影响。') }
  async function exportNotes(format: 'pdf' | 'markdown' | 'backup' = 'pdf') {
    if (!doc || exporting) return
    const name = `${doc.title} · ${format === 'backup' ? '全部笔记' : notebookLabel(doc)}`.replace(/[<>:"/\\|?*]/g, '_')
    setShowExport(false)
    if (format === 'pdf') {
      setExporting(true)
      try {
        const currentNotes = { title: doc.title, subtitle: doc.subtitle, notebookLabel: notebookLabel(doc), demo: doc.demo, intent: doc.intent, chapters: doc.chapters, pages: doc.pages, entryType: doc.entryType }
        const articleWidth = Math.max(280, Math.min(1920, article.current?.querySelector('.learning-article')?.getBoundingClientRect().width || 920))
        const viewportWidth = Math.max(320, Math.min(7680, window.innerWidth))
        const response = await fetch('/api/export/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reading-Tree-Token': configRef.current.token }, body: JSON.stringify({ document: currentNotes, fontSize, articleWidth, viewportWidth, theme }) })
        if (!response.ok) throw new Error((await response.json()).error || 'PDF 导出失败')
        const url = URL.createObjectURL(await response.blob())
        const link = document.createElement('a'); link.href = url; link.download = `${name}.pdf`; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        notify('长 PDF 已导出，保留正文排版、色彩和小纸条')
      } catch (e) { setError((e as Error).message) }
      finally { setExporting(false) }
      return
    }
    const backup = format === 'backup'
    download(`${name}.${backup ? 'json' : 'md'}`, backup ? JSON.stringify({ format: 'reading-tree-v1', document: commitNotebook(doc) }, null, 2) : markdown(doc), backup ? 'application/json' : undefined)
    notify(backup ? '笔记备份已导出（含原文文字，不含 PDF 文件）' : '已导出 Markdown，包含全部小纸条')
  }
  if (loading) return <div className="boot"><BrandMark size={40} /><span>打开你的阅读空间…</span></div>
  if (loadError) return <div className="boot"><h2>资料库暂时无法打开</h2><p>{loadError}</p><button className="primary" onClick={() => location.reload()}>重新打开</button></div>
  function helpAction(action: HelpAction) {
    if (action === 'library' || action === 'tree') { setModal(null); showLibrary(action) }
    else setModal(action)
  }
  const help = modal === 'help' && <HelpModal initialTopic={view === 'reader' ? 'reading' : 'start'} onClose={() => setModal(null)} onAction={onboarding ? undefined : helpAction} fileStorage={config.fileStorage} />
  if (onboarding) return <><Onboarding step={onboarding} knowledge={knowledge} config={config} configReady={configReady} theme={theme} onTheme={next => { setTheme(next); saveVisualTheme(next); void storage.setPreference('visual-theme', next) }} onHelp={() => setModal('help')} onBack={() => setOnboarding('profile')} api={api} onConfig={data => setConfig(previous => ({ ...previous, ...data }))} onBusy={setOnboardingBusy}
    onProfile={async profile => { setKnowledge(await storage.saveLearner({ ...knowledge, ...profile }, 'connection')); setOnboarding('connection') }}
    onFinish={async () => { setKnowledge(await storage.saveLearner(knowledge, 'complete')); setModal(null); setView('library'); setOnboarding(null) }} />{help}</>
  const emptyCount = doc ? remainingChapters(doc).length : 0
  const wordCount = doc?.chapters.reduce((total, c) => total + textOf(c.content).replace(/\s/g, '').length, 0) || 0
  const noteCount = doc?.chapters.reduce((total, c) => total + (c.content.content?.filter(n => n.type === 'explanation').length || 0), 0) || 0
  const contextLabel = context.text ? `已选中 ${context.text.length} 字` : context.label ? `光标所在段落 · ${context.label.slice(0, 18)}…` : '在正文中选择一句话，或将光标放在一个段落'

  return <>
    <div className={`application-shell view-${view}`}>
    <AppNavigation view={view} canRead={!!doc} onNavigate={next => { if (next === 'reader') { if (view === 'reader') setModal(null); else if (doc) switchDocument(doc.id) } else showLibrary(next) }} onImport={() => { setImportFolderId(null); setModal('import') }} onProfile={() => setModal('knowledge')} onHelp={() => setModal('help')} onSettings={() => setModal('settings')} />
    {view !== 'reader' && <LibraryHome documents={documents} collection={collection} knowledge={knowledge} activeId={activeId} view={view} onView={showLibrary}
      sidebarOpen={showSidebar} onToggleSidebar={() => setShowSidebar(!showSidebar)} onCloseSidebar={() => setShowSidebar(false)} recoverableRemoval={config.fileStorage}
      filter={libraryFilter} onFilter={setLibraryFilter} onSave={saveCollection} onOpen={switchDocument} onImport={folderId => { setImportFolderId(folderId || null); setModal('import') }} onDiscover={config.fileStorage ? () => void showDiscovery() : undefined} onDelete={removeDocument} onRename={renameDocument} onCreateNote={newBundleNote} onProfile={() => setModal('knowledge')}
      theme={theme} onTheme={next => { setTheme(next); saveVisualTheme(next); void storage.setPreference('visual-theme', next) }} organizing={organizing} organizeError={organizeError} onOrganize={() => void organizeLibrary()} onCancel={() => organizationJob.current?.abort()}
      configured={config.configured} onSettings={() => setModal('settings')} idealApi={body => api('/api/edit', body)} onIdealImport={importIdealSource} />}
    {view === 'reader' && doc && chapter && <div className={`workspace ${focused ? 'focus-mode' : ''} ${showSidebar ? 'sidebar-open' : ''}`}>
    <aside className="study-sidebar">
      <WorkspaceBrand onHome={() => showLibrary()} />
      <div className="document-meta"><span className="eyebrow">正在阅读</span><h1 title={doc.title}>{doc.title}</h1><p title={doc.subtitle}>{doc.subtitle}</p><button className="intent-pill" title={doc.intent} onClick={() => setModal('intent')}><Leaf size={13} /> 我的学习目标 <ChevronRight size={12} /></button>{(doc.sourceContext || doc.preparation?.sourceContext) && <button className="intent-pill" onClick={() => setModal('references')}><FileText size={13} />参考资料 · {(doc.sourceContext || doc.preparation?.sourceContext)!.sources.length} 份<ChevronRight size={12} /></button>}<LearningControls document={doc} locked={!!busy || preparing} onKnowledge={() => setModal('knowledge')} onChange={id => { void switchNotebook(id).catch(e => setError(e.message)) }} onRegenerate={() => setModal('regenerate')} /></div>
      <ReadingRoute document={doc} currentIndex={chapterIndex} progress={chapterProgress} onNavigate={switchChapter} />
      <div className="sidebar-source"><SourceReader documents={documents} document={doc} position={sourcePosition} chapterTitle={chapter.title} onExpand={() => { setSourceOverride(null); setModal('source') }} /></div>
      <div className="sidebar-footer"><span className="small-seed">✧</span> 理解，在每一次追问中生长。</div>
    </aside>
    <main className="main-workspace">
      <WorkspaceHeader className="workspace-header" theme={theme} onTheme={next => { setTheme(next); saveVisualTheme(next); void storage.setPreference('visual-theme', next) }} actions={<>
        <span className={`save-indicator ${saved.includes('失败') ? 'save-error' : ''}`} title={saveError}><span />{saved}</span>{saveError.includes('其他应用修改') && <button className="quiet-button" onClick={() => setModal('conflict')}>处理保存冲突</button>}
        <button className="icon-button" title="修改记录" aria-label="修改记录" onClick={() => setModal('history')}><History size={16} /></button>
        <div className="export-wrap"><button className="quiet-button" title="导出笔记" aria-label="导出笔记" disabled={exporting} onClick={() => setShowExport(!showExport)}>{exporting ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}<span>{exporting ? '导出中…' : '导出'}</span></button>{showExport && <div className="export-menu"><button onClick={() => void exportNotes()}>长 PDF · 保留排版与色彩</button><button onClick={() => void exportNotes('markdown')}>Markdown · 纯文本笔记</button><button onClick={() => void exportNotes('backup')}>JSON · 全部阅读方式备份</button></div>}</div>
      </>}>
        <button className="icon-button mobile-toggle" aria-label="展开章节导航" onClick={() => setShowSidebar(!showSidebar)}><PanelLeftOpen size={19} /></button><button className="icon-button focus-toggle" title={focused ? '退出专注模式' : '收起侧栏'} aria-label={focused ? '退出专注模式' : '收起侧栏'} onClick={() => setFocused(!focused)}>{focused ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button><button className="breadcrumb-home" onClick={() => showLibrary()}>资料库</button><ChevronRight size={12} /><span className="breadcrumb-current">{chapter.title}</span>
      </WorkspaceHeader>
      <div className="reading-progress"><div style={{ width: `${progress}%` }} /></div>
      <ReadingToolbar editor={editors.current.get(notebookKey(doc, chapter.id))} readOnly={readOnly} onReadOnly={() => setReadOnly(!readOnly)} onFontSize={() => { const next = fontSize >= 21 ? 16 : fontSize + 1; setFontSize(next); void storage.setPreference('font-size', next) }} />
      <section className="article-scroll" ref={article} onScroll={scheduleReading}
        onWheel={interruptChapterNavigation} onTouchStart={interruptChapterNavigation} onPointerDown={interruptChapterNavigation}
        onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interruptChapterNavigation() }}>
        {(emptyCount > 0 || preparing) && <div className="preparation-banner" role="status"><div className="preparation-heading"><span>{preparing ? <LoaderCircle className="spin" size={18} /> : <Sprout size={20} />} 生成{notebookLabel(doc)}笔记</span><small>{doc.chapters.length - emptyCount} / {doc.chapters.length} 章</small></div><p>{preparing ? busy : doc.preparation ? '这份笔记尚未生成完。继续时只处理未完成章节。' : '首次选择时生成全文，逐章保存。之后切换直接打开已保存的笔记。'}</p><progress aria-label="全文整理进度" max={doc.chapters.length} value={doc.chapters.length - emptyCount} />{!preparing && <button className="secondary" disabled={!!busy} onClick={() => void generateRemaining()}>{config.configured ? doc.preparation ? '继续未完成部分' : '生成这份笔记' : '连接模型，生成笔记'}</button>}{doc.preparation && Object.keys(doc.preparation.errors).length > 0 && <details><summary>{Object.keys(doc.preparation.errors).length} 个问题待处理 · 查看原因</summary>{Object.entries(doc.preparation.errors).map(([id, message]) => <p key={id}><b>{id === '__plan' ? '整理规划' : id === '__template' ? '模板选择' : doc.chapters.find(c => c.id === id)?.title}</b> · {message}</p>)}</details>}</div>}
        <ContinuousNotes document={doc} fontSize={fontSize} readOnly={readOnly || preparing || !!doc.storageIssue}
          highlight={context.text && !busy && !pending ? { chapterId: contextChapter.current, from: context.from, to: context.to } : undefined}
          onChange={(id, content) => changeContent(id, content, notebookKey(doc))} onSelection={(id, selection) => { if (docRef.current && notebookKey(docRef.current) === notebookKey(doc)) selectInChapter(id, selection) }}
          onReady={(id, editor) => { editors.current.set(notebookKey(doc, id), editor); setEditorEpoch(n => n + 1) }}
          onAddNote={addNote} onFinish={() => void finishReading()} finished={collection.items[doc.id]?.status === 'completed'}
          onSource={id => { setSourceOverride(doc.chapters.find(c => c.id === id)!.sourcePages[0]); setModal('source') }} />
      </section>
      <div className="composer-dock">
        {context.text && !pending && !busy && <div className="selection-bar"><span>“{context.text.slice(0, 42)}{context.text.length > 42 ? '…' : ''}”</span><button onClick={() => { setAction('explain'); void requestEdit('explain', defaultEditInstruction(notebookSettings(doc), 'explain')) }}><LightbulbIcon /> 人话讲解</button><button onClick={() => { setAction('rewrite'); promptInput.current?.focus() }}>改写这句</button><button aria-label="清除选区" onClick={clearSelection}><X size={13} /></button></div>}
        {pending && <div className="suggestion-panel"><div className="suggestion-heading"><span><Sparkles size={15} /> {pending.request.action === 'explain' ? '一张新的讲解纸条' : pending.request.action === 'generate' ? '本章笔记已整理' : '修改建议已就绪'}</span><button aria-label="放弃建议" onClick={() => setPending(null)}><X size={16} /></button></div><p className="suggestion-summary">{doc.chapters.find(c => c.id === pending.request.chapterId)?.title} · {pending.result.summary}</p><div className="suggestion-preview">{pending.result.title && <strong>{pending.result.title}</strong>}<Suspense fallback={<span>...</span>}><NotePreview action={pending.request.action} result={pending.result} /></Suspense></div><div className="suggestion-footer"><span>{pending.request.action === 'generate' && doc.chapters.find(c => c.id === pending.request.chapterId)?.status === 'ready' ? '应用后替换本章 · 原版本会保留' : pending.request.action === 'explain' ? '将插入所选段落之后' : '修改可通过历史记录恢复'}</span><button className="quiet-button" onClick={() => setPending(null)}>放弃</button><button className="primary" onClick={applyPending}><Check size={14} /> 写入笔记</button></div></div>}
        <div className={`ai-composer ${busy ? 'is-busy' : ''}`}>
          <div className="composer-top"><div className="composer-context"><Sparkles size={14} /><span>{busy || (action === 'style' ? scope === 'document' ? '调整整份资料的笔记风格' : '调整当前章节的笔记风格' : contextLabel)}</span></div><div className="composer-mode"><select aria-label="AI 编辑模式" value={action} disabled={!!busy} onChange={e => { setAction(e.target.value as EditRequest['action']); setError('') }}><option value="explain">添加讲解纸条</option><option value="rewrite">改写选中文字</option><option value="style">调整笔记风格</option></select>{action === 'style' && <select aria-label="修改范围" value={scope === 'document' ? 'document' : 'chapter'} onChange={e => setScope(e.target.value as EditRequest['scope'])}><option value="chapter">当前章节</option><option value="document">整份资料</option></select>}</div></div>
          <div className="composer-input-row"><textarea ref={promptInput} aria-label="向 AI 提出编辑诉求" placeholder={action === 'explain' ? '这里没懂？让 AI 换个角度讲讲…' : action === 'style' ? '比如：用更直观的语言讲解，保留公式和我的补充…' : action === 'rewrite' ? '想怎么改这句话？' : '告诉 AI 你希望这章如何整理…'} rows={1} value={instruction} disabled={!!busy} onChange={e => setInstruction(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void requestEdit() } }} />{busy ? <button className="send-button cancel" title="取消生成" aria-label="取消生成" onClick={cancelRequest}><X size={17} /></button> : <button className="send-button" title="交给 AI（Enter）" aria-label="发送 AI 编辑请求" onClick={() => void requestEdit()}><ArrowUp size={18} /></button>}</div>
          <div className="composer-bottom"><div>{busy ? <><LoaderCircle size={12} className="spin" /> {preparing ? '逐章保存 · 已完成章节不会重复生成' : '完成后预览，确认后写入正文'}</> : <><span className="context-dot" /> 已带上原文与当前笔记 <span className="composer-shortcut">↵ 发送 · Shift ↵ 换行</span></>}</div><button onClick={() => addNote()} disabled={readOnly || preparing || !!doc.storageIssue}><Plus size={12} /> 手写纸条</button></div>
        </div>
        {error && <div className="request-error" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}><X size={14} /></button></div>}
        <div className="workspace-footnote"><span>{wordCount.toLocaleString()} 字 · {noteCount} 张小纸条</span><span>{doc.storageIssue ? '只读查看已保存笔记 · 原文待恢复' : doc.demo ? '示例内容用于体验，未调用模型' : config.fileStorage ? '学习笔记自动保存于本机资料目录' : '学习笔记自动保存于当前浏览器'}{emptyCount > 0 && !doc.storageIssue && <button onClick={() => void generateRemaining()} disabled={!!busy}>继续生成 ({emptyCount})</button>}</span></div>
      </div>
    </main>
    {showSidebar && <button className="mobile-shade" aria-label="收起章节导航" onClick={() => setShowSidebar(false)} />}
    </div>}
    </div>
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    {modal === 'knowledge' && <KnowledgeModal knowledge={knowledge} onSave={saveKnowledge} onReset={resetKnowledge} onClose={() => setModal(null)} />}
    {(modal === 'settings'||modal==='startup-settings'||modal==='storage-settings') && <SettingsModal key={modal} initialSection={modal==='storage-settings'?'storage':modal==='startup-settings'?'startup':'model'} config={config} onClose={() => setModal(null)} onCourseStyle={() => setModal('course-style')} onDiscover={() => void showDiscovery()} onMaintenance={() => void showMaintenance()} api={api} onSave={data => { setConfig(previous=>({ ...previous, ...data })) }} />}
    {modal === 'discover' && <DiscoverNotesModal onClose={() => setModal(null)} onAdded={refreshDiscovered} />}
    {modal === 'maintenance' && <MaintenanceModal onClose={() => setModal(null)} />}
    {modal === 'records' && doc && <GenerationRecordsModal id={doc.id} onClose={() => setModal(null)} />}
    {modal === 'conflict' && doc && <ConflictModal document={doc} onClose={() => setModal(null)} />}
    {modal === 'course-style' && <CourseStyleModal configured={config.configured} api={api} onClose={() => setModal(null)} onModel={() => setModal('settings')} onStartup={()=>setModal('startup-settings')} onStorage={()=>setModal('storage-settings')} />}
    {modal==='choose-reader'&&readingChoice&&<Modal title="选择这次的阅读方式" subtitle={documents.find(d=>d.id===readingChoice.id)?.title} onClose={()=>{setReadingChoice(null);setModal(null)}}><div className="startup-choice">{(['translation','adaptive'] as const).map(mode=><button key={mode} onClick={()=>openDocument(readingChoice.id,readingChoice.chapterId,mode)}><strong>{mode==='translation'?'纯翻译':'适应性讲解'}</strong><span>{notebookStatus(documents.find(d=>d.id===readingChoice.id)?.notebooks?.[mode])} · {mode==='translation'?'忠实保留原文':'按画像与目标展开讲解'}</span></button>)}<p>已有笔记直接打开；未生成的版本会在选定后整理。两份笔记分别保存。</p></div></Modal>}
    {modal === 'import' && <ImportModal configured={config.configured} onClose={() => setModal(null)} onImport={async (material, file, directory) => {
      if (busy || preparationJob.current) throw new Error('请先暂停当前整理，再导入其他资料。')
      material = ensureNotebooks(upgradeMathDocument(upgradeNoteFormat(repairFormulaDocument(normalizeLearningIntent(material))))) as LearningDocument
      if (docRef.current) await storage.saveDocument(docRef.current)
      await storage.importDocument(material, file, directory)
      const nextDocuments = orderLibraryDocuments([material, ...docsRef.current]) as LearningDocument[]
      let nextCollection = reconcileCollection(collectionRef.current, nextDocuments, knowledge) as Collection
      const targetFolder = nextCollection.folders.find(folder => folder.id === importFolderId)
      if (targetFolder) nextCollection = updateCollectionItem(nextCollection, material.id, { folderId: targetFolder.id }) as Collection
      await saveCollection(nextCollection)
      setLibraryFilter({ folder: targetFolder?.id || 'all', status: 'all', query: '' })
      setDocuments(nextDocuments); setActiveId(material.id); setModal(null); setView('library')
      activeRef.current = material.id; docRef.current = material
      notify(`已导入 ${material.pages.length} 页资料，分为 ${material.chapters.length} 个阅读章节`)
    }} />}
    {modal === 'source' && doc && chapter && <Modal title="回到原文" subtitle={doc.filename} onClose={() => setModal(null)} wide><div className="source-modal-content"><SourceReader documents={documents} document={doc} position={sourceOverride === null ? sourcePosition : { page: sourceOverride, fraction: 0, quote: '', approximate: false }} chapterTitle={chapter.title} expanded /></div></Modal>}
    {modal === 'reference-source' && referenceSource && <Modal title={referenceSource.title} subtitle="保存的参考原文" onClose={() => setModal('references')} wide><div className="source-modal-content"><SourceReader document={referenceSource} position={{ page: 1, fraction: 0, quote: '', approximate: false }} expanded /></div></Modal>}
    {modal === 'references' && doc && <Modal title="这份笔记的参考资料" subtitle={(doc.sourceContext || doc.preparation?.sourceContext)?.folderName} onClose={() => setModal(null)}><div className="reference-inventory"><p>保存于 {new Date((doc.sourceContext || doc.preparation?.sourceContext)!.capturedAt).toLocaleDateString('zh-CN')}。来源文字随笔记保留；文件夹的后续变化不会自动改写已有笔记。</p>{(doc.sourceContext || doc.preparation?.sourceContext)!.sources.map(source => <button key={source.id} onClick={() => { const original = documents.find(document => document.id === source.id); setReferenceSource({ ...doc, id: source.id, title: source.title, pages: source.pages, entryType: undefined, kind: original?.kind || 'text', library: original?.library, demo: original?.demo, filename: original?.filename || source.title }); setModal('reference-source') }}><FileText size={18} /><span>{source.title}<small>{source.path} · {source.pages.length} 页{!documents.some(document => document.id === source.id) && ' · 原资料已移除，仍保留文字来源'}</small></span></button>)}</div></Modal>}
    {modal === 'intent' && doc && <IntentModal intent={doc.intent} onClose={() => setModal(null)} onSave={intent => { mutate(d => ({ ...d, intent, intentSource: 'user', revision: d.revision + 1 })); setModal(null); notify('学习目标已更新，将用于后续生成、讲解和编辑') }} />}
    {modal === 'regenerate' && doc && <Modal title={`重新生成${notebookLabel(doc)}笔记`} subtitle="将按当前模板重新处理全文。" onClose={() => setModal(null)}>
      <div className="confirmation-content">
        <p>当前正文和小纸条会先存入这份笔记的修改记录，再开始重新生成。其他阅读方式的笔记保持原样。</p>
        <div className="modal-actions">
          <button className="secondary" onClick={() => setModal(null)}>保留当前笔记</button>
          <button className="primary" disabled={!!busy} onClick={() => { void regenerateCurrentNotebook().catch(e => setError(e.message)) }}>重新生成这份笔记</button>
        </div>
      </div>
    </Modal>}
    {modal === 'history' && doc && <Modal title="笔记的生长记录" subtitle={`${notebookLabel(doc)} · 保留最近 20 次修改前的版本，恢复仅影响当前笔记。`} onClose={() => setModal(null)}><div className="version-list">{config.fileStorage && <button className="secondary" onClick={() => setModal('records')}>查看生成来源与调用记录</button>}{doc.versions.length ? doc.versions.map(version => <div className="version-item" key={version.id}><History size={18} /><div><strong>{version.label}</strong><span>{new Date(version.time).toLocaleString('zh-CN')}</span></div><button className="secondary" disabled={!!busy} onClick={() => { mutate(d => restoreNotebookVersion(snapshot(d, '恢复历史版本之前'), version.chapters) as LearningDocument); setPending(null); setModal(null); notify('已恢复历史笔记，之后的版本仍保留在记录中') }}>恢复</button></div>) : <div className="modal-empty"><History size={28} /><p>还没有 AI 修改记录</p><span>直接编辑正文时，可用 Ctrl / ⌘ + Z 撤销。<br />AI 修改之前会自动保存版本。</span></div>}</div></Modal>}
    {missingDocument && <Modal title="找不到文件" subtitle={missingDocument.title} onClose={() => setMissingDocument(null)}><div className="confirmation-content"><p>文件可能已被移动或删除。可恢复到原位置，或通过“识别已有笔记”关联移动后的目录。</p>{missingDocument.paths.map(path => <p className="missing-file-path" key={path}>{path}</p>)}{missingDocument.canRead && <SourceRepair id={missingDocument.id} />}<p className="field-help">移除记录不会删除仍然存在的资料或笔记文件。</p><div className="modal-actions"><button className="secondary" onClick={() => setMissingDocument(null)}>保留记录</button>{missingDocument.canRead && <button className="secondary" onClick={() => { void openDocument(missingDocument.id, undefined, undefined, true); setMissingDocument(null) }}>只读打开笔记</button>}<button className="primary" onClick={() => void removeDocument(missingDocument.id, true).then(() => setMissingDocument(null)).catch(error => notify(error.message))}>移除失效记录</button></div></div></Modal>}
    {importLocation && <Modal title="确认保存位置" subtitle={importLocation.title} onClose={() => { importLocation.resolve(null); setImportLocation(null) }}><div className="settings-form"><StorageLocation value={importLocation.directory} onChange={directory => setImportLocation(current => current ? { ...current, directory } : null)} /><div className="modal-actions"><button className="secondary" onClick={() => { importLocation.resolve(null); setImportLocation(null) }}>取消</button><button className="primary" disabled={!importLocation.directory.trim()} onClick={() => { importLocation.resolve(importLocation.directory); setImportLocation(null) }}>确认保存位置</button></div></div></Modal>}
    {help}
  </>
}

function LightbulbIcon() { return <Sparkles size={13} /> }

function ImportModal({ configured, onClose, onImport }: { configured: boolean; onClose: () => void; onImport: (document: LearningDocument, file: File, directory?: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null), [intent, setIntent] = useState(defaultLearningIntent)
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [location, setLocation] = useState<storage.StorageSettings | null>(null)
  useEffect(() => { void storage.storageSettings().then(setLocation).catch(error => setError(error.message)) }, [])
  const submit = async () => {
    if (!file) return
    setBusy('正在读取资料…'); setError('')
    try { const { importMaterial } = await import('./pdf'); const doc = await importMaterial(file, intent.trim(), setBusy); await onImport(doc, file, location?.enabled ? location.directory : undefined) }
    catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  return <Modal title="开始一段新的学习" subtitle="一篇论文，一份讲义，或一章你一直想弄懂的知识。" onClose={() => { if (!busy) onClose() }}>
    <div className="import-form">
      <button className={`drop-zone ${dragging ? 'dragging' : ''}`} disabled={!!busy} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]) }}><span className="upload-circle">{file ? <FileText size={26} /> : <Upload size={26} />}</span><strong>{file?.name || '把学习资料拖到这里'}</strong><span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · 点击重新选择` : '或点击选择文件 · PDF / Markdown / TXT · 或 JSON 备份'}</span><small>文本型 PDF，最大 50 MB</small></button>
      <input ref={input} type="file" accept=".pdf,.md,.markdown,.txt,.json" hidden onChange={e => { setFile(e.target.files?.[0] || null); setError('') }} />
      <label>这次，你想学会什么？<textarea rows={3} value={intent} onChange={e => setIntent(e.target.value)} maxLength={4000} /></label>
      <p className="field-help">默认只求看懂原文；有特别关注的问题时，可以自行修改。</p>
      {location?.enabled && <StorageLocation value={location.directory || ''} onChange={directory => setLocation(current => current ? { ...current, directory } : null)} disabled={!!busy} />}
      <p className="import-initialization">{configured ? '进入资料时按设置中的阅读启动方式打开；两种笔记分别保存。' : '导入后请连接模型；阅读启动方式可在设置中调整。'}</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="modal-actions"><span className="field-help">{location?.enabled ? '确认此位置并导入，文件保存在本机资料目录' : '资料保存在这台设备的浏览器中'}</span><div className="spacer" /><button className="primary" disabled={!file || !!busy || !intent.trim() || !location || (location.enabled && !location.directory?.trim())} onClick={() => void submit()}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}{busy || '添加到资料库'}</button></div>
    </div>
  </Modal>
}

function IntentModal({ intent, onClose, onSave }: { intent: string; onClose: () => void; onSave: (intent: string) => void }) {
  const [value, setValue] = useState(intent)
  return <Modal title="带着目标去阅读" subtitle="学习目标决定讲解重点与推理深度，文风保持一致。" onClose={onClose}><div className="intent-form"><label>我的学习目标<textarea aria-label="我的学习目标" autoFocus value={value} rows={6} onChange={e => setValue(e.target.value)} maxLength={4000} /></label><p className="field-help">保存后用于后续生成、讲解和编辑；调整现有全文请使用「重新生成」。纯翻译保留完整原文，目标仅用于术语与语境判断。</p><div className="modal-actions"><button className="primary" disabled={!value.trim()} onClick={() => onSave(value.trim())}>保存学习目标</button></div></div></Modal>
}

