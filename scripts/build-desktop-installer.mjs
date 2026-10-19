import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { build, Platform, Arch } from 'electron-builder';
import { desktopBuildConfig } from '../packaging/desktop/config.mjs';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const output = resolve(process.argv[2] || `output/releases/pangzhu-desktop-${pkg.version}`);
const local = relative(join(root, 'output'), output);
if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('Expected an existing desktop build under output');
const stage = join(output, 'payload'), manifest = JSON.parse(await readFile(join(stage, 'PACKAGE-MANIFEST.json'), 'utf8'));
if (manifest.format !== 'pangzhu-desktop-v1' || manifest.dev) throw new Error('Expected a production desktop payload');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of manifest.files) if (hash(await readFile(join(stage, file.path))) !== file.sha256) throw new Error(`Payload changed: ${file.path}`);
process.env.ELECTRON_BUILDER_CACHE = join(root, '.cache/electron-builder');
const artifacts = await build({ prepackaged: join(output, 'installer/win-unpacked'), targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  config: desktopBuildConfig(stage, join(output, 'installer')) });
for (const artifact of artifacts.filter(path => path.endsWith('.exe'))) await writeFile(artifact + '.sha256', `${hash(await readFile(artifact))}  ${artifact.split(/[\\/]/).at(-1)}\n`);
console.log(JSON.stringify({ artifacts, sourceRevision: manifest.sourceRevision }, null, 2));
