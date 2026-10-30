import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { testBrowser } from '../support/browser.mjs';
import { completeOnboarding } from '../support/onboarding.mjs';
import { validateResult } from '../../server/harness.mjs';
import { mockWorkflowReceipt } from '../support/workflow-receipt.mjs';
const base = process.env.PANGZHU_TEST_URL, output = process.env.PANGZHU_TEST_OUTPUT;
await mkdir(output, { recursive: true });
const documents = ['极限', '导数', '英语阅读', '微分练习'].map((title, i) => ({ id: `source-${i}`, title, subtitle: 'Synthetic test material', filename: `${title}.txt`, kind: 'text', intent: '看懂这篇文章', createdAt: i + 1, updatedAt: 1, revision: 0, versions: [], currentChapter: `chapter-${i}`, currentPage: 1,
  pages: [{ number: 1, text: `Source ${i}: A derivative measures the instantaneous rate of change. The limit defines this local behavior.` }], chapters: [{ id: `chapter-${i}`, title, sourcePages: [1], status: 'empty', content: { type: 'doc', content: [] } }] }));
const collection = { version: 1, folders: [{ id: 'final', name: '期末复习', kind: 'bundle' }, { id: 'math', name: '数学', parentId: 'final', kind: 'bundle' }, { id: 'unit', name: '第一单元', parentId: 'math', kind: 'bundle' }, { id: 'english', name: '英语', parentId: 'final', kind: 'bundle' }], items: Object.fromEntries(['math', 'unit', 'english', 'unit'].map((folderId, i) => [`source-${i}`, { folderId, status: 'imported', inTree: true }])) };
const browser = await testBrowser();
const page = await browser.newPage();
const requests = [], errors = [];
let failedOnce = false;
let failPendingChapter;
const secondChapterPending = new Promise(resolve => { failPendingChapter = resolve; });
let failFirstChapter = false, rejectFirstChapter;
const firstChapterPending = new Promise(resolve => { rejectFirstChapter = resolve; });
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
      if (input.action === 'bundle-plan') return void json({ result: { sections: input.units.map((unit, i) => ({ title: ['从极限到变化率', '导数的局部含义', '运用微分'][i], purpose: '理解局部变化如何由极限建立。', unitIds: [unit.id] })) } });
      if (input.action === 'select-template') return void json({ result: { templateId: 'lecture', reason: '复习讲义使用结构化模板。' } });
      if (input.action === 'generate') {
        if (failFirstChapter) {
          failFirstChapter = false;
          rejectFirstChapter(() => json({ error: '第一章审查未通过。', code: 'WORKFLOW_REVIEW_FAILED', recovery: { stopRun: true },
            workflow: mockWorkflowReceipt(input, { outcome: 'blocked', reviewedSegments: 0, reviewCalls: 0, repairsUsed: 1, diagnoses: ['REVIEW_UNRESOLVED'] }) }, 400));
          return;
        }
        if (input.chapterId === 'note-section-2' && !failedOnce) { failedOnce = true; failPendingChapter(() => json({ error: '引用自动校正仍缺少可靠来源，已暂停后续章节。', code: 'REFERENCE_REPAIR_FAILED', recovery: { stopRun: true }, workflow: mockWorkflowReceipt(input, { outcome: 'blocked', reviewedSegments: 0, reviewCalls: 0, repairsUsed: 1, diagnoses: ['ORIGINAL_PAGE_AS_ID'] }) }, 400)); return; }
        const chapter = input.document.chapters.find(c => c.id === input.chapterId);
        const raw = { blocks: [{ type: 'paragraph', text: '导数从一个局部问题开始：当输入发生很小的变化，输出如何响应？', sourcePages: chapter.sourcePages, sourceQuote: '' }, { type: 'paragraph', text: String.raw`利用极限把平均变化率收敛为瞬时变化率，写成 \(f\prime(x)=\lim_{h\to0}\frac{f(x+h)-f(x)}{h}\)。`, sourcePages: chapter.sourcePages, sourceQuote: '' }] };
        try { return void json({ result: validateResult(input, raw), model: 'mock', workflow: mockWorkflowReceipt(input) }); } catch (error) { errors.push(error.message); return void json({ error: error.message }, 400); }
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
    if (name === '数学') await (await page.$('[aria-label="展开文件夹 期末复习"]'))?.click();
    for (const button of await page.$$('.collection-folder-link')) if ((await button.evaluate(el => el.querySelector('span').textContent)) === name) { await button.click(); break; }
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
  assert.ok(await page.$('[data-folder-id="final"]'));
  assert.equal(await page.$('[data-folder-id="math"]'), null, 'Nested folders are collapsed by default');
  assert.equal(await page.$('[data-folder-id="unit"]'), null);
  const beforeExpand = await page.$eval('.collection-title h1', el => el.textContent);
  await page.focus('[aria-label="展开文件夹 期末复习"]'); await page.keyboard.press('Enter');
  await page.waitForSelector('[data-folder-id="math"]');
  assert.equal(await page.$('[data-folder-id="unit"]'), null, 'Expanding one level does not open its children');
  assert.equal(await page.$eval('.collection-title h1', el => el.textContent), beforeExpand, 'Disclosure does not navigate');
  await page.click('[aria-label="展开文件夹 数学"]'); await page.waitForSelector('[data-folder-id="unit"]');
  await page.click('[aria-label="收起文件夹 数学"]');
  await page.click('[aria-label="收起文件夹 期末复习"]');
  assert.equal(await page.$('[data-folder-id="math"]'), null);
  await page.screenshot({ path: `${output}/folders-collapsed.png` });
  await folder('期末复习');
  await page.click('.nested-folders>button[title="期末复习 / 数学"]');
  await page.waitForSelector('[data-folder-id="math"]');
  assert.equal(await page.$eval('[data-folder-id="math"] .collection-folder-link', el => el.getAttribute('aria-current')), 'page');
  assert.equal(await page.$('[data-folder-id="unit"]'), null, 'Card navigation reveals only the destination ancestors');
  await page.screenshot({ path: `${output}/folders-expanded.png` });
  await folder('期末复习');
  assert.equal((await page.$$('.nested-folders>button:not(.new-nested-folder)')).length, 2);
  await click('新建笔记');
  assert.match(await page.$eval('.bundle-source-inventory summary', el => el.textContent), /4 份/);
  await click('取消');
  await folder('数学');
  await click('新建下属资料包');
  assert.equal(await page.$eval('[aria-label="上级文件夹"]', el => el.value), 'math');
  await page.type('[aria-label="文件夹名称"]', '第二单元'); await click('创建资料包');
  await page.waitForSelector('dialog', { hidden: true });
  assert.equal((await state()).collection.folders.find(f => f.name === '第二单元').parentId, 'math');
  await click('新建笔记');
  assert.match(await page.$eval('.bundle-source-inventory summary', el => el.textContent), /3 份/);
  assert.match(await page.$eval('[aria-label="整理要求"]', el => el.value), /下属资料包/);
  await page.type('[aria-label="笔记名称"]', '数学复习讲义');
  await page.screenshot({ path: `${output}/new-note.png` });
  await click('创建并打开笔记');
  const failChapter = await secondChapterPending;
  await page.waitForFunction(() => document.querySelector('.preparation-banner progress')?.value === 1 && document.querySelector('.learning-article')?.textContent.includes('导数从一个局部问题开始'));
  assert.equal((await state()).documents.find(d => d.entryType === 'note').preparation.completedIds.length, 1, 'Completed prose is saved and visible while the next request is pending');
  await failChapter();
  await page.waitForSelector('.preparation-banner details');
  assert.equal(requests.filter(r => r.action === 'bundle-plan').length, 1);
  const plan = requests.find(r => r.action === 'bundle-plan');
  assert.deepEqual(plan.units.map(unit => unit.sourceId), ['source-0', 'source-1', 'source-3']);
  assert.equal(requests.filter(r => r.chapterId === 'note-section-3').length, 0, 'The semantic failure must stop the cascade');
  assert.match(await page.$eval('.preparation-banner>p', el => el.textContent), /已停止后续章节/);
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
  assert.equal(note.sourceContext.sources.length, 3); assert.equal(note.preparation.status, 'complete');
  assert.equal(note.preparation.workflow.history.length, 4);
  assert.ok(requests.find(r => r.chapterId === 'note-section-3').workflow.priorDiagnoses.includes('ORIGINAL_PAGE_AS_ID'));
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

  // A first-chapter failure leaves no ready prose, but must still expose the
  // same goal + feedback + replan flow as a successfully generated notebook.
  await page.click('[aria-label="资料库"]'); await folder('数学');
  await click('新建笔记'); await page.type('[aria-label="笔记名称"]', '首章失败的复习讲义');
  failFirstChapter = true;
  await click('创建并打开笔记');
  const rejectFirst = await firstChapterPending;
  assert.equal(await page.$eval('.document-meta>.intent-pill', el => el.disabled), true, 'Cannot regenerate during an active call');
  await rejectFirst();
  await page.waitForFunction(() => [...document.querySelectorAll('.preparation-banner button')].some(button => button.textContent.trim() === '继续未完成部分' && !button.disabled));
  const failed = (await state()).documents.find(d => d.title === '首章失败的复习讲义');
  assert.equal(failed.preparation.status, 'partial');
  assert.equal(failed.preparation.completedIds.length, 0);
  assert.ok(failed.chapters.every(chapter => chapter.status === 'empty'));
  // Reopen an older save containing errors from chapters never retried in this
  // attempt. Only the actual stopping chapter belongs to the current failure.
  await page.evaluate(async failed => {
    const next = structuredClone(failed);
    delete next.preparation.currentErrorIds;
    for (const chapter of next.chapters.slice(1)) next.preparation.errors[chapter.id] = '生成笔记引用了本章以外的原文页码。';
    if (next.notebooks?.[next.activeNotebookId]) next.notebooks[next.activeNotebookId].preparation = next.preparation;
    const db = await new Promise(resolve => { const req = indexedDB.open('reading-tree'); req.onsuccess = () => resolve(req.result); });
    await new Promise(resolve => { const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(next); tx.oncomplete = resolve; });
    db.close();
  }, failed);
  await page.reload({ waitUntil: 'networkidle0' });
  await folder('数学');
  await page.click('[aria-label="打开 首章失败的复习讲义"]');
  await page.waitForSelector('.previous-generation-errors');
  assert.match(await page.$eval('.current-generation-errors summary', el => el.textContent), /本轮 1 个问题/);
  assert.match(await page.$eval('.previous-generation-errors summary', el => el.textContent), /此前错误记录 · 2 条/);
  assert.equal(await page.$eval('.previous-generation-errors', el => el.open), false);
  assert.doesNotMatch(await page.$eval('.current-generation-errors', el => el.textContent), /本章以外/);
  await page.screenshot({ path: `${output}/current-and-previous-errors.png` });
  const failedCalls = requests.length;
  await click('调整并重新生成');
  await page.waitForSelector('[aria-label="重新生成的调整要求"]');
  await page.screenshot({ path: `${output}/regenerate-after-first-failure.png` });
  const replace = async (selector, text) => page.$eval(selector, (el, text) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await replace('[aria-label="我的学习目标"]', '整理成可独立复习的知识讲义');
  await replace('[aria-label="重新生成的调整要求"]', '先说明概念，再解释计算思路');
  await click('取消');
  assert.equal(requests.length, failedCalls, 'Opening/cancelling never generates');
  assert.equal((await state()).documents.find(d => d.id === failed.id).intent, failed.intent);
  await click('调整并重新生成');
  await replace('[aria-label="我的学习目标"]', '整理成可独立复习的知识讲义');
  await replace('[aria-label="重新生成的调整要求"]', '先说明概念，再解释计算思路');
  await click('保存目标并重新生成');
  await page.waitForSelector('dialog', { hidden: true });
  await page.waitForFunction(() => !document.querySelector('.preparation-banner'));
  const regenerated = (await state()).documents.find(d => d.id === failed.id);
  const regenerationCalls = requests.slice(failedCalls);
  assert.deepEqual(regenerationCalls.map(request => request.action), ['bundle-plan', 'select-template', 'generate', 'generate', 'generate']);
  assert.equal(regenerationCalls[0].intent, '整理成可独立复习的知识讲义');
  assert.equal(regenerationCalls[0].feedback, '先说明概念，再解释计算思路');
  assert.equal(regenerationCalls[2].document.intent, regenerationCalls[0].intent);
  assert.equal(regenerationCalls[2].learning.regenerationFeedback, regenerationCalls[0].feedback);
  assert.equal(regenerated.preparation.status, 'complete');
  assert.deepEqual(regenerated.preparation.errors, {});
  assert.deepEqual(regenerated.sourceContext, failed.sourceContext);
  assert.deepEqual(regenerated.versions[0].chapters, failed.chapters);
  assert.deepEqual((await state()).documents.find(d => d.id === note.id).chapters, note.chapters, 'Other notes are untouched');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ passed: true, calls: requests.map(r => ({ action: r.action, chapterId: r.chapterId })), checks: ['nested navigation', 'create child bundle', 'source scope excludes siblings', 'standalone note creation', 'completed prose visible while generating next chapter', 'exhausted semantic recovery stops subsequent chapters', 'resume without duplicate chapters', 'shared math renderer', 'source switch', 'rename notes and materials', 'reload without calls', 'source snapshot retained', 'regenerate after first-chapter failure', 'regeneration locked while active', 'cancel preserves goal without calls', 'new goal and feedback reach replan and generation', 'regeneration retains sources, history and other notes'] }, null, 2));
} catch (error) { await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); throw error; }
finally { await browser.close(); }
