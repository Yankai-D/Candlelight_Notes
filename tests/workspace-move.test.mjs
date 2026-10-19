import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, readFile, writeFile, copyFile, rm, readdir, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { FileLibrary } from '../server/file-library.mjs';
import { previewWorkspaceMove } from '../server/workspace-move.mjs';
import { createDemo } from '../src/demo.ts';

async function fixture(t) {
  const root=await mkdtemp(join(await realpath(tmpdir()),'candlelight-move-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const options={profile:join(root,'profile'),defaultDirectory:join(root,'library')},store=new FileLibrary(options);
  const doc={...createDemo(),id:'move-note',kind:'pdf',demo:false,library:undefined,filename:'original.pdf'};
  await store.command({action:'import',document:doc,source:{name:'original.pdf',data:Buffer.from('%PDF-1.7\nORIGINAL').toString('base64')}});
  const entry=store.index.entries[0],system=store.index.systemDirectory;
  const tree='10000000-0000-4000-8000-000000000001.json';
  await mkdir(join(system,'ideal-trees/assets'),{recursive:true});
  await writeFile(join(system,'ideal-trees',tree),'original tree');
  await writeFile(join(system,'ideal-trees/assets/S'+'a'.repeat(22)+'.pdf'),'%PDF-1.7\nasset');
  await mkdir(join(system,'generation-records',doc.id),{recursive:true});await writeFile(join(system,'generation-records',doc.id,tree),'generation record');
  await store.command({action:'preference-set',key:'collection',value:{folders:[{id:'math',name:'Math'}]}});
  await writeFile(join(options.profile,'.env'),'DEEPSEEK_API_KEY=LOCAL_CANARY');
  return {root,options,store,doc,entry,system,tree,target:join(root,'new-location'),command:cmd=>store.command(cmd)};
}

test('unified migration verifies notes, original PDF, retired files, trees and records, then removes managed old copies',async t=>{
  const f=await fixture(t),before=await readFile(f.entry.notePath);
  await f.command({action:'import',document:{...f.doc,id:'retired'},source:{name:'other.pdf',data:Buffer.from('%PDF-1.7\nretired').toString('base64')}});
  await f.command({action:'retire',id:'retired',mode:'trash'});
  const unrelated=join(f.options.defaultDirectory,'my-unrelated-file.txt');await writeFile(unrelated,'KEEP');
  const preview=await f.command({action:'workspace-move-preview',directory:f.target});assert.equal(preview.documents,1);assert.equal(preview.retired,1);assert.equal(preview.files,7);
  await assert.rejects(f.command({action:'workspace-move',previewId:preview.id}),/预览并确认/);
  const result=await f.command({action:'workspace-move',previewId:preview.id,confirm:true});assert.deepEqual(result.remainingOldPaths,[]);
  const next=f.store.index.entries[0];assert.deepEqual(await readFile(next.notePath),before);assert.equal(await readFile(next.sourcePath,'utf8'),'%PDF-1.7\nORIGINAL');
  await assert.rejects(readFile(f.entry.notePath),{code:'ENOENT'});await assert.rejects(readFile(f.entry.sourcePath),{code:'ENOENT'});
  assert.equal(await readFile(unrelated,'utf8'),'KEEP');assert.equal(await readFile(join(f.store.index.systemDirectory,'ideal-trees',f.tree),'utf8'),'original tree');
  await assert.rejects(readFile(join(f.target,'.env')),{code:'ENOENT'});assert.equal(await readFile(join(f.options.profile,'.env'),'utf8'),'DEEPSEEK_API_KEY=LOCAL_CANARY');
  const restarted=new FileLibrary(f.options);assert.equal((await restarted.command({action:'status'})).directory,f.target);
  assert.equal((await restarted.command({action:'list'}))[0].storageIssue,undefined);
  assert.equal((await restarted.command({action:'retired-list'})).length,1);
  assert.deepEqual(await restarted.command({action:'preference-get',key:'collection'}),{folders:[{id:'math',name:'Math'}]});
  const separate=new FileLibrary({...f.options,profile:join(f.root,'other-install'),defaultDirectory:f.target});assert.equal((await separate.command({action:'list'}))[0].storageIssue,undefined);
});

test('migration refuses populated destinations, overlap, links and changed sources without altering old data',async t=>{
  const f=await fixture(t);await mkdir(f.target);await writeFile(join(f.target,'keep.txt'),'KEEP');
  await assert.rejects(f.command({action:'workspace-move-preview',directory:f.target}),/空文件夹/);
  await assert.rejects(f.command({action:'workspace-move-preview',directory:join(f.entry.directory,'inside')}),/相互包含/);
  const target=join(f.root,'empty'),preview=await f.command({action:'workspace-move-preview',directory:target});
  await writeFile(f.entry.sourcePath,'%PDF-1.7\nUPDATED');
  await assert.rejects(f.command({action:'workspace-move',previewId:preview.id,confirm:true}),/变化|校验/);
  assert.equal(f.store.index.directory,f.options.defaultDirectory);assert.equal(await readFile(f.entry.sourcePath,'utf8'),'%PDF-1.7\nUPDATED');
  assert.deepEqual(await readdir(target),[]);
  await symlink(f.entry.directory,join(f.system,'ideal-trees','link'),'junction');
  await assert.rejects(f.command({action:'workspace-move-preview',directory:target}),/未知文件/);
});

test('migration rejects a stale preview after notes or library membership change',async t=>{
  const f=await fixture(t),preview=await f.command({action:'workspace-move-preview',directory:f.target});
  await f.command({action:'save',document:{...f.doc,title:'Updated note'}});
  await assert.rejects(f.command({action:'workspace-move',previewId:preview.id,confirm:true}),/变化/);
  assert.equal(JSON.parse(await readFile(f.entry.notePath)).title,'Updated note');
});

async function checkpoint(f,phase) {
  const plan=await previewWorkspaceMove(f.store,f.target);
  for(const file of plan.files){const dest=join(plan.target,file.path);await mkdir(dirname(dest),{recursive:true});await copyFile(file.source,dest);}
  await writeFile(join(plan.target,'.candlelight-incomplete'),plan.id);
  await writeFile(join(f.options.profile,'workspace-move.json'),JSON.stringify({...plan,phase}));return plan;
}
test('restart before commit rolls back verified new copies and keeps the original workspace',async t=>{
  const f=await fixture(t);await checkpoint(f,'copying');
  const restarted=new FileLibrary(f.options);assert.equal((await restarted.command({action:'status'})).directory,f.options.defaultDirectory);
  assert.ok(await readFile(f.entry.notePath));assert.deepEqual(await readdir(f.target),[]);
});
test('a partially copied file after a crash is retained separately without blocking the original library',async t=>{
  const f=await fixture(t),plan=await checkpoint(f,'copying');
  await writeFile(join(plan.target,plan.files[0].path),'partial copy');
  const restarted=new FileLibrary(f.options);assert.equal((await restarted.command({action:'status'})).directory,f.options.defaultDirectory);
  assert.ok(await readFile(f.entry.notePath));assert.equal((await restarted.command({action:'list'}))[0].storageIssue,undefined);
  assert.equal(await readFile(join(plan.target,plan.files[0].path),'utf8'),'partial copy');
  assert.ok(await readFile(join(plan.target,'.candlelight-incomplete')));
});
test('restart after durable commit intent finishes relocation and preserves file bytes',async t=>{
  const f=await fixture(t),plan=await checkpoint(f,'committing'),before=await readFile(f.entry.notePath);
  const restarted=new FileLibrary(f.options);assert.equal((await restarted.command({action:'status'})).directory,f.target);
  assert.deepEqual(await readFile(plan.nextIndex.entries[0].notePath),before);await assert.rejects(readFile(f.entry.sourcePath),{code:'ENOENT'});
  assert.equal((await restarted.command({action:'list'}))[0].storageIssue,undefined);
});
test('cleanup keeps an old copy changed by another application after the migration snapshot',async t=>{
  const f=await fixture(t),plan=await checkpoint(f,'cleanup');
  await writeFile(join(f.options.profile,'library-index.json'),JSON.stringify(plan.nextIndex));
  await writeFile(f.entry.notePath,JSON.stringify({...f.doc,title:'External later edit'}));
  const restarted=new FileLibrary(f.options);await restarted.command({action:'status'});
  assert.equal(JSON.parse(await readFile(f.entry.notePath)).title,'External later edit');assert.ok(await readFile(f.entry.sourcePath));
  const result=JSON.parse(await readFile(join(f.options.profile,'last-workspace-move.json')));assert.deepEqual(result.remainingOldPaths,[f.entry.directory]);
});
