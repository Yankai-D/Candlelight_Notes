import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { testBrowser } from '../support/browser.mjs';
import { completeOnboarding } from '../support/onboarding.mjs';
import { createDemo } from '../../src/demo.ts';
import { paragraph, withIds } from '../../shared/document.mjs';
import { ensureNotebooks, selectNotebook, commitNotebook } from '../../shared/notebooks.mjs';
import { defaultModelConnection } from '../../shared/app-settings.mjs';
import { validateResult } from '../../server/harness.mjs';
import { mockWorkflowReceipt } from '../support/workflow-receipt.mjs';

const base=process.env.PANGZHU_TEST_URL,output=process.env.PANGZHU_TEST_OUTPUT;
if(!base||!output)throw new Error('Run npm run test:e2e with an isolated test server.');
await mkdir(output,{recursive:true});
const fixture=(id,ready)=>{
  const doc=createDemo(),chapter=doc.chapters[0];
  return ensureNotebooks({...doc,id,title:id,kind:'text',demo:false,library:{id,label:id,group:'测试资料',order:0},
    chapters:[{...chapter,status:ready?'ready':'empty',content:withIds({type:'doc',content:ready?[paragraph('已保存的原文译文。')]:[]})}],
    pages:[doc.pages[0]],currentChapter:chapter.id,currentPage:1});
};
let saved=selectNotebook(fixture('已有两份笔记',true),'adaptive');
saved=commitNotebook({...saved,chapters:saved.chapters.map(c=>({...c,status:'ready',content:withIds({type:'doc',content:[paragraph('已保存的适应性讲解。')]})}))});
saved=selectNotebook(saved,'translation');
const documents=[saved,fixture('新资料',false)];
let config={baseUrl:'https://example.invalid/v1',model:'saved-model',configured:true,token:'qa',startupMode:'adaptive',storage:'env'};
const calls=[],errors=[],forbidden=[];
const browser=await testBrowser();let page;
try {
  page=await browser.newPage();
  await page.setViewport({width:1440,height:900});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    const url=new URL(request.url());
    const json=value=>request.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
    // The app's optional web font is deliberately unavailable in offline QA.
    if(url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com')return request.abort();
    if(url.origin!==base){forbidden.push(request.url());return request.abort();}
    if(!url.pathname.startsWith('/api/'))return request.continue();
    const body=request.postData()?JSON.parse(request.postData()):{};
    calls.push({path:url.pathname,method:request.method(),body});
    if(url.pathname==='/api/library')return json({documents});
    if(url.pathname==='/api/config') {
      if(request.method()==='POST') {
        const {apiKey,...publicFields}=body;
        config={...config,...publicFields,...(apiKey!==undefined?{configured:!!apiKey}:{})};
      }
      return json(config);
    }
    if(url.pathname==='/api/config/reset'){config={...config,baseUrl:defaultModelConnection.baseUrl,model:defaultModelConnection.model,configured:false};return json(config);}
    if(url.pathname==='/api/test')return json({ok:true});
    if(url.pathname==='/api/edit') {
      if(body.action==='select-template')return json({result:{templateId:'narrative',reason:'用于测试启动方式的原创示例。'}});
      if(body.action==='generate')return json({result:validateResult(body,{summary:'离线测试生成',blocks:[{type:'paragraph',text:`新生成的${body.learning.mode}笔记。`,sourcePages:[1]}]}),workflow:mockWorkflowReceipt(body)});
    }
    forbidden.push(request.url());return request.abort();
  });
  const clickText=async(text,selector='button')=>{
    for(const button of await page.$$(selector))if(await button.evaluate((el,text)=>el.textContent.trim()===text,text)){await button.click();return;}
    throw new Error(`Button not found: ${text}`);
  };
  const close=async()=>{await page.click('[aria-label="关闭弹窗"]');await page.waitForSelector('dialog',{hidden:true});};
  const replace=async(selector,text)=>{await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type(selector,text);};
  const generationCalls=()=>calls.filter(c=>c.path==='/api/edit');
  const mutations=()=>calls.filter(c=>c.path==='/api/config'&&c.method==='POST');
  const open=async title=>{await page.click(`[aria-label="打开 ${title}"]`);};
  const library=async()=>{await page.click('[aria-label="资料库"]');await page.waitForSelector('.collection-row');};
  const reader=async mode=>{
    await page.waitForFunction(mode=>document.querySelector('[aria-label="阅读方式"]')?.value===mode,{},mode);
    await page.waitForSelector('.note-prose p');
  };
  const mode=async value=>{
    await page.click('[aria-label="模型设置"]');await clickText('阅读启动');
    await page.click(`input[name="startup-mode"][value="${value}"]`);await clickText('保存启动方式');
    await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('启动方式已保存'));
    await close();
  };
  const readDocs=()=>page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const req=indexedDB.open('reading-tree',1);req.onsuccess=()=>resolve(req.result);});
    const docs=await new Promise(resolve=>{const req=db.transaction('documents').objectStore('documents').getAll();req.onsuccess=()=>resolve(req.result);});db.close();return docs;
  });
  const contentSnapshot=doc=>Object.fromEntries(Object.entries(doc.notebooks).map(([id,n])=>[id,{chapters:n.chapters,versions:n.versions,revision:n.revision}]));
  await page.goto(base+'/',{waitUntil:'networkidle0'});
  await completeOnboarding(page);
  await page.waitForSelector('.collection-row');
  const before=contentSnapshot((await readDocs()).find(d=>d.id===saved.id));

  // Saved connections are read-only; testing a draft and cancelling never save it.
  await page.click('[aria-label="模型设置"]');
  assert.equal(await page.$('input[type="password"]'),null);
  await clickText('修改连接');
  await replace('input[list="model-list"]','unsaved-model');
  await clickText('测试连接');
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('草稿连接成功'));
  assert.equal(calls.find(c=>c.path==='/api/test').body.model,'unsaved-model');
  assert.equal(config.model,'saved-model');assert.equal(mutations().length,0);
  await clickText('取消修改');
  assert.equal(await page.$('input[type="password"]'),null);
  await clickText('修改连接');
  assert.equal(await page.$eval('input[list="model-list"]',el=>el.value),'saved-model');
  await replace('input[list="model-list"]','persisted-model');await clickText('保存连接');
  await page.waitForSelector('.connection-lock');
  assert.equal(config.model,'persisted-model');assert.equal(config.configured,true);
  assert.equal(Object.hasOwn(mutations().at(-1).body,'apiKey'),false,'Blank input preserves the stored Key');
  await clickText('恢复默认连接');await clickText('取消');
  assert.equal(config.model,'persisted-model');assert.equal(config.configured,true);
  await close();
  await page.reload({waitUntil:'networkidle0'});
  await page.click('[aria-label="模型设置"]');
  assert.match(await page.$eval('.connection-summary',el=>el.textContent),/persisted-model/);
  await clickText('阅读启动');
  assert.equal(await page.$eval('input[value="adaptive"]',el=>el.checked),true);
  await clickText('模板风格');await page.waitForSelector('.template-space');
  await clickText('阅读启动');await page.waitForSelector('.startup-options');await close();

  // Reopening chooses the configured edition without touching either saved text.
  await open(saved.title);await reader('adaptive');assert.equal(generationCalls().length,0);
  await library();await mode('translation');await open(saved.title);await reader('translation');
  assert.equal(generationCalls().length,0);await library();
  await mode('manual');await page.reload({waitUntil:'networkidle0'});
  await open('新资料');await page.waitForSelector('.startup-choice');
  assert.ok(await page.$('.view-library'));assert.equal(generationCalls().length,0);
  await page.screenshot({path:`${output}/manual-choice.png`});await close();
  assert.equal(generationCalls().length,0,'Cancelling the choice starts no generation');
  await open('新资料');await page.click('.startup-choice button:first-child');await reader('translation');
  await page.waitForSelector('.preparation-banner',{hidden:true});
  assert.deepEqual(generationCalls().map(c=>[c.body.action,c.body.learning?.mode]),[['generate','translation']]);
  const firstTranslation=(await readDocs()).find(d=>d.id==='新资料').notebooks.translation.chapters;
  await library();await open('新资料');await page.click('.startup-choice button:first-child');await reader('translation');
  assert.equal(generationCalls().length,1,'An existing edition is not regenerated');
  await library();await mode('adaptive');await open('新资料');await reader('adaptive');
  await page.waitForSelector('.preparation-banner',{hidden:true});
  assert.deepEqual(generationCalls().map(c=>c.body.action),['generate','select-template','generate']);
  assert.equal(generationCalls().at(-1).body.learning.mode,'adaptive');
  await library();await open('新资料');await reader('adaptive');assert.equal(generationCalls().length,3);
  await library();
  const after=await readDocs();
  assert.deepEqual(contentSnapshot(after.find(d=>d.id===saved.id)),before);
  assert.deepEqual(after.find(d=>d.id==='新资料').notebooks.translation.chapters,firstTranslation);

  // One entry edits the goal and the revision feedback, preserves drafts on
  // outside clicks/Escape, and reroutes only after explicit submission.
  await open('新资料');await reader('adaptive');
  assert.equal(await page.$('[aria-label="重新生成当前笔记"]'),null);
  await clickText('调整并重新生成');await page.waitForSelector('[aria-label="重新生成的调整要求"]');
  const callCount=generationCalls().length;
  await replace('[aria-label="我的学习目标"]','按小问讲解题目');
  await replace('[aria-label="重新生成的调整要求"]','只给提示，不要答案');
  await page.keyboard.press('Escape');await page.mouse.click(5,5);
  assert.equal(await page.$eval('[aria-label="重新生成的调整要求"]',el=>el.value),'只给提示，不要答案');
  assert.equal(generationCalls().length,callCount);
  await page.screenshot({path:`${output}/regenerate-goal.png`});
  await clickText('取消');assert.equal(generationCalls().length,callCount);
  assert.equal((await readDocs()).find(d=>d.id==='新资料').intent,documents[1].intent);
  await clickText('调整并重新生成');
  await replace('[aria-label="我的学习目标"]','按小问讲解题目');
  await replace('[aria-label="重新生成的调整要求"]','只给提示，不要答案');
  await clickText('保存目标并重新生成');await page.waitForSelector('dialog',{hidden:true});
  await page.waitForSelector('.preparation-banner',{hidden:true});
  await page.waitForFunction(()=>document.querySelector('.notebook-status')?.textContent.includes('已保存'));
  const newCalls=generationCalls().slice(callCount);
  assert.deepEqual(newCalls.map(c=>c.body.action),['select-template','generate']);
  assert.equal(newCalls[0].body.document.feedback,'只给提示，不要答案');
  assert.equal(newCalls[1].body.document.intent,'按小问讲解题目');
  assert.equal(newCalls[1].body.learning.regenerationFeedback,'只给提示，不要答案');
  const revised=(await readDocs()).find(d=>d.id==='新资料');
  assert.deepEqual(revised.notebooks.translation.chapters,firstTranslation);
  assert.ok(revised.versions.length);
  await page.click('.reader-template-hint button');await page.waitForSelector('.template-list');
  assert.equal(await page.$$eval('.template-list [role="tab"]',tabs=>tabs.length),3);
  await page.click('.template-list [role="tab"]:nth-child(3)');await page.waitForFunction(()=>document.querySelector('.course-style-preview h3')?.textContent.includes('原创小题'));
  await page.screenshot({path:`${output}/exercise-template.png`});
  assert.equal(await page.$eval('dialog',el=>el.scrollWidth>el.clientWidth+1),false);
  await close();await library();

  // The setting affects the next entry, not the edition currently being read.
  await open(saved.title);await reader('adaptive');await mode('translation');await reader('adaptive');await library();
  for(const theme of ['sage','dark','light']) {
    await page.click('[aria-label="切换视觉风格"]');await page.click(`[data-theme-preview="${theme}"]`);
    await page.click('[aria-label="模型设置"]');
    await page.screenshot({path:`${output}/connection-${theme}.png`});
    await clickText('阅读启动');await page.screenshot({path:`${output}/startup-${theme}.png`});
    assert.equal(await page.$eval('dialog',el=>el.scrollWidth>el.clientWidth+1),false);await close();
  }
  await page.setViewport({width:390,height:844});await page.click('[aria-label="模型设置"]');await clickText('阅读启动');
  await page.screenshot({path:`${output}/startup-mobile.png`});
  assert.equal(await page.$eval('dialog',el=>el.scrollWidth>el.clientWidth+1),false);await close();
  await page.setViewport({width:1440,height:900});await page.click('[aria-label="模型设置"]');
  await clickText('清除 Key');await clickText('取消');assert.equal(config.configured,true);
  await clickText('恢复默认连接');await page.screenshot({path:`${output}/reset-confirmation.png`});
  await clickText('确认恢复默认');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('已恢复默认'));
  assert.equal(config.baseUrl,defaultModelConnection.baseUrl);assert.equal(config.model,defaultModelConnection.model);
  assert.equal(config.configured,false);assert.equal(config.startupMode,'translation');
  assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
  console.log('PASS: locked connection / draft test / cancel / save / reload / reset / 3 startup modes / deferred generation / independent editions / 3 themes / mobile; model responses are offline fixtures.');
} catch(error) {
  if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});
  throw error;
} finally {await browser.close();}
