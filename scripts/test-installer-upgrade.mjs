// Full NSIS transactions with an isolated app identity. Never invoke the
// user's installed uninstaller or touch the production registry/profile.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, access, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { build, Platform, Arch } from 'electron-builder';
import { desktopBuildConfig } from '../packaging/desktop/config.mjs';
if(process.platform!=='win32') throw new Error('Windows is required.');
const root=resolve(import.meta.dirname,'..'), run=promisify(execFile);
const unpacked=process.argv[2] && resolve(process.argv[2]);
if(!unpacked) throw new Error('Usage: node scripts/test-installer-upgrade.mjs <win-unpacked> [evidence-directory]');
const out=resolve(process.argv[3] || join(root,'artifacts/installer-upgrade'));
assert.ok(out.startsWith(join(root,'artifacts')+'\\'));
await mkdir(out,{recursive:true});
const scratch=await mkdtemp(join(out,'fixture-')), target=join(scratch,'中文 安装目录');
const profile=join(scratch,'profile'), library=join(scratch,'library'), cache=join(scratch,'cache');
const guid=randomUUID(), name='candlelight-upgrade-test-'+guid, checks=[], owned=new Set();
const sha=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>s.replaceAll('$',()=> '$$').replaceAll('"',()=>'$\\"');
const exists=async p=>access(p).then(()=>true,()=>false);
const sources=['config.mjs','uninstall.nsh','install-directory.nsh','app-running.nsh','installer-handoff.nsh','installer-upgrade.nsh'];
const hooks=await Promise.all(sources.map(async f=>({file:'packaging/desktop/'+f,sha256:sha(await readFile(join(root,'packaging/desktop',f)))})));
const compilerBase=join(root,'.cache/electron-builder/nsis-3.0.4.1');
const compiler=join(compilerBase,(await readdir(compilerBase)).find(n=>n.startsWith('nsis-')&&!n.includes('.state')),'Bin/makensis.exe');
async function files(dir,prefix='') {let result=[];for(const e of await readdir(dir,{withFileTypes:true})){assert.ok(!e.isSymbolicLink());const p=prefix+e.name;if(e.isDirectory())result.push(...await files(join(dir,e.name),p+'/'));else result.push(p);}return result.sort();}
const payload=await Promise.all((await files(unpacked)).map(async f=>({file:f,sha256:sha(await readFile(join(unpacked,f)))})));
async function verifyInstalled(){for(const f of payload)assert.equal(sha(await readFile(join(target,f.file))),f.sha256,f.file);}
async function execute(exe,args,timeout=120000){try{await run(exe,args,{windowsHide:true,windowsVerbatimArguments:true,timeout,maxBuffer:1024*1024});return 0;}catch(e){if(typeof e.code!=='number')throw e;return e.code;}}
async function compile(name,body){const script=join(scratch,name+'.nsi'),exe=join(scratch,name+'.exe');await writeFile(script,`Unicode true\nRequestExecutionLevel user\nSilentInstall silent\nOutFile "${quote(exe)}"\n${body}\n`);await run(compiler,['/INPUTCHARSET','UTF8','/V2',script],{windowsHide:true});return exe;}
async function waitFor(check,message){for(let n=0;n<120;n++){if(await check())return;await delay(1000);}throw new Error(message);}
async function stop(child){if(child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill();await done;}
let setup, appUninstaller;
try {
 for(const d of [profile,library,cache,join(scratch,'metadata')])await mkdir(d,{recursive:true});
 await writeFile(join(scratch,'metadata/package.json'),JSON.stringify({name,version:'0.1.30',description:'Isolated upgrade test',author:'Candlelight Notes',main:'index.js'}));
 await writeFile(join(scratch,'metadata/index.js'),'throw new Error("Do not launch this test application");');
 const wrapper=join(scratch,'hooks.nsh'), log=join(scratch,'upgrade.log');
 await writeFile(wrapper,`!define CANDLELIGHT_PROFILE_PATH "${quote(profile)}"\n!define CANDLELIGHT_INSTALLER_CACHE "${quote(join(cache,'installer.exe'))}"\n!define CANDLELIGHT_INSTALLER_LOG "${quote(log)}"\n!include "${quote(join(root,'packaging/desktop/uninstall.nsh'))}"\n`);
 const config=desktopBuildConfig(scratch,join(scratch,'build'));
 config.appId='org.candlelight.test.'+guid;config.productName='Candlelight Upgrade Test '+guid;
 config.directories.app=join(scratch,'metadata');config.extraResources=[];delete config.win.icon;
 config.artifactName='isolated-setup.exe';Object.assign(config.nsis,{guid,include:wrapper,createDesktopShortcut:false,createStartMenuShortcut:false,runAfterFinish:false,uninstallDisplayName:'Candlelight Upgrade Test '+guid});
 process.env.ELECTRON_BUILDER_CACHE=join(root,'.cache/electron-builder');
 await build({prepackaged:unpacked,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),config});
 setup=join(scratch,'build/isolated-setup.exe');appUninstaller=join(target,'Uninstall PangzhuNotes.exe');
 assert.equal(await execute(setup,['/S',`/D=${target}`]),0);await verifyInstalled();checks.push('Fresh installation: every runtime file matches the prepackaged payload');
 await writeFile(join(profile,'.env'),'TEST_ONLY=credential-canary');await writeFile(join(profile,'.env.test.tmp'),'TEST_ONLY');
 await writeFile(join(library,'paper.pdf'),'fixture-source');await writeFile(join(library,'note.json'),'fixture-note');
 const goodUninstaller=await readFile(appUninstaller), marker=join(scratch,'legacy-was-invoked');
 const broken=await compile('broken-legacy',`Section\n FileOpen $0 "${quote(marker)}" w\n FileWrite $0 "called"\n FileClose $0\n SetErrorLevel 42\n Quit\nSectionEnd`);
 await copyFile(broken,appUninstaller);
 assert.equal(await execute(setup,['/S',`/D=${target}`]),0);await verifyInstalled();assert.equal(await exists(marker),false);assert.deepEqual(await readFile(appUninstaller),goodUninstaller);
 assert.equal(await readFile(join(profile,'.env'),'utf8'),'TEST_ONLY=credential-canary');checks.push('Upgrade succeeds even with a deliberately failing legacy uninstaller; legacy code is never executed and credentials survive');
 // An actual Windows sharing violation, after earlier files have been moved.
 const held=join(target,'resources/app.asar'), ready=join(scratch,'lock-ready'), lockScript=join(scratch,'lock.ps1');
 const ps=s=>s.replaceAll("'","''");
 // Windows PowerShell 5 needs a BOM to preserve the Chinese fixture path.
 await writeFile(lockScript,`\uFEFF$ErrorActionPreference='Stop'\n$f=[System.IO.File]::Open('${ps(held)}',[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)\ntry { [System.IO.File]::WriteAllText('${ps(ready)}','ready'); Start-Sleep -Seconds 180 } finally {$f.Dispose()}`);
 const locker=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',lockScript],{windowsHide:true,stdio:'ignore'});owned.add(locker);locker.once('exit',()=>owned.delete(locker));
 await waitFor(()=>exists(ready),'File locker did not start');
 assert.equal(await execute(setup,['/S',`/D=${target}`]),2);await verifyInstalled();assert.deepEqual(await readFile(appUninstaller),goodUninstaller);
 assert.match(await readFile(log,'utf16le'),/无法替换文件：.*resources\\app\.asar/);assert.equal(await readFile(join(profile,'.env'),'utf8'),'TEST_ONLY=credential-canary');
 checks.push('A real locked app.asar stops replacement, names the file, restores all original runtime bytes, and preserves credentials');
 await stop(locker);
 assert.equal(await execute(setup,['/S',`/D=${target}`]),0);await verifyInstalled();checks.push('Reinstall succeeds after the lock is released, without nested installation paths');
 await copyFile(broken,appUninstaller);const inside=join(target,'Setup.exe');await copyFile(setup,inside);
 assert.equal(await execute(inside,['/S',`/D=${target}`]),0);
 await waitFor(async()=>{try{return (await readFile(appUninstaller)).equals(goodUninstaller);}catch{return false;}},'Handed-off upgrade did not complete');
 await verifyInstalled();assert.equal(await exists(marker),false);checks.push('Setup launched inside the installation directory hands off and finishes the full upgrade');
 const un=join(scratch,'isolated-uninstall.exe');await copyFile(appUninstaller,un);
 assert.equal(await execute(un,['/S','/currentuser',`_?=${target}`]),0);
 assert.equal(await exists(join(target,'PangzhuNotes.exe')),false);assert.equal(await exists(join(profile,'.env')),false);assert.equal(await exists(join(profile,'.env.test.tmp')),false);
 assert.equal(await readFile(join(library,'paper.pdf'),'utf8'),'fixture-source');assert.equal(await readFile(join(library,'note.json'),'utf8'),'fixture-note');
 checks.push('Real uninstall removes application and credentials while retaining external papers and notes');
 for(const h of hooks)assert.equal(sha(await readFile(join(root,h.file))),h.sha256,'Hook changed during the test');
 const report={status:'pass',finishedAt:new Date().toISOString(),checks,hooks,runtimeFiles:payload.length,fixture:scratch,appId:config.appId,guid,personalInstallationModified:false,scope:'Full electron-builder NSIS install/upgrade/rollback/uninstall transactions with the supplied runtime, isolated identity and disabled shortcuts/launch',limitations:['Native interactive wizard appearance is not automated','The user installation is not modified; the original reported environment-specific failure is not directly reproduced']};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error) {await writeFile(join(out,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,scratch,guid},null,2));throw error;}
finally {
 for(const child of owned)await stop(child);
 // These exact GUID keys were created by this test; never production keys.
 for(const key of [`HKCU\\Software\\${guid}`,`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`])await run('reg.exe',['delete',key,'/f','/reg:64'],{windowsHide:true}).catch(()=>{});
 // electron-builder retains its installer cache outside the fixture.
 const updater=resolve(process.env.LOCALAPPDATA,name+'-updater');assert.equal(dirname(updater),resolve(process.env.LOCALAPPDATA));assert.ok(name.startsWith('candlelight-upgrade-test-'));
 await rm(updater,{recursive:true,force:true});
}
