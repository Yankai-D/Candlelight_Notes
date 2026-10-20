import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { testBrowser } from '../support/browser.mjs';
import { completeOnboarding } from '../support/onboarding.mjs';
import { validateResult } from '../../server/harness.mjs';
const base = process.env.PANGZHU_TEST_URL, output = process.env.PANGZHU_TEST_OUTPUT;
await mkdir(output, { recursive: true });
const documents = ['极限', '导数', '英语阅读'].map((title, i) => ({ id: `source-${i}`, title, subtitle: 'Synthetic test material', filename: `${title}.txt`, kind: 'text', intent: '看懂这篇文章', createdAt: i + 1, updatedAt: 1, revision: 0, versions: [], currentChapter: `chapter-${i}`, currentPage: 1,
  pages: [{ number: 1, text: `Source ${i}: A derivative measures the instantaneous rate of change. The limit defines this local behavior.` }], chapters: [{ id: `chapter-${i}`, title, sourcePages: [1], status: 'empty', content: { type: 'doc', content: [] } }] }));
const collection = { version: 1, folders: [{ id: 'final', name: '期末复习', kind: 'bundle' }, { id: 'math', name: '数学', parentId: 'final', kind: 'bundle' }, { id: 'unit', name: '第一单元', parentId: 'math', kind: 'bundle' }, { id: 'english', name: '英语', parentId: 'final', kind: 'bundle' }], items: Object.fromEntries(['math', 'unit', 'english'].map((folderId, i) => [`source-${i}`, { folderId, status: 'imported', inTree: true }])) };
const browser = await testBrowser();
const page = await browser.newPage();
const requests = [], errors = [];
let failedOnce = false;
try {
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 950 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    const json = (value, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.endsWith('/bundle-seed')) return void request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
    if (url.endsWith('/api/config')) return void json({ configured: true, token: 'qa', model: 'mock', startupMode: 'adaptive' });
    if (url.endsWith('/api/library')) return void json({ documents });
    if (url.endsWith('/api/edit')) {
      const input = JSON.parse(request.postData()); requests.push(input);
      if (input.action === 'bundle-plan') return void json({ result: { sections: input.units.map((unit, i) => ({ title: ['从极限到变化率', '导数的局部含义'][i], purpose: '理解局部变化如何由极限建立。', unitIds: [unit.id] })) } });
      if (input.action === 'select-template') return void json({ result: { templateId: 'lecture', reason: '复习讲义使用结构化模板。' } });
      if (input.action === 'generate') {
        if (input.chapterId === 'note-section-2' && !failedOnce) { failedOnce = true; return void json({ error: '模拟网络中断，已完成章节保留。' }, 400); }
        const chapter = input.document.chapters.find(c => c.id === input.chapterId);
        const raw = { blocks: [{ type: 'paragraph', text: '导数从一个局部问题开始：当输入发生很小的变化，输出如何响应？', sourcePages: chapter.sourcePages, sourceQuote: '' }, { type: 'paragraph', text: String.raw`利用极限把平均变化率收敛为瞬时变化率，写成 \(f\prime(x)=\lim_{h\to0}\frac{f(x+h)-f(x)}{h}\)。`, sourcePages: chapter.sourcePages, sourceQuote: '' }] };
        try { return void json({ result: validateResult(input, raw), model: 'mock' }); } catch (error) { errors.push(error.message); return void json({ error: error.message }, 400); }
      }
      errors.push(`unexpected action ${input.action}`); return void request.abort();
    }
    if (url.includes('/api/') || !url.startsWith(base + '/')) return void request.abort();
    void request.continue();
  });
  const click = async (text, selector = 'button') => {
    for (const button of await page.$$(selector)) if ((await button.evaluate(el => el.textContent.trim())) === text) { await button.click(); return; }
    throw new Error(`Button not found: ${text}`);
  };
  const folder = async name => {
    for (const button of await page.$$('.collection-folders>button')) if ((await button.evaluate(el => el.querySelector('span').textContent)) === name) { await button.click(); break; }
    await page.waitForFunction(name => document.querySelector('.collection-title h1')?.textContent === name, {}, name);
  };
  const state = () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('reading-tree'); req.onsuccess = () => resolve(req.result); });
    const read = (store, key) => new Promise(resolve => { const req = key ? db.transaction(store).objectStore(store).get(key) : db.transaction(store).objectStore(store).getAll(); req.onsuccess = () => resolve(req.result); });
    const value = { documents: await read('documents'), collection: await read('preferences', 'collection') }; db.close(); return value;
  });
  await page.goto(base + '/bundle-seed');
  await page.evaluate(async collection => {
    const db = await new Promise(resolve => { const req = indexedDB.open('reading-tree', 1); req.onupgradeneeded = () => { req.result.createObjectStore('documents', { keyPath: 'id' }); req.result.createObjectStore('files'); req.result.createObjectStore('preferences'); }; req.onsuccess = () => resolve(req.result); });
    await new Promise(resolve => { const tx = db.transaction('preferences', 'readwrite'); tx.objectStore('preferences').put(collection, 'collection'); tx.oncomplete = resolve; }); db.close();
  }, collection);
  await page.goto(base + '/', { waitUntil: 'networkidle0' }); await completeOnboarding(page);
  await folder('期末复习');
  assert.equal((await page.$$('.nested-folders>button:not(.new-nested-folder)')).length, 2);
  await click('新建笔记');
  assert.match(await page.$eval('.bundle-source-inventory summary', el => el.textContent), /3 份/);
  await click('取消');
  await folder('数学');
  await click('新建下属资料包');
  assert.equal(await page.$eval('[aria-label="上级文件夹"]', el => el.value), 'math');
  await page.type('[aria-label="文件夹名称"]', '第二单元'); await click('创建资料包');
  await page.waitForSelector('dialog', { hidden: true });
  assert.equal((await state()).collection.folders.find(f => f.name === '第二单元').parentId, 'math');
  await click('新建笔记');
  assert.match(await page.$eval('.bundle-source-inventory summary', el => el.textContent), /2 份/);
  assert.match(await page.$eval('[aria-label="整理要求"]', el => el.value), /下属资料包/);
  await page.type('[aria-label="笔记名称"]', '数学复习讲义');
  await page.screenshot({ path: `${output}/new-note.png` });
  await click('创建并打开笔记');
  await page.waitForSelector('.preparation-banner details');
  assert.equal(requests.filter(r => r.action === 'bundle-plan').length, 1);
  const plan = requests.find(r => r.action === 'bundle-plan');
  assert.deepEqual(plan.units.map(unit => unit.sourceId), ['source-0', 'source-1']);
  assert.equal(await page.$('[aria-label="阅读方式"]'), null);
  // An error can render before the pending checkpoint finishes. Resume is
  // available only after generation has settled and released its busy state.
  await page.waitForFunction(() => [...document.querySelectorAll('.preparation-banner button')].some(button => button.textContent.trim() === '继续未完成部分' && !button.disabled));
  await click('继续未完成部分');
  await page.waitForFunction(() => !document.querySelector('.preparation-banner'));
  assert.equal(requests.filter(r => r.chapterId === 'note-section-1').length, 1);
  assert.equal(requests.filter(r => r.chapterId === 'note-section-2').length, 2);
  await page.waitForSelector('.math-node, mjx-container, .math-inline');
  const note = (await state()).documents.find(d => d.entryType === 'note');
  assert.equal(note.sourceContext.sources.length, 2); assert.equal(note.preparation.status, 'complete');
  const formula = note.chapters[0].content.content.flatMap(node => node.content || []).find(node => node.type === 'math');
  assert.match(formula.attrs.latex, /\\prime/);
  assert.ok(!formula.attrs.latex.includes('fprime'), 'A malformed fixture must not silently become plain letters');
  await page.select('[aria-label="选择参考原文"]', 'source-1');
  await page.waitForFunction(() => document.querySelector('.source-flow-text')?.textContent.includes('Source 1:'));
  await page.screenshot({ path: `${output}/reading.png` });
  await page.click('[aria-label="资料库"]'); await folder('数学');
  assert.ok(await page.$('.standalone-note-icon'));
  await page.click('[aria-label="整理 数学复习讲义"]');
  await page.$eval('[aria-label="修改名称"]', el => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '微积分复习'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('保存名称'); await click('完成');
  await page.waitForSelector('[aria-label="打开 微积分复习"]');
  await page.click('[aria-label="整理 极限"]');
  await page.$eval('[aria-label="修改名称"]', el => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '极限讲义'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('保存名称'); await click('完成');
  await page.waitForSelector('[aria-label="打开 极限讲义"]');
  await page.screenshot({ path: `${output}/library.png` });
  const before = requests.length;
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click('[aria-label="打开 微积分复习"]'); await page.waitForSelector('.learning-article');
  assert.equal(requests.length, before);
  assert.equal((await state()).documents.find(d => d.id === note.id).sourceContext.sources[0].title, '极限');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ passed: true, calls: requests.map(r => ({ action: r.action, chapterId: r.chapterId })), checks: ['nested navigation', 'create child bundle', 'source scope excludes siblings', 'standalone note creation', 'resume without duplicate chapters', 'shared math renderer', 'source switch', 'rename notes and materials', 'reload without calls', 'source snapshot retained'] }, null, 2));
} catch (error) { await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); throw error; }
finally { await browser.close(); }
