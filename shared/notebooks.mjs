import { defaultNotebookId, templateSettings, noteTemplates } from './learning-templates.mjs';
import { textOf } from './document.mjs';

const fields = ['chapters','revision','updatedAt','currentChapter','currentPage','readingAnchor','versions','preparation','formulaLayoutVersion','mathTypesetVersion','noteFormatVersion'];
function stateOf(document) { return Object.fromEntries(fields.map(field => [field, document[field]])); }
export function notebookSettings(document) {
  if (document.preparation?.settings?.writingTemplate) return document.preparation.settings;
  return document.notebooks?.[document.activeNotebookId]?.settings || document.preparation?.settings || templateSettings(defaultNotebookId);
}
export function notebookLabel(document) {
  return document.notebooks?.[document.activeNotebookId]?.label || noteTemplates[defaultNotebookId].label;
}
export function notebookKey(document, chapterId = '') { return `${document.id}:${document.activeNotebookId || defaultNotebookId}${chapterId ? ':' + chapterId : ''}`; }
export function commitNotebook(document) {
  const notebook = document.notebooks?.[document.activeNotebookId];
  if (!notebook || fields.every(field => notebook[field] === document[field])) return document;
  return { ...document, notebooks: { ...document.notebooks, [notebook.id]: { ...notebook, ...stateOf(document) } } };
}
export function ensureNotebooks(document, now = Date.now()) {
  const hasWork = state => Boolean(state.preparation || state.versions?.length || state.chapters.some(chapter => chapter.status === 'ready' || textOf(chapter.content).trim() || chapter.content.content?.some(node => node.type === 'explanation')));
  if (document.notebooks && document.activeNotebookId && document.notebooks[document.activeNotebookId]) {
    const current = commitNotebook(document);
    if (current.notebookDefaultsVersion === 1) return current;
    const marked = { ...current, notebookDefaultsVersion: 1 };
    // Update untouched shelves once. Explicit choices made after this migration
    // survive reopening, even if the chosen notebook has not been generated yet.
    return current.activeNotebookId === 'translation' && Object.values(current.notebooks).every(state => !hasWork(state))
      ? selectNotebook(marked, defaultNotebookId, now) : marked;
  }
  const legacyAdaptive = document.preparation?.settings?.mode === 'adaptive';
  const id = legacyAdaptive ? 'adaptive-legacy' : hasWork(document) ? 'translation' : defaultNotebookId;
  const settings = legacyAdaptive ? { ...document.preparation.settings, template: 'legacy' } : templateSettings(id);
  const notebook = { id, label: legacyAdaptive ? '适应学习 · 旧版' : noteTemplates[id].label, createdAt: document.createdAt || now, settings, ...stateOf(document) };
  // Legacy writing keeps its original edition; only untouched papers start
  // with the current adaptive template. Creating an edition never calls a model.
  return { ...document, notebookDefaultsVersion: 1, activeNotebookId: id, notebooks: { [id]: notebook } };
}
function emptyState(document, now) {
  const chapters = document.chapters.map(chapter => ({ ...chapter, status: 'empty', content: { type: 'doc', content: [] } }));
  return { chapters, revision: 0, updatedAt: now, currentChapter: chapters[0].id, currentPage: chapters[0].sourcePages[0],
    readingAnchor: undefined, versions: [], preparation: undefined, formulaLayoutVersion: undefined, mathTypesetVersion: undefined, noteFormatVersion: undefined };
}
export function selectNotebook(document, id, now = Date.now()) {
  if (document.entryType === 'note' && id !== 'adaptive') throw new Error('独立笔记按整理要求生成，无需切换翻译版本。');
  const current = commitNotebook(ensureNotebooks(document, now));
  if (current.activeNotebookId === id) return current;
  let target = current.notebooks[id];
  if (!target) {
    const template = noteTemplates[id];
    if (!template) throw new Error('这份笔记不存在。');
    target = { id, label: template.label, settings: templateSettings(id), createdAt: now, ...emptyState(current, now) };
  }
  return { ...current, ...stateOf(target), activeNotebookId: id, notebooks: { ...current.notebooks, [id]: target } };
}
export function regenerateNotebook(document, now = Date.now()) {
  const current = commitNotebook(ensureNotebooks(document, now));
  if (!noteTemplates[current.activeNotebookId]) throw new Error('旧版笔记作为存档保留，请选择新的适应学习模板。');
  const previous = { id: crypto.randomUUID(), time: now, label: `${notebookLabel(current)} · 重新生成之前`, chapters: structuredClone(current.chapters) };
  const notebook = { ...current.notebooks[current.activeNotebookId], settings: templateSettings(current.activeNotebookId) };
  return commitNotebook({ ...current, notebooks: { ...current.notebooks, [notebook.id]: notebook }, ...emptyState(current, now), revision: current.revision + 1,
    versions: [previous, ...current.versions].slice(0,20) });
}
export function restoreNotebookVersion(document, chapters, now = Date.now()) {
  if (!chapters.length) throw new Error('历史笔记没有可恢复的章节。');
  const completedIds = chapters.filter(chapter => chapter.status === 'ready').map(chapter => chapter.id);
  const complete = completedIds.length === chapters.length;
  const current = chapters.find(chapter => chapter.id === document.currentChapter);
  const chapter = current || chapters[0];
  const { completedAt: _completedAt, ...preparation } = document.preparation || {};
  return commitNotebook({ ...document, chapters: structuredClone(chapters), revision: document.revision + 1, updatedAt: now,
    currentChapter: chapter.id, currentPage: current?.sourcePages.includes(document.currentPage) ? document.currentPage : chapter.sourcePages[0],
    readingAnchor: undefined,
    ...(document.entryType === 'note' ? { composition: { version: 1, planned: true } } : {}),
    preparation: { ...preparation, startedAt: document.preparation?.startedAt || now, settings: notebookSettings(document),
      completedIds, errors: {}, status: complete ? 'complete' : 'partial', ...(complete ? { completedAt: now } : {}) } });
}
export function notebookStatus(notebook) {
  if (!notebook) return '选择后生成';
  const done = notebook.chapters.filter(chapter => chapter.status === 'ready' || textOf(chapter.content).trim()).length;
  return done === notebook.chapters.length ? '已保存' : done ? `已保存 ${done}/${notebook.chapters.length}` : '待生成';
}
