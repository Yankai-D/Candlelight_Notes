import { z } from 'zod';
import { bundleForDocument, bundleTreeId, folderAncestors, descendantFolderIds } from './folders.mjs';

const description = z.string().max(600);
const concept = z.object({ label: z.string().min(1).max(80), description, chapterIds: z.array(z.string().max(100)).min(1).max(30) });
export const treeResultSchema = z.object({
  classificationVersion: z.literal('folder-topics-v2').optional(),
  branches: z.array(z.object({ label: z.string().min(1).max(80), description, folderId: z.string().nullable().optional(), documentIds: z.array(z.string().max(120)).min(1).max(250) })).min(1).max(250),
  documents: z.array(z.object({ documentId: z.string().max(120), description, concepts: z.array(concept).max(12) })).min(1).max(250),
});
export const treeSchema = treeResultSchema.extend({ version: z.literal('study-tree-v1'), generatedAt: z.number(), fingerprint: z.string().max(100), model: z.string().max(120) });
export const organizationRequestSchema = z.object({ folders: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(60) })).max(200).default([]), documents: z.array(z.object({
  folderId: z.string().nullable().default(null),
  id: z.string().min(1).max(120), title: z.string().min(1).max(400), description: z.string().max(1400),
  chapters: z.array(z.object({ id: z.string().max(100), title: z.string().max(400), sourcePages: z.array(z.number().int().positive()).max(1000) })).min(1).max(300),
})).min(1).max(250) }).strict();

// All tree consumers use these entries. Member preferences remain saved so
// moving out of a package restores their previous independent visibility.
/** @param {any[]} documents @param {any} collection @returns {any[]} */
export function treeEntries(documents, collection) {
  const independent = documents.filter(document => !bundleForDocument(collection, document.id) && collection.items[document.id]?.inTree !== false);
  const bundles = collection.folders.filter(folder => folder.kind === 'bundle' && folder.inTree === true && !folderAncestors(collection, folder.parentId).some(parent => parent.kind === 'bundle' && parent.inTree === true)).flatMap(folder => {
    const descendants = descendantFolderIds(collection, folder.id);
    const members = documents.filter(document => descendants.has(collection.items[document.id]?.folderId));
    if (!members.length) return [];
    return [{ id: bundleTreeId(folder.id), title: folder.name, kind: 'bundle', bundleFolderId: folder.id,
      subtitle: `联合资料包 · ${members.length} 份资料`,
      members: members.map(document => ({ id: document.id, title: document.library?.label || document.title, pageCount: document.pages.length })),
      pages: [{ number: 1, text: members.map(document => document.title).join('\n').slice(0, 1100) }],
      chapters: members.slice(0, 300).map(document => ({ id: document.id, title: document.library?.label || document.title, sourcePages: [] })),
    }];
  });
  return [...independent, ...bundles];
}

export function treeEntryStatus(entry, collection) {
  if (entry.kind !== 'bundle') return collection.items[entry.id]?.status || 'imported';
  const statuses = entry.members.map(member => collection.items[member.id]?.status || 'imported');
  return statuses.every(status => status === 'completed') ? 'completed' : statuses.some(status => status !== 'imported') ? 'studying' : 'imported';
}

const entryFolder = (entry, collection) => entry.kind === 'bundle' ? null : collection.items[entry.id]?.folderId || null;

/** @param {any[]} documents @param {any} [collection] */
export function organizationInput(documents, collection = { folders: [], items: {} }) {
  const included = treeEntries(documents, collection);
  const usedFolders = new Set(included.map(document => entryFolder(document, collection)));
  return { folders: collection.folders.filter(folder => usedFolders.has(folder.id)).map(({ id, name }) => ({ id, name })), documents: included.map(document => ({ id: document.id, folderId: entryFolder(document, collection), title: document.library?.label ? `${document.library.label} · ${document.title}`.slice(0, 400) : document.title,
    description: [document.subtitle, document.library?.group, document.pages.slice(0, 2).map(page => page.text).join('\n').slice(0, 1100)].filter(Boolean).join('\n').slice(0, 1400),
    chapters: document.chapters.map(({ id, title, sourcePages }) => ({ id, title, sourcePages })),
  })) };
}

export function treeFingerprint(documents, collection) {
  const prepared = organizationInput(documents, collection);
  const input = JSON.stringify({ folders: prepared.folders.sort((a, b) => a.id.localeCompare(b.id)), documents: prepared.documents.sort((a, b) => a.id.localeCompare(b.id)) });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `v2-${(hash >>> 0).toString(16)}-${input.length}`;
}

export function validateTree(input, raw) {
  const request = organizationRequestSchema.parse(input);
  const result = treeResultSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const ids = request.documents.map(document => document.id);
  if (new Set(ids).size !== ids.length) throw new Error('资料 ID 重复，无法整理。');
  const assigned = result.branches.flatMap(branch => branch.documentIds);
  const described = result.documents.map(document => document.documentId);
  for (const references of [assigned, described]) {
    if (references.length !== ids.length || new Set(references).size !== ids.length || references.some(id => !ids.includes(id))) throw new Error('整理结果包含重复、遗漏或不存在的资料。');
  }
  if (result.classificationVersion === 'folder-topics-v2') for (const branch of result.branches) {
    if (branch.documentIds.some(id => request.documents.find(document => document.id === id).folderId !== branch.folderId)) throw new Error('分类结果改变了用户的文件夹归属。');
  }
  for (const document of result.documents) {
    const chapters = request.documents.find(source => source.id === document.documentId).chapters.map(chapter => chapter.id);
    for (const concept of document.concepts) {
      if (new Set(concept.chapterIds).size !== concept.chapterIds.length || concept.chapterIds.some(id => !chapters.includes(id))) throw new Error('概念指向了不存在的章节。');
    }
  }
  return result;
}

// Before model organization, folders provide a useful, complete index. A newly
// imported document also stays visible while a previously saved tree is stale.
export function treeBranches(documents, collection) {
  documents = treeEntries(documents, collection);
  const existing = new Set(documents.map(document => document.id));
  if (collection.tree) {
    const branches = collection.tree.branches.map((branch, index) => ({ ...branch, id: `topic-${index}`, documentIds: branch.documentIds.filter(id => existing.has(id)) })).filter(branch => branch.documentIds.length);
    const assigned = new Set(branches.flatMap(branch => branch.documentIds));
    const added = documents.filter(document => !assigned.has(document.id)).map(document => document.id);
    if (added.length) branches.push({ id: 'unorganized', label: '待整理资料', description: '新加入的资料，可以自动整理到知识主题中。', documentIds: added });
    return branches;
  }
  return [...collection.folders.filter(folder => folder.kind !== 'bundle').map(folder => ({ ...folder, label: folder.name })), { id: '', label: '未分类' }]
    .map(folder => ({ id: folder.id || 'unfiled', label: folder.label, description: '按资料库文件夹索引',
      documentIds: documents.filter(document => (entryFolder(document, collection) || '') === folder.id).map(document => document.id) }))
    .filter(branch => branch.documentIds.length);
}

// The folders are user-owned trunks. Topics remain classification metadata;
// moving a file changes its visible parent immediately without changing notes.
export function treeDomains(documents, collection) {
  const included = treeEntries(documents, collection);
  return [...collection.folders.filter(folder => folder.kind !== 'bundle'), { id: null, name: '未分类' }].flatMap(folder => {
    const members = included.filter(document => entryFolder(document, collection) === folder.id);
    if (!members.length) return [];
    const assigned = new Set();
    const topics = (collection.tree?.branches || []).flatMap((branch, index) => {
      const documentIds = branch.documentIds.filter(id => members.some(document => document.id === id) && !assigned.has(id));
      documentIds.forEach(id => assigned.add(id));
      return documentIds.length ? [{ id: `${folder.id || 'unfiled'}-topic-${index}`, label: branch.label, description: branch.description, documentIds }] : [];
    });
    const pending = members.filter(document => !assigned.has(document.id)).map(document => document.id);
    if (pending.length) topics.push({ id: `${folder.id || 'unfiled'}-pending`, label: '', description: '', unclassified: true, documentIds: pending });
    return [{ id: folder.id || 'unfiled', label: folder.name, topics, documentIds: members.map(document => document.id) }];
  });
}
