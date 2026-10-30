import { mkdir, readFile, writeFile, readdir, lstat, realpath, copyFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname, relative, isAbsolute, resolve, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { storedDocumentSchema } from '../shared/backup.mjs';
import { knowledgeSchema } from '../shared/learning.mjs';
import { collectionSchema } from '../shared/collection.mjs';
import { templateLibrarySchema } from '../shared/writing-templates.mjs';
import { atomicJSON, readJSON, commitWorkspaceState } from './workspace-state.mjs';
import { materialFormat, richMaterial } from '../shared/material-formats.mjs';

const manifestName = 'candlelight-workspace.json';
const preferenceKeys = ['knowledge', 'learner-setup-v1', 'writing-templates-v1', 'course-style-v1', 'collection', 'active-document', 'font-size', 'removed-library-papers', 'ideal-source-links', 'visual-theme'];
const safePath = value => /^(notes\/\d{1,5}\/(note\.candlelight\.json|source\.(pdf|txt|md|html|docx|pptx|json))|system\/ideal-trees\/[a-f0-9-]{36}\.json|system\/ideal-trees\/assets\/S[a-f0-9]{22}\.(pdf|txt)|system\/generation-records\/[a-zA-Z0-9_-]{1,100}\/[a-f0-9-]{36}\.json|system\/source-knowledge\/[a-f0-9]{64}\.json)$/.test(value);
const fileSchema = z.object({ path: z.string().refine(safePath), bytes: z.number().int().nonnegative().max(128 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const entrySchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), title: z.string().max(400), filename: z.string(), kind: z.enum(['pdf', 'text']), createdAt: z.number(), entryType: z.literal('note').optional(), note: z.string().refine(safePath).optional(), source: z.string().refine(safePath).optional(), sourceType: z.string(), retired: z.object({ mode: z.enum(['record','trash']), time: z.number(), placement: z.unknown().optional() }).optional() }).strict();
const manifestSchema = z.object({ format: z.literal('candlelight-workspace-v1'), createdAt: z.number(), credentialsIncluded: z.literal(false), preferences: z.record(z.string(), z.unknown()), entries: z.array(entrySchema).max(2000), files: z.array(fileSchema).max(10000), warnings: z.array(z.string()).max(4000) }).strict();
const inside = (root, path) => { const rel = relative(root, path); return !rel || !rel.startsWith('..') && !isAbsolute(rel); };
async function hashFile(path) { const hash = createHash('sha256'); for await (const bytes of createReadStream(path)) hash.update(bytes); return hash.digest('hex'); }
async function regular(path) { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new Error('备份路径包含链接或非普通文件。'); return info; }
function preferences(value) {
  const result = Object.fromEntries(preferenceKeys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  if (result.knowledge) result.knowledge = knowledgeSchema.parse(result.knowledge);
  if (result.collection) result.collection = collectionSchema.parse(result.collection);
  if (result['writing-templates-v1']) result['writing-templates-v1'] = templateLibrarySchema.parse(result['writing-templates-v1']);
  if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024 * 1024) throw new Error('偏好数据过大，备份已停止。');
  return result;
}
async function walkSystem(directory, prefix, add) {
  const info = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) return;
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== resolve(directory)) throw new Error('学习树或生成记录目录已被重定向。');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('资料系统目录包含链接，未创建不完整备份。');
    const name = `${prefix}/${entry.name}`, path = join(directory, entry.name);
    if (entry.isDirectory() && ((prefix === 'system/ideal-trees' && entry.name === 'assets') || (prefix === 'system/generation-records' && /^[a-zA-Z0-9_-]{1,100}$/.test(entry.name)))) await walkSystem(path, name, add);
    else if (entry.isFile() && safePath(name)) await add(path, name);
    else throw new Error(`资料系统目录存在未识别文件，备份已停止：${entry.name}`);
  }
}
export async function createWorkspaceBackup(store, directory) {
  const parent = await store.checkDirectory(directory), target = join(parent, `烛光笔记备份-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
  await mkdir(target);
  await writeFile(join(target, '.candlelight-incomplete'), 'backup', { flag: 'wx' });
  const manifest = { format: 'candlelight-workspace-v1', createdAt: Date.now(), credentialsIncluded: false, preferences: preferences(await readJSON(join(store.profile, 'preferences.json'), {})), entries: [], files: [], warnings: [] };
  let total = 0;
  async function add(source, name) {
    if (!safePath(name)) throw new Error('备份文件名不符合规范。');
    const info = await regular(source); total += info.size;
    if (info.size > 128 * 1024 * 1024 || total > 4 * 1024 ** 3 || manifest.files.length >= 10000) throw new Error('备份超过当前单文件 128 MB／总量 4 GB／10000 文件限制。');
    const hash = await hashFile(source), destination = join(target, name); await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination, 1);
    if (await hashFile(destination) !== hash || await hashFile(source) !== hash) throw new Error('备份期间文件发生变化，未完成备份，请重试。');
    manifest.files.push({ path: name, bytes: info.size, sha256: hash }); return name;
  }
  const inputs = [...store.index.entries.map(entry => ({ entry })), ...(store.index.retired || [])];
  for (const [position, item] of inputs.entries()) {
    const entry = item.entry, prefix = `notes/${position}`, output = { id: entry.id, title: entry.title, filename: entry.filename, kind: entry.kind, createdAt: entry.createdAt, entryType: entry.entryType, sourceType: entry.sourceType,
      ...(item.mode ? { retired: { mode: item.mode, time: item.time, placement: item.placement } } : {}) };
    if (await store.owned(entry, entry.notePath, true)) {
      await store.withNoteWrite(entry, async () => { storedDocumentSchema.parse(await readJSON(entry.notePath)); output.note = await add(entry.notePath, `${prefix}/note.candlelight.json`); });
    } else manifest.warnings.push(`${entry.title}：笔记文件缺失，仅保留记录`);
    const builtin = entry.builtinId ? await store.builtin(entry.id) : null, source = entry.sourcePath || builtin?.path;
    if (source) {
      const available = entry.sourcePath ? await store.owned(entry, source, true) : await lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (available) output.source = await add(source, `${prefix}/${entry.sourcePath ? basename(source) : 'source.pdf'}`);
      else manifest.warnings.push(`${entry.title}：原文缺失，已有笔记仍保留`);
    }
    manifest.entries.push(output);
  }
  for (const name of ['ideal-trees', 'generation-records', 'source-knowledge']) await walkSystem(join(store.index.systemDirectory, name), `system/${name}`, add);
  await atomicJSON(join(target, manifestName), manifestSchema.parse(manifest));
  await unlink(join(target, '.candlelight-incomplete'));
  return { directory: target, documents: store.index.entries.length, files: manifest.files.length, bytes: total, warnings: manifest.warnings, credentialsIncluded: false };
}
export async function inspectWorkspaceBackup(store, directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('请选择备份文件夹。');
  const root = await realpath(directory), path = join(root, manifestName);
  if ((await regular(path)).size > 16 * 1024 * 1024) throw new Error('备份清单过大。');
  const bytes = await readFile(path), manifest = manifestSchema.parse(JSON.parse(bytes));
  manifest.preferences = preferences(manifest.preferences);
  const names = new Set(), ids = new Set(), usedNotes = new Set(); let total = 0;
  for (const file of manifest.files) {
    if (names.has(file.path)) throw new Error('备份中存在重复文件。'); names.add(file.path); total += file.bytes;
    if (total > 4 * 1024 ** 3) throw new Error('备份总量超过 4 GB。');
    const source = join(root, file.path); if (!inside(root, source)) throw new Error('备份路径越界。');
    if ((await regular(source)).size !== file.bytes || await hashFile(source) !== file.sha256) throw new Error('备份文件缺失或校验失败，当前资料库未更改。');
  }
  for (const entry of manifest.entries) {
    if (entry.note && !/^notes\/\d+\/note\.candlelight\.json$/.test(entry.note) || entry.source && !/^notes\/\d+\/source\.(pdf|txt|md|html|docx|pptx|json)$/.test(entry.source) || entry.note && entry.source && dirname(entry.note) !== dirname(entry.source)) throw new Error('备份资料配套关系异常。');
    if (!entry.retired) { if (ids.has(entry.id)) throw new Error('备份中存在重复资料编号。'); ids.add(entry.id); }
    for (const name of [entry.note, entry.source].filter(Boolean)) { if (!names.has(name) || usedNotes.has(name)) throw new Error('备份缺少资料文件或存在重复关联。'); usedNotes.add(name); }
    if (entry.note) { const document = storedDocumentSchema.parse(await readJSON(join(root, entry.note))); if (document.id !== entry.id) throw new Error('备份笔记编号不一致。'); }
  }
  if (manifest.files.some(file => file.path.startsWith('notes/') && !usedNotes.has(file.path))) throw new Error('备份存在未关联的资料文件。');
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  return { root, manifest, fingerprint, summary: { createdAt: manifest.createdAt, documents: ids.size, retired: manifest.entries.filter(e => e.retired).length, trees: manifest.files.filter(f => /^system\/ideal-trees\/[^/]+\.json$/.test(f.path)).length, files: names.size, bytes: total, warnings: manifest.warnings, hasProfile: !!manifest.preferences.knowledge, hasTemplates: !!manifest.preferences['writing-templates-v1'] } };
}
export async function restoreWorkspaceBackup(store, preview, directory) {
  // Revalidate every file at confirmation time, never trust a path from a manifest.
  const checked = await inspectWorkspaceBackup(store, preview.root);
  if (checked.fingerprint !== preview.fingerprint) throw new Error('备份清单在预览后已变化，请重新检查。');
  const parent = await store.checkDirectory(directory), target = join(parent, `恢复的学习空间-${randomUUID().slice(0,8)}`); await mkdir(target);
  await writeFile(join(target, '.candlelight-incomplete'), 'restore', { flag: 'wx' });
  const { manifest } = checked, entries = [], retired = [], systemDirectory = join(target, '.candlelight');
  for (const file of manifest.files) {
    const name = file.path.startsWith('system/') ? `.candlelight/${file.path.slice(7)}` : file.path;
    const destination = join(target, name); await mkdir(dirname(destination), { recursive: true }); await copyFile(join(checked.root, file.path), destination, 1);
    if (await hashFile(destination) !== file.sha256) throw new Error('恢复时文件校验失败，原资料库未更改。');
  }
  for (const [position, item] of manifest.entries.entries()) {
    const folder = join(target, item.note ? dirname(item.note) : item.source ? dirname(item.source) : `notes/missing-${position}`);
    const entry = { id: item.id, title: item.title, filename: item.filename, kind: item.kind, createdAt: item.createdAt, entryType: item.entryType,
      directory: folder, notePath: join(folder, 'note.candlelight.json'), sourcePath: item.source ? join(target, item.source) : (item.kind === 'pdf' || richMaterial(item.filename)) && item.entryType !== 'note' ? join(folder, 'source.' + (item.kind === 'pdf' ? 'pdf' : materialFormat(item.filename).extension)) : null, sourceType: item.sourceType };
    if (item.retired) retired.push({ id: randomUUID(), entry, ...item.retired, hash: item.note ? manifest.files.find(file => file.path === item.note).sha256 : undefined }); else entries.push(entry);
  }
  await mkdir(systemDirectory, { recursive: true });
  // A restored space is discoverable when explicitly selected, not as a child
  // of an older space after undo. Incomplete copies are never discovered.
  await writeFile(join(target, '.candlelight-space'), 'candlelight-workspace-v1', { flag: 'wx' });
  const index = { version: 1, directory: target, systemDirectory, entries, retired, migrationComplete: true, isolatedWorkspace: true, scanDirectories: [], ignoredNotes: retired.map(item => item.entry.notePath) };
  await unlink(join(target, '.candlelight-incomplete'));
  await commitWorkspaceState(store, index, manifest.preferences, true);
  store.discovered = true; store.fileSnapshots.clear(); store.scans.clear(); store.removedIds = new Set(retired.map(item => item.entry.id));
  return { directory: target, documents: entries.length, previousWorkspaceAvailable: true };
}
export async function undoWorkspaceRestore(store) {
  const previous = await readJSON(join(store.profile, 'workspace-previous.json'), null);
  if (!previous?.index || !previous.preferences) throw new Error('没有可返回的学习空间。');
  await commitWorkspaceState(store, previous.index, previous.preferences, true);
  store.discovered = true; store.fileSnapshots.clear(); store.scans.clear(); store.removedIds = new Set();
  return { directory: store.index.directory };
}
