import { brand } from './brand.mjs';
import { z } from 'zod';
import { uid, withIds } from './document.mjs';
import { preparationSchema, learningSettingsSchema } from './learning.mjs';
import { commitNotebook } from './notebooks.mjs';
import { libraryPlacementSchema } from './library.mjs';
import { bundleContextSchema, sourcePageSchema, compositionSchema, flattenedSources } from './bundle-context.mjs';

const node = z.lazy(() => z.object({
  type: z.enum(['doc', 'paragraph', 'text', 'heading', 'explanation', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'hardBreak', 'horizontalRule', 'math']),
  text: z.string().max(150000).optional(),
  attrs: z.object({ id: z.string().max(100).optional(), level: z.number().int().min(1).max(6).optional(), title: z.string().max(120).optional(), sourcePages: z.array(z.number().int().positive()).optional(), sourceQuote: z.string().max(2000).optional(), origin: z.enum(['ai', 'user', 'example']).optional(), start: z.number().int().optional(), latex: z.string().min(1).max(12000).optional(), display: z.boolean().optional() }).optional(),
  marks: z.array(z.object({ type: z.enum(['bold', 'italic', 'strike', 'code', 'underline', 'link']), attrs: z.object({ href: z.string().refine(s => /^(https?:|mailto:)/i.test(s)).optional(), target: z.string().optional(), rel: z.string().optional(), class: z.string().optional() }).optional() })).optional(),
  content: z.array(node).max(3000).optional(),
}));
const chapter = z.object({ id: z.string(), title: z.string().max(400), subtitle: z.string().optional(), sourcePages: z.array(z.number().int().positive()).min(1), content: node, status: z.enum(['empty', 'ready']) });
const notebookState = {
  updatedAt: z.number(), revision: z.number().int().nonnegative(),
  chapters: z.array(chapter).min(1).max(300), currentChapter: z.string(), currentPage: z.number().int().positive(),
  readingAnchor: z.object({ chapterId: z.string(), blockId: z.string(), fraction: z.number().min(0).max(1) }).optional(),
  versions: z.array(z.object({ id: z.string(), time: z.number(), label: z.string(), chapters: z.array(chapter).max(300) })).max(20),
  preparation: preparationSchema.optional(),
  formulaLayoutVersion: z.number().int().min(0).max(1).optional(),
  mathTypesetVersion: z.number().int().min(0).max(1).optional(),
  noteFormatVersion: z.number().int().min(0).max(1).optional(),
};
const notebook = z.object({ ...notebookState, id: z.string().max(80), label: z.string().max(120), createdAt: z.number(), settings: learningSettingsSchema });
const schema = z.object({ format: z.literal('reading-tree-v1'), document: z.object({
  title: z.string().min(1).max(400), subtitle: z.string(), filename: z.string(), kind: z.enum(['pdf', 'text']), intent: z.string().max(4000),
  intentSource: z.enum(['default', 'user']).optional(),
  entryType: z.literal('note').optional(), sourceContext: bundleContextSchema.optional(), composition: compositionSchema.optional(),
  createdAt: z.number(), ...notebookState,
  pages: z.array(sourcePageSchema).min(1).max(1000),
  demo: z.boolean().optional(),
  library: z.object({ id: z.string().regex(/^[a-z0-9-]+$/), label: z.string().max(200), year: z.string().max(30), authors: z.string().max(300), group: z.string().max(100), order: z.number().int().nonnegative(), placement: libraryPlacementSchema.optional() }).optional(),
  activeNotebookId: z.string().max(80).optional(),
  notebookDefaultsVersion: z.literal(1).optional(),
  notebooks: z.partialRecord(z.enum(['translation', 'adaptive', 'adaptive-legacy']), notebook).optional(),
}) });

export const storedDocumentSchema = schema.shape.document.extend({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) });

export function restoreBackup(raw) {
  let result;
  try { result = schema.parse(JSON.parse(raw)).document; }
  catch { throw new Error(`这不是有效的${brand.name} JSON 备份，或包含不支持的内容。`); }
  if (result.pages.some((p, i) => p.number !== i + 1)) throw new Error('备份中的章节或原文页码不完整。');
  if (result.entryType === 'note') {
    const expected = result.sourceContext ? flattenedSources(result.sourceContext) : [];
    if (!result.composition || !expected.length || expected.length !== result.pages.length || result.pages.some((page, index) =>
      ['number', 'text', 'sourceId', 'sourceTitle', 'sourcePage'].some(key => page[key] !== expected[index][key]))) throw new Error('独立笔记的来源映射不完整。');
  }
  function restoreState(state) {
    const ids = state.chapters.map(c => c.id);
    const validChapters = chapters => new Set(chapters.map(c => c.id)).size === chapters.length && chapters.every(c => c.sourcePages.every(p => p <= result.pages.length));
    if (!validChapters(state.chapters) || state.versions.some(v => !validChapters(v.chapters) || result.entryType !== 'note' && (v.chapters.length !== ids.length || v.chapters.some(c => !ids.includes(c.id))))) throw new Error('备份中的章节或原文页码不完整。');
    if (state.preparation) {
      const completed = state.preparation.completedIds;
      if (new Set(completed).size !== completed.length || completed.some(id => !ids.includes(id)) || Object.keys(state.preparation.errors).some(id => !ids.includes(id) && !(id === '__plan' && result.entryType === 'note' && !result.composition.planned) && !(id === '__template' && state.preparation.templateRouting === 'pending')) || (state.preparation.status === 'complete' && completed.length !== ids.length)) throw new Error('备份中的初始化进度与章节不一致。');
    }
    return { ...state, chapters: state.chapters.map(c => ({ ...c, content: withIds(c.content) })),
      versions: state.versions.map(v => ({ ...v, chapters: v.chapters.map(c => ({ ...c, content: withIds(c.content) })) })),
      currentChapter: ids.includes(state.currentChapter) ? state.currentChapter : ids[0], currentPage: Math.min(state.currentPage, result.pages.length) };
  }
  result = restoreState(result);
  if (result.notebooks || result.activeNotebookId) {
    if (!result.notebooks?.[result.activeNotebookId]) throw new Error('备份中的当前阅读方式不存在。');
    for (const [key, value] of Object.entries(result.notebooks)) {
      if (key !== value.id || (key === 'translation' ? value.settings.mode !== 'translation' : value.settings.mode !== 'adaptive') || value.chapters.length !== result.chapters.length || value.chapters.some((c, i) => c.id !== result.chapters[i].id)) throw new Error('备份中的独立笔记与资料不一致。');
      result.notebooks[key] = restoreState(value);
    }
  }
  return commitNotebook({ ...result, id: uid(), title: result.title + ' · 恢复', updatedAt: Date.now() });
}
