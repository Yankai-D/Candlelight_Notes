import assert from 'node:assert/strict';
import { readFile, writeFile, stat, readdir, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { listPackage, extractFile, statFile } from '@electron/asar';
import { validateDistributionPath } from '../packaging/windows/policy.mjs';
import { brand } from '../shared/brand.mjs';
import { brandIconSvg } from '../shared/brand-mark.mjs';
import { sha256 } from './lib/source-evidence.mjs';
import { createTransformer } from 'app-builder-lib/out/fileTransformer.js';

const { values } = parseArgs({ options: { release: { type: 'string' }, check: { type: 'string' } } });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const output = resolve(values.release || `output/releases/pangzhu-desktop-${pkg.version}`);
const resources = join(output, 'installer/win-unpacked/resources'), asar = join(resources, 'app.asar');
const manifest = JSON.parse(await readFile(join(resources, 'PACKAGE-MANIFEST.json'), 'utf8'));
const checked = JSON.parse(await readFile(values.check || 'artifacts/check/report.json', 'utf8'));
const evidenceRoot = dirname(dirname(resolve(values.check || 'artifacts/check/report.json')));
assert.equal(manifest.version, pkg.version); assert.equal(manifest.dev, false);
assert.equal(checked.status, 'pass'); assert.equal(checked.source.status, ''); assert.equal(manifest.source.status, '');
assert.equal(manifest.sourceRevision, checked.source.revision); assert.equal(manifest.source.fingerprint, checked.source.fingerprint);
assert.equal(manifest.source.lockSha256, checked.source.lockSha256);
assert.deepEqual(manifest.includedMaterialIds.slice().sort(), ['descriptive-statistics-textbook', 'descriptive-statistics-numerical', 'descriptive-statistics-categorical'].sort());
assert.equal(manifest.personalDataIncluded, false); assert.equal(manifest.credentialsIncluded, false);
const entries = listPackage(asar).map(path => path.replaceAll('\\', '/').replace(/^\//, ''));
for (const entry of entries) validateDistributionPath(`app/${entry}`);
const paths = new Set(entries), staged = new Map(manifest.files.map(file => [file.path, file]));
const transformMetadata = createTransformer(join(output, 'payload/app'), {});
const expectedHashes = new Map(); let normalizedPackageManifests = 0;
async function expectedHash(file) {
  if (!file.path.endsWith('/package.json')) return file.sha256;
  if (expectedHashes.has(file.path)) return expectedHashes.get(file.path);
  const path = join(output, 'payload', file.path), original = await readFile(path);
  assert.equal(sha256(original), file.sha256, `Staged metadata changed: ${file.path}`);
  // Use the locked builder's declared metadata transformation, after verifying
  // its input. Runtime entrypoints and dependency versions remain constrained.
  const transformed = await transformMetadata(path);
  if (transformed != null) normalizedPackageManifests++;
  const hash = sha256(transformed == null ? original : Buffer.from(transformed));
  expectedHashes.set(file.path, hash); return hash;
}
const relocatedDependencies = [];
async function verifyRelocation(entry, actual) {
    // The packager may relocate a duplicate transitive package. Require the
    // same declared package/version, internal filename AND original bytes.
    assert.ok(entry.startsWith('node_modules/'), `Unmanifested application file: ${entry}`);
    const start = entry.lastIndexOf('node_modules/') + 'node_modules/'.length;
    const tail = entry.slice(start).split('/');
    const packagePath = entry.slice(0, start) + tail.slice(0, tail[0].startsWith('@') ? 2 : 1).join('/');
    const metadata = JSON.parse(extractFile(asar, join(...(packagePath + '/package.json').split('/'))).toString());
    const internal = entry.slice(packagePath.length + 1);
    let original;
    for (const dependency of manifest.dependencies.filter(dependency => dependency.version === metadata.version && dependency.name.endsWith('/' + metadata.name))) {
      const candidate = staged.get(`app/${dependency.name}/${internal}`);
      if (candidate && await expectedHash(candidate) === actual) { original = candidate; break; }
    }
    assert.ok(original, `Unmanifested or modified dependency: ${entry}`);
    relocatedDependencies.push({ path: entry, original: original.path, sha256: actual });
}
// Verify actual installed bytes, not just the staging manifest's assertions.
let verifiedFiles = 0; const omittedDependencies = [];
for (const entry of entries) {
  const info = statFile(asar, join(...entry.split('/')), false);
  assert.ok(!info.link, `Unexpected packaged link: ${entry}`);
  if (info.files) continue;
  const file = staged.get(`app/${entry}`);
  const actual = sha256(extractFile(asar, join(...entry.split('/'))));
  if (!file || actual !== await expectedHash(file)) await verifyRelocation(entry, actual);
  verifiedFiles++;
}
for (const file of manifest.files) {
  validateDistributionPath(file.path);
  if (file.path.startsWith('app/') && !paths.has(file.path.slice(4))) {
    // electron-builder prunes dependency declarations, docs and unused peers.
    // Every shipped file is checked above; application modules may not vanish.
    assert.ok(file.path.startsWith('app/node_modules/'), `Application file omitted: ${file.path}`);
    omittedDependencies.push(file.path); continue;
  }
  if (file.path.startsWith('app/')) continue;
  const bytes = await readFile(join(resources, file.path));
  assert.equal(sha256(bytes), await expectedHash(file), `Packaged bytes differ: ${file.path}`); verifiedFiles++;
}
for (const name of ['sprintf-js', 'roarr', 'global-agent', 'electron-builder']) {
  assert.ok(!entries.some(entry => entry.split('/').includes(name)), `Build-only dependency shipped: ${name}`);
}
const packaged = JSON.parse(extractFile(asar, 'package.json').toString());
assert.deepEqual(packaged, JSON.parse(await readFile(join(output, 'payload/app/package.json'), 'utf8')));
assert.equal(packaged.version, pkg.version); assert.equal(packaged.author.url, brand.projectUrl); assert.equal(packaged.homepage, brand.projectUrl);
assert.equal(extractFile(asar, 'dist/favicon.svg').toString(), brandIconSvg());
assert.equal((await readdir(join(resources, 'materials'))).filter(name => name.endsWith('.pdf')).length, 3);
const installer = `Candlelight-Notes-${pkg.version}-Setup-x64.exe`, path = join(output, 'installer', installer);
const installerHash = sha256(await readFile(path));
assert.ok((await readFile(path + '.sha256', 'utf8')).startsWith(installerHash));
const smoke = JSON.parse(await readFile(join(evidenceRoot, 'desktop/report.json'), 'utf8'));
assert.equal(smoke.status, 'pass'); assert.equal(resolve(smoke.target), join(output, 'installer/win-unpacked/PangzhuNotes.exe'));
const archive = JSON.parse(await readFile(join(evidenceRoot, `release-${pkg.version}-archive.json`), 'utf8'));
assert.equal(archive.status, 'pass'); assert.equal(archive.verifiedEntries.find(entry => entry.name === installer)?.sha256, installerHash);
assert.equal(sha256(await readFile(archive.archive)), archive.sha256);
const report = { schema: 'desktop-audit-v2', version: pkg.version, status: 'pass', checkedAt: new Date().toISOString(),
  auditToolSha256: sha256(await readFile(import.meta.filename)),
  source: manifest.source, checkReportSha256: sha256(await readFile(values.check || 'artifacts/check/report.json')),
  installer: { file: installer, bytes: (await stat(path)).size, sha256: installerHash }, archive,
  payload: { asarEntries: entries.length, manifestFiles: manifest.files.length, verifiedFiles, normalizedPackageManifests, omittedDependencies, relocatedDependencies, includedMaterialIds: manifest.includedMaterialIds,
    buildOnlyAdvisoryDependenciesAbsent: true, forbiddenPathsAbsent: true },
  desktop: smoke, signed: false, installerLifecycle: 'not-run-this-review', remoteCI: 'not-run', modelCalls: 0 };
await mkdir('artifacts/release-audit', { recursive: true });
await writeFile(`artifacts/release-audit/${pkg.version}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, version: pkg.version, verifiedFiles, installerHash }));
