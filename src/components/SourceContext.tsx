import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, FileText, LoaderCircle, LocateFixed } from 'lucide-react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist'
import type { LearningDocument, SourcePosition } from '../types'
import { readFile, saveFile } from '../storage'
import { createSourceFollower } from '../../shared/source-follow.mjs'

type Props = { document: LearningDocument; position: SourcePosition; expanded?: boolean; onExpand?: () => void; chapterTitle?: string; documents?: LearningDocument[] }
export function SourceReader(props: Props) {
  const [chosen, setChosen] = useState('')
  const mapped = props.document.pages.find(page => page.number === props.position.page)
  useEffect(() => setChosen(''), [props.document.id, props.position.page, props.position.fraction])
  if (props.document.entryType !== 'note' || !props.document.sourceContext) return <SingleSourceReader {...props} />
  const sources = props.document.sourceContext.sources
  const source = sources.find(source => source.id === (chosen || mapped?.sourceId)) || sources[0]
  const original = props.documents?.find(document => document.id === source.id)
  const document: LearningDocument = { ...props.document, id: source.id, title: source.title, pages: source.pages,
    kind: original?.kind || 'text', filename: original?.filename || source.title, sourceWarnings: original?.sourceWarnings, library: original?.library, demo: original?.demo, entryType: undefined }
  const position = !chosen || chosen === mapped?.sourceId ? { ...props.position, page: mapped?.sourcePage || 1 } : { page: 1, fraction: 0, quote: '', approximate: false }
  return <div className="bundle-source-reader"><label>参考资料<select aria-label="选择参考原文" value={source.id} onChange={event => setChosen(event.target.value)}>{sources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label><SingleSourceReader {...props} key={source.id} document={document} position={position} /></div>
}
function SingleSourceReader({ document, position, expanded = false, onExpand, chapterTitle }: Props) {
  const viewport = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [width, setWidth] = useState(expanded ? 660 : 270)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [manualPage, setManualPage] = useState<number | null>(null)
  const [hoverPage, setHoverPage] = useState<number | null>(null)
  const [renderEpoch, setRenderEpoch] = useState(0)
  const [quoteAnchor, setQuoteAnchor] = useState<{ page: number; quote: string; fraction: number } | null>(null)
  const follower = useRef<ReturnType<typeof createSourceFollower> | null>(null)
  const opened = useRef('')
  const [settledPage, setSettledPage] = useState(position.page)
  const page = manualPage ?? position.page
  const fraction = manualPage === null ? quoteAnchor?.page === page && quoteAnchor.quote === position.quote ? quoteAnchor.fraction : position.fraction : 0
  const onRendered = useCallback(() => setRenderEpoch(n => n + 1), [])
  const onQuote = useCallback((page: number, quote: string, fraction: number) => setQuoteAnchor(current => current?.page === page && current.quote === quote && current.fraction === fraction ? current : { page, quote, fraction }), [])
  useEffect(() => { setManualPage(null) }, [document.id, position.page, position.fraction, position.quote])
  useEffect(() => {
    const timer = setTimeout(() => setSettledPage(page), 90)
    return () => clearTimeout(timer)
  }, [page])
  useEffect(() => {
    const root = viewport.current
    if (!root) return
    const control = createSourceFollower(root, { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches })
    follower.current = control
    const cancel = () => control.cancel()
    root.addEventListener('wheel', cancel, { passive: true }); root.addEventListener('touchstart', cancel, { passive: true })
    return () => { control.cancel(); root.removeEventListener('wheel', cancel); root.removeEventListener('touchstart', cancel) }
  }, [])
  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | undefined
    setPdf(null); setError('')
    if (document.kind !== 'pdf') return
    void (async () => {
      try {
        const { pdfjs } = await import('../pdf')
        let file = document.demo ? null : await readFile(document.id)
        if (!file && document.library) {
          const response = await fetch(`/api/library/${encodeURIComponent(document.library.id)}/source`)
          if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) throw new Error('本机书单原文暂时无法读取，正在显示已保存的原文文字。')
          file = await response.blob()
          // A full browser cache should not prevent reading the local original.
          await saveFile(document.id, file).catch(() => {})
        }
        if (!file && !document.demo) throw new Error('找不到原始 PDF，正在显示已保存的原文文字。')
        const data = file ? new Uint8Array(await file.arrayBuffer()) : null
        if (cancelled) return
        task = pdfjs.getDocument(data ? { data } : { url: '/attention-field-notes.pdf' })
        const loaded = await task.promise
        if (!cancelled) setPdf(loaded)
      } catch (e) { if (!cancelled) setError((e as Error).message) }
    })()
    return () => { cancelled = true; void task?.destroy() }
  }, [document.id, document.kind, document.demo])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      setWidth(Math.max(100, entries[0].contentRect.width))
      setViewportHeight(entries[0].contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const root = viewport.current
    const target = root?.querySelector<HTMLElement>(`[data-source-page="${page}"]`)
    if (!root || !target) return
    const first = opened.current !== document.id
    opened.current = document.id
    follower.current?.to(() => {
      const pageTop = target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
      const withinPage = target.getBoundingClientRect().height * fraction
      const context = Math.min(withinPage, root.clientHeight * 0.24)
      return pageTop + withinPage - context
    }, first, { readingOffset: manualPage === null ? position.readingOffset : undefined })
  }, [document.id, page, fraction, position.readingOffset, manualPage, width, viewportHeight, renderEpoch, expanded])
  // Stable page slots prevent removal of the preceding page from shifting the
  // scroll origin at every page boundary. Only nearby PDF canvases are painted.
  const pages = document.pages
  return <div className={`source-reader following-source ${expanded ? 'expanded' : ''}`}>
    <div className="source-heading"><span><FileText size={14} /> 原文对照</span>{!expanded && <button title="展开当前原文上下文" aria-label="展开原文" onClick={onExpand}><Maximize2 size={14} /></button>}</div>
    <div className="source-follow-label"><span><span className="tiny-dot" /> {manualPage === null ? '跟随笔记' : '自由查看'}{chapterTitle && ` · ${chapterTitle}`}</span>{manualPage !== null && <button onClick={() => setManualPage(null)} title="回到笔记对应原文"><LocateFixed size={13} /></button>}</div>
    <div className="source-context-viewport" ref={viewport} aria-label="原文上下文" data-follow-page={page} data-follow-fraction={fraction.toFixed(3)}>
      {error && <p className="inline-error">{error}</p>}
      {pages.map(p => <div className={`source-context-page ${p.number === page ? 'current-source-page' : ''}`} data-source-page={p.number} key={`${document.id}:${p.number}`}>
        <div className="source-page-caption" title={p.sourceTitle}>{p.sourceTitle || (p.number < page ? '前文' : p.number > page ? '后文' : '当前位置')} <span>p.{p.sourcePage || p.number}</span></div>
        {document.kind === 'pdf' && !error ? <PdfCanvas pdf={pdf} active={Math.abs(p.number - settledPage) <= 2} page={p.number} width={width} quote={p.number === page && manualPage === null ? position.quote : ''} onRendered={onRendered} onQuote={onQuote} /> : <pre className="source-flow-text">{p.text}</pre>}
      </div>)}
    </div>
    <div className="page-scrubber" onMouseLeave={() => setHoverPage(null)}><div className="page-ticks" style={{ gap: document.pages.length > 40 ? 0 : undefined }}>{document.pages.map(p => <button key={p.number} className={p.number === page ? 'active' : ''} aria-label={`跳到第 ${p.number} 页`} onMouseEnter={() => setHoverPage(p.number)} onClick={() => setManualPage(p.number)} />)}</div>{hoverPage !== null && <div className="page-hover"><b>第 {hoverPage} 页</b><span>{document.pages[hoverPage - 1]?.text.slice(0, 110)}</span></div>}</div>
    <div className="page-controls"><button aria-label="上一页" disabled={page <= 1} onClick={() => setManualPage(page - 1)}><ChevronLeft size={16} /></button><label>原文 <input aria-label="原文页码" type="number" min={1} max={document.pages.length} value={page} onChange={e => { const n = Number(e.target.value); if (n >= 1 && n <= document.pages.length) setManualPage(n) }} /> <span>/ {document.pages.length}</span></label><button aria-label="下一页" disabled={page >= document.pages.length} onClick={() => setManualPage(page + 1)}><ChevronRight size={16} /></button></div>
    {expanded && !!document.sourceWarnings?.length && <details className="extracted-text"><summary>资料读取说明</summary>{document.sourceWarnings.map(message => <p key={message}>{message}</p>)}</details>}
    {expanded && document.kind === 'pdf' && <details className="extracted-text"><summary>查看可复制的当前页原文</summary><pre>{document.pages[page - 1]?.text}</pre></details>}
  </div>
}

const PdfCanvas = memo(function PdfCanvas({ pdf, active, page, width, quote, onRendered, onQuote }: { pdf: PDFDocumentProxy | null; active: boolean; page: number; width: number; quote: string; onRendered: () => void; onQuote: (page: number, quote: string, fraction: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ratio, setRatio] = useState(1.414)
  useEffect(() => {
    if (!pdf || !canvas.current || !active) return
    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    setLoading(true); setError('')
    void (async () => {
      try {
        const p = await pdf.getPage(page)
        if (cancelled || !canvas.current) return
        const view = p.getViewport({ scale: width / p.getViewport({ scale: 1 }).width })
        setRatio(view.height / view.width)
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const el = canvas.current
        el.width = Math.floor(view.width * ratio); el.height = Math.floor(view.height * ratio)
        el.style.width = `${view.width}px`; el.style.height = `${view.height}px`
        renderTask = p.render({ canvas: el, viewport: view, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
        await renderTask.promise
        if (!cancelled) { setLoading(false); onRendered() }
      } catch (e) { if (!cancelled && (e as Error).name !== 'RenderingCancelledException') { setLoading(false); setError('页面渲染失败，请查看提取的原文文字。') } }
    })()
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdf, active, page, width, onRendered])
  useEffect(() => {
    if (!pdf || !quote) return
    let cancelled = false
    void (async () => {
      try {
        const p = await pdf.getPage(page)
        const text = await p.getTextContent()
        const items = text.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
        const normalized = (value: string) => value.replace(/\s+/g, '').toLowerCase()
        const all = items.map(item => normalized(item.str)).join('')
        const index = all.indexOf(normalized(quote))
        if (index < 0 || cancelled) return
        let count = 0
        const item = items.find(item => { count += normalized(item.str).length; return count > index })
        if (!item) return
        const { pdfjs } = await import('../pdf')
        const view = p.getViewport({ scale: 1 })
        const transform = pdfjs.Util.transform(view.transform, item.transform)
        if (!cancelled) onQuote(page, quote, Math.max(0, Math.min(1, transform[5] / view.height)))
      } catch { /* Source-page fallback remains available if a quote is absent. */ }
    })()
    return () => { cancelled = true }
  }, [pdf, page, quote, onQuote])
  return <div className="pdf-context-canvas" style={{ height: width * ratio }}>{active && <canvas ref={canvas} />}{active && loading && <span className="source-loading"><LoaderCircle className="spin" size={18} /></span>}{error && <p className="inline-error">{error}</p>}</div>
})
