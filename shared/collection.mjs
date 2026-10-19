import { z } from 'zod';
import { treeSchema } from './study-tree.mjs';
import { libraryPlacementSchema } from './library.mjs';
import { folderSchema, bundleForDocument, folderAncestors } from './folders.mjs';

export const studyStatuses = { imported: '已导入', studying: '正在学习', completed: '已完成' };
const item = z.object({ folderId: z.string().nullable(), status: z.enum(['imported', 'studying', 'completed']), inTree: z.boolean().default(true) });
export const collectionSchema = z.object({
  version: z.literal(1),
  folders: z.array(folderSchema).max(200),
  items: z.record(z.string(), item), tree: treeSchema.optional(),
}).superRefine((value, ctx) => {
  const ids = new Set(value.folders.map(folder => folder.id));
  const names = new Set();
  if (ids.size !== value.folders.length) ctx.addIssue({ code: 'custom', message: '文件夹编号重复。' });
  for (const folder of value.folders) {
    const key = `${folder.parentId || ''}:${folder.name.toLocaleLowerCase()}`;
    if (names.has(key)) ctx.addIssue({ code: 'custom', message: '同一层级已有同名文件夹。' });
    names.add(key);
    if (folder.parentId && !ids.has(folder.parentId)) ctx.addIssue({ code: 'custom', message: '上级文件夹不存在。' });
    const chain = folderAncestors(value, folder.id);
    if (chain.at(-1)?.parentId) ctx.addIssue({ code: 'custom', message: '文件夹不能移动到自己或下属文件夹。' });
    if (chain.length > 12) ctx.addIssue({ code: 'custom', message: '文件夹最多支持 12 层。' });
  }
});

// This is a one-time migration of the existing shelf, never a rule for future
// uploads. Explicit folder and reading-status choices always win afterwards.
export function reconcileCollection(saved, documents, knowledge) {
  const legacyFolder = !saved && documents.some(document => !libraryPlacementSchema.safeParse(document.library?.placement).success
    && !/(?:wk|week)[\s_.-]*0?10(?:\D|$)/i.test([document.title, document.filename, document.library?.label].join(' ')));
  const current = saved ? collectionSchema.parse(saved) : { version: 1, folders: legacyFolder ? [{ id: 'machine-learning', name: '机器学习' }] : [], items: {} };
  const folders = [...current.folders];
  const read = new Set((knowledge?.materials || []).map(material => material.documentId));
  const items = Object.fromEntries(documents.map(document => {
    const previous = current.items[document.id];
    if (previous) return [document.id, { ...previous, folderId: current.folders.some(folder => folder.id === previous.folderId) ? previous.folderId : null }];
    const started = document.preparation || document.readingAnchor || document.revision > 0
      || Object.values(document.notebooks || {}).some(notebook => notebook.preparation || notebook.revision > 0);
    const wk10 = /(?:wk|week)[\s_.-]*0?10(?:\D|$)/i.test([document.title, document.filename, document.library?.label].join(' '));
    const placement = libraryPlacementSchema.safeParse(document.library?.placement);
    let folderId = !saved && !wk10 ? 'machine-learning' : null;
    if (placement.success) {
      const requested = placement.data.folder;
      let folder = folders.find(folder => folder.id === requested.id || (folder.parentId || null) === (requested.parentId || null) && folder.name.toLocaleLowerCase() === requested.name.toLocaleLowerCase());
      if (!folder && folders.length < 200) { folder = requested; folders.push(folder); }
      folderId = folder?.id || null;
    }
    return [document.id, { folderId, inTree: placement.success ? placement.data.inTree : true,
      status: read.has(document.id) ? 'completed' : started ? 'studying' : 'imported' }];
  }));
  return { ...current, folders, items };
}

export function createFolder(collection, name, id, options = {}) {
  const normalized = name.trim();
  if (!normalized || normalized.length > 60) throw new Error('文件夹名称需要 1–60 个字符。');
  if (collection.folders.some(folder => (folder.parentId || null) === (options.parentId || null) && folder.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) throw new Error('同一层级已有同名文件夹。');
  if (collection.folders.some(folder => folder.id === id)) throw new Error('文件夹编号已存在。');
  const folder = folderSchema.parse({ ...options, id, name: normalized });
  if (folder.kind === 'bundle' && folder.inTree === undefined) folder.inTree = false;
  return collectionSchema.parse({ ...collection, folders: [...collection.folders, folder] });
}

export function updateFolder(collection, id, changes) {
  const previous = collection.folders.find(folder => folder.id === id);
  if (!previous) throw new Error('文件夹已不存在。');
  const next = folderSchema.parse({ ...previous, ...changes, id });
  if (collection.folders.some(folder => folder.id !== id && (folder.parentId || null) === (next.parentId || null) && folder.name.toLocaleLowerCase() === next.name.toLocaleLowerCase())) throw new Error('同一层级已有同名文件夹。');
  if (next.kind === 'bundle' && previous.kind !== 'bundle') next.inTree = changes.inTree === true;
  if (next.kind !== 'bundle') next.inTree = false;
  return collectionSchema.parse({ ...collection, folders: collection.folders.map(folder => folder.id === id ? next : folder) });
}

export function updateCollectionItem(collection, documentId, changes) {
  if (!collection.items[documentId]) throw new Error('这份资料已不在资料库中。');
  if (changes.folderId && !collection.folders.some(folder => folder.id === changes.folderId)) throw new Error('目标文件夹不存在。');
  const target = { ...collection.items[documentId], ...changes };
  if (changes.inTree === true && bundleForDocument({ ...collection, items: { ...collection.items, [documentId]: target } }, documentId)) throw new Error('联合资料包内的文件不能单独编入学习树，请在资料包设置中调整。');
  return { ...collection, items: { ...collection.items, [documentId]: item.parse({ ...collection.items[documentId], ...changes }) } };
}

export function deleteFolder(collection, id) {
  const parentId = collection.folders.find(folder => folder.id === id)?.parentId || null;
  // Dissolve just this container; never delete files, notes or descendants.
  return collectionSchema.parse({ ...collection, folders: collection.folders.filter(folder => folder.id !== id).map(folder => folder.parentId === id ? { ...folder, parentId } : folder),
    items: Object.fromEntries(Object.entries(collection.items).map(([key, value]) => [key, value.folderId === id ? { ...value, folderId: parentId } : value])) });
}
