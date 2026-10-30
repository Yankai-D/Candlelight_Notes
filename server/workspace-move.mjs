import { mkdir, readdir, readFile, writeFile, lstat, realpath, copyFile, unlink, rmdir, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname, basename, resolve, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { atomicJSON, readJSON } from './workspace-state.mjs';

const within = (root,path) => { const part=relative(root,path); return !part || !part.startsWith('..')&&!isAbsolute(part); };
const exists = async path => { try { await access(path); return true; } catch(error) { if(error.code==='ENOENT')return false; throw error; } };
const hash = async path => { const value=createHash('sha256'); for await(const chunk of createReadStream(path))value.update(chunk); return value.digest('hex'); };
const same = (a,b) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
const entries = index => [...index.entries,...(index.retired||[]).map(item=>item.entry)];
const safeSystem = path => /^(ideal-trees\/[a-f0-9-]{36}\.json|ideal-trees\/assets\/S[a-f0-9]{22}\.(pdf|txt)|generation-records\/[a-zA-Z0-9_-]{1,100}\/[a-f0-9-]{36}\.json|source-knowledge\/[a-f0-9]{64}\.json)$/.test(path);
async function regular(path) {
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||await realpath(path)!==resolve(path))throw new Error('迁移路径包含链接或非普通文件，原文件已保留。');
  return info;
}
async function emptyDirectory(directory) {
  if((await readdir(directory)).length)throw new Error('统一迁移需要一个空文件夹，请选择新文件夹；已有内容不会被覆盖。');
}
export async function previewWorkspaceMove(store,directory) {
  const target=await store.checkDirectory(directory); await emptyDirectory(target);
  const oldIndex=structuredClone(store.index), files=[], folders=new Map(), warnings=[];
  const originalEntries=entries(oldIndex);
  for(const folder of [...originalEntries.map(e=>e.directory),oldIndex.systemDirectory]) {
    if(within(folder,target)||within(target,folder))throw new Error('新位置不能与现有资料文件夹相互包含，请选择独立的空文件夹。');
  }
  let bytes=0;
  async function add(source,path) {
    const info=await regular(source); bytes+=info.size;
    if(info.size>128*1024**2||bytes>4*1024**3||files.length>=10000)throw new Error('迁移超过单文件 128 MB、总量 4 GB 或 10000 文件限制。');
    files.push({source,path,bytes:info.size,sha256:await hash(source)});
  }
  for(const [position,entry] of originalEntries.entries()) {
    if(folders.has(entry.directory))throw new Error('多份记录指向同一个资料文件夹，请先处理冲突。');
    const folder=`资料-${entry.id}-${position}`; folders.set(entry.directory,folder);
    for(const path of [entry.notePath,entry.sourcePath].filter(Boolean)) {
      if(await store.owned(entry,path,true))await add(path,`${folder}/${basename(path)}`);
      else warnings.push(`${entry.title}：${path===entry.notePath?'笔记':'原文'}已缺失，将保留记录。`);
    }
    if(!entry.sourcePath&&entry.builtinId)throw new Error('旧原文尚未配套保存，请先在旧版资料库中修复原文。');
  }
  async function system(folder,prefix='') {
    if(!await exists(folder))return;
    const info=await lstat(folder);
    if(!info.isDirectory()||info.isSymbolicLink()||await realpath(folder)!==resolve(folder))throw new Error('学习树目录已被重定向，迁移已停止。');
    for(const item of await readdir(folder,{withFileTypes:true})) {
      const name=prefix+item.name,source=join(folder,item.name);
      if(item.isDirectory()&&(/^(ideal-trees|generation-records|source-knowledge|ideal-trees\/assets)$/.test(name)||/^generation-records\/[a-zA-Z0-9_-]{1,100}$/.test(name)))await system(source,name+'/');
      else if(item.isFile()&&safeSystem(name))await add(source,`.candlelight/${name}`);
      else throw new Error('学习树目录有未完成写入或未知文件，请关闭其他版本后重试。');
    }
  }
  await system(oldIndex.systemDirectory);
  const moveEntry=entry=>{const {builtinId:_builtin,...rest}=entry, folder=join(target,folders.get(entry.directory));return {...rest,directory:folder,notePath:join(folder,basename(entry.notePath)),sourcePath:entry.sourcePath?join(folder,basename(entry.sourcePath)):null};};
  const nextIndex={...oldIndex,directory:target,systemDirectory:join(target,'.candlelight'),entries:oldIndex.entries.map(moveEntry),
    retired:(oldIndex.retired||[]).map(item=>({...item,entry:moveEntry(item.entry)})),scanDirectories:[],isolatedWorkspace:true,
    ignoredNotes:(oldIndex.retired||[]).map(item=>moveEntry(item.entry).notePath)};
  return {version:1,id:randomUUID(),createdAt:Date.now(),target,oldIndex,nextIndex,files,
    summary:{directory:target,documents:oldIndex.entries.length,retired:(oldIndex.retired||[]).length,files:files.length,bytes,warnings}};
}
async function verifyFiles(plan, destination=false) {
  for(const file of plan.files) {
    const path=destination?join(plan.target,file.path):file.source;
    if((await regular(path)).size!==file.bytes||await hash(path)!==file.sha256)throw new Error('迁移前后文件发生变化或校验失败，原文件已保留，请重新预览。');
  }
}
async function removeEmpty(paths) {
  for(const path of [...new Set(paths)].sort((a,b)=>b.length-a.length))await rmdir(path).catch(error=>{if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;});
}
function validateJournal(plan,current) {
  if(plan.version!==1||!['copying','committing','cleanup'].includes(plan.phase)||!isAbsolute(plan.target)||!same(current,plan.oldIndex)&&!same(current,plan.nextIndex))throw new Error('资料迁移恢复记录与当前空间不一致，未清理任何文件。');
  if(plan.nextIndex.directory!==plan.target||plan.nextIndex.systemDirectory!==join(plan.target,'.candlelight'))throw new Error('迁移目标校验失败。');
  for(const file of plan.files) {
    const material=entries(plan.oldIndex).find(entry=>[entry.notePath,entry.sourcePath].includes(file.source));
    const system=within(plan.oldIndex.systemDirectory,file.source)&&safeSystem(relative(plan.oldIndex.systemDirectory,file.source).replaceAll('\\','/'));
    const next=entries(plan.nextIndex).find(entry=>[entry.notePath,entry.sourcePath].includes(join(plan.target,file.path)));
    if(!within(plan.target,join(plan.target,file.path))||!material&&!system||material&&!next||system&&file.path!=='.candlelight/'+relative(plan.oldIndex.systemDirectory,file.source).replaceAll('\\','/')||!/^[a-f0-9]{64}$/.test(file.sha256))throw new Error('迁移文件清单校验失败，原文件已保留。');
  }
}
async function cleanupSources(store,plan) {
  const remaining=[],covered=new Set(),empty=[];
  // A shared note writer lock protects both the source PDF and its notebook.
  for(const entry of entries(plan.oldIndex)) {
    const group=plan.files.filter(file=>dirname(file.source)===entry.directory);
    group.forEach(file=>covered.add(file.source));
    if(!group.length)continue;
    try {
      const present=[];
      for(const file of group)if(await exists(file.source))present.push(file);
      if(!present.length)continue;
      await store.withNoteWrite(entry,async()=>{
        for(const file of present){await store.owned(entry,file.source);await regular(join(plan.target,file.path));if(await hash(file.source)!==file.sha256||await hash(join(plan.target,file.path))!==file.sha256)throw new Error('文件已更改');}
        for(const file of present)await unlink(file.source);
      });
      empty.push(entry.directory);
    }catch{remaining.push(entry.directory);}
  }
  for(const file of plan.files.filter(file=>!covered.has(file.source))) {
    try {
      if(!await exists(file.source))continue;
      await regular(file.source);await regular(join(plan.target,file.path));
      if(await hash(file.source)!==file.sha256||await hash(join(plan.target,file.path))!==file.sha256)throw new Error('文件已更改');
      await unlink(file.source);
      let folder=dirname(file.source);while(within(plan.oldIndex.systemDirectory,folder)){empty.push(folder);if(folder===plan.oldIndex.systemDirectory)break;folder=dirname(folder);}
    }catch{remaining.push(file.source);}
  }
  await removeEmpty(empty);
  return remaining;
}
export async function recoverWorkspaceMove(store) {
  const journal=join(store.profile,'workspace-move.json'),plan=await readJSON(journal,null);
  if(!plan)return null;
  validateJournal(plan,store.index);
  if(await realpath(plan.target)!==plan.target)throw new Error('迁移目标已被重定向。');
  let keepIncomplete=false;
  if(plan.phase==='copying') {
    // Interrupted before commit: only discard our exact, verified new copies.
    const empty=[];
    for(const file of plan.files){const path=join(plan.target,file.path);if(!await exists(path))continue;await regular(path);if(await hash(path)!==file.sha256){keepIncomplete=true;continue;}await unlink(path);let folder=dirname(path);while(folder!==plan.target&&within(plan.target,folder)){empty.push(folder);folder=dirname(folder);}}
    empty.push(...entries(plan.nextIndex).map(entry=>entry.directory),plan.nextIndex.systemDirectory);
    await removeEmpty(empty);
    if(keepIncomplete)await atomicJSON(join(store.profile,'last-workspace-move.json'),{rolledBack:true,directory:plan.oldIndex.directory,incompleteDirectory:plan.target,remainingOldPaths:[]});
  } else {
    if(!same(store.index,plan.nextIndex)){await verifyFiles(plan,true);await store.persist(plan.nextIndex);}
    plan.phase='cleanup';await atomicJSON(journal,plan);
    store.lastMove={...plan.summary,remainingOldPaths:await cleanupSources(store,plan)};
    store.discovered=true;store.scans.clear();store.fileSnapshots.clear();
    await atomicJSON(join(store.profile,'last-workspace-move.json'),store.lastMove);
  }
  const marker=join(plan.target,'.candlelight-incomplete');
  if(await exists(marker)){await regular(marker);if(await readFile(marker,'utf8')!==plan.id)throw new Error('迁移目录标记不一致，已保留。');if(!keepIncomplete)await unlink(marker);}
  await unlink(journal);return store.lastMove;
}
export async function moveWorkspace(store,plan) {
  if(Date.now()-plan.createdAt>600000||!same(store.index,plan.oldIndex))throw new Error('资料库已变化，请重新预览迁移。');
  await emptyDirectory(plan.target);await verifyFiles(plan);
  if(await realpath(plan.target)!==plan.target)throw new Error('迁移目标已被重定向。');
  const journal=join(store.profile,'workspace-move.json');
  await atomicJSON(journal,{...plan,phase:'copying'});
  try {
    await writeFile(join(plan.target,'.candlelight-incomplete'),plan.id,{flag:'wx'});
    await mkdir(plan.nextIndex.systemDirectory,{recursive:true});
    for(const entry of entries(plan.nextIndex))await mkdir(entry.directory,{recursive:true});
    for(const file of plan.files){const destination=join(plan.target,file.path);await mkdir(dirname(destination),{recursive:true});if(await realpath(dirname(destination))!==dirname(destination))throw new Error('迁移目标子目录已被重定向。');await copyFile(file.source,destination,1);}
    await verifyFiles(plan,true);await verifyFiles(plan);
    await atomicJSON(journal,{...plan,phase:'committing'});
  }catch(error){await recoverWorkspaceMove(store);throw error;}
  return recoverWorkspaceMove(store);
}
