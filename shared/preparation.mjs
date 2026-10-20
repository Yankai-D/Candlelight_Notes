import { applyResult } from './document.mjs';
import { defaultSettings, defaultKnowledge, learnerProfile, learningSettingsSchema } from './learning.mjs';
import { preparationInterruption } from './note-recovery.mjs';
import { startWorkflow, workflowRequest, acceptWorkflowReport } from './workflow-review.mjs';

export function remainingChapters(document) {
  const completed = new Set(document.preparation?.completedIds || []);
  return document.chapters.filter(c => !completed.has(c.id) && c.status !== 'ready');
}

// Each chapter is committed independently. A later failure never rolls back
// completed work, and a resumed run never regenerates a completed chapter.
export async function prepareDocument({ document, settings = defaultSettings, knowledge, sourceContext, getLatest, save, request, selectTemplate, signal, reviewPolicy, onProgress = progress => {} }) {
  if (document.preparation?.status === 'complete') return document;
  let selected = learningSettingsSchema.parse(document.preparation?.settings || settings);
  let current = document;
  const sameNotebook = value => value.id === document.id && value.activeNotebookId === document.activeNotebookId;
  const completed = new Set([...(current.preparation?.completedIds || []), ...current.chapters.filter(c => c.status === 'ready').map(c => c.id)]);
  const preparation = { startedAt: Date.now(), ...current.preparation, settings: selected,
    sourceContext: current.preparation?.sourceContext || (!current.preparation ? sourceContext : undefined),
    knowledge: selected.mode === 'adaptive' ? learnerProfile(current.preparation?.knowledge || knowledge || defaultKnowledge) : undefined,
    completedIds: [...completed], errors: { ...current.preparation?.errors }, status: 'running' };
  delete preparation.interruption;
  if (reviewPolicy || preparation.workflow) preparation.workflow = startWorkflow(preparation.workflow, current.chapters.length, reviewPolicy);
  const shouldSelect = selected.mode === 'adaptive' && !selected.writingTemplate && typeof selectTemplate === 'function'
    && (current.preparation?.templateRouting === 'pending' || (!current.preparation && completed.size === 0));
  if (shouldSelect) preparation.templateRouting = 'pending';
  current = { ...current, preparation };
  await save(current);
  if (shouldSelect) {
    const before = getLatest?.() || current;
    try {
      signal?.throwIfAborted();
      const writingTemplate = await selectTemplate(before, signal);
      signal?.throwIfAborted();
      const latest = getLatest?.() || current;
      if (!sameNotebook(latest)) return current;
      if (latest.revision !== before.revision || latest.intent !== before.intent) throw new Error('选择模板期间笔记或学习目标发生编辑，请重新继续。');
      selected = learningSettingsSchema.parse({ ...selected, writingTemplate });
      preparation.settings = selected; preparation.templateRouting = 'selected'; delete preparation.errors.__template;
      current = { ...latest, preparation: { ...preparation, errors: { ...preparation.errors } } };
      // Freeze the selected definition and sample before the first chapter.
      await save(current);
    } catch (error) {
      const latest = getLatest?.() || current;
      if (!sameNotebook(latest)) return current;
      if (!signal?.aborted && error.name !== 'AbortError') preparation.errors.__template = `模板选择：${error.message}`.slice(0, 2000);
      current = { ...latest, preparation: { ...preparation, status: signal?.aborted || error.name === 'AbortError' ? 'paused' : 'partial', errors: { ...preparation.errors } } };
      await save(current); return current;
    }
  }
  const queue = remainingChapters(current);
  let consecutiveFailures = 0;
  for (const chapter of queue) {
    if (signal?.aborted) break;
    onProgress({ chapter, done: completed.size, total: current.chapters.length });
    const before = getLatest?.() || current;
    if (!sameNotebook(before)) return current;
    const audit = preparation.workflow ? workflowRequest(preparation.workflow, chapter.id, current.chapters.length, completed.size) : undefined;
    try {
      const reply = await request(before, chapter.id, selected, preparation.knowledge, signal, audit);
      const result = audit ? reply.result : reply;
      if (signal?.aborted) break;
      const latest = getLatest?.() || current;
      if (!sameNotebook(latest)) return current;
      if (latest.id !== before.id || latest.revision !== before.revision) {
        current = latest.id === current.id ? latest : current;
        preparation.errors[chapter.id] = '生成期间笔记发生编辑，已暂停以保留你的修改。';
        break;
      }
      if (audit) preparation.workflow = acceptWorkflowReport(preparation.workflow, audit, reply.workflow, 'accepted');
      current = applyResult(latest, { action: 'generate', chapterId: chapter.id, revision: before.revision }, result);
      completed.add(chapter.id);
      consecutiveFailures = 0;
      delete preparation.errors[chapter.id];
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') break;
      if (audit && error.workflow) {
        try { preparation.workflow = acceptWorkflowReport(preparation.workflow, audit, error.workflow, 'blocked'); }
        catch (invalidReport) { error = invalidReport; }
      }
      preparation.errors[chapter.id] = String(error.message || '生成失败').slice(0, 2000);
      // Keep user edits made while an unsuccessful request was in flight.
      const latest = getLatest?.();
      if (latest && !sameNotebook(latest)) return current;
      if (latest) current = latest;
      preparation.interruption = preparationInterruption(error, ++consecutiveFailures, chapter.id);
    }
    current = { ...current, preparation: { ...preparation, completedIds: [...completed], errors: { ...preparation.errors } } };
    await save(current);
    if (preparation.interruption) break;
  }
  const latest = getLatest?.();
  if (latest && !sameNotebook(latest)) return current;
  if (latest) current = latest;
  const complete = completed.size === current.chapters.length;
  current = { ...current, preparation: { ...preparation, completedIds: [...completed], errors: { ...preparation.errors },
    status: complete ? 'complete' : signal?.aborted ? 'paused' : 'partial', ...(complete ? { completedAt: Date.now() } : {}) } };
  await save(current);
  return current;
}
