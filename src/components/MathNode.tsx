import { useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { mathText, renderMath } from '../../shared/math.mjs'
import { mathHTML } from '../../shared/note-html.mjs'

function MathView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  function save() {
    try { renderMath(draft, node.attrs.display); updateAttributes({ latex: draft.trim() }); setEditing(false); setError('') }
    catch { setError('公式格式有误，请检查括号和命令。') }
  }
  return <NodeViewWrapper as="span" className={`math-node ${node.attrs.display ? 'math-display' : 'math-inline'}${selected ? ' math-selected' : ''}`} contentEditable={false}
    title={editor.isEditable ? '选中可向 AI 提问 · 双击编辑公式' : '数学公式'} onDoubleClick={() => { if (editor.isEditable) { setDraft(node.attrs.latex); setError(''); setEditing(true) } }}>
    <span className="math-content" dangerouslySetInnerHTML={{ __html: mathHTML(node.attrs) }} />
    {editing && <span className="math-edit-shade" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <span className="math-edit-dialog" role="dialog" aria-label="编辑公式">
        <strong>编辑公式</strong><span>保留分式、上下标和推导结构</span>
        <textarea aria-label="公式 LaTeX" autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setEditing(false); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save() }} />
        {error && <span className="error-message">{error}</span>}
        <span className="math-edit-actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>取消</button><button type="button" className="primary" onClick={save}>保存公式</button></span>
      </span>
    </span>}
  </NodeViewWrapper>
}

export const MathNode = Node.create({
  name: 'math', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { latex: { default: '' }, display: { default: false } } },
  parseHTML() { return [{ tag: 'span[data-math]', getAttrs: element => ({ latex: (element as HTMLElement).dataset.latex || '', display: (element as HTMLElement).dataset.display === 'true' }) }] },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-math': '', 'data-latex': node.attrs.latex, 'data-display': String(node.attrs.display) }), mathText(node)] },
  renderText({ node }) { return mathText(node) },
  addNodeView() { return ReactNodeViewRenderer(MathView) },
})
