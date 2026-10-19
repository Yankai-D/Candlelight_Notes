import { z } from 'zod';

export const folderSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['folder', 'bundle']).optional(),
  inTree: z.boolean().optional(),
  parentId: z.string().min(1).max(100).nullable().optional(),
});

// Ancestors are nearest-first. A visited set also makes legacy/corrupt input safe
// to inspect before the collection validator reports it.
export function folderAncestors(collection, id) {
  const result = [], seen = new Set();
  let current = collection.folders.find(folder => folder.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id); result.push(current);
    current = collection.folders.find(folder => folder.id === current.parentId);
  }
  return result;
}

export function descendantFolderIds(collection, id) {
  return new Set(collection.folders.filter(folder => folderAncestors(collection, folder.id).some(parent => parent.id === id)).map(folder => folder.id));
}

export function bundleForFolder(collection, id) {
  return folderAncestors(collection, id).find(folder => folder.kind === 'bundle');
}

export function bundleForDocument(collection, documentId) {
  return bundleForFolder(collection, collection.items[documentId]?.folderId);
}

export function folderPath(collection, id) { return folderAncestors(collection, id).reverse().map(folder => folder.name).join(' / '); }
export function folderOutline(collection, parentId = null, depth = 0) {
  return collection.folders.filter(folder => (folder.parentId || null) === parentId).flatMap(folder => [{ ...folder, depth }, ...folderOutline(collection, folder.id, depth + 1)]);
}

export const bundleTreeId = folderId => `bundle:${folderId}`;
