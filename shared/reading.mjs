import { textOf } from './document.mjs';

const clamp = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const weight = block => Math.max(40, textOf(block).length);

// Original page references are stable across editing. Older notes without
// references fall back to a proportional position within the chapter.
export function sourceAt(chapter, blockId, withinBlock = 0) {
  const blocks = chapter.content.content || [];
  const index = blocks.findIndex(b => b.attrs?.id === blockId);
  if (index < 0) return { page: chapter.sourcePages[0], fraction: 0, quote: '', approximate: false };
  const block = blocks[index];
  if (block.type === 'explanation') {
    const previous = blocks.slice(0, index).findLast(b => b.type !== 'explanation');
    if (previous) {
      const nearby = sourceAt(chapter, previous.attrs?.id, 1);
      const page = block.attrs?.sourcePages?.find(p => chapter.sourcePages.includes(p));
      return !page || nearby.page === page ? nearby : { page, fraction: 0.12, quote: '', approximate: true };
    }
  }
  const pages = [...new Set((block.attrs?.sourcePages || []).filter(p => chapter.sourcePages.includes(p)))].sort((a, b) => a - b);
  const progress = clamp(withinBlock);
  if (pages.length) {
    const position = Math.min(pages.length - 0.001, progress * pages.length);
    const page = pages[Math.floor(position)];
    const peers = blocks.filter(b => b.type !== 'explanation' && b.attrs?.sourcePages?.length === 1 && b.attrs.sourcePages[0] === page);
    const peerIndex = peers.indexOf(block);
    const total = peers.reduce((sum, b) => sum + weight(b), 0);
    const fraction = pages.length === 1 && peerIndex >= 0 ? (peers.slice(0, peerIndex).reduce((sum, b) => sum + weight(b), 0) + weight(block) * progress) / total : position % 1;
    const quote = page === pages[0] ? block.attrs?.sourceQuote || '' : '';
    return { page, fraction: clamp(0.08 + fraction * 0.82), quote, approximate: !quote };
  }
  const originals = blocks.filter(b => b.type !== 'explanation');
  const originalIndex = originals.indexOf(block);
  const total = originals.reduce((sum, b) => sum + weight(b), 0) || 1;
  const fraction = (originals.slice(0, Math.max(0, originalIndex)).reduce((sum, b) => sum + weight(b), 0) + weight(block) * progress) / total;
  const position = Math.min(chapter.sourcePages.length - 0.001, fraction * chapter.sourcePages.length);
  return { page: chapter.sourcePages[Math.floor(position)], fraction: clamp(position % 1), quote: '', approximate: true };
}

// Layouts are expressed in scroll-content coordinates, so the same calculation
// works for wheel, touch, keyboard, and explicit chapter navigation.
export function locateReading(chapters, layouts, scrollTop, viewportHeight, scrollHeight) {
  if (!layouts.length) return null;
  const line = scrollTop + Math.min(88, viewportHeight * 0.18);
  let layout = layouts[0];
  for (const candidate of layouts) { if (candidate.top <= line) layout = candidate; else break; }
  const chapter = chapters.find(c => c.id === layout.id);
  if (!chapter) return null;
  let block;
  for (const candidate of layout.blocks) { if (candidate.top <= line) block = candidate; else break; }
  const withinBlock = block ? clamp((line - block.top) / Math.max(1, block.height)) : 0;
  return {
    chapterId: chapter.id, blockId: block?.id || '', withinBlock,
    chapterProgress: clamp((line - layout.top) / Math.max(1, layout.height)),
    progress: clamp(scrollTop / Math.max(1, scrollHeight - viewportHeight)),
    source: sourceAt(chapter, block?.id, withinBlock),
  };
}

export function collectReadingLayout(root) {
  const origin = root.getBoundingClientRect().top - root.scrollTop;
  return [...root.querySelectorAll('[data-note-chapter]')].map(section => {
    const rect = section.getBoundingClientRect();
    const prose = section.querySelector('.note-prose');
    const blocks = [...(prose?.children || [])].map(element => {
      const id = element.getAttribute('data-block-id') || element.querySelector('[data-block-id]')?.getAttribute('data-block-id');
      const box = element.getBoundingClientRect();
      return { id, top: box.top - origin, height: box.height };
    }).filter(b => b.id);
    return { id: section.getAttribute('data-note-chapter'), top: rect.top - origin, height: rect.height, blocks };
  });
}
