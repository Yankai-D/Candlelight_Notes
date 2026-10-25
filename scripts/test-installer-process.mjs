import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, copyFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID, createHash } from 'node:crypto';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..');
if (process.platform !== 'win32') throw new Error('This test compiles and executes the actual Windows installer hooks.');
const out = resolve(process.argv[2] || 'artifacts/installer-process');
if (!out.startsWith(join(root, 'artifacts') + '\\')) throw new Error('Evidence must be under artifacts');
await mkdir(out, { recursive: true });
const cache = join(root, '.cache/electron-builder/nsis-3.0.4.1');
const compiler = join(cache, (await readdir(cache)).find(n => n.startsWith('nsis-') && !n.includes('.state')), 'Bin/makensis.exe');
const scratch = await mkdtemp(join(tmpdir(), 'candlelight-process-test-'));
const target = join(scratch, "中文 O'Brien $资料"), sibling = target + ' archive', other = join(scratch, 'other');
const key = `Software\\CandlelightProcessTest-${randomUUID()}`, owned = new Set(), checks = [];
const hook = join(root, 'packaging/desktop/app-running.nsh');
const handoff = join(root, 'packaging/desktop/installer-handoff.nsh');
const quote = s => String(s).replaceAll('$', () => '$$').replaceAll('"', () => '$\\"');
async function compile(name, body, directory = scratch) {
  const path = join(directory, name + '.exe'), compiled = join(scratch, name + '.exe'), script = join(scratch, name + '.nsi');
  await writeFile(script, `Unicode true\nRequestExecutionLevel user\nSilentInstall silent\nSilentUnInstall silent\nOutFile "${quote(compiled)}"\n!include LogicLib.nsh\n${body}\n`);
  const result = await run(compiler, ['/INPUTCHARSET', 'UTF8', '/V2', script], { windowsHide: true, timeout: 30000 });
  await writeFile(join(out, name + '-compile.log'), result.stdout + result.stderr);
  if (compiled !== path) await copyFile(compiled, path);
  return path;
}
async function execute(path, args = ['/S']) { return run(path, args, { windowsHide: true, timeout: 30000 }); }
async function fixture(path, args = ['/S']) {
  const child = spawn(path, args, { windowsHide: true, stdio: 'ignore' });
  owned.add(child); child.once('exit', () => owned.delete(child)); await delay(250);
  assert.equal(child.exitCode, null); return child;
}
async function stop(child) { if (child.exitCode !== null) return; const done = new Promise(r => child.once('exit', r)); child.kill(); await done; }
async function waitFile(path) { for (let n = 0; n < 100; n++) { try { return await readFile(path, 'utf16le'); } catch (e) { if (e.code !== 'ENOENT') throw e; await delay(100); } } throw new Error('Timed out: ' + path); }
try {
  for (const dir of [target, sibling, other]) await mkdir(dir);
  const helper = await compile('helper', 'Section\n Sleep 120000\nSectionEnd');
  const result = join(scratch, 'process.txt');
  const detector = await compile('Setup', `!define CANDLELIGHT_EXECUTABLE_FILENAME "PangzhuNotes.exe"
!include "${quote(hook)}"
Section
 StrCpy $INSTDIR "${quote(target)}"
 Call CandlelightFindApp
 FileOpen $0 "${quote(result)}" w
 FileWriteUTF16LE $0 "$CandlelightAppPid"
 FileClose $0
SectionEnd`, target);
  const detect = async () => { await execute(detector); return Number(await readFile(result, 'utf16le')); };
  assert.equal(await detect(), 0); checks.push('Setup inside the application directory does not detect itself');
  const sameDirHelper = join(target, 'other-tool.exe'); await copyFile(helper, sameDirHelper);
  const unrelated = await fixture(sameDirHelper);
  assert.equal(await detect(), 0); checks.push('Unrelated executable in the exact installation directory is ignored');
  const siblingHelper = join(sibling, 'PangzhuNotes.exe'); await copyFile(helper, siblingHelper);
  const siblingChild = await fixture(siblingHelper);
  assert.equal(await detect(), 0); checks.push('Same executable name in a prefix-sharing sibling directory is ignored');
  const otherHelper = join(other, 'PangzhuNotes.exe'); await copyFile(helper, otherHelper);
  const otherChild = await fixture(otherHelper);
  assert.equal(await detect(), 0); checks.push('Another independent installation is ignored');
  const exactHelper = join(target, 'PangzhuNotes.exe'); await copyFile(process.execPath, exactHelper);
  const exactChild = await fixture(exactHelper, ['-e', 'setTimeout(() => {}, 120000)']);
  assert.equal(await detect(), exactChild.pid); checks.push('Exact target process is identified by PID, including Unicode, spaces, quotes and dollar signs');
  const gate = await compile('gate', `!define CANDLELIGHT_EXECUTABLE_FILENAME "PangzhuNotes.exe"
!include "${quote(hook)}"
Section
 StrCpy $INSTDIR "${quote(target)}"
 !insertmacro customCheckAppRunning
SectionEnd`);
  await assert.rejects(execute(gate), error => error.code === 2);
  assert.equal(exactChild.exitCode, null); assert.equal(unrelated.exitCode, null); assert.equal(otherChild.exitCode, null);
  checks.push('Silent install fails boundedly when the app is running and never force-kills it or unrelated processes');
  await stop(exactChild); assert.equal(await detect(), 0); await execute(gate);
  checks.push('Closing the target clears the check while unrelated processes remain alive');
  for (const child of [unrelated, siblingChild, otherChild]) await stop(child);
  // Compile the real uninstall-side function too, not a JS approximation.
  const unResult = join(scratch, 'un-result.txt'), unExe = join(scratch, 'un-gate.exe');
  const unProducer = await compile('un-producer', `!define BUILD_UNINSTALLER
!define CANDLELIGHT_EXECUTABLE_FILENAME "PangzhuNotes.exe"
!include "${quote(hook)}"
Section
 WriteUninstaller "${quote(unExe)}"
SectionEnd
Section "Uninstall"
 StrCpy $INSTDIR "${quote(target)}"
 !insertmacro customCheckAppRunning
 FileOpen $0 "${quote(unResult)}" w
 FileWriteUTF16LE $0 "pass"
 FileClose $0
SectionEnd`);
  await execute(unProducer); await execute(unExe, ['/S', `_?=${scratch}`]);
  assert.equal(await readFile(unResult, 'utf16le'), 'pass'); checks.push('Uninstaller uses the same native exact-path guard');
  // Model the old uninstaller's live predicate after automatic handoff. Only
  // this test's unique registry key/cache is used; installed app state is not.
  const legacyDir = join(scratch, 'legacy'), stagedDir = join(scratch, 'isolated-cache');
  await mkdir(legacyDir); await mkdir(stagedDir);
  const staged = join(stagedDir, 'installer.exe'), handoffResult = join(scratch, 'handoff.txt');
  const handoffExe = await compile('handoff', `!define INSTALL_REGISTRY_KEY "${key}"
!define CANDLELIGHT_INSTALLER_CACHE "${quote(staged)}"
!include "${quote(handoff)}"
Function .onInit
 !insertmacro preInit
FunctionEnd
Section
 FileOpen $0 "${quote(handoffResult)}" w
 FileWriteUTF16LE $0 "$EXEPATH$\\r$\\n$CMDLINE$\\r$\\n$INSTDIR"
 FileClose $0
SectionEnd`, legacyDir);
  await run('reg.exe', ['add', `HKCU\\${key}`, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', legacyDir, '/f', '/reg:64'], { windowsHide: true });
  // NSIS /D consumes the remaining raw command line; the whole /D argument
  // must not be wrapped in quotes by Node's Windows argument encoder.
  await run(handoffExe, ['/S', '/D=' + join(scratch, 'selected directory')], { windowsHide: true, windowsVerbatimArguments: true, timeout: 30000 });
  const handed = await waitFile(handoffResult);
  await writeFile(join(out, 'handoff.txt'), handed);
  assert.equal(handed.split('\r\n')[0], staged); assert.match(handed, /\/candlelight-parent=\d+/);
  assert.equal(handed.split('\r\n').at(-1), join(scratch, 'selected directory'));
  checks.push('Setup below the legacy install prefix relaunches from isolated cache, waits for its parent and preserves /S and /D');
  const ps = join(scratch, 'legacy-check.ps1');
  await writeFile(ps, `if ((Get-CimInstance -ClassName Win32_Process | Where-Object { $_.Path -and $_.Path.StartsWith('${legacyDir}', 'CurrentCultureIgnoreCase') }).Count -gt 0) { exit 2 } else { exit 0 }`);
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps], { windowsHide: true, timeout: 30000 });
  checks.push('The legacy directory-prefix predicate is clear after handoff');
  const report = { status: 'pass', createdAt: new Date().toISOString(), checks, modelCalls: 0,
    scope: 'Compiled production NSIS guard and bootstrap, live fixture processes and unique test registry; no personal installation changed',
    hooks: await Promise.all([hook,handoff].map(async p => ({ file: p, sha256: createHash('sha256').update(await readFile(p)).digest('hex') }))) };
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  for (const child of [...owned]) await stop(child);
  await run('reg.exe', ['delete', `HKCU\\${key}`, '/f', '/reg:64'], { windowsHide: true }).catch(e => { if (e.code !== 1) throw e; });
  if (dirname(scratch) !== resolve(tmpdir()) || !scratch.includes('candlelight-process-test-')) throw new Error('Unsafe fixture cleanup');
  await delay(300); await rm(scratch, { recursive: true, force: true });
}
