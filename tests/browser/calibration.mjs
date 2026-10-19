import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { testBrowser } from '../support/browser.mjs';
import { createCalibrationPack } from '../../evals/notes/calibration/suite.mjs';
import { calibrationHTML } from '../../evals/notes/calibration/page.mjs';

const output=process.env.PANGZHU_TEST_OUTPUT;
if(!output)throw new Error('Run npm run test:e2e with an isolated output directory.');
await mkdir(output,{recursive:true});const pack=createCalibrationPack(),file=`${output}/calibration.html`;
await writeFile(file,calibrationHTML(pack));
const browser=await testBrowser();let page;
try {
  page=await browser.newPage();const errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
  await page.setRequestInterception(true);page.on('request',r=>{if(r.url()===pathToFileURL(file).href)return void r.continue();network.push(r.url());void r.abort();});
  await page.goto(pathToFileURL(file).href,{waitUntil:'load'});
  await page.waitForSelector('.candidate');assert.equal((await page.$$('[data-answers]:not([hidden])')).length,0);
  assert.ok(await page.$('[role="math"] svg'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:`${output}/workbook-desktop.png`});
  const record=pack.packet.records[0],answer=pack.answers[record.id],selector=`[data-record="${record.id}"]`;
  await page.type('#reviewer','Browser reviewer');
  for(const [field,value] of Object.entries({verdict:answer.acceptable?'acceptable':'revise',score:answer.score[0],critical:answer.critical,failureCode:answer.failureCode}))await page.select(`${selector} [data-field="${field}"]`,String(value));
  await page.type(`${selector} [data-field="quote"]`,answer.quote);await page.type(`${selector} [data-field="reason"]`,answer.reason);
  await page.reload({waitUntil:'load'});assert.equal(await page.$eval('#reviewer',el=>el.value),'Browser reviewer');
  assert.equal(await page.$eval(`${selector} [data-field="quote"]`,el=>el.value),answer.quote);
  assert.match(await page.$eval('#progress',el=>el.textContent),/^1 \/ 16/);
  await page.click('[data-reveal="math-purpose"]');await page.waitForSelector('[data-answers="math-purpose"]',{visible:true});
  await page.reload({waitUntil:'load'});assert.equal(await page.$eval('[data-answers="math-purpose"]',el=>el.hidden),false);
  await page.evaluate(()=>{
    const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.exportedReview=blob.text().then(JSON.parse);return original(blob);};
    HTMLAnchorElement.prototype.click=function(){};
  });
  await page.click('#download');const exported=await page.evaluate(()=>window.exportedReview);
  assert.equal(exported.revealed.length,2);assert.equal(exported.records.find(r=>r.id===record.id).score,answer.score[0]);
  const imported=structuredClone(exported);imported.reviewer='Imported reviewer';
  await writeFile(`${output}/review.json`,JSON.stringify(imported));await(await page.$('#import-file')).uploadFile(`${output}/review.json`);
  await page.waitForFunction(()=>document.querySelector('#reviewer').value==='Imported reviewer');
  const invalid=structuredClone(imported);invalid.corpusHash='wrong-material';
  await writeFile(`${output}/wrong.json`,JSON.stringify(invalid));await(await page.$('#import-file')).uploadFile(`${output}/wrong.json`);
  await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('导入失败'));
  assert.equal(await page.$eval('#reviewer',el=>el.value),'Imported reviewer');
  const malformed=structuredClone(imported);malformed.records[0].reason={invalid:true};
  await writeFile(`${output}/malformed.json`,JSON.stringify(malformed));await(await page.$('#import-file')).uploadFile(`${output}/malformed.json`);
  await page.waitForFunction(()=>document.querySelector('#import-file').value==='');
  await page.reload({waitUntil:'load'});assert.equal(await page.$eval('#reviewer',el=>el.value),'Imported reviewer');
  await page.click('[data-task="profile-voice"]');assert.ok(await page.$('#task-profile-voice .anchor'));
  await page.screenshot({path:`${output}/profile-comparison.png`});
  await page.click('[data-task="paper-note"]');assert.equal((await page.$$('#task-paper-note .paper-note')).length,2);
  await page.screenshot({path:`${output}/paper-note.png`});
  await page.setViewport({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:`${output}/workbook-mobile.png`,fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  console.log('PASS: offline calibration rendering / 8 tasks / formula rendering / draft reload / reference exposure / export / import / mismatched and malformed imports / mobile. No network requests.');
}catch(error){if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{await browser.close();}
