import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';

// Compile and execute the production callback against isolated directories and
// a unique test registry key. This never installs or uninstalls the real app.
if(process.platform!=='win32')throw new Error('NSIS path verification requires Windows.');
const root=resolve(import.meta.dirname,'..'),output=join(root,'artifacts/install-directory');await mkdir(output,{recursive:true});
const cache=join(root,'.cache/electron-builder/nsis-3.0.4.1');
const version=(await readdir(cache,{withFileTypes:true})).find(e=>e.isDirectory()&&e.name.startsWith('nsis-'))?.name;
if(!version)throw new Error('Build an installer first to populate the NSIS cache.');
const scratch=await mkdtemp(join(tmpdir(),'candlelight-install-path-')),key=`Software\\CandlelightPathTest-${randomUUID()}`;
const escape=path=>path.replaceAll('$','$$').replaceAll('"','$\\"'),hook=join(root,'packaging/desktop/install-directory.nsh');
try{
 const cases=[['first-parent','parent','parent/Candlelight Notes',false,false],['same-name','Candlelight Notes','Candlelight Notes',false,false],['custom-upgrade','my-app','my-app',true,false],['old-brand-upgrade','Pangzhu Notes','Pangzhu Notes',true,false],['registered-no-exe','registered','registered',false,true],['name-substring','Candlelight Notes Archive','Candlelight Notes Archive/Candlelight Notes',false,false]];
 for(const [name,input,expected,exe,registered] of cases){
  const destination=join(scratch,input);await mkdir(destination,{recursive:true});if(exe)await writeFile(join(destination,'PangzhuNotes.exe'),'isolated fixture');
  const result=join(scratch,`${name}.txt`),binary=join(scratch,`${name}.exe`),script=join(scratch,`${name}.nsi`);
  await writeFile(script,`Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${escape(binary)}"
!include LogicLib.nsh
!define APP_EXECUTABLE_FILENAME "PangzhuNotes.exe"
!define APP_FILENAME "Candlelight Notes"
!define INSTALL_REGISTRY_KEY "${key}"
!define allowToChangeInstallationDirectory
!include "${escape(hook)}"
!define MUI_PAGE_CUSTOMFUNCTION_PRE upstreamCallback
Function instFilesPre
 StrCpy $INSTDIR "$INSTDIR\\upstream-append"
FunctionEnd
!insertmacro customPageAfterChangeDir
Section
 ${registered?`WriteRegStr HKCU "${key}" InstallLocation "${escape(destination)}"`:''}
 StrCpy $INSTDIR "${escape(destination)}"
 Call candlelightInstFilesPre
 FileOpen $0 "${escape(result)}" w
 FileWriteUTF16LE $0 "$INSTDIR"
 FileClose $0
 DeleteRegKey HKCU "${key}"
SectionEnd
`);
  execFileSync(join(cache,version,'Bin/makensis.exe'),['/V2',script],{windowsHide:true,timeout:30000});
  execFileSync(binary,['/S'],{windowsHide:true,timeout:30000});
  assert.equal((await readFile(result)).toString('utf16le'),join(scratch,expected),name);
 }
 await writeFile(join(output,'report.json'),JSON.stringify({status:'pass',hookSha256:createHash('sha256').update(await readFile(hook)).digest('hex'),checks:cases.map(c=>c[0]),scope:'Production directory callback compiled and executed with isolated files/registry; not a full installer upgrade',modelCalls:0},null,2));
 console.log('PASS: installer directory reuse, old/custom names, first install and exact leaf matching');
}finally{
 // Only the unique fixture key can be removed, even if a native assertion failed.
 try{execFileSync('reg.exe',['delete',`HKCU\\${key}`,'/f'],{windowsHide:true,stdio:'ignore',timeout:10000})}catch(error){if(error.status!==1)throw error}
 if(dirname(scratch)!==resolve(tmpdir())||!scratch.includes('candlelight-install-path-'))throw new Error('Unsafe fixture cleanup');
 await rm(scratch,{recursive:true,force:true});
}
