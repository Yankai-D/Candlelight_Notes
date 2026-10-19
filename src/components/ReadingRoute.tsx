import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { LearningDocument } from '../types'

type Props = { document: LearningDocument; currentIndex: number; progress: number; onNavigate: (id: string) => void }

export function ReadingRoute({ document, currentIndex, progress, onNavigate }: Props) {
  const list = useRef<HTMLElement>(null)
  const [capacity, setCapacity] = useState(5)
  useEffect(() => {
    const element = list.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      const height = entries[0].contentRect.height
      if (height > 0) setCapacity(Math.max(1, Math.min(7, Math.floor(height / 46))))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const count = document.chapters.length
  const start = Math.max(0, Math.min(currentIndex - Math.floor(capacity / 2), count - capacity))
  const visible = document.chapters.slice(start, start + capacity)
  return <section className="reading-route">
    <div className="outline-heading"><span>阅读路线</span><div className="route-controls">
      <button aria-label="前一章节" disabled={currentIndex === 0} onClick={() => onNavigate(document.chapters[currentIndex - 1].id)}><ChevronLeft size={13} /></button>
      <label className="route-jump" title="选择任意章节"><span>{String(currentIndex + 1).padStart(2, '0')} <i>/ {String(count).padStart(2, '0')}</i></span><ChevronDown size={11} /><select aria-label="跳转到章节" value={document.chapters[currentIndex].id} onChange={e => onNavigate(e.target.value)}>{document.chapters.map((chapter, index) => <option key={chapter.id} value={chapter.id}>{index + 1}. {chapter.title}</option>)}</select></label>
      <button aria-label="后一章节" disabled={currentIndex === count - 1} onClick={() => onNavigate(document.chapters[currentIndex + 1].id)}><ChevronRight size={13} /></button>
    </div></div>
    <nav className="chapter-outline" aria-label="章节导航" ref={list}>
      {visible.map((chapter, offset) => {
        const index = start + offset
        const current = index === currentIndex
        return <button key={chapter.id} className={`chapter-link ${current ? 'current' : index < currentIndex ? 'passed' : ''}`} style={{ '--route-progress': progress } as React.CSSProperties} onClick={() => onNavigate(chapter.id)} aria-current={current ? 'step' : undefined} title={chapter.title}>
          <span className="chapter-node">{current ? <span /> : <i />}</span>
          <span className="chapter-label"><span>{chapter.title}</span><small>{current ? `正在阅读 · ${Math.round(progress * 100)}%` : chapter.status === 'empty' ? '等待整理' : chapter.subtitle || `原文 p.${chapter.sourcePages[0]}`}</small></span>
          <span className="chapter-number">{String(index + 1).padStart(2, '0')}</span>
        </button>
      })}
    </nav>
  </section>
}
