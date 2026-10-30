import { parseMath, mathText } from './math-syntax.mjs';
import { modelBlocks, resultRendering } from './note-format.mjs';
import { sourceLabel } from './bundle-context.mjs';
import { makeTeachingRecord } from './teaching-plan.mjs';
export const uid = () => globalThis.crypto.randomUUID();

export function textOf(node) {
  if (node.type === 'math') return mathText(node);
  if (node.type === 'hardBreak') return '\n';
  if (node.text) return node.text;
  return (node.content || []).map(textOf).join(['doc', 'bulletList', 'orderedList', 'explanation'].includes(node.type) ? '\n' : '');
}

export function withIds(node) {
  const next = { ...node };
  if (['paragraph', 'heading', 'explanation', 'bulletList', 'orderedList', 'blockquote'].includes(node.type)) {
    next.attrs = { ...node.attrs, id: node.attrs?.id || uid() };
  }
  if (node.content) next.content = node.content.map(withIds);
  return next;
}

export function paragraph(text, attrs = {}) {
  return { type: 'paragraph', attrs: { id: uid(), ...attrs }, ...(text ? { content: parseMath(text) } : {}) };
}

export function normalizeBlocks(blocks) {
  return modelBlocks(blocks).map(withIds);
}

export function editableBlocks(chapters) {
  const blocks = [];
  const walk = (node, chapterId, inNote = false) => {
    if (['paragraph', 'heading'].includes(node.type) && node.attrs?.id && textOf(node)) {
      blocks.push({ id: node.attrs.id, chapterId, type: node.type, inNote, text: textOf(node) });
    }
    node.content?.forEach(child => walk(child, chapterId, inNote || node.type === 'explanation'));
  };
  chapters.forEach(c => walk(c.content, c.id));
  return blocks;
}

// Apply validated block operations to an immutable document snapshot. Selection
// replacement uses ProseMirror's transaction so it can preserve rich-text marks.
export function applyResult(document, request, result) {
  if (document.revision !== request.revision) throw new Error('笔记已发生变化。请重新发起修改，以免覆盖刚才的编辑。');
  const copy = structuredClone(document);
  const chapter = copy.chapters.find(c => c.id === request.chapterId);
  if (!chapter) throw new Error('找不到目标章节。');
  const rendering = resultRendering(request.action, result);
  if (request.action === 'explain') {
    const index = chapter.content.content.findIndex(b => b.attrs?.id === request.anchorId);
    if (index < 0) throw new Error('原段落已移动，请重新选择插入位置。');
    chapter.content.content.splice(index + 1, 0, withIds({
      type: 'explanation', attrs: { title: result.title, sourcePages: result.sourcePages, origin: 'ai' },
      content: structuredClone(rendering.blocks),
    }));
  } else if (request.action === 'generate') {
    chapter.content = withIds({ type: 'doc', content: structuredClone(rendering.blocks) });
    chapter.status = 'ready';
    const record = makeTeachingRecord(document.composition?.plan?.teachingPlan, result.blocks, chapter.content.content, block => modelBlocks([block]));
    if (record) chapter.teachingRecord = record;
    else delete chapter.teachingRecord;
  } else if (request.action === 'style') {
    const allowed = editableBlocks(request.scope === 'document' ? document.chapters : [chapter]);
    const ids = new Set(allowed.map(b => b.id));
    const edits = new Map(rendering.edits.map(edit => {
      if (!ids.has(edit.id)) throw new Error('模型试图修改范围之外的段落。');
      return [edit.id, edit.content];
    }));
    const walk = node => {
      if (edits.has(node.attrs?.id)) node.content = structuredClone(edits.get(node.attrs.id));
      else node.content?.forEach(walk);
    };
    copy.chapters.forEach(c => walk(c.content));
  } else throw new Error('未知修改类型。');
  copy.revision++;
  copy.updatedAt = Date.now();
  return copy;
}

export function markdown(document) {
  const render = (n) => {
    if (n.type === 'math') return mathText(n);
    const body = n.content?.map(render).join('') || '';
    if (n.type === 'text') {
      if (n.marks?.some(m => m.type === 'code')) {
        const ticks = '`'.repeat(Math.max(0, ...(n.text.match(/`+/g) || []).map(s => s.length)) + 1);
        return `${ticks} ${n.text} ${ticks}`;
      }
      let text = n.text.replace(/[\\`*_$~<>\[\]]/g, '\\$&');
      for (const mark of n.marks || []) {
        if (mark.type === 'bold') text = `**${text}**`;
        if (mark.type === 'italic') text = `*${text}*`;
        if (mark.type === 'strike') text = `~~${text}~~`;
        if (mark.type === 'link') text = `[${text}](${mark.attrs.href})`;
      }
      return text;
    }
    if (n.type === 'heading') return `${'#'.repeat(Math.min(6, (n.attrs?.level || 2) + 1))} ${body}\n\n`;
    if (n.type === 'paragraph') return `${body}\n\n`;
    if (n.type === 'listItem') return `- ${body.trim()}\n`;
    if (n.type === 'bulletList' || n.type === 'orderedList') return `${body}\n`;
    if (n.type === 'explanation') return `> **小纸条 · ${n.attrs?.title || '换个角度理解'}**\n>\n${body.trim().split('\n').map(l => `> ${l}`).join('\n')}\n${n.attrs?.sourcePages?.length ? `> ${document.entryType === 'note' ? sourceLabel(document.pages, n.attrs.sourcePages) : `原文：第 ${n.attrs.sourcePages.join('、')} 页`}\n` : ''}\n`;
    if (n.type === 'hardBreak') return '\n';
    if (n.type === 'blockquote') return `${body.trim().split('\n').map(l => `> ${l}`).join('\n')}\n\n`;
    return body;
  };
  return `# ${document.title}\n\n学习目标：${document.intent}\n\n${document.chapters.map(c => `## ${c.title}\n\n${render(c.content)}`).join('\n')}`;
}
