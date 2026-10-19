import { z } from 'zod';
import { organizationRequestSchema, validateTree } from '../shared/study-tree.mjs';

export const classificationVersion = 'folder-topics-v2';
const replySchema = z.object({ groups: z.array(z.object({
  label: z.string().trim().min(1).max(80), description: z.string().trim().max(600).default(''),
  documents: z.array(z.string().trim().regex(/^D[1-9]\d{0,2}$/)).min(1).max(250),
})).min(1).max(250) });

export function classificationInput(input) {
  const request = organizationRequestSchema.parse(input);
  if (new Set(request.documents.map(document => document.id)).size !== request.documents.length) throw new Error('资料编号重复，无法整理。');
  if (new Set(request.folders.map(folder => folder.id)).size !== request.folders.length) throw new Error('文件夹编号重复，无法整理。');
  for (const document of request.documents) if (document.folderId && !request.folders.some(folder => folder.id === document.folderId)) throw new Error('资料关联的文件夹不存在，请刷新资料库后重试。');
  const folders = request.folders.map((folder, index) => ({ ref: `F${index + 1}`, name: folder.name }));
  return { folders, documents: request.documents.map((document, index) => ({ ref: `D${index + 1}`,
    folder: document.folderId ? folders[request.folders.findIndex(folder => folder.id === document.folderId)].ref : null,
    title: document.title, description: document.description, chapterTitles: document.chapters.map(chapter => chapter.title),
  })) };
}

export class ClassificationError extends Error {
  constructor(issues) { super('分类校验失败'); this.code = 'INVALID_CLASSIFICATION'; this.issues = issues; }
}

export function decodeClassification(input, raw) {
  const request = organizationRequestSchema.parse(input), source = classificationInput(request);
  let value;
  try {
    // Only unwrap a complete JSON fence. Never guess IDs or extract partial JSON.
    const text = typeof raw === 'string' ? raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim() : raw;
    value = replySchema.parse(typeof text === 'string' ? JSON.parse(text) : text);
  } catch (error) {
    throw new ClassificationError(error instanceof z.ZodError
      ? error.issues.slice(0, 12).map(issue => ({ code: issue.code, path: issue.path.join('.'), expected: issue.expected, maximum: issue.maximum, minimum: issue.minimum }))
      : [{ code: 'invalid_json', path: '$' }]);
  }
  const byRef = new Map(source.documents.map((document, index) => [document.ref, { ...document, original: request.documents[index] }]));
  const assigned = new Set(), issues = [];
  for (const [index, group] of value.groups.entries()) {
    const path = `groups.${index}.documents`, folders = new Set();
    for (const ref of group.documents) {
      const document = byRef.get(ref);
      if (!document) { issues.push({ code: 'unknown_document', path, refs: [ref] }); continue; }
      if (assigned.has(ref)) issues.push({ code: 'duplicate_document', path, refs: [ref] });
      assigned.add(ref); folders.add(document.folder);
    }
    if (folders.size > 1) issues.push({ code: 'mixed_folders', path, refs: group.documents });
  }
  const missing = source.documents.map(document => document.ref).filter(ref => !assigned.has(ref));
  if (missing.length) issues.push({ code: 'missing_documents', path: 'groups', refs: missing });
  if (issues.length) throw new ClassificationError(issues.slice(0, 12));
  const result = { classificationVersion,
    branches: value.groups.map(group => ({ label: group.label, description: group.description,
      folderId: byRef.get(group.documents[0]).original.folderId, documentIds: group.documents.map(ref => byRef.get(ref).original.id) })),
    // Navigation is owned by the app. There is no model-generated chapter ID.
    documents: request.documents.map(document => ({ documentId: document.id, description: '', concepts: [] })),
  };
  return validateTree(request, result);
}

export function classificationFailure(issues) {
  const codes = new Set(issues.map(issue => issue.code));
  if (codes.has('mixed_folders')) return '模型将不同文件夹的资料混在同一分类中';
  if (codes.has('missing_documents')) return '模型遗漏了部分资料';
  if (codes.has('duplicate_document')) return '模型重复分配了资料';
  if (codes.has('unknown_document')) return '模型引用了不在本次整理范围内的资料';
  return '模型返回的分类格式不完整';
}
