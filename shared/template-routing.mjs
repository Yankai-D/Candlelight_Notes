import { templateLibrarySchema, templateSnapshot } from './writing-templates.mjs';
import { templateDecisionSchema } from './template-decision.mjs';
import { notebookSettings } from './notebooks.mjs';

export function templateCatalog(library) {
  return templateLibrarySchema.parse(library).templates.map(({ id, name, audience, organization }) => ({ id, name, audience, organization }));
}
// Distributed excerpts are only for selecting a genre. Generation still reads
// all source pages through the existing, lossless chapter pipeline.
export function templateRoutingRequest(document, library) {
  const pages = document.pages.filter(p => p.text.trim());
  const indices = new Set([0, 1, 2]);
  for (let i = 0; i < 9; i++) indices.add(Math.round(i * (pages.length - 1) / 8));
  return { action: 'select-template', catalog: templateCatalog(library), document: { title: document.title, intent: document.intent,
    feedback: notebookSettings(document).regenerationFeedback || '',
    chapters: document.chapters.map(c => c.title.slice(0, 500)).slice(0, 300),
    excerpts: [...indices].filter(i => i >= 0 && i < pages.length).sort((a, b) => a - b).slice(0, 12).map(i => ({ page: pages[i].number, text: pages[i].text.slice(0, 2000) })) } };
}
export function selectedTemplate(library, result) {
  if (!result || typeof result.reason !== 'string' || !result.reason.trim() || result.reason.length > 600) throw new Error('模板选择说明无效，请重试。');
  const snapshot = templateSnapshot(library, result.templateId, result.reason);
  if (result.task) snapshot.routing = templateDecisionSchema.parse({ task: result.task, material: result.material, fit: result.fit, adaptation: result.adaptation });
  return snapshot;
}
