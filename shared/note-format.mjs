import MarkdownIt from 'markdown-it';
import { parseMath } from './math-syntax.mjs';
import { layoutTemplateBlocks } from './learning-templates.mjs';

export const NOTE_FORMAT = 'reading-tree-note-v1';
export const noteFormatPrompt = `统一内容格式 ${NOTE_FORMAT}：正文、讲解小纸条、改写和风格编辑使用同一规则。字段仍是 JSON 字符串，段落由数组/blocks 表达；可用 **重点**、*术语*、行内代码，不生成 HTML、图片或 Markdown 表格。公式只用配对的 \\(…\\) 和 \\[...\\]；不要使用美元定界符、公式代码围栏或裸 LaTeX 环境，不要把数学公式包进行内代码。JSON 解析后每个定界符仅有一个反斜杠，公式内部 aligned 的 \\\\ 换行保留。不要额外转义整段字符串。title/summary 是普通文字，公式放在正文。输出会先由统一编译器转成文本、强调、列表和 math(latex,display) 节点，校验通过后才能写入；不要自行输出渲染节点或 SVG。`;

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true }).disable(['table', 'image']);
function prepare(text, options) {
  if (options?.strict && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('内容含异常控制字符，请检查 JSON 中 LaTeX 反斜杠是否双写。');
  let prefix = '\uE000M'; while (text.includes(prefix)) prefix += 'M';
  const formulas = [];
  const masked = parseMath(text, undefined, options).map(node => {
    if (node.type !== 'math') return node.text;
    const key = `${prefix}${formulas.length}\uE001`;
    formulas.push(node); return key;
  }).join('');
  const pattern = new RegExp(`${prefix}(\\d+)\uE001`, 'g');
  function restore(value, marks = []) {
    const result = []; let end = 0;
    const plain = text => { if (text) result.push({ type: 'text', text, ...(marks.length ? { marks: structuredClone(marks) } : {}) }); };
    for (const match of value.matchAll(pattern)) {
      plain(value.slice(end, match.index)); result.push(structuredClone(formulas[Number(match[1])])); end = match.index + match[0].length;
    }
    plain(value.slice(end)); return result;
  }
  return { masked, restore };
}
function inlineTokens(tokens, restore, inherited = []) {
  const output = [], marks = [...inherited];
  for (const token of tokens || []) {
    if (token.type === 'text') output.push(...restore(token.content, marks));
    else if (token.type === 'code_inline') output.push({ type: 'text', text: token.content, marks: [...marks.filter(m => m.type !== 'code'), { type: 'code' }] });
    else if (token.type === 'softbreak' || token.type === 'hardbreak') output.push({ type: 'hardBreak' });
    else if (token.nesting === 1) {
      const type = { strong_open: 'bold', em_open: 'italic', s_open: 'strike', link_open: 'link' }[token.type];
      if (type) marks.push(type === 'link' ? { type, attrs: { href: token.attrGet('href'), target: '_blank', rel: 'noopener noreferrer nofollow' } } : { type });
    } else if (token.nesting === -1) {
      const type = { strong_close: 'bold', em_close: 'italic', s_close: 'strike', link_close: 'link' }[token.type];
      const index = marks.findLastIndex(m => m.type === type); if (index >= 0) marks.splice(index, 1);
    }
  }
  return output;
}
export function noteInline(text, marks = [], options = {}) {
  const { masked, restore } = prepare(text, options);
  return inlineTokens(md.parseInline(masked, {})[0]?.children, restore, marks);
}
export function noteBlocks(text, attrs = {}, options = {}) {
  const { masked, restore } = prepare(text, options);
  const root = { content: [] }, stack = [root];
  const append = node => stack.at(-1).content.push(node);
  for (const token of md.parse(masked, {})) {
    if (token.type === 'inline') stack.at(-1).content.push(...inlineTokens(token.children, restore));
    else if (token.type === 'fence' || token.type === 'code_block') append({ type: 'paragraph', content: [{ type: 'text', text: token.content.replace(/\n$/, ''), marks: [{ type: 'code' }] }] });
    else if (token.type === 'hr') append({ type: 'horizontalRule' });
    else if (token.nesting === 1) {
      const type = { paragraph_open: 'paragraph', heading_open: 'heading', bullet_list_open: 'bulletList', ordered_list_open: 'orderedList', list_item_open: 'listItem', blockquote_open: 'blockquote' }[token.type];
      if (!type) continue;
      const node = { type, content: [] };
      if (type === 'heading') node.attrs = { level: token.tag === 'h3' ? 3 : 2 };
      if (type === 'orderedList') node.attrs = { start: Number(token.attrGet('start') || 1) };
      append(node); stack.push(node);
    } else if (token.nesting === -1 && stack.length > 1) stack.pop();
  }
  // Source anchors belong to all blocks derived from this model field.
  const attach = node => ({ ...node, ...(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote'].includes(node.type) ? { attrs: { ...node.attrs, ...attrs } } : {}), ...(node.content ? { content: node.content.map(attach) } : {}) });
  return root.content.map(attach);
}
export function modelBlocks(blocks, options = {}) {
  return layoutTemplateBlocks(blocks).flatMap(block => {
    const attrs = { sourcePages: block.sourcePages || [], sourceQuote: block.sourceQuote || '' };
    if (block.type === 'heading') return [{ type: 'heading', attrs: { level: 2, ...attrs }, content: noteInline(block.text.replace(/^#{1,6}\s+/, ''), [], options) }];
    if (block.type === 'bulletList') return [{ type: 'bulletList', attrs, content: block.items.map(text => ({ type: 'listItem', content: noteBlocks(text, attrs, options) })) }];
    return noteBlocks(block.text, attrs, options);
  });
}
// Provider-supplied rendering fields are never trusted: the harness always
// recompiles from its validated strings. Clients consume the returned nodes.
export function compileResult(action, result, options = {}) {
  const rendering = { format: NOTE_FORMAT };
  if (action === 'generate') rendering.blocks = modelBlocks(result.blocks, options);
  if (action === 'explain') rendering.blocks = result.paragraphs.flatMap(text => noteBlocks(text, {}, options));
  if (action === 'rewrite') rendering.inline = noteInline(result.text, [], options);
  if (action === 'style') rendering.edits = result.edits.map(edit => ({ id: edit.id, content: noteInline(edit.text, [], options) }));
  return rendering;
}
export function resultRendering(action, result) {
  return result.rendering?.format === NOTE_FORMAT ? result.rendering : compileResult(action, result);
}

// Conservative one-time compatibility pass for stored raw text. Existing math
// and code nodes, source quotes, IDs and historical versions remain intact.
export function upgradeNoteFormat(document, now = Date.now()) {
  if (document.noteFormatVersion >= 1) return document;
  const upgrade = node => {
    if (node.type === 'math' || node.type === 'codeBlock' || node.marks?.some(m => m.type === 'code')) return node;
    if (!node.content) return node;
    const content = node.content.flatMap(child => child.type === 'text' && !child.marks?.some(mark => mark.type === 'code') && /\\{1,2}[([]|\$|\*\*|`/.test(child.text)
      ? noteInline(child.text, child.marks || []) : [upgrade(child)]);
    return JSON.stringify(content) === JSON.stringify(node.content) ? node : { ...node, content };
  };
  const chapters = document.chapters.map(chapter => ({ ...chapter, content: upgrade(chapter.content) }));
  const changed = chapters.some((chapter, i) => chapter.content !== document.chapters[i].content);
  return { ...document, noteFormatVersion: 1, ...(changed ? { chapters, revision: document.revision + 1, updatedAt: now,
    versions: [{ id: crypto.randomUUID(), time: now, label: '统一笔记与小纸条格式之前', chapters: structuredClone(document.chapters) }, ...(document.versions || [])].slice(0, 20) } : {}) };
}
