import { mkdir, readFile, writeFile, copyFile, cp, lstat, stat, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { build as buildFrontend } from 'vite';
import react from '@vitejs/plugin-react';
import { writeBrandIcons } from './lib/brand-icons.mjs';
import { brandIconSvg } from '../shared/brand-mark.mjs';
import { build, Platform, Arch } from 'electron-builder';
import { statisticsCatalog } from '../packaging/windows/catalog.mjs';
import { validateDistributionPath } from '../packaging/windows/policy.mjs';
import { desktopBuildConfig } from '../packaging/desktop/config.mjs';
import { brand } from '../shared/brand.mjs';
import { sourceEvidence } from './lib/source-evidence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const { values } = parseArgs({ options: { out: { type: 'string' }, dev: { type: 'boolean' }, 'stage-only': { type: 'boolean' } } });
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This desktop distribution targets Windows x64');
const source = await sourceEvidence(root);
if (source.status && !values.dev) throw new Error('Desktop release requires a clean Git checkout; commit reviewed source first');
if (!values.dev && !values['stage-only']) {
  try { await stat(join(root, 'node_modules/electron/dist/electron.exe')); }
  catch { throw new Error('Electron runtime is missing. Run node node_modules/electron/install.js before desktop packaging.'); }
}
const output = resolve(root, values.out || `output/releases/pangzhu-desktop-${pkg.version}`);
const suffix = relative(join(root, 'output'), output);
if (!suffix || suffix.startsWith('..') || isAbsolute(suffix)) throw new Error('Output must be a new directory under output');
await mkdir(dirname(output), { recursive: true }); await mkdir(output);
const stage = join(output, 'payload'), app = join(stage, 'app'); await mkdir(app, { recursive: true });
const copy = async (source, destination) => { await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = JSON.parse(await readFile(join(root, 'examples/course/descriptive-statistics/sources.json'), 'utf8'));
for (const source of fixture.sources) {
  const original = join(root, 'output/pdf/descriptive-statistics', source.file);
  if (sha(await readFile(original)) !== source.sha256) throw new Error(`Source fingerprint mismatch: ${source.id}`);
  await copy(original, join(stage, `materials/descriptive-statistics-${source.id}.pdf`));
}
await writeFile(join(stage, 'materials/catalog.json'), JSON.stringify(statisticsCatalog(fixture.sources), null, 2) + '\n');
await copy(join(root, 'examples/course/descriptive-statistics/sources.json'), join(stage, 'materials/SOURCES.json'));
await copy(join(root, 'output/pdf/descriptive-statistics/ATTRIBUTION.txt'), join(stage, 'materials/ATTRIBUTION.txt'));
await copy(join(root, 'packaging/desktop/使用说明.txt'), join(stage, '使用说明.txt'));
await copy(join(root, 'ACKNOWLEDGEMENTS.md'), join(stage, 'ACKNOWLEDGEMENTS.md'));
const tracked = execFileSync('git', ['ls-files', '-z', 'server', 'shared', 'src/styles.css', 'src/learning.css', 'src/themes.css',
  'scripts/render-course-reference.mjs', 'scripts/render-editorial-reference.mjs', 'examples/course/descriptive-statistics', 'examples/editorial/adam-bias-correction.mjs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
// These are runtime modules, not user material. New desktop files are explicit.
for (const file of [...new Set([...tracked, 'shared/brand.mjs', 'shared/print-layout.mjs', 'desktop/main.mjs', 'desktop/local-bridge.mjs', 'desktop/policy.mjs', 'desktop/preload.cjs', 'desktop/pdf.mjs', 'desktop/updates.mjs'])].filter(file => /\.(mjs|cjs|json|css)$/.test(file))) await copy(join(root, file), join(app, file));
await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'pangzhu-notes', version: pkg.version, private: true, type: 'module',
  main: 'desktop/main.mjs', description: `${brand.englishName} · 本地学习笔记与 AI 协作工具`,
  author: { name: brand.authorName, url: brand.projectUrl }, homepage: brand.projectUrl, repository: pkg.repository,
  license: 'UNLICENSED', dependencies: pkg.dependencies }, null, 2));
await buildFrontend({ root, configFile: false, envDir: false, publicDir: false, plugins: [react(), {
  name: 'desktop-system-fonts', enforce: 'pre', transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/styles.css')) return code.replace(/@import url\('https:\/\/fonts\.googleapis\.com\/[^']+'\);\r?\n?/g, '');
  }
}], build: { outDir: join(app, 'dist'), emptyOutDir: false, sourcemap: false } });
await writeFile(join(app, 'dist/favicon.svg'), brandIconSvg());
await writeBrandIcons(join(app, 'desktop'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')), dependencies = [];
if (!values.dev) for (const [path, metadata] of Object.entries(lock.packages).filter(([path, pkg]) => path.startsWith('node_modules/') && !pkg.dev)) {
  const source = join(root, path);
  try { await stat(source); } catch (error) { if (error.code === 'ENOENT' && metadata.optional) continue; throw error; }
  const installed = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (installed.version !== metadata.version) throw new Error(`Installed dependency differs from lockfile: ${path}`);
  await cp(source, join(app, path), { recursive: true, filter: async current => {
    if (relative(source, current).split(/[\\/]/).includes('node_modules')) return false;
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Unexpected dependency symlink: ${path}`);
    return true;
  } });
  dependencies.push({ name: path, version: metadata.version, license: metadata.license || 'See bundled license' });
}
await writeFile(join(stage, 'THIRD-PARTY-NOTICES.txt'), [
  `${brand.englishName} - Windows desktop distribution`,
  'Project acknowledgements and design references: resources/ACKNOWLEDGEMENTS.md.',
  'Electron 44.9.0, Chromium and Node.js: LICENSE.electron.txt and LICENSES.chromium.html in the installation directory.',
  'Individual npm package licenses remain in resources/app.asar and app.asar.unpacked.',
  'OpenIntro source attribution and licenses: resources/materials/ATTRIBUTION.txt.',
  'The project itself has not selected an open-source license.', '',
  ...dependencies.map(item => `${item.name} @ ${item.version} | ${item.license}`), ''
].join('\n'));
const files = [];
async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name), name = relative(stage, path).replaceAll('\\', '/');
    if (item.isSymbolicLink()) throw new Error(`Unexpected link: ${name}`);
    if (item.isDirectory()) { await inspect(path); continue; }
    validateDistributionPath(name); const bytes = await readFile(path);
    if (/\.(mjs|cjs|js|json|css|txt|html|md)$/i.test(name) && /sk-[a-zA-Z0-9]{24,}/.test(bytes.toString('utf8'))) throw new Error(`Credential-like content: ${name}`);
    files.push({ path: name, sha256: sha(bytes), bytes: bytes.length });
  }
}
await inspect(stage);
const after = await sourceEvidence(root);
if (source.fingerprint !== after.fingerprint || source.revision !== after.revision) throw new Error('Source changed while staging the desktop release');
await writeFile(join(stage, 'PACKAGE-MANIFEST.json'), JSON.stringify({ format: 'pangzhu-desktop-v1', version: pkg.version,
  sourceRevision: source.revision, source,
  builtAt: new Date().toISOString(), runtime: { electron: '44.9.0' }, dev: !!values.dev,
  personalDataIncluded: false, credentialsIncluded: false, includedMaterialIds: fixture.sources.map(source => `descriptive-statistics-${source.id}`),
  dependencies, files }, null, 2) + '\n');
if (!values.dev && !values['stage-only']) {
  const config = desktopBuildConfig(stage, join(output, 'installer'));
  config.electronDist = join(root, 'node_modules/electron/dist');
  process.env.ELECTRON_BUILDER_CACHE = join(root, '.cache/electron-builder');
  const artifacts = await build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config });
  for (const artifact of artifacts.filter(path => path.endsWith('.exe'))) await writeFile(artifact + '.sha256', `${sha(await readFile(artifact))}  ${artifact.split(/[\\/]/).at(-1)}\n`);
}
console.log(JSON.stringify({ output, stage, files: files.length, materials: 3, dev: !!values.dev }, null, 2));
