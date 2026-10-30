import { z } from 'zod';
import { teachingIssues } from './teaching-plan.mjs';
import { bundleForDocument, descendantFolderIds, folderPath, folderOutline } from './folders.mjs';
import { bundleBlueprintSchema, planningIssue, requirementCoverage } from './bundle-blueprint.mjs';
import sourceLimits from './source-limits.json' with { type: 'json' };

export const defaultBundleIntent = '整理当前资料包以及下属资料包的全部资料，形成一份完整、层次清晰的学习笔记。';
export const sourcePageSchema = z.object({ number: z.number().int().positive(), text: z.string().max(150000),
  sourceId: z.string().max(100).optional(), sourceTitle: z.string().max(400).optional(), sourcePage: z.number().int().positive().optional() });
export const bundleContextSchema = z.object({
  version: z.literal(1), folderId: z.string().max(100), folderName: z.string().max(800), capturedAt: z.number(),
  sources: z.array(z.object({ id: z.string().min(1).max(100), title: z.string().min(1).max(400), path: z.string().max(800),
    pages: z.array(sourcePageSchema).min(1).max(sourceLimits.maxPages),
    chapters: z.array(z.object({ title: z.string().max(400), sourcePages: z.array(z.number().int().positive()) })).max(300),
  })).min(1).max(100),
}).superRefine((context, ctx) => {
  if (new Set(context.sources.map(s => s.id)).size !== context.sources.length) ctx.addIssue({ code: 'custom', message: '来源编号重复。' });
  if (context.sources.reduce((n, s) => n + s.pages.length, 0) > sourceLimits.maxPages) ctx.addIssue({ code: 'custom', message: `单份笔记最多参考 ${sourceLimits.maxPages} 页，请在下属资料包中创建。` });
  if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 3000000) ctx.addIssue({ code: 'custom', message: '资料包文本过大，请在下属资料包中创建笔记。' });
  for (const source of context.sources) if (source.pages.some((p, i) => p.number !== i + 1)) ctx.addIssue({ code: 'custom', message: '来源页码不完整。' });
});

export function bundleMaterials(documents, collection, folderId) {
  const ids = descendantFolderIds(collection, folderId);
  const order = folderOutline(collection).map(folder => folder.id);
  return documents.filter(document => document.entryType !== 'note' && ids.has(collection.items[document.id]?.folderId)).sort((a, b) => order.indexOf(collection.items[a.id].folderId) - order.indexOf(collection.items[b.id].folderId) || (a.library?.order ?? 10000) - (b.library?.order ?? 10000) || a.title.localeCompare(b.title, 'zh-CN', { numeric: true }));
}

export function captureBundleContext(documents, collection, folderId, now = Date.now()) {
  const folder = collection.folders.find(f => f.id === folderId);
  if (!folder) throw new Error('资料包已不存在，请在资料库中重新选择。');
  const members = bundleMaterials(documents, collection, folderId);
  if (!members.length) throw new Error('请先向当前资料包或下属资料包添加资料。');
  if (members.some(document => !document.pages.some(page => page.text.trim()))) throw new Error('资料包中有无法提取正文的文件，请先补充可读取的文字。');
  return bundleContextSchema.parse({ version: 1, folderId, folderName: folderPath(collection, folderId), capturedAt: now,
    sources: members.map(document => ({ id: document.id, title: document.library?.label || document.title, path: folderPath(collection, collection.items[document.id]?.folderId),
      pages: document.pages.map(({ number, text }) => ({ number, text })), chapters: document.chapters.map(({ title, sourcePages }) => ({ title, sourcePages })) })) });
}

export function contextForMaterial(document, documents, collection) {
  const folder = bundleForDocument(collection, document.id);
  return folder ? captureBundleContext(documents, collection, folder.id) : undefined;
}

export function flattenedSources(context) {
  let number = 0;
  return context.sources.flatMap(source => source.pages.map(page => ({ number: ++number, text: page.text,
    sourceId: source.id, sourceTitle: source.title, sourcePage: page.number })));
}

// Index every file; select bounded, relevant evidence from each file. This is
// supplementary context, never a claim that excerpts exhaust the whole package.
export function relatedBundleEvidence(context, primaryId, query) {
  if (!context) return undefined;
  const sources = context.sources.filter(source => source.id !== primaryId);
  if (!sources.length) return undefined;
  const words = [...new Set((query.toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\p{Script=Han}]{2,}/gu) || []).flatMap(word => /\p{Script=Han}/u.test(word) ? Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2)) : [word]))].slice(0, 150);
  const perSource = Math.min(10000, Math.floor(60000 / sources.length));
  return { scope: context.folderName, capturedAt: context.capturedAt, evidenceMode: 'bounded-excerpts', sources: sources.map(source => {
    const ranked = source.pages.map(page => ({ ...page, score: words.reduce((score, word) => score + (page.text.toLowerCase().includes(word) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score || a.number - b.number);
    return { id: source.id, title: source.title, path: source.path, totalPages: source.pages.length,
      excerpts: ranked.slice(0, 3).map(page => { const size = Math.floor(perSource / Math.min(3, ranked.length)); const hit = words.map(word => page.text.toLowerCase().indexOf(word)).filter(i => i >= 0).sort((a, b) => a - b)[0] || 0; const start = Math.max(0, hit - 180); return { page: page.number, text: page.text.slice(start, start + size), partial: start > 0 || page.text.length > size }; }) };
  }) };
}

export function createBundleNote(context, title, intent = defaultBundleIntent, now = Date.now()) {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length > 400) throw new Error('笔记名称需要 1–400 个字符。');
  if (!intent.trim() || intent.length > 4000) throw new Error('请填写 1–4000 字的整理要求。');
  const pages = flattenedSources(bundleContextSchema.parse(context)), chapterId = crypto.randomUUID();
  return { id: crypto.randomUUID(), entryType: 'note', title: cleanTitle, subtitle: `独立笔记 · ${context.folderName}`, filename: '', kind: 'text',
    intent: intent.trim(), intentSource: 'user', createdAt: now, updatedAt: now, revision: 0, pages,
    chapters: [{ id: chapterId, title: '整理资料包', sourcePages: pages.map(p => p.number), status: 'empty', content: { type: 'doc', content: [] } }],
    currentChapter: chapterId, currentPage: 1, versions: [], sourceContext: context,
    composition: { version: 1, planned: false } };
}

export const compositionSchema = z.object({ version: z.literal(1), planned: z.boolean(), plan: bundleBlueprintSchema.optional() });

// Metadata-only planner input: units partition ALL source pages, including blank
// ones. Generation receives the complete assigned texts, not these excerpts.
export function bundlePlanRequest(document) {
  const units = []; let current;
  for (const page of document.pages) {
    if (!current || current.sourceId !== page.sourceId || current.size + page.text.length > 14000 || current.pages.length >= 12) {
      current = { id: `unit-${units.length + 1}`, sourceId: page.sourceId || document.id, title: page.sourceTitle || document.title, pages: [], size: 0, excerpts: [] }; units.push(current);
    }
    current.pages.push(page.number); current.size += page.text.length;
    if (current.excerpts.length < 3) current.excerpts.push({ page: page.number, text: page.text.slice(0, 200) });
  }
  if (units.length > 300) throw new Error('资料包内容过多，请选择下属资料包分别整理。');
  const feedback = document.preparation?.settings?.regenerationFeedback || document.notebooks?.[document.activeNotebookId]?.settings?.regenerationFeedback;
  return { action: 'bundle-plan', title: document.title, intent: document.intent,
    documentId: document.id, notebookId: document.activeNotebookId || 'adaptive', revision: document.revision,
    planningId: document.preparation?.planningId,
    ...(feedback ? { feedback } : {}), units: units.map(({ size, ...unit }) => unit) };
}

export const bundlePlanInputSchema = z.object({ action: z.literal('bundle-plan'), title: z.string().max(400), intent: z.string().min(1).max(4000),
  documentId: z.string().max(100).optional(), notebookId: z.string().max(100).optional(),
  revision: z.number().int().nonnegative().optional(), planningId: z.string().uuid().optional(),
  feedback: z.string().max(4000).optional(),
  units: z.array(z.object({ id: z.string().max(100), sourceId: z.string().max(100), title: z.string().max(400), pages: z.array(z.number().int().positive()).min(1).max(sourceLimits.maxPages), excerpts: z.array(z.object({ page: z.number().int().positive(), text: z.string().max(600) })).max(3) })).min(1).max(300) });
export function validateBundlePlan(input, raw) {
  const request = bundlePlanInputSchema.parse(input);
  const plan = bundleBlueprintSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const required = request.units.map(unit => unit.id), actual = plan.sections.flatMap(section => section.unitIds);
  const counts = new Map();
  for (const id of actual) counts.set(id, (counts.get(id) || 0) + 1);
  const issues = [];
  if (new Set(required).size !== required.length) throw planningIssue('来源输入的单元编号重复。', [{ path: ['units'], code: 'INPUT_UNIT_ID', expected: 'unique IDs' }]);
  // Considering a source does not create a writing obligation. Explicit,
  // reviewable exclusions account for material outside the learning goal.
  const omitted=plan.sourceSelection?.omissions.flatMap(item=>item.unitIds)||[];
  const invalidOmissions=omitted.filter(id=>!required.includes(id)||actual.includes(id));
  if(invalidOmissions.length||new Set(omitted).size!==omitted.length)issues.push({path:['sourceSelection','omissions'],code:'SOURCE_SELECTION',
    expected:'existing source IDs, each omitted once and never also assigned to a section',refs:invalidOmissions});
  if(omitted.length&&plan.analysis?.task.kind&&plan.analysis.task.kind!=='lecture')issues.push({path:['sourceSelection'],code:'TASK_SOURCE_SELECTION',expected:'selective lecture composition only; translation and complete solutions retain source coverage'});
  const missing = required.filter(id => !actual.includes(id)&&!omitted.includes(id));
  if (missing.length) issues.push({ path: ['sections'], code: 'MISSING_UNITS', refs: missing, expected: required });
  plan.sections.forEach((section, index) => {
    const unknown = section.unitIds.filter(id => !required.includes(id));
    if (unknown.length) issues.push({ path: ['sections', index, 'unitIds'], code: 'UNKNOWN_UNITS', refs: unknown, expected: required });
    if (new Set(section.unitIds).size !== section.unitIds.length) issues.push({ path: ['sections', index, 'unitIds'], code: 'DUPLICATE_UNITS' });
    if (section.dependsOn?.some(n => n > index)) issues.push({ path: ['sections', index, 'dependsOn'], code: 'FORWARD_DEPENDENCY', maximum: index });
    if (section.teaching?.recallFrom.some(n => n > index) || section.teaching && new Set(section.teaching.recallFrom).size !== section.teaching.recallFrom.length) issues.push({ path: ['sections', index, 'teaching', 'recallFrom'], code: 'RECALL_BINDING', maximum: index });
  });
  const repeated = [...counts].filter(([id, count]) => {
    if (count <= 3) return false;
    const uses = new Set(plan.teachingPlan?.examples.filter(e => e.unitIds.includes(id)).flatMap(e => e.uses.map(use => use.section)) || []);
    return plan.sections.some((section,index) => section.unitIds.includes(id) && !uses.has(index + 1));
  }).map(([id]) => id);
  if (repeated.length) issues.push({ path: ['sections'], code: 'OVERUSED_UNITS', refs: repeated, maximum: 3 });
  issues.push(...teachingIssues(plan, required));
  if (issues.length) throw planningIssue('整理规划遗漏资料、重复分配或引用了不存在的来源／章节关系。', issues);
  if (plan.analysis) {
    if (plan.analysis.pendingChecks?.some(check => check.unitIds.some(id => !required.includes(id)))) throw planningIssue('待核查事项引用了不存在的来源单元。', [{ path: ['analysis', 'pendingChecks'], code: 'PENDING_CHECK_SOURCE', expected: required }]);
    const coverage = requirementCoverage(plan.analysis.task,plan.sections);
    if (coverage.missing.length || coverage.unknown.length) throw planningIssue('章节分工未覆盖具体任务或引用了未知要求。', [{ path: ['sections'], code: 'REQUIREMENT_COVERAGE', expected: coverage.required, refs: coverage.missing, unknown:coverage.unknown }]);
  }
  return plan;
}

export function sourceLabel(pages, references) {
  if (!references?.length) return '';
  if (!pages?.some(page => page.sourceId)) return `原文 p.${references.join(' / ')}`;
  const groups = new Map();
  for (const reference of references) {
    const page = pages.find(page => page.number === reference);
    if (!page?.sourceId) continue;
    const group = groups.get(page.sourceId) || { title: page.sourceTitle, pages: [] };
    if (!group.pages.includes(page.sourcePage)) group.pages.push(page.sourcePage);
    groups.set(page.sourceId, group);
  }
  return [...groups.values()].map(group => `${group.title} p.${group.pages.join(' / ')}`).join('；');
}

export function applyBundlePlan(document, result) {
  const input = bundlePlanRequest(document), plan = validateBundlePlan(input, result);
  // A metadata-only plan cannot prove an omitted source is irrelevant. Keep
  // those pages on one chapter's reading queue for full-text reconsideration;
  // this assignment creates no teaching or prose obligation.
  const readingOnly=plan.sections.map(()=>[]);
  for(const id of plan.sourceSelection?.omissions.flatMap(item=>item.unitIds)||[]){
    const unit=input.units.find(unit=>unit.id===id);
    const owner=plan.sections.findIndex(section=>section.unitIds.some(selected=>input.units.find(u=>u.id===selected).sourceId===unit.sourceId));
    readingOnly[Math.max(0,owner)].push(id);
  }
  const chapters = plan.sections.map((section, index) => ({ id: `note-section-${index + 1}`, title: section.title, subtitle: section.purpose,
    sourcePages: [...new Set([...section.unitIds,...readingOnly[index]].flatMap(id => input.units.find(unit => unit.id === id).pages))], status: 'empty', content: { type: 'doc', content: [] } }));
  return { ...document, chapters, composition: { version: 1, planned: true, ...(plan.analysis ? { plan } : {}) }, currentChapter: chapters[0].id, currentPage: chapters[0].sourcePages[0], revision: document.revision + 1, updatedAt: Date.now() };
}
