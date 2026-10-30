import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronRight, Compass, ExternalLink, GitBranch, Layers3, LoaderCircle, Pause, Play, Plus, RotateCcw, Search, Sparkles, Trash2, Wrench, X } from 'lucide-react'
import type { Knowledge, LearningDocument } from '../types'
import { idealInput, idealNodeResources, idealSourceIdentity } from '../../shared/ideal-tree.mjs'
import { getPreference } from '../storage'
import { CourseSamplePreview } from './CourseSamplePreview'
import { Modal } from './Modal'
import { fitIdealCanopy } from '../ideal-tree-layout'

type Node = { id: string; parentId: string | null; kind: 'knowledge' | 'reading' | 'practice' | 'experience'; title: string; body: string; outcome: string; dependsOn: string[]; priority: string; deliverable: string; feedback: string }
type Branch = { id: string; title: string; purpose: string; dependsOn: string[]; requirementIds: string[] }
type Source = { id: string; title: string; url?: string; level: string; extent: string; documentId?: string; importable?: boolean; attribution?: string; arxivId?: string }
type Selection = { nodeId: string; sourceIds: string[]; explanation: string; evidence: { sourceId: string; quote: string }[] }
type Job = { id: string; revision: number; goal: string; status: string; stage: string; error?: string; createdAt: number; model: string; promptVersion: string;
  edition?: number; rebuild?: { sourceId:string; suggestion:string; reason:string; includeReview:boolean };
  pathReport?: { status:string; errors:string[]; branchOrder:string[]; requirements:{id:string;label:string;outcome:string;tasks:{branchId:string;branchTitle:string;nodeId:string;title:string;kind:string;outcome:string;deliverable:string;feedback:string}[]}[] };
  contract?: { title: string; summary: string; assumptions: string[]; excluded: string[]; requirements: { id: string; label: string; outcome: string }[] };
  skeleton?: { branches: Branch[] }; branches: Record<string, { branchId: string; nodes: Node[] }>;
  research: Record<string, { selections: Selection[]; problems: string[] }>; sources: Source[];
  paperResearch?: Record<string, Record<string, {status:string;stage:string;error?:string;selection?:Selection}>>;
  issues: { branchId: string; nodeId: string | null; severity: string; problem: string; repair: string }[];
  review?: { summary: string }; metrics: { modelCalls: number; toolCalls: number; completionTokens: number; repairs: number };
  gaps?: {branchId:string;nodeId:string;explanation:string}[];
  activity?: {stage:string;branchId?:string;attempt:number;startedAt:number};
  events: { at: number; stage?: string; type: string; accepted?: boolean; elapsedMs?: number; issue?:string;reason?:string }[];
}
type Summary = { id: string; title: string; status: string; stage: string; nodes: number; createdAt: number; edition?:number }
type Props = { documents: LearningDocument[]; knowledge: Knowledge; configured: boolean; onSettings: () => void;
  api: (body: Record<string, unknown>) => Promise<any>; onOpen: (id: string) => void;
  onImport: (resource: { filename: string; data: string; url: string; title: string; sourceId: string; intent: string }) => Promise<string> }
const labels: Record<string, string> = { running: '正在生长', paused: '已暂停', failed: '构建中断', complete: '已完成', review: '已完成' }
const kinds = { knowledge: '知识与能力', reading: '阅读资料', practice: '项目实践', experience: '情境经验' }
const iconFor = { knowledge: GitBranch, reading: BookOpen, practice: Wrench, experience: Compass }
const findingPapers = (job: Job | null) => !!job && Object.values(job.paperResearch || {}).some(branch => Object.values(branch).some(state => state.status === 'running'))

export function IdealTree({ documents, knowledge, configured, onSettings, api, onOpen, onImport }: Props) {
  const [trees, setTrees] = useState<Summary[]>([]), [job, setJob] = useState<Job | null>(null)
  const [goal, setGoal] = useState(''), [creating, setCreating] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [branchId, setBranchId] = useState(''), [parentId, setParentId] = useState<string | null>(null), [selectedId, setSelectedId] = useState(''), [query, setQuery] = useState('')
  const [diagnostics, setDiagnostics] = useState(false), [imports, setImports] = useState<Record<string,string>>({})
  const [loading, setLoading] = useState(true), [searchBranch, setSearchBranch] = useState('')
  const [rebuilding, setRebuilding] = useState<Job | null>(null), [suggestion, setSuggestion] = useState(''), [reason, setReason] = useState(''), [includeReview, setIncludeReview] = useState(false)
  const [deleting, setDeleting] = useState<{id:string;title:string} | null>(null)
  const rebuildRequest = useRef({ key:'', id:'', revision:0 })
  const [rebuildBusy, setRebuildBusy] = useState('')
  const rebuildInFlight = useRef(false)
  const organism = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 800, height: 450 })
  const [paths, setPaths] = useState<{width:number;height:number;curves:string[]}>({width:0,height:0,curves:[]})
  const apiRef = useRef(api); apiRef.current = api
  const request = useRef({ goal: '', id: '' }), selection = useRef(0), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { let active=true; void getPreference('ideal-source-links').then(links=>{if(active) setImports(links || {})}).catch(()=>{}); return ()=>{active=false} }, [])
  const command = async (body: Record<string, unknown>) => (await apiRef.current({ action: 'ideal-tree', ...body })).result
  useEffect(() => {
    let active = true
    setLoading(true)
    command({ command: 'list' }).then(data => { if (active) setTrees(data.trees) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [configured])
  const paperRunning = findingPapers(job)
  useEffect(() => {
    if (!job || deleting || job.status !== 'running' && !paperRunning) return
    let active = true, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { const result = await command({ command: 'get', id: job.id }); if (!active) return; setJob(result.job); setError(''); timer = setTimeout(poll, 1800) }
      catch (e) { if (active) { setError((e as Error).message); timer = setTimeout(poll, 5000) } }
    }
    timer = setTimeout(poll, 1200)
    return () => { active = false; clearTimeout(timer) }
  }, [job?.id, job?.status, paperRunning, deleting])
  async function perform(label: string, task: () => Promise<void>) {
    setBusy(label); setError('')
    try { await task() } catch (e) { if (mounted.current) setError((e as Error).message) } finally { if (mounted.current) setBusy('') }
  }
  function resetFocus() { setBranchId(''); setParentId(null); setSelectedId(''); setQuery(''); setSearchBranch(''); setDiagnostics(false) }
  async function open(id: string) {
    const ticket = ++selection.current
    await perform('打开', async () => { const data = await command({ command: 'get', id }); if (ticket !== selection.current || !mounted.current) return; setJob(data.job); setCreating(false); resetFocus() })
  }
  async function create() {
    if (!configured) { onSettings(); return }
    if (request.current.goal !== goal) request.current = { goal, id: crypto.randomUUID() }
    await perform('开始构建', async () => {
      const data = await command({ command: 'create', input: idealInput(goal, knowledge, documents), requestId: request.current.id })
      if (!mounted.current) return
      setJob(data.job); setCreating(false); setGoal(''); request.current = { goal:'', id:'' }; resetFocus(); setTrees((await command({ command: 'list' })).trees)
    })
  }
  async function rebuild() {
    if (!rebuilding || rebuildInFlight.current) return
    if (!configured) { onSettings(); return }
    const body = { command:'rebuild', id:rebuilding.id, suggestion:suggestion.trim(), reason:reason.trim(), includeReview }
    const key = JSON.stringify(body)
    const ticket = selection.current
    rebuildInFlight.current = true; setRebuildBusy('核对当前状态'); setError('')
    try {
      if (rebuildRequest.current.key !== key) {
        const latest: Job = (await command({ command:'get', id:rebuilding.id })).job
        if (!mounted.current || selection.current !== ticket) return
        setJob(latest)
        if (findingPapers(latest)) throw new Error('当前正在查找论文。可以等待完成，或先暂停论文查找，再生成新版本。')
        if (!['complete','review'].includes(latest.status)) throw new Error('当前学习树尚未完成，请先返回继续构建。')
        rebuildRequest.current = { key, id:crypto.randomUUID(), revision:latest.revision }
      }
      setRebuildBusy('开始重建')
      const data = await command({ ...body, revision:rebuildRequest.current.revision, requestId:rebuildRequest.current.id })
      if (!mounted.current || selection.current !== ticket) return
      setJob(data.job); setRebuilding(null); resetFocus(); rebuildRequest.current = { key:'', id:'', revision:0 }
      setTrees((await command({ command:'list' })).trees)
    } catch (e) { if (mounted.current) setError((e as Error).message) }
    finally { rebuildInFlight.current = false; if (mounted.current) setRebuildBusy('') }
  }
  async function pauseRebuildResearch() {
    if (!rebuilding || rebuildInFlight.current) return
    const ticket = selection.current
    rebuildInFlight.current = true; setRebuildBusy('暂停论文查找'); setError('')
    try {
      const data = await command({ command:'pause', id:rebuilding.id })
      if (mounted.current && selection.current === ticket) setJob(data.job)
    } catch (e) { if (mounted.current) setError((e as Error).message) }
    finally { rebuildInFlight.current = false; if (mounted.current) setRebuildBusy('') }
  }
  function showRebuild() { setRebuilding(job); setSuggestion(''); setReason(''); setIncludeReview(false); setError(''); rebuildRequest.current = {key:'',id:'',revision:0} }
  async function removeTree() {
    if (!deleting) return
    const id = deleting.id
    await perform('删除学习树', async () => {
      await command({ command:'delete', id, confirm:true })
      if (!mounted.current) return
      ++selection.current
      setTrees(previous => previous.filter(tree => tree.id !== id))
      if (job?.id === id) { setJob(null); resetFocus() }
      setDeleting(null)
    })
  }
  const total = job ? Object.values(job.branches).reduce((n,b) => n+b.nodes.length,0) : 0
  const branch = job?.skeleton?.branches.find(b => b.id === branchId), nodes = job?.branches[branchId]?.nodes || []
  const selected = nodes.find(n => n.id === selectedId), parent = nodes.find(n => n.id === parentId)
  const results = useMemo(() => job ? Object.values(job.branches).flatMap(b => b.nodes.map(node => ({ branchId: b.branchId, node }))).filter(({ node }) => query.trim() && (node.title + node.body).toLowerCase().includes(query.trim().toLowerCase())) : [], [job,query])
  const currentNodes = nodes.filter(n => n.parentId === parentId)
  const resultBranches = job?.skeleton?.branches.filter(b => results.some(result => result.branchId === b.id)) || []
  const groupedSearch = results.length > 12 && resultBranches.length > 1 && !searchBranch
  const visibleResults = searchBranch ? results.filter(result => result.branchId === searchBranch) : results
  const visibleCount = query ? groupedSearch ? resultBranches.length : visibleResults.length : !branch ? job?.skeleton?.branches.length || 0 : currentNodes.length
  const canopy = fitIdealCanopy(visibleCount, viewport.width, viewport.height)
  useLayoutEffect(() => {
    const element = organism.current
    if (!element) return
    const measure = () => setViewport(previous => {
      const next = { width: element.clientWidth, height: element.clientHeight }
      return previous.width === next.width && previous.height === next.height ? previous : next
    })
    const observer = new ResizeObserver(measure); observer.observe(element); measure()
    return () => observer.disconnect()
  }, [job?.id])
  useLayoutEffect(() => {
    const root = organism.current
    if (!root) return
    const measure = () => {
      const box = root.getBoundingClientRect(), anchor = root.querySelector('.ideal-tree-root svg')?.getBoundingClientRect()
      if (!anchor) return
      const x = anchor.left + anchor.width / 2 - box.left, y = anchor.top - box.top
      const curves = Array.from(root.querySelectorAll('.ideal-bough,.ideal-leaf')).map(el => {
        const leaf = el.getBoundingClientRect(), tx = leaf.left + leaf.width / 2 - box.left, ty = leaf.bottom - box.top
        return `M${x},${y} C${x},${y-70} ${tx},${ty+65} ${tx},${ty}`
      })
      setPaths(previous => { const next = { width:box.width,height:box.height,curves }; return JSON.stringify(previous) === JSON.stringify(next) ? previous : next })
    }
    const observer = new ResizeObserver(measure); observer.observe(root); root.addEventListener('animationend',measure); measure()
    return () => { observer.disconnect(); root.removeEventListener('animationend',measure) }
  }, [job?.id, job?.revision, branchId, parentId, query, searchBranch, viewport.width, viewport.height, canopy.columns, canopy.rows, canopy.density])
  const chooseBranch = (id: string) => { setBranchId(id); setParentId(null); setSelectedId(''); setQuery(''); setSearchBranch(''); setDiagnostics(false) }
  const chooseNode = (id: string) => { setSelectedId(id); setDiagnostics(false) }
  const selectedResources: {sourceId:string;explanation:string;quote:string;viaTitle:string}[] = job ? idealNodeResources(job,branchId,selectedId) : []
  const paperState = job?.paperResearch?.[branchId]?.[selectedId]
  const linkedDocument = (source:Source) => source.documentId || imports[source.id] || imports[idealSourceIdentity(source.url)] || documents.find(d=>!!idealSourceIdentity(source.url) && idealSourceIdentity(d.subtitle?.replace(/^来源：/,''))===idealSourceIdentity(source.url))?.id
  const path: Node[] = []
  let cursor = parent
  while (cursor && path.length < 40) { path.unshift(cursor); cursor = nodes.find(n => n.id === cursor!.parentId) }
  async function importSource(source: Source) {
    const linked = linkedDocument(source)
    if (linked && documents.some(d => d.id === linked)) { onOpen(linked); return }
    const treeId=job!.id, intent=selected?.outcome || '看懂这篇文章'
    await perform(`下载并导入 ${source.title}`, async () => {
      const data = await command({ command: 'resource', id: treeId, sourceId: source.id })
      const id = await onImport({ ...data, sourceId: source.id, title: source.title, intent })
      if (mounted.current) setImports(previous => ({ ...previous, [source.id]: id }))
    })
  }
  async function findPapers() {
    if(!configured) { onSettings(); return }
    const ticket=selection.current, treeId=job!.id
    await perform('开始查找论文',async()=>{
      const data=await command({command:'papers',id:treeId,branchId,nodeId:selectedId,refresh:!!paperState})
      if(mounted.current && selection.current===ticket) setJob(data.job)
    })
  }
  return <section className="ideal-tree" aria-label="理想学习树" onKeyDown={event => { if (event.key === 'Escape' && !(event.target as HTMLElement).closest('dialog')) { setSelectedId(''); setDiagnostics(false) } }}>
    <header className="tree-heading ideal-heading"><div><span className="collection-eyebrow">A MAP OF WHAT YOU COULD BECOME</span><h1>理想学习树<span>让每一条枝干，都通向想学会的事。</span></h1></div>
      <button className="primary" onClick={() => { setCreating(true); setError('') }}><Plus size={15} />新的目标</button>
    </header>
    {error && !creating && !rebuilding && !deleting && <p className="inline-error" role="alert">{error}</p>}
    {!job && <div className="ideal-entry">
      <div className="ideal-saved-heading"><h2>已保存的目标</h2><span>{trees.length} 份学习路径</span></div>
      {loading ? <div className="ideal-saved-empty" role="status"><LoaderCircle size={24} className="spin"/><p>正在打开你的目标…</p></div> : trees.length ? <div className="ideal-saved" aria-label="已保存的目标">{trees.map((tree,index) => <div className="ideal-saved-card" key={tree.id}><button className="ideal-saved-open" onClick={() => void open(tree.id)} disabled={!!busy}><span className="ideal-saved-mark" aria-hidden="true"><GitBranch size={24} strokeWidth={1.2}/><small>{String(index+1).padStart(2,'0')}</small></span><span className="ideal-saved-copy"><strong>{tree.title}</strong><small><i className={tree.status}/>{labels[tree.status]} · {tree.nodes} 个节点 · 第 {tree.edition || 1} 版</small></span><ArrowUpRight size={16} /></button><button className="icon-button ideal-saved-delete" aria-label={`删除目标 ${tree.title}`} title="删除目标" disabled={!!busy} onClick={() => { setError(''); setDeleting(tree) }}><Trash2 size={15}/></button></div>)}</div> : <div className="ideal-saved-empty">
        <div className="ideal-seed-art" aria-hidden="true"><svg viewBox="0 0 400 220"><path d="M200 210 C200 145 188 130 200 80 M200 164 C160 140 130 160 94 100 M200 130 C250 130 275 85 310 64 M200 96 C169 83 151 53 137 25 M200 82 C224 64 234 43 238 14" /><circle cx="94" cy="100" r="5"/><circle cx="310" cy="64" r="6"/><circle cx="137" cy="25" r="4"/><circle cx="238" cy="14" r="4"/></svg></div>
        <h2>留一个想抵达的方向</h2><p>保存你的学习目标，让知识、资料与实践逐步展开。</p><button className="secondary" onClick={() => { setCreating(true); setError('') }}><Plus size={14}/>创建第一个目标</button>
      </div>}
    </div>}
    {creating && <Modal title="你希望学会什么？" subtitle="描述一个方向、贴上一份能力要求，或说说你想独立完成的事。" onClose={() => setCreating(false)}>
      <form className="ideal-goal-form" onSubmit={event => { event.preventDefault(); if (!busy && (!configured || goal.trim().length >= 4)) void create() }}>
        <label htmlFor="ideal-goal">我的学习目标</label><textarea autoFocus id="ideal-goal" value={goal} maxLength={12000} onChange={e => setGoal(e.target.value)} placeholder="例如：我想独立做出一个可靠的资料问答工具。已经会 Python，希望理解检索原理、学会评估结果，并完成一个能展示的项目。" rows={6} />
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="ideal-goal-footer"><span>以当前学习画像作为起点<br/>构建进度自动保存</span><button className="primary" disabled={!!busy || configured && goal.trim().length < 4}>{busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{configured ? '构建理想学习树' : '连接模型'}</button></div>
      </form>
    </Modal>}
    {rebuilding && <Modal title="重建学习树" subtitle="按原目标或你的调整建议生成新版本，原版本继续保留。" onClose={() => { if (!rebuildInFlight.current) setRebuilding(null) }}>
      <form className="ideal-goal-form ideal-rebuild-form" onSubmit={event => { event.preventDefault(); void rebuild() }}>
        <p className="ideal-rebuild-context">{rebuilding.contract?.title || rebuilding.goal} · 第 {rebuilding.edition || 1} 版</p>
        <label htmlFor="ideal-rebuild-suggestion">希望怎样调整？</label><textarea autoFocus id="ideal-rebuild-suggestion" value={suggestion} maxLength={6000} disabled={!!rebuildBusy} onChange={e => setSuggestion(e.target.value)} rows={3} placeholder="例如：加强检索评估的基础，把部署部分收紧，增加一个贯穿各阶段的实践。" />
        <label htmlFor="ideal-rebuild-reason">为什么这样调整？</label><textarea id="ideal-rebuild-reason" value={reason} maxLength={3000} disabled={!!rebuildBusy} onChange={e => setReason(e.target.value)} rows={2} placeholder="例如：目前更需要理解如何判断检索效果，暂时不需要大规模部署。" />
        {!!rebuilding.issues.length && <label className="ideal-review-choice"><input type="checkbox" checked={includeReview} disabled={!!rebuildBusy} onChange={e => setIncludeReview(e.target.checked)} />同时参考原版本的审查备注</label>}
        {paperRunning && <div className="ideal-notice" role="status">当前正在查找论文，可以等待完成，也可以暂停后重建。已找到的资料会保留。<button type="button" className="text-button" disabled={!!rebuildBusy} onClick={() => void pauseRebuildResearch()}>暂停论文查找</button></div>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="ideal-goal-footer"><span>原目标与稳定画像继续作为起点<br/>本次会重新调用模型，生成完整学习树</span><button className="primary" disabled={!!rebuildBusy}>{rebuildBusy ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}{rebuildBusy || (configured ? '生成新版本' : '连接模型')}</button></div>
      </form>
    </Modal>}
    {deleting && <Modal title="删除理想学习树" subtitle={deleting.title} onClose={() => { if (!busy) setDeleting(null) }}><div className="ideal-goal-form"><p>此目标的学习树和构建记录将被删除，正在进行的构建或论文查找会先停止。已导入资料库的资料、笔记以及其他版本会保留。</p><p>删除后无法撤销。</p>{error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" disabled={!!busy} onClick={() => setDeleting(null)}>保留目标</button><button className="secondary danger" disabled={!!busy} onClick={() => void removeTree()}>{busy ? <LoaderCircle size={14} className="spin"/> : <Trash2 size={14}/>}确认删除</button></div></div></Modal>}
    {job && <>
      <div className="ideal-toolbar"><div><button className="ideal-back" onClick={() => { ++selection.current; setJob(null); resetFocus(); void command({ command: 'list' }).then(data => setTrees(data.trees)).catch(e => setError(e.message)) }}><ArrowLeft size={14} />全部目标</button><span className={`ideal-status ${job.status}`}>{job.status === 'running' && <LoaderCircle className="spin" size={12} />}{['complete','review'].includes(job.status) ? '学习路径构建完成' : job.stage}</span></div><div>
        {job.status === 'running' ? <button className="secondary" disabled={!!busy} onClick={() => void perform('暂停', async () => { setJob((await command({ command: 'pause', id: job.id })).job) })}><Pause size={13} />暂停</button> : ['paused','failed'].includes(job.status) && <button className="primary" disabled={!!busy} onClick={() => void perform('继续', async () => { setJob((await command({ command: 'resume', id: job.id })).job) })}><Play size={13} />继续构建</button>}
        {['complete','review'].includes(job.status) && <button className="secondary" aria-label="重建学习树" onClick={showRebuild}><RotateCcw size={13}/>重建</button>}
        <button className="icon-button" title="导出学习树与构建记录" aria-label="导出理想学习树" onClick={() => void perform('导出', async () => { const { artifact } = await command({ command: 'export', id: job.id }); const url = URL.createObjectURL(new Blob([JSON.stringify(artifact,null,2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${job.contract?.title || '理想学习树'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000) })}><ArrowDownToLine size={16} /></button>
        <button className="secondary" aria-expanded={diagnostics} onClick={() => { setDiagnostics(!diagnostics); setSelectedId('') }}>构建记录</button>
        <button className="icon-button" aria-label="删除理想学习树" title="删除此目标" disabled={!!busy} onClick={() => { setError(''); setDeleting({id:job.id,title:job.contract?.title || job.goal}) }}><Trash2 size={16}/></button>
      </div></div>
      {job.error && <p className="ideal-notice" role="status">{job.error}</p>}
      <div className="ideal-workspace">
        <div className="ideal-landscape">
          <div className="ideal-map-title"><h2>{job.contract?.title || '正在理解你的目标'}</h2><span>第 {job.edition || 1} 版 · {job.skeleton?.branches.length || 0} 条主干 · {total} 个节点</span></div>
          <div className="ideal-map-controls"><nav className="ideal-trail" aria-label="理想树路径"><button onClick={resetFocus}>全景</button>{query ? <><ChevronRight size={11}/><button onClick={() => setSearchBranch('')}>搜索 · {results.length} 个结果</button>{searchBranch && <span><ChevronRight size={11}/>{job.skeleton?.branches.find(b => b.id === searchBranch)?.title}</span>}</> : <>{branch && <><ChevronRight size={11} /><button onClick={() => chooseBranch(branch.id)}>{branch.title}</button></>}{path.map(n => <span key={n.id}><ChevronRight size={11} /><button onClick={() => { setParentId(n.id); setSelectedId('') }}>{n.title}</button></span>)}</>}</nav>
          {total > 0 && <label className="ideal-search"><Search size={14} /><input aria-label="搜索理想学习树节点" placeholder="在整棵树中寻找…" value={query} onChange={e => { setQuery(e.target.value); setSearchBranch('') }} />{query && <button aria-label="清除节点搜索" onClick={() => { setQuery(''); setSearchBranch('') }}><X size={13}/></button>}</label>}</div>
          <div className={`ideal-organism density-${canopy.density}`} ref={organism}>
          <svg className="ideal-growth-lines" width={paths.width} height={paths.height} aria-hidden="true">{paths.curves.map((path,i) => <path key={i} d={path}/>)}</svg>
          <div className={`ideal-canopy ${!branch && !query ? 'ideal-overview' : ''}`} style={{ gridTemplateColumns: `repeat(${canopy.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${canopy.rows}, minmax(0, 1fr))`, gap: canopy.gap }} key={`${branchId}/${parentId}/${!!query}/${searchBranch}`}>
            {query ? groupedSearch ? resultBranches.map(b => <button key={b.id} className="ideal-bough" onClick={() => setSearchBranch(b.id)} title={b.title}><span className="ideal-kicker">匹配的分支</span><h3>{b.title}</h3><p>{b.purpose}</p><span className="ideal-bough-foot">{results.filter(r => r.branchId === b.id).length} 个匹配节点<ArrowUpRight size={14}/></span></button>) : visibleResults.length ? visibleResults.map(({ branchId: b, node }) => <button className="ideal-leaf" key={`${b}/${node.id}`} title={node.title} onClick={() => { setBranchId(b); setParentId(node.parentId); setSelectedId(node.id); setQuery(''); setSearchBranch(''); setDiagnostics(false) }}><span className="ideal-kicker">{kinds[node.kind]}</span><h3>{node.title}</h3><p>{node.outcome}</p></button>) : <p className="ideal-empty">没有匹配的节点。</p>
              : !branch ? job.skeleton?.branches.map((b,index) => <button key={b.id} className="ideal-bough" title={b.title} onClick={() => chooseBranch(b.id)}><span className="ideal-bough-number">{String(index+1).padStart(2,'0')}</span><h3>{b.title}</h3><p>{b.purpose}</p><span className="ideal-bough-foot">{job.branches[b.id] ? `${job.branches[b.id].nodes.length} 个节点` : '等待展开'}<ArrowUpRight size={14}/></span></button>)
              : currentNodes.map(node => { const Icon = iconFor[node.kind], children = nodes.filter(n => n.parentId === node.id), resourceState = job.research[branchId]?.selections.find(s => s.nodeId === node.id); return <button key={node.id} title={node.title} className={`ideal-leaf ${node.kind} ${node.id === selectedId ? 'selected' : ''}`} onClick={() => chooseNode(node.id)}><span className="ideal-kicker"><Icon size={13}/>{kinds[node.kind]}{node.priority === 'extension' && ' · 选修'}</span><h3>{node.title}</h3><p>{node.outcome}</p><span className="ideal-bough-foot">{children.length ? `${children.length} 条子枝` : node.kind === 'reading' ? resourceState ? resourceState.sourceIds.length ? '资料已核对' : '资料待补足' : '资料待研究' : '查看说明'}<ArrowUpRight size={14}/></span></button> })}
            {!job.skeleton && <div className="ideal-growing"><Sparkles size={28}/><p>从目标建立第一条枝干…</p><small>可以离开页面，后台会继续构建。</small></div>}
            {branch && !nodes.length && <div className="ideal-growing"><Layers3 size={28}/><p>{branch.purpose}</p><small>这个分支将在前置内容就绪后展开。</small></div>}
          </div>
          <div className="ideal-tree-root"><Compass size={22} strokeWidth={1.25}/><p>{query ? '沿着分支寻找' : parent?.title || branch?.title || '想抵达的地方'}</p></div>
          </div>
          {!!branch?.dependsOn.length && <div className="ideal-prerequisites">先修分支 {branch.dependsOn.map(id => <button key={id} onClick={() => chooseBranch(id)}>{job.skeleton!.branches.find(b => b.id === id)?.title}<ChevronRight size={10}/></button>)}</div>}
        </div>
        {selected && <aside className="ideal-paper" aria-label="学习节点详情"><button className="icon-button ideal-close" aria-label="收起节点详情" onClick={() => setSelectedId('')}><X size={16}/></button><span className="ideal-kicker">{kinds[selected.kind]}</span><h2>{selected.title}</h2><CourseSamplePreview paragraphs={[{ id: selected.id, text: selected.body }]} />
          {nodes.some(n => n.parentId === selected.id) && <button className="primary" onClick={() => { setParentId(selected.id); setSelectedId('') }}><GitBranch size={14}/>展开这条分支<ArrowUpRight size={14}/></button>}
          {!!selected.dependsOn.length && <div className="ideal-prerequisites">先掌握 {selected.dependsOn.map(id => <button key={id} onClick={() => chooseNode(id)}>{nodes.find(n => n.id === id)?.title}<ChevronRight size={10}/></button>)}</div>}
          {selected.deliverable && <div className="ideal-practice-proof"><h3>留下什么</h3><p>{selected.deliverable}</p><h3>如何获得反馈</h3><p>{selected.feedback}</p></div>}
          {['knowledge','reading'].includes(selected.kind) && <div className="ideal-reading">
            <div className="ideal-reading-heading"><h3>从这里开始阅读</h3><button className="secondary" disabled={!!busy || paperRunning || job.status==='running'} onClick={()=>void findPapers()}><Search size={13}/>{paperState ? '重新查找' : '查找 arXiv 论文'}</button></div>
            {paperState?.status==='running' ? <p className="ideal-paper-progress" role="status"><LoaderCircle className="spin" size={13}/>{paperState.stage}<button onClick={()=>void perform('暂停查找',async()=>{const data=await command({command:'pause',id:job.id});if(mounted.current)setJob(current=>current?.id===data.job.id?data.job:current)})}>暂停</button></p> : paperState?.error ? <p className="ideal-notice" role="status">{paperState.error}</p> : !selectedResources.length && <p>根据这里的学习目标寻找论文，核实后可直接下载 PDF，导入资料库学习。</p>}
            {selectedResources.map(resource => { const source = job.sources.find(s => s.id === resource.sourceId); if (!source) return null; const local = linkedDocument(source); const available = local && documents.some(d => d.id === local); return <article className="ideal-source" key={source.id}>
              <span className="ideal-kicker">{source.arxivId ? `arXiv · ${source.arxivId}` : source.level === 'abstract' ? '已核实摘要' : source.level === 'local' ? '已有资料 · 页面摘录' : '已读取正文'}</span><h4>{source.title}</h4><small>{source.extent}</small>
              {resource.viaTitle && <p className="ideal-source-via">关联阅读 · {resource.viaTitle}</p>}
              <div>{available || source.importable || source.arxivId ? <button className="secondary" disabled={!!busy} onClick={() => void importSource(source)}>{available ? <BookOpen size={13}/> : <ArrowDownToLine size={13}/ >}{available ? '打开学习笔记' : source.arxivId ? '下载 PDF 并导入' : '导入正文学习'}</button> : source.documentId ? <small>原资料已从本机移除</small> : null}{source.url && <a href={source.url} target="_blank" rel="noreferrer">来源<ExternalLink size={12}/></a>}</div>
              <details><summary>推荐依据</summary><div className="ideal-source-reason"><CourseSamplePreview paragraphs={[{id:`${source.id}-reason`,text:resource.explanation}]} /></div><div className="ideal-quote"><CourseSamplePreview source paragraphs={[{id:`${source.id}-quote`,text:resource.quote}]} /></div>{source.attribution && <small>{source.attribution}</small>}</details>
            </article> })}
          </div>}
          {!!job.issues.filter(i => i.branchId === branchId && (!i.nodeId || i.nodeId === selected.id)).length && <details className="ideal-node-review"><summary>查看审查备注</summary>{job.issues.filter(i => i.branchId === branchId && (!i.nodeId || i.nodeId === selected.id)).map((issue,i) => <p key={i} className="ideal-notice">{issue.problem}<br/>{issue.repair}</p>)}</details>}
        </aside>}
        {diagnostics && <aside className="ideal-paper ideal-diagnostics" aria-label="构建记录"><button className="icon-button ideal-close" aria-label="收起构建记录" onClick={() => setDiagnostics(false)}><X size={16}/></button><span className="ideal-kicker">构建记录</span><h2>从目标到枝叶</h2><p>{job.contract?.summary || job.goal}</p><dl><dt>模型</dt><dd>{job.model}</dd><dt>协议版本</dt><dd>{job.promptVersion}</dd><dt>模型调用</dt><dd>{job.metrics.modelCalls}</dd><dt>资料工具调用</dt><dd>{job.metrics.toolCalls}</dd><dt>返回 token</dt><dd>{job.metrics.completionTokens}</dd><dt>格式修复</dt><dd>{job.metrics.repairs}</dd></dl>
          <h3>目标约定</h3>{job.contract?.requirements.map(r => <p key={r.id}><strong>{r.label}</strong><br/>{r.outcome}</p>)}
          {job.rebuild && <><h3>本版重建依据</h3><p>{job.rebuild.suggestion}</p><p>原因：{job.rebuild.reason}</p>{trees.some(tree => tree.id === job.rebuild!.sourceId) ? <button className="secondary" disabled={!!busy} onClick={() => void open(job.rebuild!.sourceId)}><ArrowLeft size={13}/>查看原版本</button> : <p>原版本已删除，重建依据仍保留。</p>}</>}
          {job.pathReport && <section className="ideal-path-check" aria-label="学习路径检查"><h3>学习路径检查</h3><p>{job.pathReport.status === 'checked' ? '已核对目标覆盖、先修无环、成果与反馈字段。' : '这份历史记录尚有结构项未通过当前检查。'}这些检查不代表已证明教学内容完整或学习者已经掌握。</p><p>先修顺序：{job.pathReport.branchOrder.map(id => job.skeleton?.branches.find(b => b.id === id)?.title).join(' → ')}</p>{job.pathReport.requirements.map(r => <details key={r.id}><summary>{r.label} · {r.tasks.length} 个学习任务</summary><p>掌握标准：{r.outcome}</p>{r.tasks.map(task => <div key={`${task.branchId}/${task.nodeId}`}><button onClick={() => { chooseBranch(task.branchId); chooseNode(task.nodeId) }}>{task.branchTitle} · {task.title}<ArrowUpRight size={12}/></button><p>{task.outcome}</p>{task.deliverable && <p>成果：{task.deliverable}<br/>反馈：{task.feedback}</p>}</div>)}</details>)}</section>}
          {!!job.contract?.assumptions.length && <><h3>当前假设</h3>{job.contract.assumptions.map((s,i) => <p key={i}>{s}</p>)}</>}
          {!!job.contract?.excluded.length && <><h3>范围边界</h3>{job.contract.excluded.map((s,i) => <p key={i}>{s}</p>)}</>}
          {job.review && <><h3>审查备注</h3><p>本轮构建已结束。以下是模型的审查意见，不会自动触发修改；需要调整时，可以提交重建建议。</p><p>{job.review.summary}</p>{job.issues.map((issue,i) => <p className="ideal-notice" key={i}>{issue.problem}<br/>{issue.repair}</p>)}</>}
          {!!job.gaps?.length && <><h3>阅读资料 · {job.gaps.length} 处待匹配</h3><p>学习内容已保存。补充资料只查找这些阅读任务的来源，不会重新改写整棵树。</p>{job.gaps.map(gap=><p key={`${gap.branchId}/${gap.nodeId}`}>{job.branches[gap.branchId]?.nodes.find(n=>n.id===gap.nodeId)?.title}</p>)}{['complete','review'].includes(job.status) && <button className="secondary" disabled={!!busy || paperRunning} onClick={() => void perform('补充资料', async () => { setJob((await command({command:'resume',id:job.id})).job) })}><Search size={13}/>补充阅读资料</button>}</>}
          {job.activity && <p role="status">正在执行 {job.activity.stage} · 第 {job.activity.attempt} 次尝试 · 已等待 {Math.max(0,Math.floor((Date.now()-job.activity.startedAt)/1000))} 秒</p>}
          <h3>执行轨迹</h3>{job.events.map((event,i) => <div className="ideal-event" key={i} title={event.issue || event.reason}>{event.accepted === true ? <Check size={12}/> : <span/>}<span>{event.type === 'retry' ? '连接重试' : event.type === 'repair' ? `格式修正 · ${event.stage}` : event.type === 'stopped' ? `中断 · ${event.stage}` : event.stage || ({ tool: '资料检索 / 读取', finished: '构建结果已保存' }[event.type] || event.type)}</span><small>{event.elapsedMs ? `${(event.elapsedMs/1000).toFixed(1)}s` : ''}</small></div>)}
        </aside>}
      </div>
      {busy && <p className="ideal-working" role="status"><LoaderCircle className="spin" size={13}/>{busy}…</p>}
    </>}
  </section>
}
