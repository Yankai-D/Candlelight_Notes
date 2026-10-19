import { useMemo } from 'react'
import { resultRendering } from '../../shared/note-format.mjs'
import { renderNoteHTML } from '../../shared/note-html.mjs'

export function NotePreview({ action, result }: { action: string; result: any }) {
  const html = useMemo(() => {
    const rendering = resultRendering(action, result)
    const blocks = rendering.blocks || (rendering.inline ? [{ type: 'paragraph', content: rendering.inline }] : rendering.edits.map((edit: any) => ({ type: 'paragraph', content: edit.content })))
    return renderNoteHTML({ type: 'doc', content: blocks })
  }, [action, result])
  return <div className="note-prose suggestion-note-prose" dangerouslySetInnerHTML={{ __html: html }} />
}
