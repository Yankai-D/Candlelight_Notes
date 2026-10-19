import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Execute the actual NSIS cleanup macro against a compiled-in temporary
// profile. This harness has no product registration, shortcuts or access to
// the real application's AppData. It is not a full installer acceptance test.
if (process.platform !== 'win32') throw new Error('NSIS lifecycle verification requires Windows.');
const root = resolve(import.meta.dirname, '..'), output = join(root, 'artifacts/uninstall-policy');
await mkdir(output, { recursive: true });
const cache = join(root, '.cache/electron-builder/nsis-3.0.4.1');
const directory = (await readdir(cache, { withFileTypes: true })).find(entry => entry.isDirectory() && entry.name.startsWith('nsis-'))?.name;
if (!directory) throw new Error('Build a desktop installer first to populate the NSIS tool cache.');
const compiler = join(cache, directory, 'Bin/makensis.exe');
const scratch = await mkdtemp(join(tmpdir(), 'candlelight-uninstall-'));
const profile = join(scratch, 'profile'), library = join(scratch, 'user-library');
const exists = async path => access(path).then(() => true, () => false);
const escape = path => path.replaceAll('$', '$$').replaceAll('"', '$\\"');
const macro = join(root, 'packaging/desktop/uninstall.nsh');
const fixture = join(scratch, 'fixture.nsi');
try {
  await mkdir(profile); await mkdir(library); await mkdir(join(profile, 'browser')); await mkdir(join(profile, 'logs'));
  await writeFile(join(profile, '.env'), 'DEEPSEEK_API_KEY=TEST_ONLY_CREDENTIAL\n');
  await writeFile(join(profile, '.env.test.tmp'), 'TEST_ONLY_CREDENTIAL');
  await writeFile(join(profile, 'preferences.json'), '{"profile":"test"}');
  await writeFile(join(profile, 'library-index.json'), JSON.stringify({ directory: library }));
  await writeFile(join(profile, 'file-storage-migrated'), '1');
  await writeFile(join(profile, 'browser/cache'), Buffer.alloc(1024 * 1024));
  await writeFile(join(library, 'paper.pdf'), 'test paper'); await writeFile(join(library, 'note.json'), 'test note');
  await writeFile(fixture, `Unicode true
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
OutFile "${escape(join(scratch, 'fixture.exe'))}"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define isUpdated '$R9 == "1"'
!define CANDLELIGHT_PROFILE_PATH "${escape(profile)}"
!include "${escape(macro)}"
Section
  WriteUninstaller "${escape(join(scratch, 'uninstall.exe'))}"
SectionEnd
Function un.onInit
  StrCpy $R9 "0"
  \${GetParameters} $R0
  ClearErrors
  \${GetOptions} $R0 "--updated" $R1
  \${IfNot} \${Errors}
    StrCpy $R9 "1"
  \${EndIf}
FunctionEnd
Section "Uninstall"
  !insertmacro customUnInstall
SectionEnd
`.replaceAll('\\${', '${'));
  const compileLog = execFileSync(compiler, ['/V2', fixture], { encoding: 'utf8', windowsHide: true }); await writeFile(join(output, 'compile.log'), compileLog);
  execFileSync(join(scratch, 'fixture.exe'), ['/S'], { windowsHide: true, timeout: 30000 });
  execFileSync(join(scratch, 'uninstall.exe'), ['/S', '--updated', `_?=${scratch}`], { windowsHide: true, timeout: 30000 });
  assert.equal(await exists(join(profile, '.env')), true, 'Upgrade preserves credentials');
  assert.equal(await exists(join(profile, 'browser/cache')), true);
  for (let repetition = 0; repetition < 2; repetition++) {
    execFileSync(join(scratch, 'uninstall.exe'), ['/S', `_?=${scratch}`], { windowsHide: true, timeout: 30000 });
    for (const file of ['.env', '.env.test.tmp', 'browser', 'logs']) assert.equal(await exists(join(profile, file)), false, `Removed ${file}`);
    assert.equal(await readFile(join(library, 'paper.pdf'), 'utf8'), 'test paper');
    assert.equal(await readFile(join(library, 'note.json'), 'utf8'), 'test note');
    assert.ok(await readFile(join(profile, 'library-index.json'))); assert.ok(await readFile(join(profile, 'preferences.json')));
  }
  const report = { status: 'pass', hookSha256: createHash('sha256').update(await readFile(macro)).digest('hex'), modelCalls: 0,
    scope: 'Compiled production cleanup hook, isolated profile; no personal installation or registry changes',
    checks: ['upgrade preserves credentials', 'uninstall deletes saved and temporary keys', 'browser cache and logs removed after verified migration', 'user materials, notes, index and profile survive', 'repeated uninstall is idempotent'] };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('PASS: NSIS uninstall credential and data-retention policy');
} finally {
  if (dirname(scratch) !== resolve(tmpdir()) || !scratch.includes('candlelight-uninstall-')) throw new Error('Unsafe harness cleanup target');
  await rm(scratch, { recursive: true, force: true });
}
