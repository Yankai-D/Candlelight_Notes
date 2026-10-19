import { brand } from './brand.mjs';
import { z } from 'zod';
import { defaultNotebookId, templateSettings } from './learning-templates.mjs';
import { writingTemplateSnapshotSchema } from './writing-templates.mjs';
import { bundleContextSchema } from './bundle-context.mjs';

export const learningSettingsSchema = z.object({
  mode: z.enum(['translation', 'adaptive']).default(defaultNotebookId),
  difficulty: z.enum(['foundation', 'standard', 'advanced']).default('standard'),
  style: z.enum(['clear', 'academic', 'derivation']).default('clear'),
  template: z.enum(['translation-v1', 'guided-v1', 'guided-v2', 'guided-v3', 'legacy']).optional(),
  writingTemplate: writingTemplateSnapshotSchema.optional(),
});
export const materialSchema = z.object({
  id: z.string().min(1).max(100), documentId: z.string().max(100).optional(),
  title: z.string().min(1).max(400), category: z.enum(['intro', 'method', 'theory', 'application']),
  concepts: z.array(z.string().max(160)).max(100), note: z.string().max(3000), readAt: z.number(),
});
export const learnerProfileSchema = z.object({
  background: z.string().max(4000), foundations: z.array(z.string().max(200)).max(100),
});
export const knowledgeSchema = learnerProfileSchema.extend({ materials: z.array(materialSchema).max(2000).default([]) });
export const learnerProfile = value => learnerProfileSchema.parse(value);
export const defaultSettings = learningSettingsSchema.parse(templateSettings(defaultNotebookId));
export const defaultKnowledge = {
  background: '', foundations: [], materials: [],
};
export const categories = { intro: '导论', method: '方法', theory: '理论', application: '应用' };
export const preparationSchema = z.object({
  startedAt: z.number(), completedAt: z.number().optional(),
  status: z.enum(['running', 'paused', 'partial', 'complete']),
  completedIds: z.array(z.string()).max(300), errors: z.record(z.string(), z.string().max(2000)),
  settings: learningSettingsSchema, knowledge: learnerProfileSchema.optional(),
  templateRouting: z.enum(['pending', 'selected']).optional(),
  sourceContext: bundleContextSchema.optional(),
});

export function knowledgeContext(knowledge) { return learnerProfile(knowledge); }

export function materialFromDocument(document, now = Date.now()) {
  const group = document.library?.group || '';
  const category = /导论|基础概览/.test(group) ? 'intro' : /规律|理论/.test(group) ? 'theory' : 'method';
  return { id: `read-${document.id}`, documentId: document.id, title: document.library?.label || document.title,
    category, concepts: document.chapters.map(c => c.title).filter(t => !/abstract|references|acknowledg|conclusion|摘要|参考文献/i.test(t)).slice(0, 100).map(t => t.slice(0, 160)),
    note: '已读完此资料。章节主题仅作为阅读经历，不代表已掌握全部概念。', readAt: now };
}

export function addReadMaterial(knowledge, material) {
  const valid = materialSchema.parse(material);
  const existing = knowledge.materials.find(m => m.id === valid.id || (valid.documentId && m.documentId === valid.documentId));
  return existing ? knowledge : knowledgeSchema.parse({ ...knowledge, materials: [...knowledge.materials, valid] });
}

export function restoreKnowledge(raw) {
  const value = JSON.parse(raw);
  if (value.format !== 'reading-tree-knowledge-v1') throw new Error(`请选择${brand.name}的知识库备份。`);
  return knowledgeSchema.parse(value.knowledge);
}
