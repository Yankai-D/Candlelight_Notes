import { createHash } from 'node:crypto';

// Shared by citation recovery and review. IDs bind to an exact span of the
// current source; the model never has to retype damaged PDF glyphs.
export function sourceEvidenceIndex(pages) {
  const byId = new Map();
  const source = pages.map(({ text, ...page }) => {
    const excerpts = [];
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + 800);
      if (end < text.length) {
        const boundary = Math.max(text.lastIndexOf('\n', end - 1), text.lastIndexOf(' ', end - 1));
        if (boundary > start + 300) end = boundary + 1;
        if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      }
      const quote = text.slice(start, end);
      const id = `e${page.number}-${start}-${createHash('sha256').update(quote).digest('hex').slice(0, 12)}`;
      excerpts.push({ id, text: quote }); byId.set(id, { page: page.number, quote });
      start = end;
    }
    return { ...page, excerpts };
  });
  return { source, byId };
}
