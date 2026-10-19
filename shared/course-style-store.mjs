import { COURSE_STYLE_KEY, courseStylePreferences } from './course-style.mjs';

// Compare and write in one IDB transaction, including across browser tabs. A
// model response for an old personal sample cannot overwrite a newer choice.
export async function commitCourseStylePreferences(db, value, expectedRevision) {
  const next = courseStylePreferences(value);
  if (next.revision !== expectedRevision + 1) throw new Error('样稿版本不连续，请重新打开设置。');
  const tx = db.transaction('preferences', 'readwrite');
  try {
    const current = courseStylePreferences(await tx.store.get(COURSE_STYLE_KEY));
    if (current.revision !== expectedRevision) throw new Error('样稿已在其他窗口更新，请重新打开讲义风格后重试。');
    await tx.store.put(next, COURSE_STYLE_KEY);
    await tx.done;
    return next;
  } catch (error) {
    try { tx.abort(); } catch { /* Already complete or aborted. */ }
    await tx.done.catch(() => {});
    throw error;
  }
}
