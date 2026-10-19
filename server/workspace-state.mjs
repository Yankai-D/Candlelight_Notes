import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw error; }
}
export async function atomicJSON(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
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
