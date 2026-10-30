import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { testBrowser } from '../support/browser.mjs';
import { completeOnboarding } from '../support/onboarding.mjs';
import { captureBundleContext, createBundleNote } from '../../shared/bundle-context.mjs';
import { paragraph } from '../../shared/document.mjs';

const base=process.env.PANGZHU_TEST_URL,output=process.env.PANGZHU_TEST_OUTPUT;
if(!base||!output)throw new Error('Run with an isolated test server.');
await mkdir(output,{recursive:true});
const longTitle='从假设检验到方差分析：适用条件、操作流程、例题与课内变体的系统复习—'+'LongUnbrokenChapterTitle'.repeat(12);
const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
for(let n=1;n<=6;n++)pdf.addPage([400,550]).drawText(`Original source page ${n}. A complete synthetic example.`,{font,x:20,y:500,size:10});
const pdfData=Buffer.from(await pdf.save()).toString('base64');
const material=id=>({id,title:`${id} ${longTitle}`,subtitle:'Synthetic source',filename:`${id}.pdf`,kind:'pdf',intent:'看懂这篇文章',createdAt:1,updatedAt:1,revision:0,currentPage:1,currentChapter:`${id}-1`,versions:[],
  pages:Array.from({length:6},(_,i)=>({number:i+1,text:`Original source page ${i+1}. A complete synthetic example.`})),
  chapters:Array.from({length:6},(_,i)=>({id:`${id}-${i+1}`,title:`${i+1}. ${longTitle}`,sourcePages:[i+1],status:'ready',content:{type:'doc',content:[paragraph('阅读笔记中的完整讲解。'.repeat(35))]}}))});
const sources=[material('source-a'),material('source-b')];
const collection={version:1,folders:[{id:'final',name:'期末复习',kind:'bundle'},{id:'math',name:'数学',kind:'bundle',parentId:'final'}],items:{'source-a':{folderId:'final',status:'imported',inTree:false},'source-b':{folderId:'math',status:'imported',inTree:false}}};
const note=createBundleNote(captureBundleContext(sources,collection,'final'),'期末复习讲义 '+longTitle);
note.chapters=Array.from({length:6},(_,i)=>({id:`note-${i+1}`,title:`${i+1}. ${longTitle}`,subtitle:longTitle,sourcePages:[i*2+1,i*2+2],status:'ready',content:{type:'doc',content:[paragraph('先识别问题的条件，再选择方法并检查结果。'.repeat(40))]}}));
note.currentChapter='note-1';note.composition.planned=true;note.noteFormatVersion=1;
collection.items[note.id]={folderId:null,status:'studying',inTree:false};
const documents=[note,...sources],browser=await testBrowser(),page=await browser.newPage(),errors=[],unexpected=[],checks=[];
try {
  await page.setViewport({width:1440,height:900});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
  page.on('request',request=>{
    const url=request.url(),json=value=>void request.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
    if(url===base+'/sidebar-seed')return void request.respond({status:200,contentType:'text/html',body:'<!doctype html><body></body>'});
    if(url.endsWith('/api/config'))return json({configured:false,token:'fixture',model:'offline'});
    if(url.endsWith('/api/library'))return json({documents});
    if(url.includes('/api/')){unexpected.push(url);return void request.abort();}
    if(!url.startsWith(base+'/'))return void request.abort();
    void request.continue();
  });
  await page.goto(base+'/sidebar-seed');
  await page.evaluate(async({collection,pdfData,ids})=>{
    const db=await new Promise(resolve=>{const q=indexedDB.open('reading-tree',1);q.onupgradeneeded=()=>{q.result.createObjectStore('documents',{keyPath:'id'});q.result.createObjectStore('files');q.result.createObjectStore('preferences');};q.onsuccess=()=>resolve(q.result);});
    const bytes=Uint8Array.from(atob(pdfData),char=>char.charCodeAt(0));
    await new Promise(resolve=>{const tx=db.transaction(['preferences','files'],'readwrite');tx.objectStore('preferences').put(collection,'collection');for(const id of ids)tx.objectStore('files').put(new Blob([bytes],{type:'application/pdf'}),id);tx.oncomplete=resolve;});db.close();
  },{collection,pdfData,ids:sources.map(source=>source.id)});
  await page.goto(base+'/',{waitUntil:'networkidle0'});await completeOnboarding(page);
  async function open(title){
    await page.waitForSelector('.collection-document');
    for(const button of await page.$$('.collection-document'))if(await button.evaluate((el,title)=>el.getAttribute('aria-label')===`打开 ${title}`,title)){await button.click();break;}
    await page.waitForSelector('.reading-route');
    await page.waitForFunction(()=>!!document.querySelector('.sidebar-source canvas')?.width);
  }
  async function fitted(kind,size){
    await page.setViewport(size);
    if(size.width<=780){const hidden=await page.$eval('.study-sidebar',el=>getComputedStyle(el).visibility==='hidden');if(hidden)await page.click('[aria-label="展开章节导航"]');}
    await page.waitForFunction(()=>{const viewport=document.querySelector('.sidebar-source .source-context-viewport'),canvas=viewport?.querySelector('canvas');return canvas&&canvas.getBoundingClientRect().width<=viewport.clientWidth+1;});
    const result=await page.evaluate(()=>{
      const side=document.querySelector('.study-sidebar'),rect=side.getBoundingClientRect(),style=getComputedStyle(side),right=rect.right-parseFloat(style.paddingRight)-parseFloat(style.borderRightWidth),left=rect.left+parseFloat(style.paddingLeft),issues=[];
      for(const selector of ['.document-meta','.reading-route','.sidebar-source','.bundle-source-reader','.source-context-viewport','.page-controls','.source-heading','select[aria-label="选择参考原文"]','.chapter-link','.chapter-label'])for(const el of side.querySelectorAll(selector)){
        const box=el.getBoundingClientRect(),slack=selector==='.chapter-link'?10:1;
        if(box.right>right+slack||box.left<left-slack||box.bottom>rect.bottom+1)issues.push({selector,right:box.right,left:box.left,bottom:box.bottom,limit:right});
      }
      const title=side.querySelector('.chapter-label>span'),source=side.querySelector('.source-context-viewport');
      const article=document.querySelector('.article-scroll');
      return {issues,sidebarOverflow:side.scrollWidth>side.clientWidth+1,sidebarScroll:side.scrollHeight>side.clientHeight+1,sourceOverflow:source.scrollWidth>source.clientWidth+1,articleOverflow:article.scrollWidth>article.clientWidth+1,titleEllipsis:getComputedStyle(title).textOverflow,titleTruncated:title.scrollWidth>title.clientWidth,fullTitle:title.closest('button').title,sourceWidth:source.clientWidth};
    });
    await page.screenshot({path:`${output}/${kind}-${size.width}.png`});
    assert.deepEqual(result.issues,[],`${kind} ${size.width}: all modules must fit`);
    assert.equal(result.sidebarOverflow,false);assert.equal(result.sidebarScroll,false);assert.equal(result.sourceOverflow,false);
    assert.equal(result.articleOverflow,false);
    assert.equal(result.titleEllipsis,'ellipsis');assert.equal(result.titleTruncated,true);assert.ok(result.fullTitle.includes('LongUnbrokenChapterTitle'));
    checks.push({kind,...size,...result});
  }
  await open(note.title);
  for(const size of [{width:1920,height:1080},{width:1440,height:900},{width:1280,height:720},{width:1000,height:700},{width:390,height:844}])await fitted('bundle',size);
  await page.setViewport({width:1440,height:900});await page.select('select[aria-label="选择参考原文"]','source-b');
  await page.waitForSelector('.sidebar-source canvas');await fitted('bundle-other-source',{width:1440,height:900});
  await page.select('select[aria-label="跳转到章节"]','note-6');
  await page.waitForFunction(()=>document.querySelector('.chapter-link.current')?.title.startsWith('6.'));
  await fitted('bundle-last-chapter',{width:1280,height:720});
  await page.click('[aria-label="展开原文"]');await page.waitForSelector('.source-modal-content .source-context-viewport');
  assert.equal(await page.$eval('dialog',el=>el.scrollWidth>el.clientWidth+1),false);await page.click('dialog [aria-label="关闭弹窗"]');
  await page.click('[aria-label="资料库"]');
  // Also verify an ordinary paper with equally long chapter titles.
  for(const button of await page.$$('.collection-folder-link'))if(await button.evaluate(el=>el.textContent.includes('期末复习'))){await button.click();break;}
  await open(sources[0].title);await fitted('paper',{width:1280,height:720});
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  await writeFile(`${output}/report.json`,JSON.stringify({passed:true,checks,actualModelCalls:0},null,2));
  console.log(JSON.stringify({passed:true,checks:checks.length,actualModelCalls:0,output}));
} finally {await browser.close();}
