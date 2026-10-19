import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const selectionHighlightKey = new PluginKey<DecorationSet>('reading-tree-selection-highlight')

// Decorations only affect the view: neither document JSON nor undo history
// contains the temporary highlight used while composing an AI request.
export const SelectionHighlight = Extension.create({
  name: 'selectionHighlight',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: selectionHighlightKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, previous) {
          if (transaction.getMeta('reading-tree-clear-selection')) return DecorationSet.empty
          const range = transaction.getMeta(selectionHighlightKey) as { from: number; to: number } | null | undefined
          if (range === null) return DecorationSet.empty
          if (range) {
            const from = Math.max(0, range.from), to = Math.min(transaction.doc.content.size, range.to)
            return from < to ? DecorationSet.create(transaction.doc, [Decoration.inline(from, to, { class: 'ai-selection-highlight' })]) : DecorationSet.empty
          }
          return previous.map(transaction.mapping, transaction.doc)
        },
      },
      props: { decorations: state => selectionHighlightKey.getState(state) },
    })]
  },
})
