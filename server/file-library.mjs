import { mkdir, readFile, writeFile, rename, unlink, lstat, realpath, access, readdir, cp, rmdir, open } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { storedDocumentSchema } from '../shared/backup.mjs';
import { readLearnerSetup, commitLearnerSetup, resetLearnerSetup } from '../shared/learner-setup.mjs';
import { readTemplateLibrary, commitTemplateLibrary } from '../shared/template-library-store.mjs';
import { commitCourseStylePreferences } from '../shared/course-style-store.mjs';
import { scanNoteFiles, fileHash } from './file-discovery.mjs';
import { atomicJSON, recoverWorkspaceState, commitWorkspaceState } from './workspace-state.mjs';
import { createWorkspaceBackup, inspectWorkspaceBackup, restoreWorkspaceBackup, undoWorkspaceRestore } from './workspace-backup.mjs';
import { readGenerationRecords, generationRecordFiles } from './generation-records.mjs';
import { previewWorkspaceMove, moveWorkspace, recoverWorkspaceMove } from './workspace-move.mjs';
export { atomicJSON } from './workspace-state.mjs';

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const keySchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const inside = (parent, child) => { const part = relative(parent, child); return !part || !part.startsWith('..') && !isAbsolute(part); };
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function json(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw error; } }
export function defaultLibraryDirectory() {
  if (process.env.READING_TREE_DOCUMENTS_DIR) return join(process.env.READING_TREE_DOCUMENTS_DIR, '烛光笔记');
  if (process.platform === 'win32') {
    const folder = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); [Environment]::GetFolderPath("MyDocuments")'], { encoding: 'utf8', windowsHide: true }).trim();
    if (folder) return join(folder, '烛光笔记');
  }
  return join(homedir(), 'Documents', '烛光笔记');
}
const entrySchema = z.object({ id: idSchema, title: z.string().max(400), filename: z.string(), kind: z.enum(['pdf', 'text']), entryType: z.literal('note').optional(), createdAt: z.number(),
  directory: z.string(), notePath: z.string(), sourcePath: z.string().nullable(), sourceType: z.string(), builtinId: z.string().optional(),
  migrationDigest: z.string().optional() });
const indexSchema = z.object({ version: z.literal(1), directory: z.string(), systemDirectory: z.string(), entries: z.array(entrySchema), migrationComplete: z.boolean().optional(), isolatedWorkspace: z.boolean().optional(), scanDirectories: z.array(z.string()).optional(), ignoredNotes: z.array(z.string()).optional(), retired: z.array(z.object({ id: z.string(), entry: entrySchema, mode: z.enum(['record', 'trash']), time: z.number(), hash: z.string().optional(), placement: z.unknown().optional() })).optional() });

// One serialized writer covers index, files and preference CAS operations. No
// renderer-provided path is ever used as a document filename or deletion target.
export class FileLibrary {
  constructor({ profile, defaultDirectory, programDirectory, builtinDirectory, legacyIdealDirectory } = {}) {
    this.profile = resolve(profile || '.local-storage'); this.defaultDirectory = defaultDirectory;
    this.programDirectory = programDirectory && resolve(programDirectory); this.builtinDirectory = builtinDirectory && resolve(builtinDirectory);
    this.legacyIdealDirectory = legacyIdealDirectory && resolve(legacyIdealDirectory);
    this.pending = Promise.resolve(); this.indexPath = join(this.profile, 'library-index.json'); this.removedIds = new Set();
    this.scans = new Map(); this.fileSnapshots = new Map();
  }
  run(operation) { const next = this.pending.then(operation); this.pending = next.catch(() => {}); return next; }
  async initialize() {
    if (this.initialized) return;
    await mkdir(this.profile, { recursive: true });
    await recoverWorkspaceState(this.profile);
    const saved = await json(this.indexPath, null);
    if (saved) this.index = indexSchema.parse(saved);
    else {
      const directory = await this.checkDirectory(this.defaultDirectory || defaultLibraryDirectory());
      this.index = { version: 1, directory, systemDirectory: join(directory, '.candlelight'), entries: [] };
      await mkdir(this.index.systemDirectory, { recursive: true }); await atomicJSON(this.indexPath, this.index);
    }
    await recoverWorkspaceMove(this);
    const preferences = await json(join(this.profile, 'preferences.json'), {});
    this.removedIds = new Set([...(this.index.retired || []).map(item => item.entry.id), ...(Array.isArray(preferences['removed-library-papers']) ? preferences['removed-library-papers'] : [])]);
    // Ideal trees include downloaded material and therefore belong alongside
    // user files, not in the lightweight application profile.
    const destination = join(this.index.systemDirectory, 'ideal-trees');
    if (this.legacyIdealDirectory && this.legacyIdealDirectory !== destination && await exists(this.legacyIdealDirectory)) {
      await this.migrateDirectory(this.legacyIdealDirectory, destination);
    }
    this.initialized = true;
  }
  async migrateDirectory(source, destination) {
    await mkdir(destination, { recursive: true });
    for (const item of await readdir(source, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('旧学习树目录包含链接，迁移已停止，原文件保留。');
      const from = join(source, item.name), to = join(destination, item.name);
      if (item.isDirectory()) { await this.migrateDirectory(from, to); await rmdir(from); }
      else {
        const bytes = await readFile(from);
        if (await exists(to)) { if (digest(await readFile(to)) !== digest(bytes)) throw new Error('学习树迁移遇到不同版本的同名文件，原文件已保留。'); }
        else await cp(from, to, { errorOnExist: true, force: false });
        if (digest(await readFile(to)) !== digest(bytes)) throw new Error('学习树文件校验失败，原文件已保留。');
        await unlink(from);
      }
    }
  }
  async checkDirectory(value) {
    if (typeof value !== 'string' || !value.trim() || !isAbsolute(value.trim()) || /[\0\r\n]/.test(value)) throw new Error('请选择有效的绝对文件夹路径。');
    const path = resolve(value.trim());
    // Check both lexical and resolved paths; a junction cannot bypass this.
    for (const forbidden of [this.profile, this.programDirectory, this.builtinDirectory].filter(Boolean)) {
      if (inside(forbidden, path)) throw new Error('资料目录不能位于程序、内置资料或应用配置目录中，请选择独立文件夹。');
    }
    await mkdir(path, { recursive: true });
    const canonical = await realpath(path);
    for (const forbidden of [this.profile, this.programDirectory, this.builtinDirectory].filter(Boolean)) {
      const actual = await realpath(forbidden).catch(() => forbidden);
      if (inside(actual, canonical)) throw new Error('资料目录不能位于程序、内置资料或应用配置目录中。');
    }
    const probe = join(canonical, `.candlelight-write-${randomUUID()}`);
    try { await writeFile(probe, '', { flag: 'wx' }); } catch { throw new Error('所选资料目录无法写入，请更换位置。'); }
    finally { await unlink(probe).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return canonical;
  }
  async persist(index) { await atomicJSON(this.indexPath, index); this.index = index; }
  async withNoteWrite(entry, operation) {
    await this.owned(entry, entry.notePath, true);
    const path = join(entry.directory, '.candlelight-write.lock');
    const locked = () => new Error('另一个应用正在保存这份笔记，请稍后重试。');
    let handle;
    try { handle = await open(path, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) throw locked();
      const bytes = await readFile(path), owner = JSON.parse(bytes.toString('utf8') || '{}');
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw locked();
      try { process.kill(owner.pid, 0); throw locked(); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (!bytes.equals(await readFile(path))) throw locked();
      await unlink(path); handle = await open(path, 'wx');
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() })); return await operation(); }
    finally { await handle.close(); await unlink(path); }
  }
  async discover(directory) {
    const scan = await scanNoteFiles(directory, [this.profile, this.programDirectory, this.builtinDirectory]);
    const counts = new Map(); for (const note of scan.notes) counts.set(note.document.id, (counts.get(note.document.id) || 0) + 1);
    const candidates = [];
    for (const note of scan.notes) {
      const document = note.document, existing = this.index.entries.find(entry => entry.id === document.id);
      const builtin = !note.sourcePath ? await this.builtin(document.id) : null;
      const missingSource = !note.sourcePath && !builtin && document.kind === 'pdf' && document.entryType !== 'note';
      const entry = { id: document.id, title: document.title, filename: document.filename, kind: document.kind, createdAt: document.createdAt,
        ...(document.entryType ? { entryType: document.entryType } : {}), directory: note.directory, notePath: note.notePath,
        sourcePath: note.sourcePath || (missingSource ? join(note.directory, 'source.pdf') : null), sourceType: note.sourcePath?.endsWith('.pdf') || missingSource ? 'application/pdf' : 'text/plain',
        ...(builtin ? { builtinId: builtin.id } : {}) };
      const status = existing?.notePath === note.notePath ? 'known' : counts.get(document.id) > 1 ? 'conflict' : existing ? await exists(existing.notePath) ? 'conflict' : 'moved' : 'new';
      candidates.push({ key: randomUUID(), entry, hash: note.hash, status, missingSource, ignored: (this.index.ignoredNotes || []).includes(note.notePath) });
    }
    return { ...scan, notes: undefined, candidates };
  }
  async attach(scan, selected, remember = false) {
    const entries = [...this.index.entries], added = [], selectedPaths = new Set();
    for (const candidate of selected) {
      if (!['new', 'moved'].includes(candidate.status)) throw new Error('所选笔记已存在或有编号冲突，请重新扫描。');
      const entry = candidate.entry, current = entries.find(item => item.id === entry.id);
      if (current && (candidate.status !== 'moved' || await exists(current.notePath))) throw new Error('资料库已发生变化，请重新扫描。');
      await this.owned(entry, entry.notePath);
      if (fileHash(await readFile(entry.notePath)) !== candidate.hash) throw new Error('扫描后的笔记发生了变化，请重新扫描；原文件未修改。');
      // A missing PDF is retained as a missing source, never inferred from an
      // arbitrary path embedded in the note or copied out of another profile.
      if (entry.sourcePath) await this.owned(entry, entry.sourcePath, true);
      const at = entries.findIndex(item => item.id === entry.id); if (at < 0) entries.push(entry); else entries[at] = entry;
      added.push(entry.id); selectedPaths.add(entry.notePath);
    }
    const scanDirectories = [...new Set([...(this.index.scanDirectories || []), ...(remember ? [scan.directory] : [])])];
    if (scanDirectories.length > 32) throw new Error('最多记住 32 个识别目录。');
    await this.persist({ ...this.index, entries, scanDirectories, ignoredNotes: (this.index.ignoredNotes || []).filter(path => !selectedPaths.has(path)) });
    for (const candidate of selected) { this.removedIds.delete(candidate.entry.id); this.fileSnapshots.set(candidate.entry.id, candidate.hash); }
    return { ids: added, count: added.length };
  }
  async autoDiscover() {
    if (this.discovered) return;
    this.discovered = true;
    const roots = [...new Set([...(this.index.isolatedWorkspace ? [] : [this.defaultDirectory || defaultLibraryDirectory()]), this.index.directory, ...(this.index.scanDirectories || [])])];
    this.discoveryIssues = [];
    for (const directory of roots) {
      try { const scan = await this.discover(directory); await this.attach(scan, scan.candidates.filter(item => item.status === 'new' && !item.ignored)); }
      catch (error) { this.discoveryIssues.push({ path: directory, reason: error.message }); }
    }
  }
  async builtin(id) {
    if (!this.builtinDirectory || !id) return null;
    const catalog = await json(join(this.builtinDirectory, 'catalog.json'), { documents: [] });
    const found = catalog.documents.find(document => document.id === id);
    if (!found?.library?.id || !/^[a-z0-9-]+$/.test(found.library.id)) return null;
    return { id: found.library.id, path: join(this.builtinDirectory, found.library.id + '.pdf') };
  }
  async owned(entry, path, allowMissing = false) {
    if (dirname(path) !== entry.directory || !['note.candlelight.json', 'source.pdf', 'source.txt', 'source.md', 'source.json'].includes(basename(path))) throw new Error('资料路径校验失败，未操作文件。');
    const folder = await lstat(entry.directory).catch(error => { if (allowMissing && error.code === 'ENOENT') return null; throw error; });
    if (!folder) return false;
    if (!folder.isDirectory() || folder.isSymbolicLink() || await realpath(entry.directory) !== entry.directory) throw new Error('资料目录已被替换或重定向，未操作文件。');
    const file = await lstat(path).catch(error => { if (allowMissing && error.code === 'ENOENT') return null; throw error; });
    if (!file) return false;
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('资料文件已被替换为链接，未操作文件。');
    return true;
  }
  async inspect(entry) {
    const missing = [];
    if (!await this.owned(entry, entry.notePath, true)) missing.push(entry.notePath);
    if (entry.sourcePath && !await this.owned(entry, entry.sourcePath, true)) missing.push(entry.sourcePath);
    const builtin = entry.builtinId ? await this.builtin(entry.id) : null;
    if (entry.builtinId && (!builtin || !await exists(builtin.path))) missing.push(builtin?.path || '内置原文');
    return { id: entry.id, missing, notePath: entry.notePath, sourcePath: entry.sourcePath || builtin?.path || null };
  }
  async localizeSources() {
    const entries = [];
    this.sourceIssues = [];
    const originals = [...this.index.entries, ...(this.index.retired || []).map(item => item.entry)];
    for (const original of originals) {
      let entry = original;
      if (entry.kind === 'pdf' && entry.entryType !== 'note' && (!entry.sourcePath || entry.builtinId || entry.sourcePath.endsWith('.json'))) {
        try {
          const sourcePath = join(entry.directory, 'source.pdf');
          if (!await this.owned(entry, entry.notePath, true)) { entries.push(entry); continue; }
          if (!entry.sourcePath && !entry.builtinId && (await json(entry.notePath)).demo) { entries.push(entry); continue; }
          let present = await this.owned(entry, sourcePath, true);
          if (!present && entry.builtinId) {
            const builtin = await this.builtin(entry.id);
            if (builtin && await exists(builtin.path)) {
              const bytes = await this.builtinBytes(builtin);
              await this.withNoteWrite(entry, async () => {
                try { await writeFile(sourcePath, bytes, { flag: 'wx' }); }
                catch (error) { if (error.code !== 'EEXIST') throw error; }
                await this.owned(entry, sourcePath);
                if (digest(await readFile(sourcePath)) !== digest(bytes)) throw new Error('配套原文已有不同内容，未覆盖。');
              });
              present = true;
            }
          }
          const { builtinId: _builtin, ...local } = entry;
          entry = { ...local, sourcePath, sourceType: 'application/pdf', ...(!present && original.builtinId ? { builtinId: original.builtinId } : {}) };
        } catch (error) { this.sourceIssues.push({ id: entry.id, reason: error.message }); }
      }
      entries.push(entry);
    }
    if (JSON.stringify(entries) !== JSON.stringify(originals)) await this.persist({ ...this.index, entries: entries.slice(0,this.index.entries.length),
      retired:(this.index.retired || []).map((item,index)=>({...item,entry:entries[this.index.entries.length+index]})) });
  }
  async builtinBytes(builtin) {
    const info = await lstat(builtin.path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 50 * 1024 * 1024) throw new Error('旧资料原文无法安全读取，请重新选择原文。');
    const bytes = await readFile(builtin.path);
    if (bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('旧资料原文不是有效的 PDF。');
    return bytes;
  }
  async readEntry(entry) {
    const status = await this.inspect(entry);
    let document;
    if (!status.missing.includes(entry.notePath)) {
      try { const bytes = await readFile(entry.notePath); document = storedDocumentSchema.parse(JSON.parse(bytes.toString('utf8'))); if (document.id !== entry.id) throw new Error('文件编号不匹配'); this.fileSnapshots.set(entry.id, fileHash(bytes)); }
      catch { status.missing.push(entry.notePath); status.error = '笔记文件无法读取，文件可能已损坏。'; }
    }
    if (!document) document = { id: entry.id, title: entry.title, subtitle: '文件暂不可用', kind: entry.kind, filename: entry.filename, entryType: entry.entryType,
      createdAt: entry.createdAt, updatedAt: entry.createdAt, revision: 0, intent: '', pages: [], chapters: [], currentChapter: '', currentPage: 1, versions: [] };
    return { ...document, ...(status.missing.length ? { storageIssue: status } : {}) };
  }
  async importDocument(input) {
    const document = storedDocumentSchema.parse(input.document), id = idSchema.parse(document.id);
    const encoded = JSON.stringify(document), hash = digest(encoded);
    const existing = this.index.entries.find(entry => entry.id === id);
    if (existing) {
      if (input.migration && existing.migrationDigest === hash) return { id, verified: true };
      throw new Error('资料编号已存在，原笔记已保留。请重新导入文件。');
    }
    const backup = /\.json$/i.test(input.source?.name || '');
    let bytes = input.source && !backup ? Buffer.from(z.string().max(72 * 1024 * 1024).parse(input.source.data), 'base64') : null;
    if (bytes && bytes.length > 50 * 1024 * 1024) throw new Error('资料文件不能超过 50 MB。');
    const directory = await this.checkDirectory(input.directory || this.index.directory);
    const folder = join(directory, `资料-${id}`);
    const builtin = await this.builtin(id);
    if (!bytes && builtin) bytes = await this.builtinBytes(builtin);
    if (bytes && document.kind === 'pdf' && bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('原文不是有效的 PDF，未保存这份资料。');
    const extension = document.kind === 'pdf' ? 'pdf' : input.source?.name?.match(/\.(txt|md|markdown)$/i)?.[1]?.toLowerCase() || 'txt';
    const sourcePath = bytes || document.kind === 'pdf' && document.entryType !== 'note' && !document.demo ? join(folder, `source.${extension === 'markdown' ? 'md' : extension}`) : null;
    const entry = { id, title: document.title, kind: document.kind, filename: document.filename, ...(document.entryType ? { entryType: document.entryType } : {}), createdAt: document.createdAt,
      directory: folder, notePath: join(folder, 'note.candlelight.json'), sourcePath, sourceType: sourcePath?.endsWith('.pdf') ? 'application/pdf' : 'text/plain',
      ...(input.migration ? { migrationDigest: hash } : {}) };
    let created = false;
    try { await mkdir(folder); created = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Resume a crash between verified file writes and the index commit.
      // Unrelated files or different contents are never overwritten.
      const info = await lstat(folder);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(folder) !== folder) throw new Error('资料目录已被重定向，未操作文件。');
      const allowed = [basename(entry.notePath), ...(sourcePath ? [basename(sourcePath)] : [])];
      if ((await readdir(folder)).some(name => !allowed.includes(name))) throw new Error('目标资料文件夹已有其他内容，请选择另一保存位置。');
      if (await exists(entry.notePath)) { await this.owned(entry, entry.notePath); if (digest(JSON.stringify(await json(entry.notePath))) !== hash) throw new Error('目标位置已有不同笔记，原文件已保留。'); }
      if (sourcePath && bytes && await exists(sourcePath)) { await this.owned(entry, sourcePath); if (digest(await readFile(sourcePath)) !== digest(bytes)) throw new Error('目标位置已有不同原文，原文件已保留。'); }
    }
    let committed = false;
    try {
      if (sourcePath && bytes) { if (!await exists(sourcePath)) await writeFile(sourcePath, bytes, { flag: 'wx' }); if (digest(await readFile(sourcePath)) !== digest(bytes)) throw new Error('原文文件校验失败。'); }
      if (!await exists(entry.notePath)) await atomicJSON(entry.notePath, document);
      if (digest(JSON.stringify(await json(entry.notePath))) !== hash) throw new Error('笔记文件校验失败。');
      await this.persist({ ...this.index, directory: input.remember ? directory : this.index.directory, entries: [...this.index.entries, entry] }); committed = true;
      this.fileSnapshots.set(id, fileHash(await readFile(entry.notePath)));
      return { id, verified: true };
    } finally {
      if (!committed && created) { for (const path of [entry.notePath, sourcePath].filter(Boolean)) await unlink(path).catch(() => {}); await rmdir(folder).catch(() => {}); }
    }
  }
  async preferences(action) {
    const path = join(this.profile, 'preferences.json');
    const before = await json(path, {}), values = structuredClone(before);
    const store = { get: async key => values[key], put: async (value, key) => { values[key] = structuredClone(value); } };
    const db = { get: async (_store, key) => store.get(key), put: async (_store, value, key) => store.put(value, key), transaction: () => ({ store, done: Promise.resolve(), abort() {} }) };
    const result = await action(db, values);
    if (JSON.stringify(values) !== JSON.stringify(before)) await atomicJSON(path, values);
    return result;
  }
  command(command) { return this.run(async () => {
    await this.initialize();
    if (['status', 'list', 'file', 'inspect', 'workspace-backup', 'workspace-move-preview'].includes(command.action)) await this.localizeSources();
    switch (command.action) {
      case 'workspace-move-preview': {
        await this.autoDiscover(); await this.localizeSources();
        this.movePreview = await previewWorkspaceMove(this,command.directory);
        return {id:this.movePreview.id,...this.movePreview.summary};
      }
      case 'workspace-move': {
        if(command.confirm!==true||!this.movePreview||command.previewId!==this.movePreview.id)throw new Error('请先预览并确认迁移现有资料。');
        const preview=this.movePreview;this.movePreview=null;
        return moveWorkspace(this,preview);
      }
      case 'conflict-read': {
        const entry = this.index.entries.find(entry => entry.id === idSchema.parse(command.id)); if (!entry) throw new Error('资料记录已不存在。');
        await this.owned(entry, entry.notePath); return { document: storedDocumentSchema.parse(await json(entry.notePath)), path: entry.notePath };
      }
      case 'conflict-copy': {
        const document = storedDocumentSchema.parse(command.document), entry = this.index.entries.find(entry => entry.id === document.id); if (!entry) throw new Error('资料记录已不存在。');
        const builtin = entry.builtinId ? await this.builtin(entry.id) : null, sourcePath = entry.sourcePath || builtin?.path;
        let source;
        if (sourcePath && (!entry.sourcePath || await this.owned(entry, sourcePath, true))) source = { name: sourcePath, data: (await readFile(sourcePath)).toString('base64') };
        return this.importDocument({ document: { ...document, id: randomUUID(), title: document.title.slice(0,380) + ' · 本地副本', library: undefined }, source });
      }
      case 'source-restore': {
        const entry = this.index.entries.find(entry => entry.id === idSchema.parse(command.id)); if (!entry) throw new Error('资料记录已不存在。');
        await this.owned(entry, entry.notePath);
        const status = await this.inspect(entry); if (!status.missing.length) throw new Error('原文已存在，不会覆盖。');
        const bytes = Buffer.from(z.string().max(72 * 1024 * 1024).parse(command.source?.data), 'base64');
        if (!bytes.length || bytes.length > 50 * 1024 * 1024 || entry.kind === 'pdf' && bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('请选择有效的原文文件，PDF 最大 50 MB。');
        const sourcePath = join(entry.directory, entry.kind === 'pdf' ? 'source.pdf' : 'source.txt'); await this.owned(entry, sourcePath, true);
        await this.withNoteWrite(entry, async () => {
          await writeFile(sourcePath, bytes, { flag: 'wx' });
          const { builtinId: _builtin, ...next } = entry;
          try { await this.persist({ ...this.index, entries: this.index.entries.map(item => item.id === entry.id ? { ...next, sourcePath, sourceType: entry.kind === 'pdf' ? 'application/pdf' : 'text/plain' } : item) }); }
          catch (error) { await unlink(sourcePath); throw error; }
        });
        return { id: entry.id };
      }
      case 'records-list': return readGenerationRecords(this.index.systemDirectory, command.id);
      case 'record-read': return readGenerationRecords(this.index.systemDirectory, command.id, command.recordId);
      case 'workspace-backup': return createWorkspaceBackup(this, command.directory);
      case 'workspace-preview': {
        const preview = await inspectWorkspaceBackup(this, command.directory), id = randomUUID();
        this.backupPreview = { ...preview, id, time: Date.now() };
        return { id, ...preview.summary };
      }
      case 'workspace-restore': {
        if (command.confirm !== true || !this.backupPreview || this.backupPreview.id !== command.previewId || Date.now() - this.backupPreview.time > 600000) throw new Error('请重新检查备份并确认恢复。');
        const result = await restoreWorkspaceBackup(this, this.backupPreview, command.directory); this.backupPreview = null; return result;
      }
      case 'workspace-undo': if (command.confirm !== true) throw new Error('请确认返回上一个学习空间。'); return undoWorkspaceRestore(this);
      case 'retired-list': return (this.index.retired || []).map(item => ({ id: item.id, title: item.entry.title, mode: item.mode, time: item.time, path: item.entry.notePath }));
      case 'retire': {
        const entry = this.index.entries.find(e => e.id === idSchema.parse(command.id)); if (!entry) return {};
        const mode = z.enum(['record', 'trash']).parse(command.mode), preferences = await json(join(this.profile, 'preferences.json'), {});
        if ((this.index.retired || []).length >= 1000) throw new Error('移除记录已达 1000 条，请先处理回收站。');
        const retired = { id: randomUUID(), entry, mode, time: Date.now(), hash: this.fileSnapshots.get(entry.id), placement: preferences.collection?.items?.[entry.id] };
        preferences['removed-library-papers'] = [...new Set([...(preferences['removed-library-papers'] || []), entry.id])];
        if (preferences.collection?.items) delete preferences.collection.items[entry.id];
        await commitWorkspaceState(this, { ...this.index, entries: this.index.entries.filter(e => e.id !== entry.id), retired: [...(this.index.retired || []), retired], ignoredNotes: [...new Set([...(this.index.ignoredNotes || []), entry.notePath])] }, preferences);
        this.removedIds.add(entry.id); return { id: retired.id };
      }
      case 'retired-restore': {
        const item = (this.index.retired || []).find(item => item.id === command.id); if (!item) throw new Error('移除记录已不存在。');
        if (this.index.entries.some(entry => entry.id === item.entry.id)) throw new Error('资料库已有相同编号，未覆盖任何笔记。');
        const preferences = await json(join(this.profile, 'preferences.json'), {});
        preferences['removed-library-papers'] = (preferences['removed-library-papers'] || []).filter(id => id !== item.entry.id);
        if (item.placement && preferences.collection?.items) preferences.collection.items[item.entry.id] = item.placement;
        await commitWorkspaceState(this, { ...this.index, entries: [...this.index.entries, item.entry], retired: this.index.retired.filter(entry => entry.id !== item.id), ignoredNotes: (this.index.ignoredNotes || []).filter(path => path !== item.entry.notePath) }, preferences);
        this.removedIds.delete(item.entry.id); return { id: item.entry.id };
      }
      case 'retired-purge': {
        const item = (this.index.retired || []).find(item => item.id === command.id); if (!item || item.mode !== 'trash') throw new Error('只能永久删除回收站中的文件。');
        if (command.confirm !== true) throw new Error('请明确确认永久删除共享文件。');
        if (this.index.entries.some(entry => entry.id === item.entry.id)) throw new Error('资料库仍有相同编号的笔记，请先检查记录。');
        const records = await generationRecordFiles(this.index.systemDirectory, item.entry.id);
        const paths = [item.entry.notePath, item.entry.sourcePath].filter(Boolean), present = [];
        for (const path of paths) if (await this.owned(item.entry, path, true)) present.push(path);
        if (present.length) await this.withNoteWrite(item.entry, async () => {
          if (await this.owned(item.entry, item.entry.notePath, true) && (!item.hash || fileHash(await readFile(item.entry.notePath)) !== item.hash)) throw new Error('笔记在移除后已被修改，请先恢复记录并检查，未删除文件。');
          for (const path of present) await this.owned(item.entry, path);
          for (const path of present) await unlink(path);
        });
        for (const path of records) await unlink(path);
        await this.persist({ ...this.index, retired: this.index.retired.filter(entry => entry.id !== item.id) }); return {};
      }
      case 'status': return { enabled: true, discovery: true, maintenance: true, previousWorkspaceAvailable: await exists(join(this.profile, 'workspace-previous.json')), directory: this.index.directory, systemDirectory: this.index.systemDirectory, migrationComplete: !!this.index.migrationComplete, discoveryIssues: this.discoveryIssues || [], sourceIssues: this.sourceIssues || [] };
      case 'directory': { const directory = await this.checkDirectory(command.directory); await this.persist({ ...this.index, directory }); return { directory }; }
      case 'list': await this.autoDiscover(); return Promise.all(this.index.entries.map(entry => this.readEntry(entry)));
      case 'scan': {
        for (const [id, scan] of this.scans) if (Date.now() - scan.time > 600000) this.scans.delete(id);
        if (this.scans.size >= 8) this.scans.delete(this.scans.keys().next().value);
        const scan = await this.discover(command.directory), id = randomUUID(); this.scans.set(id, { ...scan, time: Date.now() });
        return { id, directory: scan.directory, issues: scan.issues, issueCount: scan.issueCount, items: scan.candidates.map(item => ({ key: item.key, id: item.entry.id, title: item.entry.title, path: item.entry.notePath, status: item.status, missingSource: item.missingSource, ignored: item.ignored })) };
      }
      case 'attach': {
        const scan = this.scans.get(command.scanId);
        if (!scan || Date.now() - scan.time > 600000) throw new Error('识别结果已过期，请重新扫描。');
        const keys = z.array(z.string()).max(1000).parse(command.keys), selected = scan.candidates.filter(item => keys.includes(item.key));
        if (new Set(keys).size !== keys.length || selected.length !== keys.length) throw new Error('请选择本次识别出的笔记。');
        const result = await this.attach(scan, selected, command.remember === true); this.scans.delete(command.scanId); return result;
      }
      case 'inspect': { const entry = this.index.entries.find(e => e.id === idSchema.parse(command.id)); if (!entry) throw new Error('资料记录已不存在。'); return this.inspect(entry); }
      case 'import': return this.importDocument(command);
      case 'save': {
        const document = storedDocumentSchema.parse(command.document), entry = this.index.entries.find(e => e.id === document.id);
        if (!entry) { if (!this.removedIds.has(document.id) && await this.builtin(document.id)) return this.importDocument({ document }); throw new Error('资料记录已不存在，请重新导入。'); }
        if (!await this.owned(entry, entry.notePath, true)) throw new Error('找不到笔记文件，未重新创建。请检查保存位置。');
        await this.withNoteWrite(entry, async () => {
          const currentBytes = await readFile(entry.notePath), expected = this.fileSnapshots.get(entry.id);
          if (!expected || fileHash(currentBytes) !== expected) throw new Error('笔记已被其他应用修改，未覆盖文件。请先导出当前修改，再重新打开应用。');
          await atomicJSON(entry.notePath, document);
          this.fileSnapshots.set(entry.id, fileHash(await readFile(entry.notePath)));
        });
        if (entry.title !== document.title) await this.persist({ ...this.index, entries: this.index.entries.map(e => e.id === entry.id ? { ...e, title: document.title } : e) });
        return { id: entry.id };
      }
      case 'remove': {
        const entry = this.index.entries.find(e => e.id === idSchema.parse(command.id)); if (!entry) return {};
        // Validate every target before deleting any file. Missing-file recovery
        // removes only the index; the surviving note remains on disk.
        if (!command.recordOnly) {
          const paths = [entry.notePath, entry.sourcePath].filter(Boolean), present = [];
          for (const path of paths) if (await this.owned(entry, path, true)) present.push(path);
          if (present.length) await this.withNoteWrite(entry, async () => {
            // Deletion participates in the same cross-application lock as save.
            // A stale window must not delete another application's newer edit.
            if (await this.owned(entry, entry.notePath, true)) {
              const expected = this.fileSnapshots.get(entry.id);
              if (!expected || fileHash(await readFile(entry.notePath)) !== expected) throw new Error('笔记已被其他应用修改，未删除文件。请重新打开应用后确认。');
            }
            for (const path of present) await this.owned(entry, path);
            for (const path of present) await unlink(path);
          });
          await rmdir(entry.directory).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
        }
        await this.persist({ ...this.index, entries: this.index.entries.filter(e => e.id !== entry.id), ignoredNotes: [...new Set([...(this.index.ignoredNotes || []), entry.notePath])] }); this.removedIds.add(entry.id); return {};
      }
      case 'file': {
        const entry = this.index.entries.find(e => e.id === idSchema.parse(command.id)); if (!entry) return null;
        const builtin = entry.builtinId ? await this.builtin(entry.id) : null;
        if (builtin) return { data: await readFile(builtin.path), type: 'application/pdf' };
        if (!entry.sourcePath) return null;
        if (!await this.owned(entry, entry.sourcePath, true)) throw new Error('找不到原文文件，请检查保存位置。');
        return { data: await readFile(entry.sourcePath), type: entry.sourceType };
      }
      case 'migrate-preferences': return this.preferences(async (_db, values) => { for (const [key, value] of Object.entries(command.values || {})) { keySchema.parse(key); if (!(key in values)) values[key] = value; } return { verified: true }; });
      case 'migration-complete': await this.persist({ ...this.index, migrationComplete: true }); await writeFile(join(this.profile, 'file-storage-migrated'), '1\n'); return {};
      case 'preference-get': return this.preferences(db => db.get('preferences', keySchema.parse(command.key)));
      case 'preference-set': return this.preferences(async db => { await db.put('preferences', command.value, keySchema.parse(command.key)); return {}; });
      case 'learner-read': return this.preferences(db => readLearnerSetup(db));
      case 'learner-save': return this.preferences(db => commitLearnerSetup(db, command.value, command.step));
      case 'learner-reset': return this.preferences(db => resetLearnerSetup(db));
      case 'templates-read': return this.preferences(db => readTemplateLibrary(db));
      case 'templates-save': return this.preferences(db => commitTemplateLibrary(db, command.value, command.revision));
      case 'course-save': return this.preferences(db => commitCourseStylePreferences(db, command.value, command.revision));
      default: throw new Error('未知的资料存储操作。');
    }
  }); }
}
