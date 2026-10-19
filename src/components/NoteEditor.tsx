import { useContext, useEffect, useRef } from 'react'
import { SourceLabels } from './SourceLabels'
import { sourceLabel } from '../../shared/bundle-context.mjs'
import { Node, Extension, mergeAttributes, type Editor, type JSONContent } from '@tiptap/core'
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Plugin } from '@tiptap/pm/state'
import { Bold, Italic, List, Heading2, Undo2, Redo2, StickyNote, ArrowUp, ArrowDown, X, Lightbulb, GripVertical } from 'lucide-react'
import type { SelectionContext } from '../types'
import { uid } from '../../shared/document.mjs'
import { SelectionHighlight, selectionHighlightKey } from './SelectionHighlight'
import { MathNode } from './MathNode'
import { mathText } from '../../shared/math-syntax.mjs'

function PaperNote({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const sourcePages = useContext(SourceLabels)
  const move = (direction: number) => {
    const position = getPos()
    if (position === undefined) return
    const resolved = editor.state.doc.resolve(position)
    const index = resolved.index()
    if (direction < 0 && index === 0 || direction > 0 && index >= editor.state.doc.childCount - 1) return
    const neighbor = editor.state.doc.child(index + direction)
    const target = direction < 0 ? position - neighbor.nodeSize : position + neighbor.nodeSize
    const transaction = editor.state.tr.delete(position, position + node.nodeSize).insert(target, node)
    editor.view.dispatch(transaction)
  }
  return <NodeViewWrapper className="paper-note" data-block-id={node.attrs.id}>
    <div className="paper-note-top" contentEditable={false}>
      <span className="note-symbol"><Lightbulb size={15} /></span>
      <span className="paper-note-kind">小纸条</span><span className="note-dot">·</span>
      <input aria-label="小纸条标题" value={node.attrs.title} disabled={!editor.isEditable} onChange={e => updateAttributes({ title: e.target.value })} maxLength={120} />
      <div className="paper-note-controls" hidden={!editor.isEditable}>
        <button type="button" title="上移小纸条" aria-label="上移小纸条" onClick={() => move(-1)}><ArrowUp size={14} /></button>
        <button type="button" title="下移小纸条" aria-label="下移小纸条" onClick={() => move(1)}><ArrowDown size={14} /></button>
        <button type="button" title="移除小纸条" aria-label="移除小纸条" onClick={deleteNode}><X size={14} /></button>
      </div>
    </div>
    <NodeViewContent className="paper-note-body" />
    <div className="paper-note-foot" contentEditable={false}>
      <GripVertical size={12} /><span>{node.attrs.origin === 'example' ? '示例讲解' : node.attrs.origin === 'user' ? '我的补充' : 'AI 讲解 · 可继续编辑'}</span>
      {node.attrs.sourcePages?.length > 0 && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('source-page', { detail: node.attrs.sourcePages[0] }))}>{sourceLabel(sourcePages, node.attrs.sourcePages)}</button>}
    </div>
  </NodeViewWrapper>
}

const Explanation = Node.create({
  name: 'explanation', group: 'block', content: 'block+', defining: true,
  addAttributes() { return { id: { default: null }, title: { default: '换个角度理解' }, sourcePages: { default: [] }, origin: { default: 'user' } } },
  parseHTML() { return [{ tag: 'aside[data-paper-note]' }] },
  renderHTML({ HTMLAttributes }) { return ['aside', mergeAttributes(HTMLAttributes, { 'data-paper-note': '' }), 0] },
  addNodeView() { return ReactNodeViewRenderer(PaperNote) },
})
const BlockIdentity = Extension.create({
  name: 'blockIdentity',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote'], attributes: {
    id: { default: null, parseHTML: el => el.getAttribute('data-block-id'), renderHTML: attrs => ({ 'data-block-id': attrs.id }) },
    sourcePages: { default: [], rendered: false }, sourceQuote: { default: '', rendered: false },
  } }] },
  addProseMirrorPlugins() { return [new Plugin({ appendTransaction(transactions, _old, state) {
    if (!transactions.some(t => t.docChanged)) return
    const tr = state.tr, seen = new Set<string>()
    state.doc.descendants((node, position) => {
      if (!['paragraph', 'heading', 'explanation', 'bulletList', 'orderedList', 'blockquote'].includes(node.type.name)) return
      const id = node.attrs.id
      if (!id || seen.has(id)) tr.setNodeMarkup(position, undefined, { ...node.attrs, id: uid() })
      else seen.add(id)
    })
    return tr.docChanged ? tr : undefined
  } })] },
})

type Props = { content: JSONContent; identity: string; onChange: (content: JSONContent) => void; onSelection: (context: SelectionContext) => void; onReady: (editor: Editor) => void; onAddNote: () => void; onFocus?: () => void; readOnly?: boolean; toolbar?: boolean; highlight?: { from: number; to: number } }
export function NoteEditor({ content, identity, onChange, onSelection, onReady, onAddNote, onFocus, readOnly, toolbar = true, highlight }: Props) {
  const callbacks = useRef({ onChange, onSelection, onReady, onFocus })
  callbacks.current = { onChange, onSelection, onReady, onFocus }
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, link: { openOnClick: false } }), Explanation, BlockIdentity, SelectionHighlight, MathNode, Placeholder.configure({ placeholder: '在这里写下你的理解，或让 AI 根据原文开始整理…' })],
    content, editable: !readOnly,
    editorProps: { attributes: { class: 'note-prose', 'aria-label': '学习笔记正文', spellcheck: 'false' } },
    onUpdate: ({ editor, transaction }) => { if (transaction.docChanged) callbacks.current.onChange(editor.getJSON()) },
    onFocus: ({ editor }) => {
      callbacks.current.onFocus?.()
      const { from, to, $from } = editor.state.selection
      const anchor = $from.depth > 0 ? $from.node(1) : editor.state.doc.firstChild
      callbacks.current.onSelection({ from, to, text: editor.state.doc.textBetween(from, to, '\n', mathText), anchorId: anchor?.attrs.id || '', label: anchor?.textContent.slice(0, 46) || '当前段落' })
    },
    onSelectionUpdate: ({ editor, transaction }) => {
      if (transaction.getMeta('reading-tree-clear-selection') || transaction.getMeta('preventUpdate')) return
      const { from, to, $from } = editor.state.selection
      const anchor = $from.depth > 0 ? $from.node(1) : editor.state.doc.firstChild
      callbacks.current.onSelection({ from, to, text: editor.state.doc.textBetween(from, to, '\n', mathText), anchorId: anchor?.attrs.id || '', label: anchor?.textContent.slice(0, 46) || '当前段落' })
    },
  })
  useEffect(() => { if (editor) callbacks.current.onReady(editor) }, [editor])
  useEffect(() => {
    // React node views flush synchronously when mounted. Schedule external
    // document updates outside React's effect commit to avoid nested flushes.
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled && editor && !editor.isDestroyed && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) editor.commands.setContent(content, { emitUpdate: false })
    })
    return () => { cancelled = true }
  }, [content, identity, editor])
  // Changing interaction mode is not a content edit. Emitting an update here
  // can save the previous editor content over a just-completed generation.
  useEffect(() => { editor?.setEditable(!readOnly, false) }, [editor, readOnly])
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled && editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(selectionHighlightKey, highlight || null).setMeta('addToHistory', false))
    })
    return () => { cancelled = true }
  }, [editor, highlight?.from, highlight?.to])
  if (!editor) return null
  return <div className="editor-shell">
    {!readOnly && toolbar && <div className="editor-toolbar" role="toolbar" aria-label="笔记排版">
      <button title="加粗" aria-label="加粗" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></button>
      <button title="斜体" aria-label="斜体" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></button>
      <button title="小标题" aria-label="小标题" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={17} /></button>
      <button title="项目列表" aria-label="项目列表" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={17} /></button>
      <span className="toolbar-divider" />
      <button title="撤销（Ctrl+Z）" aria-label="撤销编辑" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></button>
      <button title="重做" aria-label="重做编辑" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></button>
      <span className="toolbar-divider" />
      <button className="add-note-button" onClick={onAddNote}><StickyNote size={14} /> 写张纸条</button>
      <span className="editable-hint">正文可直接编辑</span>
    </div>}
    <EditorContent editor={editor} />
  </div>
}
