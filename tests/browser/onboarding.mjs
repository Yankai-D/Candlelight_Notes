import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { testBrowser } from '../support/browser.mjs';
import { createDemo } from '../../src/demo.ts';
import { defaultModelConnection } from '../../shared/app-settings.mjs';

const base = process.env.PANGZHU_TEST_URL, output = process.env.PANGZHU_TEST_OUTPUT;
if (!base || !output) throw new Error('Run with an isolated test server.');
await mkdir(output, { recursive: true });
const browser = await testBrowser();
const errors = [], forbidden = [], calls = [];
let config = { ...defaultModelConnection, configured: false, token: 'qa', startupMode: 'adaptive' };
let rejectSave = false, rejectTest = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    const json = (value, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.origin !== base) return void request.abort();
    if (!url.pathname.startsWith('/api/')) return void request.continue();
    const body = request.postData() ? JSON.parse(request.postData()) : {};
    calls.push({ path: url.pathname, method: request.method(), body });
    if (url.pathname === '/api/library') return void json({ documents: [createDemo()] });
    if (url.pathname === '/api/config') {
      if (request.method() === 'POST') {
        if (rejectSave) return void json({ error: '模拟保存失败' }, 500);
        const { apiKey, ...fields } = body;
        config = { ...config, ...fields, configured: !!apiKey };
      }
      return void json(config);
    }
    if (url.pathname === '/api/test') return void json(rejectTest ? { error: '模拟连接失败' } : { ok: true }, rejectTest ? 400 : 200);
    forbidden.push(url.pathname); return void request.abort();
  });
  const click = async text => {
    for (const button of await page.$$('button')) if (await button.evaluate((el, text) => el.textContent.trim() === text, text)) return button.click();
    throw new Error(`Button missing: ${text}`);
  };
  const read = () => page.evaluate(async () => {
    const db = await new Promise((resolve,reject) => { const q = indexedDB.open('reading-tree',1); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    const get = (store, key) => new Promise((resolve,reject) => { const q = key === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    const result = { documents: await get('documents'), collection: await get('preferences','collection'), profile: await get('preferences','knowledge'), setup: await get('preferences','learner-setup-v1'), preferences: await get('preferences') }; db.close(); return result;
  });
  await page.goto(base+'/', { waitUntil:'networkidle0' });
  await page.waitForSelector('#welcome-background');
  assert.equal(await page.$eval('#welcome-background', el => el.value), '');
  assert.equal(await page.$eval('#welcome-foundations', el => el.value), '');
  assert.equal(await page.$('.application-shell'), null);
  await page.keyboard.press('Escape');
  assert.ok(await page.$('.welcome'));
  assert.ok(!/必填|可稍后设置/.test(await page.$eval('.welcome', el => el.textContent)));
  await page.type('#welcome-background', 'Unsaved draft'); await page.click('.welcome-skip');
  await page.waitForSelector('#welcome-key'); await page.click('.welcome-finish .primary');
  await page.waitForSelector('.application-shell');
  assert.equal((await read()).profile.background, '', 'Skip must not silently save a draft or invent a profile');
  await page.reload({ waitUntil:'networkidle0' }); await page.waitForSelector('.application-shell');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  await page.click('[aria-label="根系 · 学习画像"]'); await click('清除画像，重新填写'); await click('确认清除画像');
  await page.waitForSelector('#welcome-background');
  await page.type('#welcome-background', 'Independent learner');
  await page.type('#welcome-foundations', 'Basic mathematics');
  for (const theme of ['sage','dark','light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.waitForFunction(theme => theme === 'sage' || getComputedStyle(document.querySelector('.welcome-next')).backgroundColor === (theme === 'dark' ? 'rgb(238, 238, 238)' : 'rgb(34, 34, 34)'), {}, theme);
    await page.screenshot({ path: `${output}/profile-${theme}.png` });
  }
  await page.evaluate(() => document.documentElement.dataset.theme = 'sage');
  for (const size of [{width:1000,height:700},{width:390,height:844}]) {
    await page.setViewport(size);
    assert.ok(await page.$eval('.welcome', el => el.scrollWidth <= el.clientWidth));
    if (size.width === 1000) assert.ok(await page.$eval('.welcome', el => el.scrollHeight <= el.clientHeight + 1), 'Desktop first entry should fit without scrolling');
  }
  await page.setViewport({width:1280,height:800});
  await page.click('.welcome-next'); await page.waitForSelector('#welcome-key');
  assert.equal((await read()).setup.step, 'connection');
  await page.reload({waitUntil:'networkidle0'}); await page.waitForSelector('#welcome-key');
  assert.equal(await page.$('#welcome-background'), null, 'A saved first step resumes at optional connection');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  await page.click('.welcome-finish .primary'); await page.waitForSelector('.application-shell');
  assert.equal((await read()).setup.step, 'complete');
  await page.reload({waitUntil:'networkidle0'}); await page.waitForSelector('.application-shell');
  assert.equal(await page.$('.welcome'), null);
  const before = await read();

  await page.keyboard.press('F1'); await page.waitForSelector('.help-guide');
  for (const topic of ['start','library','reading','tree','model','storage','about']) {
    await page.click(`[data-help-topic="${topic}"]`);
    assert.ok(await page.$eval('.help-pane', el => el.scrollWidth <= el.clientWidth));
  }
  await page.click('.help-acknowledgements summary');
  assert.ok(await page.$eval('.help-acknowledgements', el => el.open && el.textContent.includes('OpenIntro')));
  await page.click('[data-help-topic="storage"]');
  assert.match(await page.$eval('.help-local-storage', el => el.textContent), /当前浏览器/);
  await page.setViewport({width:390,height:844});
  assert.ok(await page.$eval('dialog', el => el.scrollWidth <= el.clientWidth));
  await page.setViewport({width:1280,height:800});
  await page.screenshot({path: `${output}/help.png`});
  await page.click('[data-help-topic="model"]'); await click('打开模型连接');
  await page.waitForSelector('.settings-panel'); await page.click('[aria-label="关闭弹窗"]');

  await page.click('[aria-label="根系 · 学习画像"]'); await click('清除画像，重新填写'); await click('确认清除画像');
  await page.waitForSelector('#welcome-background');
  assert.equal(await page.$eval('#welcome-background', el => el.value), '');
  const cleared = await read(); assert.equal(cleared.profile.background, '');
  assert.deepEqual(cleared.documents, before.documents); assert.deepEqual(cleared.collection, before.collection);
  await page.type('#welcome-background', 'Start from basics'); await page.click('.welcome-next'); await page.waitForSelector('#welcome-key');
  await page.type('#welcome-key', 'OFFLINE_TEST_KEY_DO_NOT_USE');
  rejectTest = true; await click('测试连接'); await page.waitForSelector('.welcome [role="alert"]');
  assert.equal(config.configured, false); assert.equal((await read()).setup.step, 'connection');
  rejectTest = false; await click('测试连接'); await page.waitForSelector('.welcome [role="status"]');
  assert.equal(config.configured, false, 'Testing does not save credentials');
  rejectSave = true; await click('保存连接'); await page.waitForSelector('.welcome [role="alert"]');
  assert.equal(config.configured, false); assert.equal((await read()).setup.step, 'connection');
  rejectSave = false; await click('保存连接'); await page.waitForSelector('.welcome-connected');
  assert.equal(config.configured, true); assert.equal(await page.$('input[type="password"]'), null);
  assert.ok(!JSON.stringify((await read()).preferences).includes('OFFLINE_TEST_KEY'), 'Credentials never enter IndexedDB');
  await page.screenshot({path:`${output}/connected.png`});
  await page.click('.welcome-finish .primary'); await page.waitForSelector('.application-shell');
  await page.reload({waitUntil:'networkidle0'}); await page.waitForSelector('.application-shell');
  assert.equal((await read()).profile.background, 'Start from basics');
  assert.deepEqual((await read()).documents, before.documents);
  assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
  const report = { status:'pass', checks:['empty profile with a direct skip','skipped draft is discarded','both steps skip without API calls','resumable optional connection','completion persists','three themes and narrow layout','F1 and all help topics','help deep link','profile-only reset','failed connection and save preserve progress','test does not save','key cleared from UI and absent from IndexedDB','existing documents preserved'], modelCalls:0 };
  await writeFile(`${output}/report.json`, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
