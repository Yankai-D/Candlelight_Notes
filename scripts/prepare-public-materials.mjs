import { readFile, mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { statisticsCatalog } from '../packaging/windows/catalog.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Reconstruct only the immutable, approved public catalog. Personal notes and
// preferences live in the application's separate storage, never in this cache.
export async function preparePublicMaterials(directory = resolve(import.meta.dirname, '..')) {
  const root = await realpath(directory);
  const sources = JSON.parse(await readFile(join(root, 'examples/course/descriptive-statistics/sources.json'), 'utf8')).sources;
  const catalog = Buffer.from(JSON.stringify(statisticsCatalog(sources), null, 2) + '\n');
  const bundled = join(root, 'materials/descriptive-statistics'), build = join(root, 'output/pdf/descriptive-statistics'), library = join(root, '.cache/public-materials');
  const prepared = [];
  async function sourceBytes(file, expected) {
    const path = join(bundled, file), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new Error('Public material must be a regular file.');
    const bytes = await readFile(path);
    if (expected && hash(bytes) !== expected) throw new Error(`Public material checksum mismatch: ${file}`);
    return bytes;
  }
  for (const source of sources) {
    if (!/^(01-selected-reading|02-numerical-data|03-categorical-data)\.pdf$/.test(source.file)) throw new Error('Unexpected public material.');
    const bytes = await sourceBytes(source.file, source.sha256);
    prepared.push([join(build, source.file), bytes], [join(library, `descriptive-statistics-${source.id}.pdf`), bytes]);
  }
  for (const name of ['ATTRIBUTION.txt', 'manifest.json']) prepared.push([join(build, name), await sourceBytes(name)]);
  prepared.push([join(library, 'catalog.json'), catalog]);
  // Inspect all existing destinations before writing. Never reset a modified
  // catalog or traverse a junction placed in the build/cache directories.
  for (const [path, bytes] of prepared) {
    let cursor = root;
    for (const part of relative(root, path).split(/[\\/]/)) {
      cursor = join(cursor, part);
      const info = await lstat(cursor).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (info && (info.isSymbolicLink() || cursor !== path && !info.isDirectory() || cursor === path && !info.isFile())) throw new Error('Prepared material path is not a regular local path.');
    }
    const existing = await readFile(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (existing && hash(existing) !== hash(bytes)) throw new Error('Prepared material differs; existing content was preserved.');
  }
  for (const [path, bytes] of prepared) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' }).catch(async e => { if (e.code !== 'EEXIST' || hash(await readFile(path)) !== hash(bytes)) throw e; });
  }
  return { materials: sources.length, library, build, credentialsRead: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await preparePublicMaterials(), null, 2));
