// Fit one level of the tree into its actual viewport. Large searches first
// resolve to real branches; no node is removed or moved to a numbered page.
export function fitIdealCanopy(count: number, width: number, height: number) {
  const items = Math.max(1, count)
  const availableWidth = Math.max(1, width - 8)
  const availableHeight = Math.max(1, height - 100)
  const gap = items > 20 ? 6 : 14
  let best = { columns: 1, rows: items, cellWidth: availableWidth, cellHeight: availableHeight / items, score: -Infinity }
  for (let columns = 1; columns <= Math.min(items, Math.max(1, Math.floor(availableWidth / 58))); columns++) {
    const rows = Math.ceil(items / columns)
    const cellWidth = (availableWidth - (columns - 1) * gap) / columns
    const cellHeight = (availableHeight - (rows - 1) * gap) / rows
    // Dense levels favor wider labels, rather than many almost unreadable
    // square tiles. Details remain available by opening the node.
    const score = Math.min(cellWidth / (items > 12 ? 180 : 215), cellHeight / (items > 12 ? 68 : 175)) - (columns * rows - items) * .015
    if (score > best.score) best = { columns, rows, cellWidth, cellHeight, score }
  }
  const density = best.cellHeight < 58 || best.cellWidth < 90 ? 'mini' : best.cellHeight < 104 || best.cellWidth < 130 ? 'dense' : best.cellHeight < 158 || best.cellWidth < 180 ? 'compact' : 'roomy'
  return { columns: best.columns, rows: best.rows, density, gap }
}
