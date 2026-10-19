import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, ChevronRight, Folder, Layers3, LoaderCircle, Sparkles, Sprout, X } from 'lucide-react'
import type { Collection, Knowledge, LearningDocument, StudyStatus, StudyTreeEntry } from '../types'
import { studyStatuses } from '../../shared/collection.mjs'
import { treeDomains, treeFingerprint, treeEntries, treeEntryStatus } from '../../shared/study-tree.mjs'
import { layoutTree, type TreeDomain } from '../tree-layout'

type Props = { documents: LearningDocument[]; collection: Collection; knowledge: Knowledge; organizing: boolean; error: string;
  onOpen: (id: string, chapterId?: string) => void; onOpenFolder: (id: string) => void; onProfile: () => void; onOrganize: () => void; onCancel: () => void }

export function StudyTree({ documents, collection, knowledge, organizing, error, onOpen, onOpenFolder, onProfile, onOrganize, onCancel }: Props) {
  const [selectedId, setSelectedId] = useState(''), [topicId, setTopicId] = useState(''), [domainId, setDomainId] = useState('')
  const [hoveredId, setHoveredId] = useState('')
  const [size, setSize] = useState({ width: 1100, height: 630 })
  const viewport = useRef<HTMLDivElement>(null)
  const uid = useId().replace(/:/g, '')
  const included = useMemo(() => treeEntries(documents, collection) as StudyTreeEntry[], [documents, collection])
  const statusOf = (entry: StudyTreeEntry) => treeEntryStatus(entry, collection) as StudyStatus
  const domains = useMemo(() => treeDomains(documents, collection) as TreeDomain[], [documents, collection])
  const layout = useMemo(() => layoutTree(domains, size.width, size.height), [domains, size])
  const selected = included.find(document => document.id === selectedId)
  const selectedTopic = domains.flatMap(domain => domain.topics).find(topic => topic.id === topicId)
  const selectedFolder = domains.find(domain => domain.id === domainId)
  const selectedDomain = selectedFolder || domains.find(domain => domain.documentIds.includes(selectedId) || domain.topics.some(topic => topic.id === topicId))
  const stale = collection.tree && collection.tree.fingerprint !== treeFingerprint(documents, collection)
  const completed = included.filter(document => statusOf(document) === 'completed').length
  useEffect(() => {
    const box = viewport.current
    if (!box) return
    const update = () => setSize(previous => {
      const next = { width: box.clientWidth, height: Math.max(560, window.innerHeight - 255) }
      return previous.width === next.width && previous.height === next.height ? previous : next
    })
    const observer = new ResizeObserver(update)
    observer.observe(box); window.addEventListener('resize', update); update()
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [])
  const close = () => { setSelectedId(''); setTopicId(''); setDomainId('') }
  const choose = (id: string) => { close(); setSelectedId(id) }
  const curve = (x: number, y: number, tx: number, ty: number) => `M${x},${y} C${x},${y - 95} ${tx + (x - tx) * .18},${ty + 105} ${tx},${ty}`
  const preview = selectedTopic || selectedFolder
  const rootWidth = Math.min(320, layout.width - 20)
  return <section className="study-tree-view knowledge-garden" aria-label="学习树" onKeyDown={event => { if (event.key === 'Escape') close() }}>
    <div className="tree-heading garden-heading"><div><span className="collection-eyebrow">A GROWING BODY OF KNOWLEDGE</span><h1>学习树<span>每一份阅读，都有它的位置。</span></h1></div>
      <button className={organizing ? 'secondary' : 'primary'} onClick={organizing ? onCancel : onOrganize} disabled={!included.length}>{organizing ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{organizing ? '整理中 · 取消' : collection.tree ? '重新整理' : '自动整理'}</button>
    </div>
    {error && <p className="inline-error tree-error" role="alert">{error}</p>}
    <div className="garden-shell">
      <div className="garden-topline"><span>{included.length} 份资料 <i /> {completed} 份已读</span><div className="garden-legend"><span><i />已导入</span><span><i />正在学习</span><span><i />已完成</span></div></div>
      <div className="garden-canvas" ref={viewport} aria-label="完整展开的知识树">
        <div className="garden-atmosphere" aria-hidden="true" />
        <div className="reading-tree-map garden-world" style={{ width: layout.width, height: layout.height }}>
          <svg className="garden-branches" width={layout.width} height={layout.height} aria-hidden="true">
            <defs><linearGradient id={`${uid}-sap`} x1="0" y1="1" x2="0" y2="0"><stop stopColor="var(--garden-root)" /><stop offset="1" stopColor="var(--garden-leaf)" /></linearGradient></defs>
            {[-1, 1].flatMap(direction => [1, 2, 3].map(index => <path key={`${direction}-${index}`} className="garden-rootlet" d={`M${layout.root.x},${layout.root.y} C${layout.root.x + direction * 20},${layout.root.y + 34} ${layout.root.x + direction * index * 36},${layout.height - 32} ${layout.root.x + direction * index * 63},${layout.height - 12}`} />))}
            {layout.domains.map(domain => <g key={domain.id}>
              <path className="garden-trunk" d={curve(layout.root.x, layout.root.y, domain.x, domain.y)} stroke={`url(#${uid}-sap)`} />
              {domain.boughs.map(bough => <g key={bough.id} className={selectedId && !bough.leaves.some(leaf => leaf.id === selectedId) ? 'garden-muted' : ''}>
                <path className={`garden-bough ${topicId === bough.topicId ? 'is-lit' : ''}`} d={curve(domain.x, domain.y - 9, bough.x, bough.y)} pathLength={1} />
                <path className="garden-twig" d={`M${bough.x},${bough.y} C${bough.x},${bough.y - 8} ${bough.leaves[0].x - 16},${bough.y} ${bough.leaves[0].x - 16},${bough.y - 40} L${bough.leaves[0].x - 16},${bough.leaves[0].y + 18}`} pathLength={1} />
                {bough.leaves.map(leaf => <path key={leaf.id} className={`garden-twig ${leaf.id === selectedId || leaf.id === hoveredId ? 'is-lit' : ''}`} d={`M${bough.leaves[0].x - 16},${leaf.y + 23} Q${leaf.x - 9},${leaf.y + 17} ${leaf.x + 10},${leaf.y + 12}`} pathLength={1} />)}
              </g>)}
            </g>)}
          </svg>
          {layout.domains.map(domain => <div key={domain.id}>
            <button className="garden-domain" style={{ left: domain.x, top: domain.y }} onClick={() => { close(); setDomainId(domain.id) }}><Folder size={13} /><strong>{domain.label}</strong></button>
            {domain.boughs.map(bough => <div key={bough.id} className={selectedId && !bough.leaves.some(leaf => leaf.id === selectedId) ? 'garden-muted' : ''}>
              {bough.label && <button className={`garden-topic ${topicId === bough.topicId ? 'selected' : ''}`} style={{ left: bough.x - bough.labelWidth / 2, top: bough.y + 10, width: bough.labelWidth }} aria-label={`查看分类 ${bough.label}`} onClick={() => { close(); setTopicId(bough.topicId) }}><strong>{bough.label}</strong></button>}
              {bough.leaves.map(leaf => { const document = included.find(document => document.id === leaf.id)!; const status = statusOf(document); return <button key={leaf.id} className={`garden-leaf status-${status} ${selectedId === leaf.id ? 'selected' : ''}`} style={{ left: leaf.x, top: leaf.y, width: leaf.width }} aria-label={`展开 ${document.library?.label || document.title} 的知识结构`} onClick={() => choose(leaf.id)} onPointerEnter={() => setHoveredId(leaf.id)} onPointerLeave={() => setHoveredId('')}>
                <span className="garden-leaf-mark" aria-hidden="true" /><span><strong title={document.title}>{document.library?.label || document.title}</strong><small>{document.kind === 'bundle' ? '联合资料包' : document.library?.year || (document.kind === 'pdf' ? 'PDF' : '讲义')}</small></span><ArrowUpRight className="garden-leaf-arrow" size={12} />
              </button> })}
            </div>)}
          </div>)}
          <button className="garden-root-anchor" style={{ left: layout.root.x - rootWidth / 2, top: layout.root.y - 14, width: rootWidth }} onClick={onProfile}><span className="garden-root-seal"><Sprout size={23} strokeWidth={1.3} /></span><strong>根系 · 我的学习画像</strong><span>{knowledge.foundations.slice(0, 3).join(' · ') || '学习从已有基础开始'}</span></button>
          {!included.length && <div className="garden-empty" style={{ left: layout.width / 2 - rootWidth / 2, top: layout.height / 2 - 100, width: rootWidth }}><Sprout size={40} strokeWidth={1} /><h2>等待新的枝叶</h2><p>这里还没有可展示的资料。</p></div>}
        </div>
      </div>
      {(selected || preview) && <aside className="tree-inspector garden-inspector" aria-label="资料快速索引"><div className="garden-inspector-heading"><span>{selectedDomain?.label} <ChevronRight size={10} /> {selected ? '资料' : selectedTopic ? '知识分支' : '文件夹'}</span><button className="icon-button" aria-label="收起资料索引" onClick={close}><X size={15} /></button></div>
        {selected ? <><span className="garden-detail-kicker">{selected.kind === 'bundle' ? 'MATERIAL BUNDLE' : 'READING LEAF'}</span><h2>{selected.library?.label || selected.title}</h2><p>{selected.subtitle}</p><div className="garden-detail-meta"><span>{studyStatuses[statusOf(selected)]}</span><span>{selected.kind === 'bundle' ? `${selected.members!.length} 份资料` : `${selected.pages.length} 页 · ${selected.chapters.length} 章`}</span></div>
          {selected.kind === 'bundle' ? <><button className="primary garden-open" onClick={() => onOpenFolder(selected.bundleFolderId!)}><Layers3 size={14} />打开资料包<ArrowUpRight size={14} /></button><h3>包内资料</h3>{selected.members!.map(member => <button className="garden-branch-file" key={member.id} onClick={() => onOpen(member.id)}><BookOpen size={14} /><span>{member.title}</span><ArrowUpRight size={13} /></button>)}</>
            : <><button className="primary garden-open" onClick={() => onOpen(selected.id)}><BookOpen size={14} />打开学习笔记<ArrowUpRight size={14} /></button><h3>章节索引</h3><div className="tree-chapter-index">{selected.chapters.map((chapter, index) => <button key={chapter.id} aria-label={`定位 ${chapter.title}`} onClick={() => onOpen(selected.id, chapter.id)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{chapter.title}</strong><small>p.{chapter.sourcePages[0]}</small></button>)}</div></>}
        </>
          : preview && <><span className="garden-detail-kicker">{selectedTopic ? 'KNOWLEDGE BRANCH' : 'COLLECTION'}</span><h2>{preview.label}</h2>{selectedTopic?.description && <p>{selectedTopic.description}</p>}<h3>{preview.documentIds.length} 份资料</h3>{preview.documentIds.map(id => { const document = included.find(document => document.id === id)!; return <button className="garden-branch-file" key={id} onClick={() => choose(id)}><BookOpen size={14} /><span>{document.library?.label || document.title}</span><ArrowUpRight size={13} /></button> })}</>}
      </aside>}
    </div>
    <div className="tree-map-footnote garden-footnote"><span>{collection.tree ? stale ? '资料分类有变化 · 可重新整理' : `分类更新于 ${new Date(collection.tree.generatedAt).toLocaleDateString()}` : '沿文件夹建立主干 · 自动整理知识分支'}</span><span>根系由你维护</span></div>
  </section>
}
