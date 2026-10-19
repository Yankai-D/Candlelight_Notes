import { mkdir, readFile, writeFile, readdir, cp, copyFile, lstat, stat } from 'node:fs/promises';
import { dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { statisticsCatalog } from '../packaging/windows/catalog.mjs';
import { validateDistributionPath } from '../packaging/windows/policy.mjs';
import { brandIconSvg } from '../shared/brand-mark.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{out:{type:'string'},materials:{type:'string'},'no-zip':{type:'boolean'}}});
if(process.platform!=='win32'||process.arch!=='x64'||process.version!=='v24.14.1')throw new Error('This distribution requires the verified Windows x64 Node.js v24.14.1 runtime');
const out=resolve(root,values.out||'output/releases/pangzhu-notes-0.1.0-windows-x64');
const location=relative(join(root,'output/releases'),out);
if(!location||location.startsWith('..')||isAbsolute(location))throw new Error('Output must be a new directory beneath output/releases');
const materialRoot=resolve(root,values.materials||'output/pdf/descriptive-statistics');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const nodeHash=digest(await readFile(process.execPath));
const sums=await readFile(join(root,'packaging/windows/node-shasums.txt'),'utf8');
if(!sums.split(/\r?\n/).some(line=>line===`${nodeHash}  win-x64/node.exe`))throw new Error('Node runtime does not match the official checksum');
const sourceFixture=JSON.parse(await readFile(join(root,'examples/course/descriptive-statistics/sources.json'),'utf8'));
for(const source of sourceFixture.sources)if(digest(await readFile(join(materialRoot,source.file)))!==source.sha256)throw new Error(`Public source checksum mismatch: ${source.id}`);
await mkdir(dirname(out),{recursive:true});
await mkdir(out); // Refuse overwrite; never package a previously used data directory.
const app=join(out,'app');await mkdir(app);
const copy=async(source,destination)=>{await mkdir(dirname(destination),{recursive:true});await copyFile(source,destination);};
const tracked=execFileSync('git',['ls-files','-z','server','shared','src/styles.css','src/learning.css','src/themes.css',
  'scripts/render-course-reference.mjs','scripts/render-editorial-reference.mjs','examples/course/descriptive-statistics',
  'examples/editorial/adam-bias-correction.mjs'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of tracked.filter(file=>/\.(mjs|json|css)$/.test(file)))await copy(join(root,file),join(app,file));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
await writeFile(join(app,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,private:true,type:'module',author:pkg.author,homepage:pkg.homepage,repository:pkg.repository,engines:pkg.engines,dependencies:pkg.dependencies},null,2)+'\n');
// Never read the developer's .env, public PDFs, cached HTML or previous dist.
await build({root,configFile:false,envDir:false,plugins:[react(),{
  name:'portable-system-fonts',enforce:'pre',
  transform(code,id){
    if(id.replaceAll('\\','/').endsWith('/src/styles.css'))return code.replace(/@import url\('https:\/\/fonts\.googleapis\.com\/[^']+'\);\r?\n?/g,'');
  }
}],publicDir:false,
  build:{outDir:join(app,'dist'),emptyOutDir:false,sourcemap:false}});
await writeFile(join(app,'dist/favicon.svg'),brandIconSvg());
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
const dependencies=Object.entries(lock.packages).filter(([path,pkg])=>path.startsWith('node_modules/')&&!pkg.dev);
const notices=[];
for(const [path,pkg] of dependencies) {
  const source=join(root,path);
  try{await stat(source);}catch(error){if(error.code==='ENOENT'&&pkg.optional)continue;throw error;}
  if((await lstat(source)).isSymbolicLink())throw new Error(`Linked dependency is not distributable: ${path}`);
  await cp(source,join(app,path),{recursive:true,filter:async current=>{
    const suffix=relative(source,current);
    if(suffix.split(/[\\/]/).includes('node_modules'))return false;
    if((await lstat(current)).isSymbolicLink())throw new Error(`Symlink in dependency: ${path}`);
    return true;
  }});
  notices.push({path,version:pkg.version,license:pkg.license||'See package license',resolved:pkg.resolved});
}
await copy(process.execPath,join(out,'runtime/node.exe'));
await copy(join(root,'packaging/windows/Node-LICENSE.txt'),join(out,'licenses/Node-LICENSE.txt'));
await copy(join(root,'packaging/windows/launch.mjs'),join(out,'launcher/launch.mjs'));
for(const name of ['Start.cmd','Stop.cmd'])await writeFile(join(out,name),(await readFile(join(root,'packaging/windows',name),'utf8')).replace(/\r?\n/g,'\r\n'));
await copy(join(root,'packaging/windows/使用说明.txt'),join(out,'使用说明.txt'));
await copy(join(root,'ACKNOWLEDGEMENTS.md'),join(out,'ACKNOWLEDGEMENTS.md'));
await copy(join(materialRoot,'ATTRIBUTION.txt'),join(out,'materials/ATTRIBUTION.txt'));
await writeFile(join(out,'materials/SOURCES.json'),JSON.stringify(sourceFixture,null,2)+'\n');
await writeFile(join(out,'materials/catalog.json'),JSON.stringify(statisticsCatalog(sourceFixture.sources),null,2)+'\n');
for(const source of sourceFixture.sources)await copy(join(materialRoot,source.file),join(out,`materials/descriptive-statistics-${source.id}.pdf`));
await writeFile(join(out,'THIRD-PARTY-NOTICES.txt'),[
  'Candlelight Notes - bundled third-party components',
  'Project acknowledgements and design references: ACKNOWLEDGEMENTS.md.',
  'Node.js v24.14.1: https://nodejs.org/ - license and embedded dependency notices: licenses/Node-LICENSE.txt',
  'Node binary checksum verified against https://nodejs.org/dist/v24.14.1/SHASUMS256.txt',
  'Individual npm package copyright and license files are retained under app/node_modules.',
  'Public course attribution and licenses: materials/ATTRIBUTION.txt; examples/course/README.md in the source project.',
  'The project itself has not selected an open-source license; third-party licenses remain in effect.',
  '',...notices.map(p=>`${p.path} @ ${p.version} | ${p.license}\n${p.resolved||''}`),''
].join('\n'));
const files=[];
async function inventory(directory) {
  for(const item of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,item.name),name=relative(out,path).replaceAll('\\','/');
    if(item.isSymbolicLink())throw new Error(`Unexpected link: ${name}`);
    if(item.isDirectory()){await inventory(path);continue;}
    validateDistributionPath(name);
    const bytes=await readFile(path);
    if(/\.(mjs|js|json|css|txt|html|cmd|md)$/i.test(name)&&/sk-[a-zA-Z0-9]{24,}/.test(bytes.toString('utf8')))throw new Error(`Credential-like value in distribution: ${name}`);
    files.push({path:name,bytes:bytes.length,sha256:digest(bytes)});
  }
}
await inventory(out);
const manifest={format:'pangzhu-windows-portable-v1',version:pkg.version,baseRelease:'v0.1.0',
  applicationRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  workingTreeChanges:execFileSync('git',['diff','--name-only'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean),
  builtAt:new Date().toISOString(),platform:'win32-x64',runtime:{version:process.version,sha256:nodeHash},
  includedMaterialIds:sourceFixture.sources.map(s=>`descriptive-statistics-${s.id}`),
  personalDataIncluded:false,credentialsIncluded:false,preGeneratedUserNotesIncluded:false,dependencies:notices,
  files:files.sort((a,b)=>a.path.localeCompare(b.path))};
await writeFile(join(out,'PACKAGE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
if(!values['no-zip']) {
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'packaging/windows/archive.ps1'),'-Source',out,'-Destination',out+'.zip'],{stdio:'inherit',windowsHide:true});
  const zip=await readFile(out+'.zip');await writeFile(out+'.zip.sha256',`${digest(zip)}  ${out.split(/[\\/]/).at(-1)}.zip\n`);
}
console.log(JSON.stringify({directory:out,zip:values['no-zip']?null:out+'.zip',files:files.length,packages:notices.length,materials:3,modelCalls:0},null,2));
