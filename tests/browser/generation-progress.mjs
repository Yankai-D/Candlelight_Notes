import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { testBrowser } from '../support/browser.mjs';
import { completeOnboarding } from '../support/onboarding.mjs';
import { createDemo } from '../../src/demo.ts';
import { ensureNotebooks } from '../../shared/notebooks.mjs';
import { validateResult } from '../../server/harness.mjs';
import { mockWorkflowReceipt } from '../support/workflow-receipt.mjs';

const base=process.env.PANGZHU_TEST_URL,output=process.env.PANGZHU_TEST_OUTPUT;
if(!base||!output)throw new Error('Use the isolated browser test runner.');
await mkdir(output,{recursive:true});
const fixture=id=>{const doc=createDemo(),chapter=doc.chapters[0];return ensureNotebooks({...doc,id,title:id,demo:false,kind:'text',library:{id,label:id,group:'测试',order:0},
  chapters:[{...chapter,status:'empty',content:{type:'doc',content:[]}}],pages:[doc.pages[0]],currentChapter:chapter.id,currentPage:1});};
const documents=[fixture('进度测试'),fixture('暂停测试')],errors=[],unexpected=[],calls=[],snapshots=new Map();
let held, pollingFailure=false;
const browser=await testBrowser();
try {
  const page=await browser.newPage();await page.setViewport({width:1440,height:900});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
  const snapshot=(id,stage,complete=false)=>({id,stage,state:complete?'complete':'running',updatedAt:Date.now(),requests:1,reportedCalls:complete?1:0,inputTokens:complete?100:0,outputTokens:complete?40:0,stages:[{stage,requests:1,reportedCalls:complete?1:0,inputTokens:complete?100:0,outputTokens:complete?40:0}]});
  page.on('request',async request=>{
    const url=new URL(request.url()),json=value=>request.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
    if(url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com')return request.abort();
    if(url.origin!==base){unexpected.push(request.url());return request.abort();}
    if(!url.pathname.startsWith('/api/'))return request.continue();
    const body=request.postData()?JSON.parse(request.postData()):{};calls.push({path:url.pathname,body});
    if(url.pathname==='/api/library')return json({documents});
    if(url.pathname==='/api/config')return json({baseUrl:'https://fixture.invalid',model:'fixture',configured:true,token:'qa',startupMode:'adaptive',storage:'env',generationProgressVersion:1});
    if(url.pathname==='/api/generation-progress')return pollingFailure?request.respond({status:503,contentType:'text/plain',body:'progress unavailable'}):json(snapshots.get(body.id)||null);
    if(url.pathname==='/api/edit'){
      assert.ok(body.progressId);
      if(body.action==='select-template')return json({result:{templateId:'narrative',reason:'离线浏览器测试'},progress:snapshot(body.progressId,body.action,true)});
      if(body.action==='generate') {snapshots.set(body.progressId,snapshot(body.progressId,'generate'));held={request,body,json};return;}
    }
    unexpected.push(request.url());return request.abort();
  });
  await page.goto(base+'/',{waitUntil:'networkidle0'});await completeOnboarding(page);
  await page.waitForSelector('[aria-label="打开 进度测试"]');await page.click('[aria-label="打开 进度测试"]');
  await page.waitForSelector('.generation-progress');await page.click('.generation-progress summary');
  await page.waitForFunction(()=>document.querySelector('.generation-progress')?.textContent.includes('2 次调用'));
  assert.ok(held);assert.equal(calls.filter(c=>c.path==='/api/edit').length,2);
  pollingFailure=true;
  await page.waitForFunction(()=>document.querySelector('.generation-progress')?.textContent.includes('进度暂不可用'));
  assert.equal(calls.filter(c=>c.path==='/api/edit').length,2,'Status failure cannot replay generation');
  pollingFailure=false;
  const v=snapshots.get(held.body.progressId);snapshots.set(v.id,{...v,updatedAt:Date.now(),stage:'note-review',requests:2,reportedCalls:1,inputTokens:200,outputTokens:80,stages:[{stage:'generate',requests:1,reportedCalls:1,inputTokens:200,outputTokens:80},{stage:'note-review',requests:1,reportedCalls:0,inputTokens:0,outputTokens:0}]});
  await page.waitForFunction(()=>document.querySelector('.generation-progress')?.textContent.includes('复查正文'));
  for(const theme of ['sage','dark','light']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const overflow=await page.$eval('.generation-progress',el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);
    await page.screenshot({path:`${output}/progress-${theme}.png`});
  }
  await page.setViewport({width:390,height:844});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.study-sidebar')).visibility==='hidden');
  assert.equal(await page.$eval('.generation-progress',el=>el.scrollWidth>el.clientWidth+1),false);
  await page.screenshot({path:`${output}/progress-mobile.png`});
  await page.setViewport({width:1440,height:900});
  const done={...snapshots.get(held.body.progressId),state:'complete',updatedAt:Date.now(),reportedCalls:2,inputTokens:300,outputTokens:120,stages:[{stage:'generate',requests:1,reportedCalls:1,inputTokens:200,outputTokens:80},{stage:'note-review',requests:1,reportedCalls:1,inputTokens:100,outputTokens:40}]};
  await held.json({result:validateResult(held.body,{summary:'离线生成',blocks:[{type:'paragraph',text:'完整保存的测试笔记。',sourcePages:[1]}]}),workflow:mockWorkflowReceipt(held.body),progress:done});held=null;
  await page.waitForFunction(()=>document.querySelector('.generation-progress')?.textContent.includes('本次处理完成'));
  assert.match(await page.$eval('.generation-progress',el=>el.textContent),/3 次调用/);
  assert.match(await page.$eval('.generation-progress',el=>el.textContent),/400/);
  assert.match(await page.$eval('.generation-progress',el=>el.textContent),/已完成 1\/1 章/);
  await page.click('[aria-label="资料库"]');await page.waitForSelector('[aria-label="打开 暂停测试"]');await page.click('[aria-label="打开 暂停测试"]');
  await page.waitForFunction(()=>document.querySelector('.generation-progress summary')?.textContent.includes('2 次调用'));
  await page.click('[aria-label="取消生成"]');await page.waitForFunction(()=>document.querySelector('.generation-progress')?.textContent.includes('本次已暂停'));
  const edits=calls.filter(c=>c.path==='/api/edit').length,polls=calls.filter(c=>c.path==='/api/generation-progress').length;
  await new Promise(resolve=>setTimeout(resolve,1300));
  assert.equal(calls.filter(c=>c.path==='/api/edit').length,edits);assert.equal(calls.filter(c=>c.path==='/api/generation-progress').length,polls);
  await held.request.abort().catch(()=>{});held=null;
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  await writeFile(`${output}/report.json`,JSON.stringify({passed:true,themes:3,mobile:true,cancellation:true,statusFailure:true,actualModelCalls:0},null,2));
  console.log(JSON.stringify({passed:true,actualModelCalls:0,output}));
} finally {if(held)await held.request.abort().catch(()=>{});await browser.close();}
