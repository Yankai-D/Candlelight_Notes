import { testBrowser } from '../support/browser.mjs';
import { completeOnboarding } from '../support/onboarding.mjs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createDemo } from '../../src/demo.ts';
import { PDFDocument, StandardFonts } from 'pdf-lib';
const paperPDF=await PDFDocument.create();const paperPage=paperPDF.addPage();const paperFont=await paperPDF.embedFont(StandardFonts.Helvetica);
paperPage.drawText('Proximal Policy Optimization Algorithms\n\nWe study policy gradient methods for reinforcement learning. A policy is updated\nusing a surrogate objective. The purpose of this synthetic PDF is to verify that\nthe full document imports directly from a knowledge node and preserves its goal.',{x:35,y:740,size:12,font:paperFont});
const paperData=Buffer.from(await paperPDF.save()).toString('base64');
const base=process.env.PANGZHU_TEST_URL,output=process.env.PANGZHU_TEST_OUTPUT;
if(!base || !output) throw new Error('Run npm run test:e2e to create an isolated test server.');
await mkdir(output,{recursive:true});
const browser=await testBrowser();
const fixture={...createDemo(),id:'ideal-preserved',title:'原有学习笔记',demo:false,noteFormatVersion:1};
const names=['编程与数据基础','表示、索引与检索','大模型与提示设计','质量评估与实验','应用工程与部署','团队协作与项目经验'];
let job={id:'10000000-0000-4000-8000-000000000001',revision:1,goal:'独立完成可评估的资料问答工具',status:'running',stage:'展开 · 表示、索引与检索',createdAt:Date.now(),model:'QA fixture',promptVersion:'2026-10-17.1',
  contract:{title:'从理解检索到构建可靠的问答工具',summary:'把基础知识、公开资料与实践连成一条可以检验的学习路径。',assumptions:['已经会基础 Python。'],excluded:['大规模集群运维'],requirements:[{id:'R1',label:'完成可评估工具',outcome:'能够比较结果并分析失败原因。'}]},
  skeleton:{branches:names.map((title,i)=>({id:`B${i+1}`,title,purpose:'从问题背景理解关键原理，结合资料学习和小规模实践建立可检验的理解。',dependsOn:i?['B1']:[],requirementIds:['R1']}))},branches:{},research:{},sources:[{id:'Slocal',title:'原有学习笔记',level:'local',extent:'本机抽样页面',documentId:fixture.id},{id:'Sweb',title:'公开检索课程',level:'body',extent:'网页正文',url:'https://example.org/course',importable:true}],issues:[],review:{summary:'已检查覆盖与先修关系。'},metrics:{modelCalls:8,toolCalls:5,completionTokens:12000,repairs:1},events:[{at:Date.now(),stage:'contract',type:'model',accepted:true,elapsedMs:4000}]};
for(let i=1;i<=6;i++){
  const base={body:'这里的关键是把局部方法放回实际问题。先固定比较的条件，再解释每个选择如何影响结果。\n\n例如均值可以写为 \\(\\bar{x}=\\frac{1}{n}\\sum_{i=1}^n x_i\\)。计算之后，还需要判断这个量是否回答了原来的问题。',outcome:'能够说明方法、条件与预期结果之间的关系。',dependsOn:[],priority:'core',deliverable:'',feedback:''};
  job.branches[`B${i}`]={branchId:`B${i}`,nodes:[{...base,id:'N1',parentId:null,kind:'knowledge',title:'问题与基本原理'},{...base,id:'N2',parentId:'N1',kind:'reading',title:'阅读与理解材料'},{...base,id:'N3',parentId:'N1',kind:'practice',title:'做一个可检验的小项目',deliverable:'可重复运行的程序、结果表与失败分析。',feedback:'用固定测试条件比较方案，解释不同结果。'},{...base,id:'N4',parentId:'N1',kind:'experience',title:'在真实反馈中积累经验',deliverable:'复盘记录与沟通材料。',feedback:'由参与者核对问题理解和解决结果。'}]};
  job.research[`B${i}`]={selections:[{nodeId:'N2',sourceIds:['Slocal','Sweb'],explanation:'主资料帮助理解问题，公开课程提供补充视角。',evidence:[{sourceId:'Slocal',quote:'真实资料摘录示例，内容仅用于界面测试。'},{sourceId:'Sweb',quote:'A verified excerpt supporting the recommendation.'}]}],problems:[]};
}
let exists=false,reads=0,requests=[],errorMode=false,savedCopies=1,paperReads=0;
let rebuildSource=null, rebuilt=null, loseRebuildResponse=true;
const errors=[],unexpected=[];
try{
const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});await page.setRequestInterception(true);
await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
page.on('request',req=>{const url=req.url(),json=(v,status=200)=>void req.respond({status,contentType:'application/json',body:JSON.stringify(v)}).catch(()=>{});
 if(url.startsWith('https://fonts.googleapis.com/'))return void req.respond({status:200,contentType:'text/css',body:''});
 if(url.endsWith('/api/config'))return json({baseUrl:'https://example.test',model:'QA',configured:true,token:'qa'});
 if(url.endsWith('/api/library'))return json({documents:[fixture]});
 if(url.endsWith('/api/edit')){const input=JSON.parse(req.postData());requests.push(input);
   if(input.action==='select-template')return json({result:{templateId:'lecture',reason:'测试讲义'}});
   if(input.action==='generate')return json({result:{blocks:[{type:'paragraph',text:'测试资料正文。',sourcePages:[],sourceQuote:''}],summary:''}});
   if(input.action!=='ideal-tree'){unexpected.push(input.action);return void req.abort();}
   if(errorMode)return json({error:'模拟连接中断，后台记录保留。'},400);
   if(input.command==='list')return json({result:{trees:rebuilt?[rebuilt,rebuildSource].map(j=>({id:j.id,title:j.contract.title,edition:j.edition||1,status:j.status,nodes:24,createdAt:j.createdAt})):exists?Array.from({length:savedCopies},(_,i)=>({id:i?`saved-${i}`:job.id,title:i?`${job.contract.title} · ${i+1}`:job.contract.title,status:job.status,nodes:24,createdAt:job.createdAt})):[]}});
   if(input.command==='create'){exists=true;return json({result:{job}});}
   if(input.command==='rebuild'){
     if(!rebuilt){rebuildSource=structuredClone(job);rebuilt={...structuredClone(job),id:'20000000-0000-4000-8000-000000000002',edition:2,status:'complete',stage:'学习路径构建完成',rebuild:{sourceId:job.id,suggestion:input.suggestion,reason:input.reason,includeReview:input.includeReview}};}
     if(loseRebuildResponse){loseRebuildResponse=false;return json({error:'模拟首次响应中断，请重试。'},400);}
     job=rebuilt;return json({result:{job:rebuilt}});
   }
   if(input.command==='pause'){job={...job,status:'paused',stage:'已暂停'};return json({result:{job}});}
   if(input.command==='resume'){job={...job,status:'running',stage:'内容审查'};reads=0;return json({result:{job}});}
   if(input.command==='papers'){job.paperResearch={B1:{N1:{status:'running',stage:'查找 arXiv 并核实摘要'}}};paperReads=0;return json({result:{job}});}
   if(input.command==='get'){
     if(rebuildSource && input.id===rebuildSource.id)return json({result:{job:rebuildSource}});
     if(job.status==='running'&&++reads>2)job={...job,status:'complete',stage:'构建完成'};
     if(job.paperResearch?.B1?.N1?.status==='running'&&++paperReads>1){
       job.paperResearch.B1.N1={status:'complete',stage:'论文已找到',selection:{nodeId:'N1',sourceIds:['Sppo'],explanation:'论文研究策略优化，适合当前节点。',evidence:[{sourceId:'Sppo',quote:'Actual abstract excerpt for a UI test.'}]}};
       job.sources.push({id:'Sppo',arxivId:'1707.06347v2',title:'Proximal Policy Optimization Algorithms',url:'https://arxiv.org/abs/1707.06347v2',level:'abstract',extent:'arXiv 官方摘要 · 全文在导入时下载'});job.revision++;
     }return json({result:{job}});
   }
   if(input.command==='export')return json({result:{artifact:job}});
   if(input.command==='resource')return json({result:input.sourceId==='Sppo'?{filename:'PPO.pdf',data:paperData,url:'https://arxiv.org/pdf/1707.06347v2'}:{filename:'公开检索课程.txt',data:Buffer.from('来源：https://example.org/course\n\nA retrieval system ranks documents for a query. This is synthetic teaching material for a UI import test.').toString('base64'),url:'https://example.org/course'}});
 }
 if(url.includes('/api/')||!url.startsWith(base+'/')){unexpected.push(url);return void req.abort();}void req.continue();
});
const click=async text=>{for(const el of await page.$$('button'))if((await el.evaluate(e=>e.textContent.trim()))===text){await el.click();return}throw new Error('Missing button '+text)};
const titleClick=async title=>{for(const el of await page.$$('.ideal-canopy button'))if(await el.evaluate((e,t)=>e.querySelector('h3')?.textContent===t,title)){await el.click();return}throw new Error('Missing node '+title)};
const read=()=>page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('reading-tree',1);q.onsuccess=()=>r(q.result)});const rows=await new Promise(r=>{const q=db.transaction('documents').objectStore('documents').getAll();q.onsuccess=()=>r(q.result)});db.close();return rows;});
await page.goto(base+'/',{waitUntil:'networkidle0'});await completeOnboarding(page);const before=await read();
await page.click('button[aria-label="学习树"]');
const frame = () => page.evaluate(() => Object.fromEntries(['.collection-sidebar','.collection-header','.tree-mode-switch','.tree-heading','.tree-heading>button'].map(selector => {const r=document.querySelector(selector).getBoundingClientRect();return [selector,{x:r.x,y:r.y,width:r.width,height:r.height}]})));
for(const size of [{width:1440,height:1000},{width:1280,height:720},{width:390,height:844}]){
  await page.setViewport(size);await click('资料学习树');await page.waitForSelector('.garden-heading');const materialFrame=await frame();
  await click('理想学习树');await page.waitForSelector('.ideal-saved-heading');assert.equal(await page.$('#ideal-goal'),null);
  assert.deepEqual(await frame(),materialFrame,`Shared frame must stay stable at ${size.width}`);
}
await page.setViewport({width:1440,height:1000});await page.screenshot({path:output+'/saved-empty.png'});
await click('新的目标');await page.waitForSelector('dialog #ideal-goal');assert.equal(await page.$eval('#ideal-goal',e=>e.value),'');
await page.type('#ideal-goal','Draft goal');await page.click('[aria-label="关闭弹窗"]');assert.equal(await page.$('#ideal-goal'),null);
await click('新的目标');assert.equal(await page.$eval('#ideal-goal',e=>e.value),'Draft goal');await page.$eval('#ideal-goal',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));});
await page.screenshot({path:output+'/entry.png'});await page.type('#ideal-goal','我希望独立完成一个可评估的资料问答工具。');await click('构建理想学习树');await page.waitForSelector('.ideal-bough');
assert.equal(requests.find(r=>r.command==='create').input.profile.materials,undefined);assert.equal((await page.$$('.ideal-bough')).length,6);
await page.waitForSelector('.ideal-growth-lines path');assert.notEqual(await page.$eval('.ideal-growth-lines path',e=>getComputedStyle(e).stroke),'none');
await click('暂停');await page.waitForFunction(()=>document.querySelector('.ideal-status')?.textContent==='已暂停');await click('继续构建');
await page.waitForFunction(()=>document.querySelector('.ideal-status')?.textContent==='学习路径构建完成');
const fitted = async () => {await new Promise(r=>setTimeout(r,100));return page.evaluate(()=>{
  const issues=[];for(const selector of ['.ideal-tree','.ideal-workspace','.ideal-organism','.ideal-canopy']){const el=document.querySelector(selector);if(el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)issues.push({selector,height:[el.clientHeight,el.scrollHeight],width:[el.clientWidth,el.scrollWidth]});}
  const box=document.querySelector('.ideal-organism').getBoundingClientRect();for(const el of document.querySelectorAll('.ideal-canopy>button')){const r=el.getBoundingClientRect();if(r.top<box.top||r.bottom>box.bottom||r.left<box.left||r.right>box.right||[...el.children].some(child=>{const c=child.getBoundingClientRect();return c.height && (c.top<r.top||c.bottom>r.bottom)}))issues.push({node:el.textContent,box:JSON.stringify(r),height:[el.clientHeight,el.scrollHeight]});}
  return issues;
});};
for(const size of [{width:1440,height:1000},{width:1280,height:720},{width:390,height:844}]){await page.setViewport(size);assert.deepEqual(await fitted(),[],`Fit at ${size.width}`);await page.screenshot({path:output+`/overview-${size.width}.png`});}
await page.setViewport({width:1440,height:1000});await page.screenshot({path:output+'/overview.png'});
await titleClick(names[1]);await titleClick('问题与基本原理');await page.waitForSelector('.ideal-paper .math-node svg');await click('展开这条分支');assert.equal((await page.$$('.ideal-leaf')).length,3);
await titleClick('做一个可检验的小项目');await page.waitForSelector('.ideal-practice-proof');await page.screenshot({path:output+'/practice-sage.png'});
for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:output+`/practice-${theme}.png`});assert.equal(await page.$eval('.ideal-tree',el=>el.scrollWidth>el.clientWidth),false);}
await page.click('[aria-label="收起节点详情"]');await titleClick('阅读与理解材料');assert.equal((await page.$$('.ideal-source')).length,2);
await page.click('[aria-label="收起节点详情"]');await click('构建记录');await page.waitForSelector('.ideal-diagnostics');await page.click('[aria-label="收起构建记录"]');
await page.type('[aria-label="搜索理想学习树节点"]','小项目');assert.equal((await page.$$('.ideal-leaf')).length,6);await page.click('[aria-label="清除节点搜索"]');
await page.setViewport({width:390,height:844});await titleClick('做一个可检验的小项目');await page.screenshot({path:output+'/mobile.png',fullPage:true});assert.equal(await page.$eval('.ideal-tree',el=>el.scrollWidth>el.clientWidth),false);assert.ok(await page.$eval('.ideal-paper',el=>el.getBoundingClientRect().top>=0&&el.getBoundingClientRect().bottom<innerHeight));
await page.setViewport({width:1440,height:1000});assert.deepEqual(await read(),before);
await page.reload({waitUntil:'networkidle0'});await page.click('button[aria-label="学习树"]');await click('理想学习树');await page.waitForSelector('.ideal-saved button');
assert.equal(await page.$('#ideal-goal'),null);await page.screenshot({path:output+'/saved-goals.png'});
await page.click('.ideal-saved button');await page.waitForSelector('.ideal-bough');
const originalJob=structuredClone(job);savedCopies=20;
await click('全部目标');await page.waitForFunction(()=>document.querySelectorAll('.ideal-saved button').length===20);
assert.ok(await page.$eval('.ideal-saved',e=>e.scrollHeight>e.clientHeight));assert.ok(await page.$eval('.ideal-tree',e=>e.scrollHeight===e.clientHeight));
await page.screenshot({path:output+'/saved-many.png'});
for(let i=7;i<=16;i++){const id=`B${i}`;job.skeleton.branches.push({...job.skeleton.branches[0],id,title:`拓展方向 ${i}`});job.branches[id]={branchId:id,nodes:[]};}
job.branches.B1.nodes=Array.from({length:40},(_,i)=>({...originalJob.branches.B1.nodes[0],id:`N${i+1}`,parentId:null,title:`知识节点 ${i+1} 的方法与应用`}));job.revision++;
await page.click('.ideal-saved button');await page.waitForSelector('.ideal-bough');assert.equal((await page.$$('.ideal-bough')).length,16);
for(const size of [{width:1280,height:720},{width:390,height:844}]){await page.setViewport(size);assert.deepEqual(await fitted(),[],`Sixteen branches at ${size.width}`);}
await titleClick(names[0]);assert.equal((await page.$$('.ideal-leaf')).length,40);
for(const size of [{width:1280,height:720},{width:390,height:844}]){await page.setViewport(size);assert.deepEqual(await fitted(),[],`Forty siblings at ${size.width}`);await page.screenshot({path:output+`/dense-${size.width}.png`});}
await page.type('[aria-label="搜索理想学习树节点"]','方法');assert.equal((await page.$$('.ideal-bough')).length,6);await titleClick(names[0]);assert.equal((await page.$$('.ideal-leaf')).length,40);assert.deepEqual(await fitted(),[]);
await page.click('[aria-label="清除节点搜索"]');await titleClick('知识节点 1 的方法与应用');await page.waitForSelector('.ideal-paper');
const beforeDialog=await page.$eval('.ideal-organism',e=>e.getBoundingClientRect().toJSON());await click('新的目标');await page.waitForSelector('#ideal-goal');await page.keyboard.press('Escape');assert.equal(await page.$('#ideal-goal'),null);assert.equal(await page.$eval('.ideal-paper h2',e=>e.textContent),'知识节点 1 的方法与应用');assert.deepEqual(await page.$eval('.ideal-organism',e=>e.getBoundingClientRect().toJSON()),beforeDialog);
job=originalJob;savedCopies=1;await page.setViewport({width:1440,height:1000});await click('全部目标');await page.waitForSelector('.ideal-saved button');await page.click('.ideal-saved button');await page.waitForSelector('.ideal-bough');
await titleClick(names[0]);await titleClick('问题与基本原理');assert.equal((await page.$$('.ideal-source')).length,2);
const beforePapers=JSON.stringify(job.branches);await click('查找 arXiv 论文');await page.waitForSelector('.ideal-paper-progress');
await page.waitForFunction(()=>[...document.querySelectorAll('.ideal-source h4')].some(e=>e.textContent==='Proximal Policy Optimization Algorithms'));
assert.equal(JSON.stringify(job.branches),beforePapers);await page.screenshot({path:output+'/knowledge-papers.png'});await click('下载 PDF 并导入');
await page.waitForFunction(()=>!!document.querySelector('.reader-workspace,.continuous-article,[data-note-chapter]'));
const after=await read();assert.equal(after.length,before.length+1);assert.equal(after.find(d=>d.title==='Proximal Policy Optimization Algorithms').intent,'能够说明方法、条件与预期结果之间的关系。');
await page.reload({waitUntil:'networkidle0'});await page.click('button[aria-label="学习树"]');await click('理想学习树');await page.waitForSelector('.ideal-saved button');await page.click('.ideal-saved button');await page.waitForSelector('.ideal-bough');await titleClick(names[0]);await titleClick('问题与基本原理');
const paperCard=(await page.$$('.ideal-source'))[0];assert.equal(await paperCard.$eval('h4',e=>e.textContent),'Proximal Policy Optimization Algorithms');assert.equal(await paperCard.$eval('button',e=>e.textContent),'打开学习笔记');
await paperCard.$eval('button',e=>e.click());assert.equal((await read()).length,after.length);assert.equal(requests.filter(r=>r.command==='resource').length,1);
assert.deepEqual(after.find(d=>d.id===fixture.id),before.find(d=>d.id===fixture.id));assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
// A completed legacy review is terminal. Rebuild is explicit, preserves the
// old version and reuses its request ID when the first response is lost.
const beforeRebuildDocs=await read();
job.status='review';job.stage='已构建 · 有内容改进建议';job.issues=[{branchId:'B1',nodeId:null,severity:'important',problem:'需要明确学习产物的检查方法。',repair:'增加具体的比较标准。'}];
job.pathReport={status:'checked',errors:[],branchOrder:['B1','B2'],requirements:[{id:'R1',label:'完成可评估工具',outcome:'比较结果并分析失败原因',tasks:[{branchId:'B1',branchTitle:names[0],nodeId:'N1',title:'问题与基本原理',kind:'knowledge',outcome:'解释方法与条件的关系',deliverable:'',feedback:''}]}]};
await page.reload({waitUntil:'networkidle0'});await page.click('button[aria-label="学习树"]');await click('理想学习树');await page.waitForSelector('.ideal-saved button');
assert.ok(!(await page.$eval('.ideal-saved',el=>el.textContent)).includes('改进建议'));await page.click('.ideal-saved button');await page.waitForSelector('.ideal-bough');
assert.equal(await page.$eval('.ideal-status',el=>el.textContent),'学习路径构建完成');await page.click('[aria-label="重建学习树"]');
assert.equal(await page.$eval('.ideal-rebuild-form .primary',el=>el.disabled),true);assert.equal(await page.$eval('.ideal-review-choice input',el=>el.checked),false);
await page.type('#ideal-rebuild-suggestion','加强检索评估，并增加贯穿各阶段的项目。');await page.type('#ideal-rebuild-reason','我需要通过具体成果检验理解。');await page.click('.ideal-review-choice input');
await page.screenshot({path:output+'/rebuild-desktop.png'});await page.setViewport({width:390,height:844});await page.screenshot({path:output+'/rebuild-mobile.png'});
assert.equal(await page.$eval('dialog',el=>el.scrollWidth>el.clientWidth),false);await page.setViewport({width:1440,height:1000});
await click('生成新版本');await page.waitForSelector('.ideal-rebuild-form [role="alert"]');await page.waitForFunction(()=>!document.querySelector('.ideal-rebuild-form .primary').disabled);await click('生成新版本');
await page.waitForFunction(()=>!document.querySelector('.ideal-rebuild-form') && document.querySelector('.ideal-map-title span')?.textContent.includes('第 2 版'));
const rebuildCalls=requests.filter(r=>r.command==='rebuild');assert.equal(rebuildCalls.length,2);assert.equal(rebuildCalls[0].requestId,rebuildCalls[1].requestId);assert.equal(rebuildCalls[0].includeReview,true);assert.ok(rebuildCalls[0].reason.includes('检验理解'));
await click('构建记录');await page.waitForSelector('.ideal-path-check');await page.click('.ideal-path-check summary');await page.screenshot({path:output+'/path-check.png'});
await click('查看原版本');await page.waitForFunction(()=>document.querySelector('.ideal-map-title span')?.textContent.includes('第 1 版'));await click('全部目标');await page.waitForFunction(()=>document.querySelectorAll('.ideal-saved button').length===2);
assert.deepEqual(await read(),beforeRebuildDocs);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
console.log(JSON.stringify({passed:true,mockedRequests:requests.length,screenshots:output,actualModelCalls:0}));
}finally{await browser.close();}
