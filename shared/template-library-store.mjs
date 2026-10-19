import { TEMPLATE_LIBRARY_KEY, templateLibrarySchema, freshTemplateLibrary } from './writing-templates.mjs';

export async function readTemplateLibrary(db) {
  const value = await db.get('preferences', TEMPLATE_LIBRARY_KEY);
  return value ? templateLibrarySchema.parse(value) : freshTemplateLibrary(await db.get('preferences', 'course-style-v1'));
}
export async function commitTemplateLibrary(db, value, expectedRevision) {
  const next = templateLibrarySchema.parse(value);
  if (next.revision !== expectedRevision + 1) throw new Error('模板版本不连续，请重新打开设置。');
  const tx = db.transaction('preferences', 'readwrite');
  try {
    const saved = await tx.store.get(TEMPLATE_LIBRARY_KEY);
    const current = saved ? templateLibrarySchema.parse(saved) : freshTemplateLibrary(await tx.store.get('course-style-v1'));
    if (current.revision !== expectedRevision) throw new Error('模板已在其他窗口更新，请重新打开设置后重试。');
    await tx.store.put(next, TEMPLATE_LIBRARY_KEY); await tx.done; return next;
  } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
}
