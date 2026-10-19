import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function sourceEvidence(cwd) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const paths = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort();
  const files = [];
  for (const path of paths) {
    try { files.push([path, sha256(await readFile(join(cwd, path)))]); }
    catch (error) { if (error.code !== 'ENOENT') throw error; files.push([path, null]); }
  }
  return { revision: git(['rev-parse', 'HEAD']).trim(), status: git(['status', '--porcelain=v1', '--untracked-files=all']).trim(),
    fileCount: files.length, fingerprint: sha256(JSON.stringify(files)), lockSha256: sha256(await readFile(join(cwd, 'package-lock.json'))) };
}
