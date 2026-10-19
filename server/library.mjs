import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeLearningIntent } from '../shared/learning-intent.mjs';

const root = resolve(process.env.READING_TREE_LIBRARY_DIR || '.local-library');
export async function readLibrary() {
  try {
    const catalog = JSON.parse(await readFile(resolve(root, 'catalog.json'), 'utf8'));
    return { ...catalog, documents: catalog.documents.map(normalizeLearningIntent) };
  }
  catch (error) { if (error.code === 'ENOENT') return { collection: '', documents: [] }; throw error; }
}
export async function readLibrarySource(id) {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const catalog = await readLibrary();
  if (!catalog.documents.some(d => d.library?.id === id)) return null;
  return readFile(resolve(root, id + '.pdf'));
}
