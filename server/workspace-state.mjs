import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './atomic-file.mjs';

export async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw error; }
}
export const atomicJSON = (path, value, options) => atomicWrite(path, JSON.stringify(value) + '\n', options);
// A durable journal makes the two lightweight files one recoverable state change.
// It never contains credentials or instructions to delete material files.
export async function recoverWorkspaceState(profile) {
  const path = join(profile, 'workspace-pending.json'), pending = await readJSON(path, null);
  if (!pending) return;
  if (pending.version !== 1 || !pending.index || !pending.preferences) throw new Error('资料库状态恢复记录异常，原文件已保留。');
  if (pending.previous) await atomicJSON(join(profile, 'workspace-previous.json'), pending.previous);
  await atomicJSON(join(profile, 'preferences.json'), pending.preferences);
  await atomicJSON(join(profile, 'library-index.json'), pending.index);
  await unlink(path);
}
export async function commitWorkspaceState(store, index, preferences, keepPrevious = false) {
  const previous = keepPrevious ? { index: store.index, preferences: await readJSON(join(store.profile, 'preferences.json'), {}), savedAt: Date.now() } : undefined;
  await atomicJSON(join(store.profile, 'workspace-pending.json'), { version: 1, index, preferences, previous });
  try { await recoverWorkspaceState(store.profile); store.index = index; }
  catch (error) { store.initialized = false; throw error; }
}
