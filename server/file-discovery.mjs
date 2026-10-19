import { readdir, lstat, realpath, readFile } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { storedDocumentSchema } from '../shared/backup.mjs';
import { sourceNames, materialFormat, richMaterial } from '../shared/material-formats.mjs';
export { sourceNames };

export const fileHash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, path) => { const part = relative(root, path); return !part || !part.startsWith('..') && !isAbsolute(part); };

// Discovery reads only the application's named notebook files. Ordinary PDFs,
// JSON configuration, hidden directories and links are never interpreted as notes.
export async function scanNoteFiles(directory, forbidden = []) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || /[\0\r\n]/.test(directory)) throw new Error('请选择有效的绝对文件夹路径。');
  const root = await realpath(resolve(directory));
  if (!(await lstat(root)).isDirectory()) throw new Error('请选择资料所在的文件夹。');
  const blocked = await Promise.all(forbidden.filter(Boolean).map(path => realpath(path).catch(() => resolve(path))));
  if (blocked.some(path => within(path, root))) throw new Error('请选择资料目录，不要扫描程序或配置目录。');
  const notes = [], issues = []; let visited = 0;
  async function walk(folder, depth) {
    if (++visited > 10000 || depth > 16) throw new Error('目录范围过大，请选择更具体的资料文件夹。');
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch { issues.push({ path: folder, reason: '无法读取此目录' }); return; }
    // Complete backups are snapshots, not another live copy to auto-index.
    if (entries.some(item => ['candlelight-workspace.json', '.candlelight-incomplete'].includes(item.name) || depth > 0 && item.name === '.candlelight-space')) return;
    for (const item of entries) {
      const path = join(folder, item.name);
      if (item.isSymbolicLink() || item.name.startsWith('.') || blocked.some(blocked => within(blocked, path))) continue;
      if (++visited > 10000) throw new Error('目录范围过大，请选择更具体的资料文件夹。');
      if (item.isDirectory()) { await walk(path, depth + 1); continue; }
      if (item.name !== 'note.candlelight.json' || !item.isFile()) continue;
      if (notes.length >= 1000) throw new Error('一次最多识别 1000 份笔记，请选择更具体的文件夹。');
      try {
        if (await realpath(folder) !== folder || await realpath(path) !== path) throw new Error('文件路径已被重定向');
        if ((await lstat(path)).size > 64 * 1024 * 1024) throw new Error('笔记文件超过 64 MB');
        const bytes = await readFile(path), document = storedDocumentSchema.parse(JSON.parse(bytes.toString('utf8')));
        // A JSON notebook backup is not an original PDF, even in older folders.
        const expectedSource = document.kind === 'pdf' ? 'source.pdf' : richMaterial(document.filename) ? 'source.' + materialFormat(document.filename).extension : null;
        const sources = entries.filter(item => sourceNames.includes(item.name) && (!expectedSource || item.name === expectedSource));
        if (sources.length > 1 || sources.some(item => !item.isFile() || item.isSymbolicLink())) throw new Error('配套原文存在多个文件或链接，请先确认原文');
        const sourcePath = sources[0] ? join(folder, sources[0].name) : null;
        if (sourcePath && await realpath(sourcePath) !== sourcePath) throw new Error('原文路径已被重定向');
        const { id, title, filename, kind, entryType, createdAt } = document;
        // Keep the preview bounded by metadata, not by the sum of all notebooks,
        // versions and source snapshots. Full content is read only when indexed.
        notes.push({ document: { id, title, filename, kind, entryType, createdAt }, notePath: path, directory: dirname(path), sourcePath, hash: fileHash(bytes) });
      } catch (error) { issues.push({ path, reason: error.name === 'ZodError' || error instanceof SyntaxError ? '无法识别的笔记格式或损坏文件' : error.message }); }
    }
  }
  await walk(root, 0);
  return { directory: root, notes, issues: issues.slice(0, 40), issueCount: issues.length };
}
