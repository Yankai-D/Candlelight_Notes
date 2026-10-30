import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {testBrowser} from '../support/browser.mjs';
import {startTestServer} from '../support/server.mjs';
import {completeOnboarding} from '../support/onboarding.mjs';
import {PDFDocument} from 'pdf-lib';

const output=process.env.PANGZHU_TEST_OUTPUT;if(!output)throw new Error('Missing output directory');await mkdir(output,{recursive:true});
const server=await startTestServer({READING_TREE_FILE_STORAGE:'1'}),browser=await testBrowser(),page=await browser.newPage();
const errors=[],calls=[];let failCollection=false,holdImport;
try{
 await page.evaluateOnNewDocument(()=>{window.pangzhuDesktop={onCloseRequest:handler=>{window.testCloseHandler=handler;return()=>{}},chooseLibraryDirectory:async()=>undefined}});
 await page.setViewport({width:1440,height:960});page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',request=>{
  const url=new URL(request.url());if(url.origin!==server.base)return void request.abort();
  if(['/api/edit','/api/import/material'].includes(url.pathname)){calls.push(url.pathname);return void request.abort()}
  if(holdImport&&url.pathname==='/api/storage'&&JSON.parse(request.postData()||'{}').action==='import'){const hold=holdImport;holdImport=null;hold(request);return}
  if(failCollection&&url.pathname==='/api/storage'){
   const body=JSON.parse(request.postData()||'{}');
   if(body.action==='preference-set'&&body.key==='collection'){failCollection=false;return void request.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Injected collection failure'})})}
  }
  void request.continue();
 });
 const click=async text=>{for(const button of await page.$$('button'))if(await button.evaluate((e,t)=>e.textContent.trim()===t,text)){await button.click();return}throw new Error('Button not found: '+text)};
 const index=async()=>JSON.parse(await readFile(join(server.directory,'profile/library-index.json'),'utf8'));
 const documents=async()=>Promise.all((await index()).entries.map(async entry=>JSON.parse(await readFile(entry.notePath,'utf8'))));
 const folder=async name=>{if(name==='数学')await(await page.$('[aria-label="展开文件夹 期末复习"]'))?.click();for(const button of await page.$$('.collection-folder-link'))if(await button.evaluate((e,n)=>e.querySelector('span')?.textContent===n,name)){await button.click();break}await page.waitForFunction(name=>document.querySelector('.collection-title h1')?.textContent===name,{},name)};
 await page.goto(server.base);await completeOnboarding(page);
 const root=join(server.directory,'期末复习'),math=join(root,'数学');
 for(let i=0;i<30;i++){
  const unit=join(math,`单元${Math.floor(i/10)+1}`);await mkdir(unit,{recursive:true});
  const text=`Original source ${i}. A derivative measures the local rate of change, computed using the limit of a difference quotient.`;
  if(i===0){const pdf=await PDFDocument.create();pdf.addPage().drawText(text,{x:30,y:700,size:9});await writeFile(join(unit,'lecture-0.pdf'),await pdf.save())}
  else await writeFile(join(unit,`lecture-${i}.txt`),`# Lesson ${i}\n${text}`);
 }
 await writeFile(join(math,'attachment.png'),'ignored auxiliary file');
 await click('导入资料');await page.waitForSelector('input[webkitdirectory]');await (await page.$('input[webkitdirectory]')).uploadFile(root);
 await page.waitForFunction(()=>document.querySelectorAll('.batch-import-entry').length===30);
 assert.equal(await page.$eval('input[name="import-policy"]',e=>e.checked),true);
 await page.mouse.click(2,2);await page.keyboard.press('Escape');assert.ok(await page.$('.import-form'));
 await page.keyboard.press('F1');await page.evaluate(()=>window.dispatchEvent(new Event('pangzhu:help')));assert.ok(await page.$('.import-form'),'Help shortcuts must preserve the import form');
 await page.screenshot({path:join(output,'batch-preview.png'),fullPage:true});
 await page.setViewport({width:390,height:844});assert.ok(await page.$eval('dialog',e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:join(output,'batch-mobile.png'),fullPage:true});await page.setViewport({width:1440,height:960});
 failCollection=true;await click('添加到资料库');await page.waitForFunction(()=>document.querySelectorAll('.batch-import-entry.done').length===29,{timeout:60000});
 assert.equal((await index()).entries.length,30,'The original committed before the injected collection failure');
 await click('重试未完成文件');await page.waitForSelector('.import-form',{hidden:true});assert.equal((await index()).entries.length,30,'Retry must not duplicate originals');
 let stored=await documents();assert.ok(stored.every(d=>d.sourceState==='deferred'&&d.readingPolicy==='manual'&&d.chapters.every(c=>c.status==='empty')));assert.equal(calls.length,0);
 await folder('数学');assert.equal((await page.$$('.nested-folders>button:not(.new-nested-folder)')).length,3);
 for(const [title,intent] of [['复习讲义','整理全部知识与推导'],['例题与讲解','保留原题，给出简洁思路和解法']]){
  await click('新建笔记');await page.waitForSelector('[aria-label="笔记名称"]');await page.type('[aria-label="笔记名称"]',title);
  await page.$eval('[aria-label="整理要求"]',(element,text)=>{const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(element,text);element.dispatchEvent(new Event('input',{bubbles:true}))},intent);
  assert.match(await page.$eval('.bundle-source-inventory summary',e=>e.textContent),/30 份/);await click('创建并打开笔记');
  await page.waitForSelector('[aria-label="资料与笔记保存位置"]');await click('确认保存位置');await page.waitForSelector('.preparation-banner',{timeout:60000});
  await page.click('[aria-label="资料库"]');await folder('数学');
 }
 stored=await documents();const notes=stored.filter(d=>d.entryType==='note'),sources=stored.filter(d=>d.entryType!=='note');
 assert.equal(notes.length,2);assert.ok(notes.every(note=>note.sourceContext.sources.length===30));
 assert.ok(sources.every(d=>d.sourceState==='ready'&&d.chapters.every(c=>c.status==='empty')));
 assert.equal(calls.length,0);assert.deepEqual(errors,[]);
 await page.screenshot({path:join(output,'two-independent-notes.png'),fullPage:true});
 const lateFiles=[join(server.directory,'late-1.txt'),join(server.directory,'late-2.txt')];for(const file of lateFiles)await writeFile(file,'A source saved during the shutdown acceptance test.');
 await click('导入资料');await page.waitForSelector('.import-form');await (await page.$('.import-form input[type="file"]')).uploadFile(...lateFiles);
 const heldPromise=new Promise(resolve=>{holdImport=resolve});await click('添加到资料库');const held=await heldPromise;
 assert.equal((await page.evaluate(()=>window.testCloseHandler('status'))).busy,true);
 const closing=page.evaluate(async()=>{window.testClosing=true;return window.testCloseHandler('save')});
 await page.waitForFunction(()=>window.testClosing);await held.continue();await closing;
 assert.equal((await index()).entries.length,33,'Shutdown waits for the current original and stops the remaining batch');
 assert.equal((await page.evaluate(()=>window.testCloseHandler('status'))).busy,false);
 assert.equal(calls.length,0);assert.deepEqual(errors,[]);await click('关闭');
 await writeFile(join(output,'report.json'),JSON.stringify({status:'pass',modelCalls:0,checks:['30 originals preserve two nested bundle levels','source-only batch default','no parsing/model requests at import','outside click, Escape and help shortcuts preserve import','idempotent retry after collection save failure','two independent notes each reference all 30 originals','source extraction cached without individual note generation','mobile layout','desktop close waits for the current file and stops the batch']},null,2));
 console.log('PASS: batch originals and two independent bundle notes');
}catch(error){await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error}
finally{await browser.close();await server.stop()}
