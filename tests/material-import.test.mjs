import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMaterial } from '../server/material-import.mjs';
import { parseMaterialInWorker } from '../server/material-worker.mjs';
import { docxFixture, pptxFixture, htmlFixture, zipFixture } from './support/office-fixtures.mjs';
import { FileLibrary } from '../server/file-library.mjs';
import { createDemo } from '../src/demo.ts';
import { startTestServer } from './support/server.mjs';
const input=(name,bytes)=>({name,data:bytes.toString('base64')});
test('Word preserves authored headings, Chinese, table cells and common Office math',async()=>{
  const result=await parseMaterial(input('讲义.docx',docxFixture()));
  assert.equal(result.sections.length,2);assert.equal(result.sections[0].title,'中文概率讲义');assert.equal(result.sections[1].title,'方差');
  assert.ok(result.sections[0].text.includes('\\frac{1}{n}{x}^{2}'));assert.ok(result.sections[0].text.includes('统计量\n\n均值'));assert.ok(result.warnings.some(w=>w.includes('表格')));
});
test('HTML reads semantic text without scripts, navigation or external fetch; plain links and table values survive',async()=>{
  const result=await parseMaterial(input('lesson.htm',htmlFixture())),text=result.sections.map(s=>s.text).join('\n');
  assert.deepEqual(result.sections.map(s=>s.title),['概率入门','期望']);assert.ok(text.includes('0.5'));assert.ok(text.includes('只有链接文字'));assert.ok(text.includes('分布图'));
  assert.ok(!text.includes('UNWANTED'));assert.ok(!text.includes('fetch('));assert.equal(globalThis.importExecuted,undefined);assert.ok(result.warnings.length);
});
test('HTML exercises retain form questions, answer choices, numbering and inert MathJax without executing controls',async()=>{
  const html=String.raw`<title>原创练习</title><main><h1>练习</h1><form action="https://invalid.example/submit"><fieldset><legend>题一：计算平均数</legend><p>观测为 2、4、6。</p><label><input type="radio" name="q">A. 4</label><label><input type="radio" name="q">B. 6</label><input type="hidden" value="SECRET_TOKEN"><button>SUBMIT_BUTTON</button><select><option>选择理由</option><option>总和除以个数</option></select></fieldset><ol start="3"><li>求 <script type="math/tex">x^2</script>。</li><li value="7">写出公式 <script type="math/tex; mode=display">\bar{x}=\frac{1}{n}\sum_i x_i</script></li><li>说明条件。</li></ol></form><script>globalThis.quizExecuted=true;fetch('https://invalid.example')</script></main>`;
  const result=await parseMaterial(input('quiz.html',Buffer.from(html))),text=result.sections.map(s=>s.text).join('\n');
  for(const value of ['题一：计算平均数','观测为 2、4、6','A. 4','B. 6','总和除以个数',String.raw`3. 求 \(x^2\)`,String.raw`7. 写出公式 \[\bar{x}`, '8. 说明条件'])assert.ok(text.includes(value),value);
  assert.doesNotMatch(text,/SECRET_TOKEN|SUBMIT_BUTTON|quizExecuted|fetch\(/);assert.equal(globalThis.quizExecuted,undefined);
  assert.ok(result.warnings.some(w=>w.includes('静态题干')));
});
test('PowerPoint follows presentation relationship order rather than slide file numbers',async()=>{
  const result=await parseMaterial(input('lecture.pptx',pptxFixture()));assert.equal(result.sections.length,2);assert.match(result.sections[0].title,/第一张/);assert.match(result.sections[1].title,/第二张/);assert.ok(result.warnings.length);
});
test('parser rejects binary DOC, corrupt archives, unsafe paths, XML entities and decompression over budget',async()=>{
  await assert.rejects(parseMaterial(input('legacy.doc',docxFixture())),/旧版/);
  await assert.rejects(parseMaterial(input('bad.docx',Buffer.from('not a zip'))));
  await assert.rejects(parseMaterial(input('unsafe.docx',zipFixture({'../word/document.xml':'anything'}))));
  await assert.rejects(parseMaterial(input('entity.docx',zipFixture({'word/document.xml':'<!DOCTYPE a [<!ENTITY e SYSTEM "file:///secret">]><a>&e;</a>'}))),/XML/);
  await assert.rejects(parseMaterial(input('large.docx',zipFixture({'word/document.xml':'x'.repeat(17*1024**2)}))),/过大/);
  await assert.rejects(parseMaterial(input('empty.html',Buffer.from('<script>nothing</script>'))),/正文/);
});
test('worker can finish and can be cancelled without leaving a parsing process',async()=>{
  assert.equal((await parseMaterialInWorker(input('lecture.docx',docxFixture()))).sections.length,2);
  await assert.rejects(parseMaterialInWorker(input('lecture.docx',docxFixture()),AbortSignal.abort()),/取消/);
});
test('parse HTTP boundary requires session token, needs no model key and never persists imported files',async t=>{
  const server=await startTestServer();t.after(()=>server.stop());const config=await (await fetch(server.base+'/api/config')).json();
  const send=token=>fetch(server.base+'/api/import/material',{method:'POST',headers:{'content-type':'application/json',...(token?{'x-reading-tree-token':token}:{})},body:JSON.stringify(input('lecture.docx',docxFixture()))});
  assert.equal((await send()).status,403);const response=await send(config.token);assert.equal(response.status,200);assert.equal((await response.json()).sections.length,2);
});
test('new original formats survive discovery, full backup, relocation and source restoration byte-for-byte',async t=>{
  const root=await mkdtemp(join(await realpath(tmpdir()),'candlelight-formats-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const options={profile:join(root,'profile'),defaultDirectory:join(root,'library')},store=new FileLibrary(options),originals=[['docx',docxFixture()],['pptx',pptxFixture()],['html',htmlFixture()]];
  for(const [ext,bytes] of originals)await store.command({action:'import',document:{...createDemo(),demo:false,library:undefined,id:ext,kind:'text',filename:'lecture.'+ext,sourceWarnings:['Test extraction notice']},source:input('lecture.'+ext,bytes)});
  const other=new FileLibrary({...options,profile:join(root,'other')});assert.equal((await other.command({action:'list'})).length,3);
  for(const [ext,bytes] of originals){assert.deepEqual((await store.command({action:'file',id:ext})).data,bytes);assert.equal((await store.command({action:'list'})).find(d=>d.id===ext).sourceWarnings[0],'Test extraction notice');}
  const backup=await store.command({action:'workspace-backup',directory:join(root,'backups')});
  const preview=await store.command({action:'workspace-preview',directory:backup.directory});assert.equal(preview.documents,3);
  const recovery=new FileLibrary({profile:join(root,'recovery-profile'),defaultDirectory:join(root,'recovery')});
  const recoveryPreview=await recovery.command({action:'workspace-preview',directory:backup.directory});await recovery.command({action:'workspace-restore',previewId:recoveryPreview.id,directory:join(root,'restored'),confirm:true});
  for(const [ext,bytes] of originals)assert.deepEqual((await recovery.command({action:'file',id:ext})).data,bytes);
  const move=await store.command({action:'workspace-move-preview',directory:join(root,'moved')});await store.command({action:'workspace-move',previewId:move.id,confirm:true});
  for(const [ext,bytes] of originals)assert.deepEqual((await store.command({action:'file',id:ext})).data,bytes);
  const entry=store.index.entries.find(e=>e.id==='docx');await unlink(entry.sourcePath);assert.ok((await store.command({action:'inspect',id:'docx'})).missing.length);
  await assert.rejects(store.command({action:'source-restore',id:'docx',source:input('wrong.txt',Buffer.from('WRONG'))}),/相同格式/);
  await store.command({action:'source-restore',id:'docx',source:input('lecture.docx',docxFixture())});assert.deepEqual(await readFile(entry.sourcePath),docxFixture());
  await store.command({action:'import',document:{...createDemo(),demo:false,library:undefined,id:'backup-only',kind:'text',filename:'missing.docx'},source:input('backup.json',Buffer.from('{}'))});
  const missing=store.index.entries.find(e=>e.id==='backup-only');assert.ok(missing.sourcePath.endsWith('source.docx'));assert.equal((await store.command({action:'inspect',id:missing.id})).missing.length,1);
});
