import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { launch } from 'puppeteer-core';
import { browserPath } from '../server/pdf-export.mjs';
import { noteBlocks } from '../shared/note-format.mjs';
import { defaultCourseSample } from '../shared/course-style.mjs';
import { validateDistributionPath } from '../packaging/windows/policy.mjs';

const exec=promisify(execFile),archive=resolve(process.argv[2]||'output/releases/pangzhu-notes-0.1.0-windows-x64.zip');
const reportFile=archive.replace(/\.zip$/i,'-verification.json');
const scratch=await mkdtemp(join(tmpdir(),'pangzhu-旁烛 验收-'));
const output=resolve('artifacts/distribution');await mkdir(output,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let directory,runtime,launcher,browser,started=false,collision;
const base='http://127.0.0.1:5186';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|pathext|comspec|systemroot|windir|temp|tmp|localappdata|appdata|userprofile|programfiles|programfiles\(x86\)|programdata|lang)$/i.test(key)));
const checks=[];
const pass=message=>{checks.push(message);console.log(`PASS: ${message}`);};
try {
  await exec('powershell.exe',['-NoProfile','-File',resolve('tests/support/portable-files.ps1'),'-Archive',archive,'-Destination',scratch],{windowsHide:true});
  const roots=await readdir(scratch);assert.equal(roots.length,1);directory=join(scratch,roots[0]);
  const manifest=JSON.parse(await readFile(join(directory,'PACKAGE-MANIFEST.json'),'utf8'));
  for(const file of manifest.files){validateDistributionPath(file.path);assert.equal(sha(await readFile(join(directory,file.path))),file.sha256,`File fingerprint: ${file.path}`);}
  assert.equal(manifest.files.filter(file=>/\.pdf$/i.test(file.path)).length,3);
  await assert.rejects(readFile(join(directory,'data/.env')),{code:'ENOENT'});
  pass('Archive fingerprints, exactly three PDFs, no pre-existing user data or credentials');
  runtime=join(directory,'runtime/node.exe');launcher=join(directory,'launcher/launch.mjs');
  const hostile={...env,DEEPSEEK_API_KEY:'PRIVATE_PARENT_CANARY',DEEPSEEK_MODEL:'PRIVATE_MODEL_CANARY',PORT:'5173',READING_TREE_ENV_FILE:join(scratch,'private.env'),READING_TREE_LIBRARY_DIR:join(scratch,'private-library')};
  await writeFile(join(scratch,'private.env'),'DEEPSEEK_API_KEY=PRIVATE_FILE_CANARY\n');
  const startup=await exec('powershell.exe',['-NoProfile','-File',resolve('tests/support/portable-start.ps1'),'-Directory',directory],{env:hostile,windowsHide:true,timeout:60000});started=true;
  console.log(startup.stdout.trim());if(startup.stderr.trim())console.error(startup.stderr.trim());
  let config=await fetch(base+'/api/config').then(r=>r.json());
  assert.equal(config.configured,false);assert.equal(config.model,'deepseek-flash');
  const state=JSON.parse(await readFile(join(directory,'data/service.json'),'utf8'));
  await exec(runtime,[launcher,'--no-browser'],{env:hostile,windowsHide:true,timeout:30000});
  assert.equal(JSON.parse(await readFile(join(directory,'data/service.json'),'utf8')).pid,state.pid);
  pass('Bundled runtime starts outside repository in a Unicode/spaced path; parent settings ignored; repeated start reuses service');
  const catalog=await fetch(base+'/api/library').then(r=>r.json());
  assert.deepEqual(catalog.documents.map(doc=>doc.library.id).sort(),manifest.includedMaterialIds.toSorted());
  for(const doc of catalog.documents){
    const res=await fetch(`${base}/api/library/${doc.library.id}/source`);assert.equal(res.status,200);
    assert.equal(sha(Buffer.from(await res.arrayBuffer())),manifest.files.find(file=>file.path===`materials/${doc.library.id}.pdf`).sha256);
  }
  const post=async(path,data)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-reading-tree-token':config.token},body:JSON.stringify(data)});
  const tree=await post('/api/edit',{action:'ideal-tree',command:'list'});assert.equal(tree.status,200);
  const treeBody=await tree.json();assert.ok(treeBody.result);assert.equal(JSON.stringify(treeBody).includes('PRIVATE_'),false);
  const sample=await fetch(base+'/review/course.html');assert.equal(sample.status,200);assert.match(await sample.text(),/role="math"/);
  pass('Public source hashes match, fresh learning-tree storage and course reference route work');
  browser=await launch({executablePath:browserPath(),headless:true,pipe:true,env,userDataDir:join(directory,'data/browser'),timeout:30000});
  const page=await browser.newPage(),errors=[],network=[];await page.setViewport({width:1440,height:1000});
  page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
  page.on('request',request=>{
    if(request.url().startsWith(base+'/')&&!request.url().includes('/api/edit')&&!request.url().includes('/api/test'))return void request.continue();
    if(/^(data:|blob:)/.test(request.url()))return void request.continue();
    network.push(request.url());void request.abort();
  });
  await page.goto(base+'/',{waitUntil:'networkidle0'});await page.waitForSelector('.collection-row');
  assert.equal(await page.$$eval('.collection-row',els=>els.length),3);
  const folders=await page.$eval('.collection-folders',el=>el.textContent);assert.match(folders,/描述性统计/);assert.doesNotMatch(folders,/机器学习/);
  for(const button of await page.$$('.collection-folders button'))if(await button.evaluate(el=>el.querySelector('span')?.textContent==='描述性统计')){await button.click();break;}
  await page.waitForFunction(()=>document.querySelector('.collection-title h1')?.textContent==='描述性统计');
  await page.screenshot({path:join(output,'statistics-library.png')});
  await page.click('[aria-label="打开 描述性统计 · 教材"]');
  await page.waitForFunction(()=>document.querySelector('.source-context-viewport canvas')?.width>100
    &&!document.querySelector('.source-context-viewport .source-loading'),{timeout:30000});
  await page.screenshot({path:join(output,'statistics-reader.png')});
  await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.collection-row');
  assert.equal(await page.$$eval('.collection-row',els=>els.length),3);
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  await browser.close();browser=null;
  pass('Fresh isolated browser shows only the statistics bundle and three files; PDF reader and persisted library verified');
  const document=structuredClone(catalog.documents[0]);document.chapters=[{...document.chapters[0],title:'描述性统计公式导出验收',content:{type:'doc',content:defaultCourseSample.paragraphs.flatMap(p=>noteBlocks(p.text))}}];
  const pdf=await post('/api/export/pdf',{document});assert.equal(pdf.status,200,await pdf.clone().text().then(t=>t.startsWith('%PDF')?'PDF':t));
  const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});
  try{const p=await task.promise;assert.ok(p.numPages>=1);const text=(await(await p.getPage(1)).getTextContent()).items.map(i=>i.str).join('');assert.match(text,/描述性统计/);assert.doesNotMatch(text,/\\frac|\\sum/);}finally{await task.destroy();}
  pass('Actual packaged PDF endpoint renders selectable Chinese and math with bundled dependencies');
  const saved=await post('/api/config',{apiKey:'PORTABLE_QA_ONLY',baseUrl:'http://127.0.0.1:9',startupMode:'manual'});assert.equal(saved.status,200);
  assert.match(await readFile(join(directory,'data/.env'),'utf8'),/PORTABLE_QA_ONLY/);
  assert.equal(await readFile(join(scratch,'private.env'),'utf8'),'DEEPSEEK_API_KEY=PRIVATE_FILE_CANARY\n');
  await exec(runtime,[launcher,'--stop'],{env,windowsHide:true,timeout:15000});started=false;
  await exec(runtime,[launcher,'--no-browser'],{env,windowsHide:true,timeout:60000});started=true;
  config=await fetch(base+'/api/config').then(r=>r.json());assert.equal(config.configured,true);assert.equal(config.startupMode,'manual');
  await exec(runtime,[launcher,'--stop'],{env,windowsHide:true,timeout:15000});started=false;
  pass('Settings saved only in portable data directory, survive restart, and service stops independently');
  collision=createServer((req,res)=>{res.writeHead(403);res.end('unrelated service');});await new Promise((resolvePromise,reject)=>{collision.once('error',reject);collision.listen(5186,'127.0.0.1',resolvePromise);});
  await exec(runtime,[launcher,'--stop'],{env,windowsHide:true,timeout:10000});
  assert.equal(await fetch(base).then(r=>r.text()),'unrelated service');
  await assert.rejects(exec('powershell.exe',['-NoProfile','-File',resolve('tests/support/portable-start.ps1'),'-Directory',directory],{env,windowsHide:true,timeout:15000}),error=>error.code!==0&&/5186/.test(error.stderr+error.stdout));
  await new Promise(resolvePromise=>collision.close(resolvePromise));collision=null;
  pass('Occupied port is rejected; stop does not terminate an unrelated service');
  await writeFile(reportFile,JSON.stringify({status:'pass',archive:basename(archive),sha256:sha(await readFile(archive)),checkedAt:new Date().toISOString(),filesVerified:manifest.files.length,materials:3,modelCalls:0,checks},null,2)+'\n');
  console.log(JSON.stringify({status:'pass',checks,report:reportFile,modelCalls:0},null,2));
} catch(error) {
  console.error(`Failed after ${checks.length} completed checks: ${error.message}`);
  if(directory){const log=await readFile(join(directory,'data/logs/server-error.log'),'utf8').catch(()=>'No service error log');console.error(log.slice(-6000));}
  throw error;
} finally {
  await browser?.close();
  if(runtime)await exec(runtime,[launcher,'--stop'],{env,windowsHide:true,timeout:15000}).catch(()=>{});
  if(collision)await new Promise(resolvePromise=>collision.close(resolvePromise));
  // Delete only this test's freshly created OS-temp directory, after verifying
  // the absolute path. Never remove a supplied extraction or user-data path.
  assert.equal(dirname(resolve(scratch)),resolve(tmpdir()));assert.ok(basename(scratch).startsWith('pangzhu-'));
  await rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:500});
}
