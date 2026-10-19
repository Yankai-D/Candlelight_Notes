import type { Editor } from '@tiptap/core'
import { Bold, Italic, Heading2, List, Undo2, Redo2, Focus } from 'lucide-react'

export function ReadingToolbar({ editor, readOnly, onReadOnly, onFontSize }: { editor?: Editor; readOnly: boolean; onReadOnly: () => void; onFontSize: () => void }) {
  return <div className="reading-toolbar" role="toolbar" aria-label="长文排版与阅读">
    {!readOnly && <div className="reading-format-tools">
      <button aria-label="加粗" title="加粗" disabled={!editor} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={14} /></button>
      <button aria-label="斜体" title="斜体" disabled={!editor} onMouseDown={e => e.preventDefault()} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={14} /></button>
      <button aria-label="小标题" title="小标题" disabled={!editor} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></button>
      <button aria-label="项目列表" title="项目列表" disabled={!editor} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={16} /></button>
      <span className="toolbar-divider" />
      <button aria-label="撤销编辑" title="撤销编辑" disabled={!editor} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={14} /></button>
      <button aria-label="重做编辑" title="重做编辑" disabled={!editor} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={14} /></button>
    </div>}
    <span className="continuous-reading-label">连续阅读 · {readOnly ? '只读模式' : '正文可直接编辑'}</span>
    <div className="reading-options">
      <button title="调整字号" aria-label="调整字号" onClick={onFontSize}>Aa</button>
      <button title={readOnly ? '恢复编辑' : '只读阅读'} aria-label={readOnly ? '恢复编辑' : '只读阅读'} className={readOnly ? 'selected' : ''} onClick={onReadOnly}><Focus size={15} /></button>
    </div>
  </div>
}
