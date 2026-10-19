import { useMemo } from 'react'
import { noteBlocks } from '../../shared/note-format.mjs'
import { renderNoteHTML } from '../../shared/note-html.mjs'

export function CourseSamplePreview({ paragraphs, source = false }: { paragraphs: { id: string; text: string }[]; source?: boolean }) {
  const html = useMemo(() => renderNoteHTML({ type: 'doc', content: paragraphs.flatMap(p => noteBlocks(p.text, {}, { source })) }), [paragraphs, source])
  return <div className="note-prose course-sample-prose" dangerouslySetInnerHTML={{ __html: html }} />
}
