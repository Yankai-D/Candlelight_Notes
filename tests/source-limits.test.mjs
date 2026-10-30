import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { captureBundleContext, createBundleNote, bundlePlanRequest } from '../shared/bundle-context.mjs';
import { storedDocumentSchema, restoreBackup } from '../shared/backup.mjs';
import { requestSchema, buildMessages, validateResult } from '../server/harness.mjs';
import { FileLibrary } from '../server/file-library.mjs';
import { createResearchTools } from '../server/ideal-tree/research.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use PDF.js's real Node renderer and worker; only the bundler URL import is
// resolved here. The actual importMaterial function and PDF bytes are tested.
const hooks = registerHooks({resolve(specifier, context, next) {
  if(specifier === 'pdfjs-dist') return next('pdfjs-dist/legacy/build/pdf.mjs',context);
  if(specifier.endsWith('pdf.worker.min.mjs?url')) {
    const worker = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return {url:'data:text/javascript,'+encodeURIComponent(`export default ${JSON.stringify(worker)}`),shortCircuit:true};
  }
  return next(specifier,context);
}});
const {importMaterial}=await import('../src/pdf.ts');
hooks.deregister();

test('a 2000-page PDF imports, persists and restores every page; 2001 pages are rejected',async t=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let n=1;n<=2000;n++)pdf.addPage([300,400]).drawText(`Source page ${n}. This is authored boundary test material.`,{font,x:15,y:350,size:8});
  const bytes=await pdf.save(),progress=[];
  const document=await importMaterial(new File([bytes],'boundary.pdf'),'看懂这篇文章',message=>progress.push(message));
  assert.equal(document.pages.length,2000);assert.ok(document.pages.at(-1).text.includes('Source page 2000.'));
  assert.ok(document.chapters.length<=300);
  assert.deepEqual(document.chapters.flatMap(chapter=>chapter.sourcePages),Array.from({length:2000},(_,i)=>i+1));
  assert.ok(progress.at(-1).includes('2000 / 2000'));
  storedDocumentSchema.parse(document);
  assert.deepEqual(restoreBackup(JSON.stringify({format:'reading-tree-v1',document})).pages,document.pages);
  const root=await mkdtemp(join(tmpdir(),'candlelight-page-limit-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new FileLibrary({profile:join(root,'profile'),defaultDirectory:join(root,'library')});
  await store.command({action:'import',document,source:{name:'boundary.pdf',data:Buffer.from(bytes).toString('base64')}});
  assert.equal((await store.command({action:'list'}))[0].pages.length,2000);
  assert.deepEqual((await store.command({action:'file',id:document.id})).data,Buffer.from(bytes));
  let researchBytes=bytes;
  const research=createResearchTools(join(root,'research'),{read:async url=>({url,type:'application/pdf',bytes:Buffer.from(researchBytes)})});
  const source=await research.read('https://example.test/boundary.pdf');
  assert.match(source.text,/\[p\.2000\]/);
  assert.equal((await research.asset(source)).data,Buffer.from(bytes).toString('base64'));
  pdf.addPage();
  researchBytes=await pdf.save();
  await assert.rejects(importMaterial(new File([researchBytes],'over-limit.pdf'),'看懂这篇文章',()=>{}),/2,000/);
  await assert.rejects(research.read('https://example.test/over-limit.pdf'),/2000/);
});

test('nested bundle notes accept 2000 total pages through planning, generation contracts and backup',()=>{
  const material=(id,count)=>({id,title:id,subtitle:'',filename:`${id}.txt`,kind:'text',intent:'看懂这篇文章',createdAt:1,updatedAt:1,revision:0,versions:[],currentChapter:`${id}-c`,currentPage:1,
    pages:Array.from({length:count},(_,i)=>({number:i+1,text:`Evidence for ${id} page ${i+1}.`})),
    chapters:[{id:`${id}-c`,title:'Sources',sourcePages:Array.from({length:count},(_,i)=>i+1),status:'empty',content:{type:'doc',content:[]}}]});
  const collection={version:1,folders:[{id:'course',name:'Course',kind:'bundle'},{id:'unit',name:'Unit',kind:'bundle',parentId:'course'}],items:{a:{folderId:'course'},b:{folderId:'unit'}}};
  const documents=[material('a',1001),material('b',999)];
  const context=captureBundleContext(documents,collection,'course');
  const note=createBundleNote(context,'Review');storedDocumentSchema.parse(note);
  assert.deepEqual(bundlePlanRequest(note).units.flatMap(unit=>unit.pages),note.pages.map(page=>page.number));
  assert.equal(note.pages[1001].sourcePage,1);assert.equal(note.pages.at(-1).sourcePage,999);
  assert.deepEqual(restoreBackup(JSON.stringify({format:'reading-tree-v1',document:note})).pages,note.pages);
  const request={action:'generate',scope:'chapter',instruction:'整理知识点',revision:0,documentId:note.id,chapterId:note.currentChapter,document:note,learning:{mode:'translation'}};
  requestSchema.parse(request);buildMessages(request);
  const result=validateResult(request,{blocks:[{type:'paragraph',text:'来源定位保留最后一页。',sourcePages:[2000],sourceQuote:''}]});
  assert.deepEqual(result.blocks[0].sourcePages,[2000]);
  assert.throws(()=>captureBundleContext([material('a',1001),material('b',1000)],collection,'course'),/2000/);
});
