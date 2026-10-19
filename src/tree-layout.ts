export type TreeTopic = { id: string; label: string; description: string; documentIds: string[]; unclassified?: boolean }
export type TreeDomain = { id: string; label: string; topics: TreeTopic[]; documentIds: string[] }

// Every document owns a visible leaf; extra twigs are geometry only,
// never invented knowledge categories or hidden files.
export function layoutTree(domains: TreeDomain[], width: number, availableHeight: number) {
  const groups = domains.flatMap(domain => domain.topics.flatMap(topic => {
    const count = Math.ceil(topic.documentIds.length / 4)
    return Array.from({ length: count }, (_, index) => ({ domain, topic, index,
      ids: topic.documentIds.slice(index * 4, index * 4 + 4),
    }))
  }))
  const columns = Math.max(1, Math.min(groups.length || 1, Math.floor((width - 36) / 130)))
  const rows = Math.max(1, Math.ceil(groups.length / columns))
  const rowCounts = Array.from({ length: rows }, (_, row) => Math.max(1, ...groups.slice(row * columns, (row + 1) * columns).map(group => group.ids.length)))
  const rowHeights = rowCounts.map(count => (count - 1) * 58 + 130)
  const crownHeight = rowHeights.reduce((sum, height) => sum + height, 0)
  const height = Math.max(600, availableHeight, crownHeight + 290)
  const slotWidth = (width - 36) / columns
  const boughs = groups.map((group, index) => {
    const row = Math.floor(index / columns), column = index % columns
    const rowSize = Math.min(columns, groups.length - row * columns)
    const x = 18 + (width - 36 - rowSize * slotWidth) / 2 + (column + .5) * slotWidth
    const arch = Math.sin((column + .5) / rowSize * Math.PI) * 40
    const y = height - 250 - crownHeight + rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) + (rowCounts[row] - 1) * 58 + 104 - arch
    const leafWidth = Math.min(230, slotWidth - 22)
    const leaves = group.ids.map((id, leaf) => ({ id,
      x: x - leafWidth / 2 + (leaf % 2 ? 9 : -3),
      y: y - 64 - (group.ids.length - 1 - leaf) * 58,
      width: leafWidth,
    }))
    return { id: `${group.topic.id}-${group.index}`, domainId: group.domain.id, topicId: group.topic.id,
      x, y, leaves, label: group.index === 0 && !group.topic.unclassified ? group.topic.label : '',
      labelWidth: Math.min(220, slotWidth - 12),
    }
  })
  const placedDomains = domains.map(domain => {
    const branches = boughs.filter(bough => bough.domainId === domain.id)
    return { ...domain, x: branches.reduce((sum, bough) => sum + bough.x, 0) / branches.length,
      y: height - 153, boughs: branches }
  })
  return { width, height, domains: placedDomains, root: { x: width / 2, y: height - 84 } }
}
