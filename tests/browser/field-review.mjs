import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { testBrowser } from '../support/browser.mjs';
import { planField, runField } from '../../evals/claims/field/experiment.mjs';
import { createFieldReview } from '../../evals/claims/field/review.mjs';
import { fieldReviewHTML } from '../../evals/claims/field/page.mjs';

const output=process.env.PANGZHU_TEST_OUTPUT;if(!output)throw Error('Use isolated browser test output');
await mkdir(output,{recursive:true});const pack=createFieldReview(await runField(planField())),file=`${output}/review.html`;
await writeFile(file,fieldReviewHTML(pack));const browser=await testBrowser();let page;
try {
  page=await browser.newPage();const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',r=>{if(r.url()===pathToFileURL(file).href)return void r.continue();network.push(r.url());void r.abort();});
  await page.setViewport({width:1400,height:1000});await page.goto(pathToFileURL(file).href);
  assert.equal((await page.$$('[data-model]:not([hidden])')).length,0);assert.ok(await page.$('[role="math"] svg'));
  const id=pack.packet.units[0].id,selector=`[data-unit="${id}"]`;
  await page.type('#reviewer','Browser tester');await page.select('#reviewerType','human');await page.select('#participatedInDevelopment','false');await page.select('#seenModelBefore','false');
  await page.select(`${selector} [data-field="verdict"]`,'retain');await page.type(`${selector} [data-field="reason"]`,'先独立检查当前原句');
  await page.click(`${selector} [data-reveal]`);await page.waitForSelector(`${selector} [data-model]`,{visible:true});
  await page.select(`${selector} [data-field="verdict"]`,'needs-source');await page.reload();
  assert.equal(await page.$eval('#reviewer',el=>el.value),'Browser tester');assert.match(await page.$eval(`${selector} [data-initial]`,el=>el.textContent),/retain/);
  assert.equal(await page.$eval(`${selector} [data-field="verdict"]`,el=>el.value),'needs-source');
  await page.evaluate(()=>{const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.exported=blob.text().then(JSON.parse);return original(blob);};HTMLAnchorElement.prototype.click=function(){};});
  await page.click('#download');const exported=await page.evaluate(()=>window.exported);assert.equal(exported.records[0].initial.verdict,'retain');assert.equal(exported.records[0].verdict,'needs-source');
  const imported=structuredClone(exported);imported.reviewer='Imported tester';await writeFile(`${output}/import.json`,JSON.stringify(imported));
  await(await page.$('#import-file')).uploadFile(`${output}/import.json`);await page.waitForFunction(()=>document.querySelector('#reviewer').value==='Imported tester');
  for(const [name,modify] of [['foreign',r=>r.packetHash='wrong'],['rewind',r=>{r.records[0].exposed=false;r.records[0].initial=null;}],['malformed',r=>r.records[0].reason={bad:true}]]) {
    const invalid=structuredClone(imported);modify(invalid);await writeFile(`${output}/${name}.json`,JSON.stringify(invalid));await(await page.$('#import-file')).uploadFile(`${output}/${name}.json`);
    await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('导入失败'));assert.equal(await page.$eval('#reviewer',el=>el.value),'Imported tester');
  }
  await page.screenshot({path:`${output}/desktop.png`});await page.setViewport({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:`${output}/mobile.png`,fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  console.log('PASS: field workbook / pre-exposure judgments / reload / export / validated import / exposure rewind rejected / math / mobile; 0 model and network calls.');
}catch(error){if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await browser.close();}
