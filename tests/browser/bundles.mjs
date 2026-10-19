import { testBrowser } from '../support/browser.mjs';
import { completeOnboarding } from '../support/onboarding.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { reconcileCollection } from '../../shared/collection.mjs';
import { createDemo } from '../../src/demo.ts';

// All materials are authored fixtures; no private library or paid API is used.
const base=process.env.PANGZHU_TEST_URL,output=process.env.PANGZHU_TEST_OUTPUT;
if(!base || !output) throw new Error('Run npm run test:e2e to create an isolated test server.');
await mkdir(output, { recursive: true });
const documents = ['教材选读','数值数据 · 课件','分类数据 · 课件','独立资料'].map((title,index)=>({
  ...createDemo(),id:`bundle-fixture-${index}`,title,demo:false,filename:`fixture-${index}.txt`,
  library:{id:`fixture-${index}`,label:title,group:'验收示例',authors:'Synthetic fixture',year:'2026',order:index,
    ...(index<3?{placement:{folder:{id:'descriptive-statistics',name:'描述性统计'},inTree:true}}:{})},
}));
assert.equal(documents.length, 4);
const collection = reconcileCollection(null, documents);
const noteSnapshot = documents => documents.map(({ id, chapters, notebooks, versions, revision }) => ({ id, chapters, versions, revision,
  notebooks: Object.fromEntries(Object.entries(notebooks || {}).map(([key, { chapters, versions, revision, currentChapter, currentPage, settings }]) => [key, { chapters, versions, revision, currentChapter, currentPage, settings }])),
}));
for (const doc of documents) collection.items[doc.id].inTree = true;
const browser = await testBrowser();
let page;
try {
  page = await browser.newPage();
  const errors = [], forbidden = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    const json = value => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.endsWith('/bundle-seed')) return void request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
    if (url.endsWith('/api/config')) return void json({ configured: false, token: 'qa', model: 'qa' });
    if (url.endsWith('/api/library')) return void json({ documents });
    if (url.includes('/api/')) { forbidden.push(url); return void request.abort(); }
    if (!url.startsWith(base+'/')) return void request.abort();
    void request.continue();
  });
  const clickText = async (text, selector = 'button') => {
    const handles = await page.$$(selector);
    for (const handle of handles) if ((await handle.evaluate(el => el.textContent.trim())) === text) { await handle.click(); return; }
    throw new Error(`Button not found: ${text}`);
  };
  const selectFolder = async () => {
    const buttons = await page.$$('.collection-folders button');
    for (const button of buttons) if ((await button.evaluate(el => el.querySelector('span').textContent)) === '描述性统计') { await button.click(); break; }
    await page.waitForFunction(() => document.querySelector('.collection-title h1')?.textContent === '描述性统计');
  };
  const readState = () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('reading-tree', 1); req.onsuccess = () => resolve(req.result); });
    const get = (store, key) => new Promise(resolve => { const req = key === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key); req.onsuccess = () => resolve(req.result); });
    const result = { collection: await get('preferences', 'collection'), documents: await get('documents') }; db.close(); return result;
  });
  await page.goto(base+'/bundle-seed');
  await page.evaluate(async collection => {
    const db = await new Promise(resolve => { const req = indexedDB.open('reading-tree',1); req.onupgradeneeded = () => { req.result.createObjectStore('documents',{keyPath:'id'}); req.result.createObjectStore('files'); req.result.createObjectStore('preferences'); }; req.onsuccess = () => resolve(req.result); });
    await new Promise(resolve => { const tx = db.transaction('preferences','readwrite'); tx.objectStore('preferences').put(collection,'collection'); tx.oncomplete = resolve; }); db.close();
  }, collection);
  await page.goto(base+'/', { waitUntil: 'networkidle0' });
  await completeOnboarding(page);
  await page.waitForSelector('.collection-row');
  const originalNotes = noteSnapshot((await readState()).documents);
  await selectFolder();
  await page.click('[aria-label="管理当前文件夹"]');
  await page.click('.folder-kind-options label:has(input[value="bundle"])');
  assert.equal(await page.$eval('[aria-label="资料包编入学习树"]', el => el.checked), false);
  await page.screenshot({ path: `${output}/settings-sage.png` });
  await clickText('保存设置');
  await page.waitForSelector('dialog', { hidden: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await selectFolder();
  assert.match(await page.$eval('.collection-title p', el => el.textContent), /联合资料包/);
  assert.equal((await readState()).collection.folders.find(f => f.id === 'descriptive-statistics').kind, 'bundle');
  await page.click('[aria-label="学习树"]');
  await page.waitForSelector('.garden-leaf');
  assert.equal((await page.$$('.garden-leaf')).length, 1);
  await page.click('[aria-label="资料库"]');
  await page.click('[aria-label="整理 数值数据 · 课件"]');
  assert.equal(await page.$('[aria-label="编入学习树"]'), null);
  assert.ok(await page.$('.bundle-member-setting'));
  await clickText('资料包设置');
  await page.waitForSelector('[aria-label="资料包编入学习树"]');
  await page.click('[aria-label="资料包编入学习树"]');
  await clickText('保存设置');
  await page.waitForSelector('dialog', { hidden: true });
  await page.click('[aria-label="学习树"]');
  await page.waitForSelector('[aria-label="展开 描述性统计 的知识结构"]');
  assert.equal((await page.$$('.garden-leaf')).length, 2);
  await page.click('[aria-label="展开 描述性统计 的知识结构"]');
  await page.waitForSelector('.garden-inspector');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.garden-inspector')).opacity === '1');
  assert.equal((await page.$$('.garden-inspector .garden-branch-file')).length, 3);
  await page.screenshot({ path: `${output}/single-package-node.png` });
  await clickText('打开资料包');
  await page.waitForSelector('.collection-title');
  assert.equal(await page.$eval('.collection-title h1', el => el.textContent), '描述性统计');
  await page.click('[aria-label="管理当前文件夹"]');
  await page.click('.folder-kind-options label:has(input[value="folder"])');
  await clickText('保存设置');
  await page.waitForSelector('dialog', { hidden: true });
  await page.click('[aria-label="学习树"]');
  await page.waitForSelector('.garden-leaf');
  assert.equal((await page.$$('.garden-leaf')).length, 4);
  assert.deepEqual(noteSnapshot((await readState()).documents), originalNotes);
  await page.click('[aria-label="资料库"]');
  await page.click('[aria-label="管理当前文件夹"]');
  await page.click('.folder-kind-options label:has(input[value="bundle"])');
  await clickText('保存设置');
  await page.waitForSelector('dialog', { hidden: true });
  // Import from inside a bundle targets that bundle instead of the unfiled shelf.
  await writeFile(`${output}/sample.txt`, '# 课后补充\n均值描述一组数据的中心。中位数对极端值更稳健。\n');
  await clickText('导入资料', '.collection-title-actions button');
  await page.waitForSelector('input[type="file"]');
  await (await page.$('input[type="file"]')).uploadFile(`${output}/sample.txt`);
  await clickText('添加到资料库');
  await page.waitForSelector('dialog', { hidden: true });
  const afterImport = await readState();
  const added = afterImport.documents.find(d => d.filename === 'sample.txt');
  assert.ok(added);
  assert.equal(afterImport.collection.items[added.id].folderId, 'descriptive-statistics');
  for (const theme of ['dark','light','sage']) {
    await page.click('[aria-label="切换视觉风格"]');
    await page.click(`[data-theme-preview="${theme}"]`);
    await page.click('[aria-label="管理当前文件夹"]');
    await page.waitForSelector('.folder-bundle-settings');
    await page.screenshot({ path: `${output}/settings-${theme}.png` });
    assert.equal(await page.$eval('dialog', el => el.scrollWidth > el.clientWidth+1), false);
    await page.click('[aria-label="关闭弹窗"]');
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.click('[aria-label="管理当前文件夹"]');
  await page.screenshot({ path: `${output}/settings-mobile.png` });
  assert.equal(await page.$eval('dialog', el => el.scrollWidth > el.clientWidth+1), false);
  await page.click('[aria-label="关闭弹窗"]');
  await page.setViewport({ width: 1440, height: 900 });
  await page.click('[aria-label="新建文件夹"]');
  await page.type('[aria-label="文件夹名称"]', '新的复习资料包');
  await page.click('.folder-kind-options label:has(input[value="bundle"])');
  await clickText('创建资料包');
  await page.waitForSelector('dialog', { hidden: true });
  const created = (await readState()).collection.folders.find(f=>f.name==='新的复习资料包');
  assert.equal(created.kind, 'bundle'); assert.equal(created.inTree, false);
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
  console.log('PASS: create / convert / reload / member lock / whole-package tree / restore / import destination / 3 themes / mobile; no model requests.');
} catch(error) {
  if (page) await page.screenshot({ path: `${output}/failure.png` }).catch(()=>{});
  throw error;
} finally { await browser.close(); }
