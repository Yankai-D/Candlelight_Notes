import { z } from 'zod';
import { folderSchema } from './folders.mjs';

// Catalog placement is used only when a document first enters the collection.
export const libraryPlacementSchema = z.object({
  folder: folderSchema,
  inTree: z.boolean().default(true),
});

// Catalog editions only add new papers. User notes, versions and reading
// positions always win; a removed paper stays removed on subsequent visits.
export function orderLibraryDocuments(documents) {
  return [...documents].sort((a, b) => (a.library?.order ?? 10000) - (b.library?.order ?? 10000)
    || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export function mergeLibrary(stored, catalog, removed = []) {
  const removedIds = new Set(removed);
  const existing = new Set(stored.map(d => d.id));
  const added = catalog.filter(d => !existing.has(d.id) && !removedIds.has(d.id));
  const all = [...stored, ...added];
  const hasPapers = all.some(d => d.library);
  const documents = all.filter(d => !(hasPapers && d.id === 'attention-demo' && d.demo && d.revision === 0 && !d.versions.length));
  return { documents: orderLibraryDocuments(documents), added };
}
