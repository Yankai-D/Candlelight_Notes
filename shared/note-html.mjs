import { renderMath } from './math.mjs';

export const escapeHTML = value => String(value ?? '').toWellFormed().replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function mathHTML(attrs) {
  try { return `<span class="math-render" role="math" aria-label="${escapeHTML(attrs.latex)}">${renderMath(attrs.latex, attrs.display).svg}</span>`; }
  catch { return `<span class="math-invalid">${escapeHTML(attrs?.latex)}</span>`; }
}
export function renderNoteHTML(node, { explanation } = {}) {
  const children = () => (node.content || []).map(child => renderNoteHTML(child, { explanation })).join('');
  if (node.type === 'text') {
    let html = escapeHTML(node.text);
    for (const mark of node.marks || []) {
      const tag = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code' }[mark.type];
      if (tag) html = `<${tag}>${html}</${tag}>`;
      if (mark.type === 'link' && /^(https?:|mailto:)/i.test(mark.attrs?.href || '')) html = `<a href="${escapeHTML(mark.attrs.href)}">${html}</a>`;
    }
    return html;
  }
  if (node.type === 'math') return `<span class="math-node ${node.attrs?.display ? 'math-display' : 'math-inline'}">${mathHTML(node.attrs)}</span>`;
  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'horizontalRule') return '<hr>';
  if (node.type === 'explanation') return explanation ? explanation(node, children()) : `<aside class="paper-note"><div class="paper-note-body">${children()}</div></aside>`;
  const tag = node.type === 'heading' ? (node.attrs?.level === 3 ? 'h3' : 'h2') : { paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', blockquote: 'blockquote' }[node.type];
  const start = node.type === 'orderedList' && Number.isInteger(node.attrs?.start) ? ` start="${node.attrs.start}"` : '';
  return tag ? `<${tag}${start}>${children()}</${tag}>` : children();
}
