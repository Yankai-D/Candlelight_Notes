import { Suspense, lazy } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import { BookOpen, FileText, Leaf, Check } from 'lucide-react'
import type { LearningDocument, SelectionContext } from '../types'
import { textOf } from '../../shared/document.mjs'
import { notebookKey, notebookLabel } from '../../shared/notebooks.mjs'
import { SourceLabels } from './SourceLabels'

const NoteEditor = lazy(() => import('./NoteEditor').then(module => ({ default: module.NoteEditor })))
type Props = {
  document: LearningDocument; fontSize: number; readOnly: boolean; finished: boolean;
  highlight?: { chapterId: string; from: number; to: number };
  onChange: (chapterId: string, content: JSONContent) => void;
  onSelection: (chapterId: string, selection: SelectionContext) => void;
  onReady: (chapterId: string, editor: Editor) => void;
  onAddNote: (chapterId: string) => void;
  onFinish: () => void;
  onSource: (chapterId: string) => void;
}

export function ContinuousNotes({ document, fontSize, readOnly, finished, highlight, onChange, onSelection, onReady, onAddNote, onFinish, onSource }: Props) {
  return <SourceLabels.Provider value={document.pages}><article className="learning-article continuous-article" style={{ '--prose-size': `${fontSize}px` } as React.CSSProperties}>
    <header className="document-reading-header">
      <div className="article-kicker"><span>READING NOTES</span><i /><span>{document.demo ? '原创示例讲义' : '我的学习笔记'}</span></div>
      <h1 className="article-title">{document.title}</h1>
      <p className="article-subtitle">{document.subtitle}</p>
      <p className="continuous-hint">{notebookLabel(document)} · 沿着文章读下去，让理解自然生长。</p>
    </header>
    {document.chapters.map((chapter, index) => <section className="flow-chapter" data-note-chapter={chapter.id} key={notebookKey(document, chapter.id)} aria-labelledby={`chapter-title-${chapter.id}`}>
      <header className="flow-chapter-heading">
        <span className="flow-chapter-index">{String(index + 1).padStart(2, '0')}</span>
        <div><h2 id={`chapter-title-${chapter.id}`}>{chapter.title}</h2>{chapter.subtitle && <p>{chapter.subtitle}</p>}</div>
        <button className="chapter-source-link" title="查看本章原文" onClick={() => onSource(chapter.id)}><FileText size={12} /> {document.entryType === 'note' ? '来源' : `p.${chapter.sourcePages[0]}`}</button>
      </header>
      {chapter.status === 'empty' && !textOf(chapter.content).trim() && <div className="empty-chapter">
        <BookOpen size={24} strokeWidth={1.3} /><h3>这部分笔记还在等待生长</h3><p>首次全文整理会依次填入这里，已完成的内容可以先读。</p>
      </div>}
      <Suspense fallback={<div className="editor-loading">正在打开笔记…</div>}>
        <NoteEditor identity={notebookKey(document, chapter.id)} content={chapter.content} toolbar={false} readOnly={readOnly}
          highlight={highlight?.chapterId === chapter.id ? highlight : undefined}
          onChange={content => onChange(chapter.id, content)} onSelection={selection => onSelection(chapter.id, selection)}
          onReady={editor => onReady(chapter.id, editor)} onAddNote={() => onAddNote(chapter.id)} />
      </Suspense>
    </section>)}
    <div className="chapter-end"><span className="end-flourish">✧</span><p>理解不止于读完，也在于用自己的话说一遍。</p>{document.chapters.every(c => c.status === 'ready') && <button className="secondary reading-finished" disabled={finished} onClick={onFinish}>{finished ? <Check size={14} /> : <Leaf size={14} />}{finished ? '已标记为已读' : '标记为已读'}</button>}</div>
  </article></SourceLabels.Provider>
}
